<?php
// Motor único de cobro: calcula cuánto se cobra por una partida de mesa o por un carrito de barra.
// La pantalla solo muestra lo que devuelve este motor, y el cobro lo vuelve a calcular antes de guardar.
//
// Reglas del negocio (cada una tiene un caso en tests/simulador/oraculo.test.js):
//  - El tiempo se cobra en bloques de 5 minutos que se cobran al iniciar: 00:01 cobra el primero, 05:01 el segundo.
//  - Cada bloque usa la tarifa vigente cuando empieza: la de lista, la de una promo de tarifa o la del incentivo en mesa.
//  - El incentivo en mesa baja la tarifa solo desde que se cumplen las horas mínimas, no hacia atrás.
//  - La hora gratis del incentivo en producto deja en cero los primeros 12 bloques que tienen tarifa.
//  - Un producto conserva el precio y las promos del momento en que se pidió, aunque se pague después.
//  - 2x1: de cada par de unidades pedidas en horario de promo, una es gratis (5 unidades pagan 3).
//  - El total se redondea hacia arriba a .00 o .50, porque no hay monedas menores a 50 centavos.
//
// Todo se calcula en centavos para no arrastrar errores de decimales; los resultados salen en Bs.

// Error que la pantalla sabe manejar por su código. Lo que va en $datos se agrega a la respuesta.
class ErrorOperacion extends Exception {
    public $codigo;
    public $datos;

    public function __construct($mensaje, $codigo, array $datos = []) {
        parent::__construct($mensaje);
        $this->codigo = $codigo;
        $this->datos = $datos;
    }
}

class Liquidacion {
    const SEG_BLOQUE = 300;
    const BLOQUES_POR_HORA = 12;
    const BLOQUES_HORA_GRATIS = 12;
    const CENTAVOS_MONEDA_MINIMA = 50;

    public static function cargarPromos($pdo) {
        return $pdo->query("SELECT * FROM promociones")->fetchAll(PDO::FETCH_ASSOC);
    }

    // Inicio incluido y fin excluido: con una promo hasta las 21:00, el bloque que empieza a las 21:00 ya va sin promo.
    // Un horario que cruza la medianoche pertenece al día en que comienza.
    public static function promoActivaEn(array $promo, $ts) {
        $hora = date('H:i:s', $ts);
        $inicio = !empty($promo['hora_inicio']) ? $promo['hora_inicio'] : null;
        $fin = !empty($promo['hora_fin']) ? $promo['hora_fin'] : null;

        if ($inicio !== null && $fin !== null && $inicio > $fin) {
            if ($hora >= $inicio) return self::cumpleFechaYDia($promo, $ts);
            if ($hora < $fin) return self::cumpleFechaYDia($promo, strtotime('-1 day', $ts));
            return false;
        }
        if ($inicio !== null && $hora < $inicio) return false;
        if ($fin !== null && $hora >= $fin) return false;
        return self::cumpleFechaYDia($promo, $ts);
    }

    public static function promosActivasEn(array $promos, $ts) {
        $activas = [];
        foreach ($promos as $promo) {
            if (self::promoActivaEn($promo, $ts)) $activas[] = $promo;
        }
        return $activas;
    }

    private static function cumpleFechaYDia(array $promo, $ts) {
        $fecha = date('Y-m-d', $ts);
        if (!empty($promo['fecha_inicio']) && $fecha < $promo['fecha_inicio']) return false;
        if (!empty($promo['fecha_fin']) && $fecha > $promo['fecha_fin']) return false;
        if (!empty($promo['dias_semana'])) {
            $dias = [1 => 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
            $permitidos = array_map([self::class, 'normalizarDia'], explode(',', $promo['dias_semana']));
            if (!in_array($dias[intval(date('N', $ts))], $permitidos, true)) return false;
        }
        return true;
    }

    private static function normalizarDia($dia) {
        $sinTildes = str_replace(['á', 'é', 'í', 'ó', 'ú', 'Á', 'É', 'Í', 'Ó', 'Ú'], ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o', 'u'], trim($dia));
        return strtolower($sinTildes);
    }

    public static function centavos($bs) {
        return (int) round(floatval($bs) * 100);
    }

    private static function bs($centavos) {
        return round($centavos / 100, 2);
    }

    // Siempre hacia arriba, a la moneda más chica que existe.
    public static function redondearCobro($centavos) {
        return (int) (ceil($centavos / self::CENTAVOS_MONEDA_MINIMA) * self::CENTAVOS_MONEDA_MINIMA);
    }

    // ---------------------------------------------------------------- tiempo

    // Tarifa por hora, en centavos, del bloque que empieza en $ts cuando la partida ya lleva $segJugados.
    // Si coinciden varios beneficios se aplica el precio más bajo.
    private static function tarifaBloque($idTipo, $lista, $ts, $segJugados, array $promosMesa) {
        $tarifa = $lista;
        foreach ($promosMesa as $promo) {
            if (intval($promo['id_item_condicion']) !== $idTipo) continue;
            if ($promo['tipo_promo'] === 'incentivo_mesa' && $segJugados < floatval($promo['cantidad_condicion']) * 3600) continue;
            if (!self::promoActivaEn($promo, $ts)) continue;
            $tarifa = min($tarifa, self::centavos($promo['valor_descuento']));
        }
        return $tarifa;
    }

    // $tramos: filas con id_tramo, numero_mesa, id_tipo_mesa, precio_hora, fecha_hora_inicio, fecha_hora_fin, fecha_hora_pausa.
    // Un tramo abierto termina en su pausa o, si no está pausado, en $corte.
    public static function liquidarTiempo(array $tramos, $horaGratis, array $promos, $corte) {
        $promosMesa = array_values(array_filter($promos, function ($p) {
            return ($p['tipo_promo'] === 'tarifa_mesa' || $p['tipo_promo'] === 'incentivo_mesa') && $p['valor_descuento'] !== null;
        }));
        $gratisPendientes = $horaGratis ? self::BLOQUES_HORA_GRATIS : 0;
        $segJugados = 0;
        $totalCentavos = 0;
        $segPorTipo = [];
        $detalle = [];
        $proximoCambio = null;

        foreach ($tramos as $tramo) {
            $inicio = strtotime($tramo['fecha_hora_inicio']);
            $cierre = $tramo['fecha_hora_fin'] ?: $tramo['fecha_hora_pausa'];
            $fin = $cierre ? strtotime($cierre) : $corte;
            $seg = max(0, $fin - $inicio);
            $bloques = (int) ceil($seg / self::SEG_BLOQUE);
            $idTipo = intval($tramo['id_tipo_mesa']);
            $lista = self::centavos($tramo['precio_hora']);

            // Se suman tarifas enteras y se divide una sola vez por tramo para no acumular redondeos.
            $sumaTarifas = 0;
            for ($k = 0; $k < $bloques; $k++) {
                $tarifa = self::tarifaBloque($idTipo, $lista, $inicio + $k * self::SEG_BLOQUE, $segJugados + $k * self::SEG_BLOQUE, $promosMesa);
                if ($tarifa > 0 && $gratisPendientes > 0) {
                    $gratisPendientes--;
                    continue;
                }
                $sumaTarifas += $tarifa;
            }
            $importe = (int) round($sumaTarifas / self::BLOQUES_POR_HORA);
            $totalCentavos += $importe;
            $segJugados += $seg;
            $segPorTipo[$idTipo] = (isset($segPorTipo[$idTipo]) ? $segPorTipo[$idTipo] : 0) + $seg;

            // El tramo en curso cambia de importe cuando empieza su próximo bloque.
            if (!$cierre) {
                $proximoCambio = $bloques * self::SEG_BLOQUE - $seg + 1;
            }

            $detalle[] = [
                'id_tramo' => intval($tramo['id_tramo']),
                'numero_mesa' => $tramo['numero_mesa'],
                'inicio' => $tramo['fecha_hora_inicio'],
                'fin' => $tramo['fecha_hora_fin'],
                'pausa' => $tramo['fecha_hora_pausa'],
                'segundos' => $seg,
                'bloques' => $bloques,
                'importe' => self::bs($importe),
            ];
        }

        return [
            'centavos' => $totalCentavos,
            'segundos' => $segJugados,
            'seg_por_tipo' => $segPorTipo,
            'tramos' => $detalle,
            'proximo_cambio' => $proximoCambio,
        ];
    }

    // ---------------------------------------------------------------- productos

    // Precio unitario, en centavos, de un producto pedido en $ts: el de lista o el de una promo de descuento vigente.
    public static function precioVigente($idProducto, $precioLista, $ts, array $promos) {
        $precio = self::centavos($precioLista);
        foreach ($promos as $promo) {
            if ($promo['tipo_promo'] !== 'descuento_producto' || $promo['valor_descuento'] === null) continue;
            if (intval($promo['id_item_condicion']) !== intval($idProducto)) continue;
            if (!self::promoActivaEn($promo, $ts)) continue;
            $precio = min($precio, self::centavos($promo['valor_descuento']));
        }
        return $precio;
    }

    // $lineas: id_producto, nombre, cantidad, precio (centavos), ts (momento del pedido).
    // $tiempo: resultado de liquidarTiempo, para el incentivo cruzado (en barra, sin tiempo).
    public static function liquidarProductos(array $lineas, array $promos, array $tiempo) {
        $subtotal = 0;
        foreach ($lineas as $linea) {
            $subtotal += $linea['cantidad'] * $linea['precio'];
        }

        $descuento = 0;
        $detalles = [];
        foreach ($promos as $promo) {
            $idProducto = intval($promo['id_item_condicion']);
            $enPromo = array_values(array_filter($lineas, function ($l) use ($promo, $idProducto) {
                return $l['id_producto'] === $idProducto && Liquidacion::promoActivaEn($promo, $l['ts']);
            }));
            if (!$enPromo) continue;

            $monto = 0;
            if ($promo['tipo_promo'] === 'combo_2x1') {
                // De cada par se regala una unidad; si hubiera precios distintos, se regalan las más baratas.
                $precios = [];
                foreach ($enPromo as $l) {
                    for ($i = 0; $i < $l['cantidad']; $i++) $precios[] = $l['precio'];
                }
                sort($precios);
                $monto = array_sum(array_slice($precios, 0, intdiv(count($precios), 2)));
            } elseif ($promo['tipo_promo'] === 'incentivo_cruzado' && $promo['valor_descuento'] !== null) {
                $idTipoMesa = !empty($promo['id_item_secundario']) ? intval($promo['id_item_secundario']) : null;
                $seg = $idTipoMesa
                    ? (isset($tiempo['seg_por_tipo'][$idTipoMesa]) ? $tiempo['seg_por_tipo'][$idTipoMesa] : 0)
                    : $tiempo['segundos'];
                if ($seg < floatval($promo['cantidad_condicion']) * 3600) continue;
                $especial = self::centavos($promo['valor_descuento']);
                foreach ($enPromo as $l) {
                    if ($l['precio'] > $especial) $monto += ($l['precio'] - $especial) * $l['cantidad'];
                }
            }
            if ($monto <= 0) continue;

            $descuento += $monto;
            $detalles[] = [
                'tipo' => $promo['tipo_promo'],
                'nombre' => $promo['nombre_promo'],
                'producto' => $enPromo[0]['nombre'],
                'monto' => self::bs($monto),
            ];
        }

        return ['subtotal' => $subtotal, 'descuento' => min($descuento, $subtotal), 'detalles' => $detalles];
    }

    // ---------------------------------------------------------------- resultado

    private static function armar($corte, array $tiempo, $horaGratis, array $lineas, array $productos) {
        $neto = max(0, $tiempo['centavos'] + $productos['subtotal'] - $productos['descuento']);
        $total = self::redondearCobro($neto);
        return [
            'corte' => date('Y-m-d H:i:s', $corte),
            'tramos' => $tiempo['tramos'],
            'segundos' => $tiempo['segundos'],
            'hora_gratis' => (bool) $horaGratis,
            'tiempo' => self::bs($tiempo['centavos']),
            'productos' => array_map(function ($l) {
                return [
                    'id_detalle_prod' => isset($l['id_detalle_prod']) ? $l['id_detalle_prod'] : null,
                    'id_producto' => $l['id_producto'],
                    'nombre' => $l['nombre'],
                    'cantidad' => $l['cantidad'],
                    'precio' => Liquidacion::bsPublico($l['precio']),
                    'subtotal' => Liquidacion::bsPublico($l['precio'] * $l['cantidad']),
                ];
            }, $lineas),
            'subtotal_productos' => self::bs($productos['subtotal']),
            'descuentos' => self::bs($productos['descuento']),
            'detalles' => $productos['detalles'],
            'neto' => self::bs($neto),
            'redondeo' => self::bs($total - $neto),
            'total' => self::bs($total),
            'proximo_cambio' => $tiempo['proximo_cambio'],
        ];
    }

    public static function bsPublico($centavos) {
        return self::bs($centavos);
    }

    // Partida de mesa con corte en $corte (timestamp). Incluye el consumo aún no cobrado.
    public static function liquidarSesion($pdo, $idSesion, $corte, array $promos = null) {
        if ($promos === null) $promos = self::cargarPromos($pdo);

        $stmt = $pdo->prepare("
            SELECT t.id_tramo, m.numero_mesa, m.id_tipo_mesa, tm.precio_hora,
                   t.fecha_hora_inicio, t.fecha_hora_fin, t.fecha_hora_pausa
            FROM tramos_mesas t
            JOIN mesas m ON m.id_mesa = t.id_mesa
            JOIN tipos_mesa tm ON tm.id_tipo_mesa = m.id_tipo_mesa
            WHERE t.id_sesion = ?
            ORDER BY t.id_tramo
        ");
        $stmt->execute([$idSesion]);
        $tramos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
        $stmt->execute([$idSesion]);
        $horaGratis = intval($stmt->fetchColumn()) === 1;

        $stmt = $pdo->prepare("
            SELECT d.id_detalle_prod, d.id_producto, p.nombre_producto, d.cantidad, d.precio_unitario_aplicado, d.fecha_hora
            FROM detalle_venta_productos d
            JOIN productos p ON p.id_producto = d.id_producto
            WHERE d.id_sesion = ? AND d.id_venta IS NULL
            ORDER BY d.id_detalle_prod
        ");
        $stmt->execute([$idSesion]);
        $lineas = array_map(function ($fila) use ($corte) {
            return [
                'id_detalle_prod' => intval($fila['id_detalle_prod']),
                'id_producto' => intval($fila['id_producto']),
                'nombre' => $fila['nombre_producto'],
                'cantidad' => intval($fila['cantidad']),
                'precio' => Liquidacion::centavos($fila['precio_unitario_aplicado']),
                // Consumo cargado antes de guardar la hora del pedido: se evalúa al momento del cobro.
                'ts' => $fila['fecha_hora'] ? strtotime($fila['fecha_hora']) : $corte,
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));

        $tiempo = self::liquidarTiempo($tramos, $horaGratis, $promos, $corte);
        $productos = self::liquidarProductos($lineas, $promos, $tiempo);
        return self::armar($corte, $tiempo, $horaGratis, $lineas, $productos);
    }

    // ---------------------------------------------------------------- barra

    public static function idHoraPromo($pdo) {
        $id = $pdo->query("SELECT id_producto FROM productos WHERE nombre_producto LIKE 'Hora Promo%' LIMIT 1")->fetchColumn();
        return $id ? intval($id) : null;
    }

    // Promo de hora gratis que se cumple con estas unidades del producto pedido, para el tipo de mesa indicado.
    public static function promoHoraGratis(array $promos, $ts, array $unidadesPorProducto, $idTipoMesa = null) {
        foreach ($promos as $promo) {
            if ($promo['tipo_promo'] !== 'incentivo_producto' || !self::promoActivaEn($promo, $ts)) continue;
            if ($idTipoMesa !== null && intval($promo['id_item_secundario']) !== intval($idTipoMesa)) continue;
            $idRequerido = intval($promo['id_item_condicion']);
            $unidades = isset($unidadesPorProducto[$idRequerido]) ? $unidadesPorProducto[$idRequerido] : 0;
            if ($unidades >= floatval($promo['cantidad_condicion'])) return $promo;
        }
        return null;
    }

    // Arma las líneas con los precios del catálogo y las promos vigentes en $ts. El precio que mande la pantalla no se usa.
    // $items: [{id_producto, cantidad}]. Devuelve las líneas, la promo de hora gratis usada (si hay) y la cotización.
    public static function cotizarCarrito($pdo, array $items, $ts, array $promos) {
        $cantidades = [];
        foreach ($items as $item) {
            $id = intval(isset($item['id_producto']) ? $item['id_producto'] : 0);
            $cantidad = intval(isset($item['cantidad']) ? $item['cantidad'] : 0);
            if ($id <= 0 || $cantidad <= 0) {
                throw new ErrorOperacion('Hay un producto o una cantidad no válida en el carrito.', 'producto_invalido');
            }
            $cantidades[$id] = (isset($cantidades[$id]) ? $cantidades[$id] : 0) + $cantidad;
        }

        $catalogo = [];
        if ($cantidades) {
            $marcas = implode(',', array_fill(0, count($cantidades), '?'));
            $stmt = $pdo->prepare("SELECT id_producto, nombre_producto, precio_venta FROM productos WHERE id_producto IN ($marcas)");
            $stmt->execute(array_keys($cantidades));
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $fila) $catalogo[intval($fila['id_producto'])] = $fila;
        }

        $idHoraPromo = self::idHoraPromo($pdo);
        $promoHora = null;
        $lineas = [];
        foreach ($cantidades as $id => $cantidad) {
            if (!isset($catalogo[$id])) {
                throw new ErrorOperacion('Uno de los productos ya no existe. Actualice la pantalla.', 'producto_invalido');
            }
            if ($id === $idHoraPromo) {
                $promoHora = self::promoHoraGratis($promos, $ts, $cantidades);
                if (!$promoHora || $cantidad !== 1) {
                    throw new ErrorOperacion('La promoción de hora gratis ya no está vigente para este carrito.', 'promo_no_vigente');
                }
                $precio = self::centavos($promoHora['valor_descuento']);
            } else {
                $precio = self::precioVigente($id, $catalogo[$id]['precio_venta'], $ts, $promos);
            }
            $lineas[] = [
                'id_producto' => $id,
                'nombre' => $catalogo[$id]['nombre_producto'],
                'cantidad' => $cantidad,
                'precio' => $precio,
                'ts' => $ts,
            ];
        }

        $sinTiempo = ['centavos' => 0, 'segundos' => 0, 'seg_por_tipo' => [], 'tramos' => [], 'proximo_cambio' => null];
        $productos = self::liquidarProductos($lineas, $promos, $sinTiempo);
        return [
            'lineas' => $lineas,
            'promo_hora' => $promoHora,
            'cotizacion' => self::armar($ts, $sinTiempo, false, $lineas, $productos),
        ];
    }
}
?>
