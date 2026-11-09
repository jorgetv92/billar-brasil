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

    // $lineas: id_producto, nombre, cantidad, precio (centavos), ts (momento del pedido) e id_promocion si vino en un combo.
    // Las líneas de un combo ya tienen el precio del combo: no entran en otras promociones.
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
                return empty($l['id_promocion']) && $l['id_producto'] === $idProducto && Liquidacion::promoActivaEn($promo, $l['ts']);
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

    // ---------------------------------------------------------------- cargos

    // Cargos guardados de una mesa en curso ('id_sesion') o de una venta ya cobrada ('id_venta'), en centavos.
    public static function cargarCargos($pdo, $campo, $id) {
        $condicion = $campo === 'id_sesion' ? 'id_sesion = ? AND id_venta IS NULL' : 'id_venta = ?';
        $stmt = $pdo->prepare("SELECT id_cargo, tipo, id_concepto, id_promocion, descripcion, monto FROM cargos_venta WHERE $condicion ORDER BY id_cargo");
        $stmt->execute([$id]);
        return array_map(function ($fila) {
            return [
                'id_cargo' => intval($fila['id_cargo']),
                'tipo' => $fila['tipo'],
                'id_concepto' => $fila['id_concepto'] ? intval($fila['id_concepto']) : null,
                'id_promocion' => $fila['id_promocion'] ? intval($fila['id_promocion']) : null,
                'descripcion' => $fila['descripcion'],
                'monto' => Liquidacion::centavos($fila['monto']),
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Un cargo que pide el cajero (rotura de vaso, una ventana): el concepto sugiere el monto y la descripción,
    // pero el cajero puede cambiarlos.
    public static function validarCargo($pdo, array $cargo) {
        $descripcion = trim(isset($cargo['descripcion']) ? (string) $cargo['descripcion'] : '');
        $monto = self::centavos(isset($cargo['monto']) ? $cargo['monto'] : 0);
        $idConcepto = !empty($cargo['id_concepto']) ? intval($cargo['id_concepto']) : null;
        if ($idConcepto) {
            $stmt = $pdo->prepare("SELECT nombre FROM conceptos_cargo WHERE id_concepto = ?");
            $stmt->execute([$idConcepto]);
            $nombre = $stmt->fetchColumn();
            if ($nombre === false) throw new ErrorOperacion('El concepto del cargo ya no existe.', 'cargo_invalido');
            if ($descripcion === '') $descripcion = $nombre;
        }
        $largo = function_exists('mb_strlen') ? mb_strlen($descripcion, 'UTF-8') : strlen($descripcion);
        if ($descripcion === '' || $largo > 150) {
            throw new ErrorOperacion('Escriba una descripción para el cargo.', 'cargo_invalido');
        }
        if ($monto <= 0) throw new ErrorOperacion('El monto del cargo debe ser mayor a cero.', 'cargo_invalido');
        return ['tipo' => 'cargo', 'id_concepto' => $idConcepto, 'id_promocion' => null, 'descripcion' => $descripcion, 'monto' => $monto];
    }

    // El monto adicional que paga el cliente por la hora gratis del incentivo en producto.
    public static function cargoHoraGratis(array $promo) {
        return [
            'tipo' => 'hora_gratis',
            'id_concepto' => null,
            'id_promocion' => intval($promo['id_promocion']),
            'descripcion' => 'Hora gratis (' . $promo['nombre_promo'] . ')',
            'monto' => self::centavos($promo['valor_descuento']),
        ];
    }

    // ---------------------------------------------------------------- combos

    // Combos vigentes en $ts con sus productos, para que el cajero los elija.
    public static function combosVigentes($pdo, array $promos, $ts) {
        $combos = [];
        foreach ($promos as $promo) {
            if ($promo['tipo_promo'] !== 'combo_especifico' || !self::promoActivaEn($promo, $ts)) continue;
            $items = self::itemsDeCombo($pdo, $promo['id_promocion']);
            if (!$items) continue;
            $combos[] = [
                'id_promocion' => intval($promo['id_promocion']),
                'nombre' => $promo['nombre_promo'],
                'precio' => round(floatval($promo['valor_descuento']), 2),
                'items' => array_map(function ($i) {
                    return ['id_producto' => $i['id_producto'], 'nombre' => $i['nombre'], 'cantidad' => $i['cantidad']];
                }, $items),
            ];
        }
        return $combos;
    }

    private static function itemsDeCombo($pdo, $idPromocion) {
        $stmt = $pdo->prepare("
            SELECT pi.id_producto, pi.cantidad, p.nombre_producto, p.precio_venta, p.activo
            FROM promocion_items pi JOIN productos p ON p.id_producto = pi.id_producto
            WHERE pi.id_promocion = ? ORDER BY pi.id_producto
        ");
        $stmt->execute([intval($idPromocion)]);
        $items = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $fila) {
            if (!intval($fila['activo'])) return [];
            $items[] = [
                'id_producto' => intval($fila['id_producto']),
                'nombre' => $fila['nombre_producto'],
                'cantidad' => intval($fila['cantidad']),
                'lista' => self::centavos($fila['precio_venta']),
            ];
        }
        return $items;
    }

    // Las líneas de $veces combos: los productos reales (descuentan su stock) con el precio del combo
    // repartido según el precio de lista de cada uno. Las líneas suman exactamente el precio del combo.
    public static function lineasDeCombo($pdo, $idPromocion, $veces, $ts, array $promos) {
        $promo = null;
        foreach ($promos as $p) {
            if (intval($p['id_promocion']) === intval($idPromocion) && $p['tipo_promo'] === 'combo_especifico') $promo = $p;
        }
        $items = $promo ? self::itemsDeCombo($pdo, $idPromocion) : [];
        if (!$promo || !$items || !self::promoActivaEn($promo, $ts)) {
            throw new ErrorOperacion('El combo ya no está vigente. Actualice la pantalla.', 'promo_no_vigente');
        }
        if ($veces <= 0) throw new ErrorOperacion('Cantidad de combos no válida.', 'producto_invalido');

        $precio = self::centavos($promo['valor_descuento']);
        $base = 0;
        foreach ($items as $i) $base += $i['cantidad'] * max(1, $i['lista']);

        $lineas = [];
        $asignado = 0;
        foreach ($items as $n => $i) {
            $parte = $n === count($items) - 1
                ? $precio - $asignado
                : (int) round($precio * $i['cantidad'] * max(1, $i['lista']) / $base);
            $asignado += $parte;
            // Precio por unidad en centavos enteros: si no divide exacto, unas unidades llevan un centavo más.
            $unitario = intdiv($parte, $i['cantidad']);
            $conExtra = $parte - $unitario * $i['cantidad'];
            foreach ([[$i['cantidad'] - $conExtra, $unitario], [$conExtra, $unitario + 1]] as $grupo) {
                if ($grupo[0] <= 0) continue;
                $lineas[] = [
                    'id_producto' => $i['id_producto'],
                    'nombre' => $i['nombre'],
                    'cantidad' => $grupo[0] * $veces,
                    'precio' => $grupo[1],
                    'ts' => $ts,
                    'id_promocion' => intval($promo['id_promocion']),
                    'combo' => $promo['nombre_promo'],
                ];
            }
        }
        return $lineas;
    }

    // ---------------------------------------------------------------- resultado

    private static function armar($corte, array $tiempo, $horaGratis, array $lineas, array $productos, array $cargos = []) {
        $subtotalCargos = 0;
        foreach ($cargos as $c) $subtotalCargos += $c['monto'];
        $neto = max(0, $tiempo['centavos'] + $productos['subtotal'] - $productos['descuento'] + $subtotalCargos);
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
                    'id_promocion' => isset($l['id_promocion']) ? $l['id_promocion'] : null,
                    'combo' => isset($l['combo']) ? $l['combo'] : null,
                ];
            }, $lineas),
            'subtotal_productos' => self::bs($productos['subtotal']),
            'descuentos' => self::bs($productos['descuento']),
            'detalles' => $productos['detalles'],
            'cargos' => array_map(function ($c) {
                return [
                    'id_cargo' => isset($c['id_cargo']) ? $c['id_cargo'] : null,
                    'tipo' => $c['tipo'],
                    'id_concepto' => $c['id_concepto'],
                    'descripcion' => $c['descripcion'],
                    'monto' => Liquidacion::bsPublico($c['monto']),
                ];
            }, $cargos),
            'subtotal_cargos' => self::bs($subtotalCargos),
            'neto' => self::bs($neto),
            'redondeo' => self::bs($total - $neto),
            'total' => self::bs($total),
            'proximo_cambio' => $tiempo['proximo_cambio'],
        ];
    }

    public static function bsPublico($centavos) {
        return self::bs($centavos);
    }

    private static function tramosDeSesion($pdo, $idSesion) {
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
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Líneas guardadas en detalle_venta_productos. Un pedido sin hora guardada se evalúa al momento del cobro.
    private static function lineasGuardadas($pdo, $condicion, $id, $corte) {
        $stmt = $pdo->prepare("
            SELECT d.id_detalle_prod, d.id_producto, p.nombre_producto, d.cantidad, d.precio_unitario_aplicado,
                   d.fecha_hora, d.id_promocion, pr.nombre_promo
            FROM detalle_venta_productos d
            JOIN productos p ON p.id_producto = d.id_producto
            LEFT JOIN promociones pr ON pr.id_promocion = d.id_promocion
            WHERE $condicion
            ORDER BY d.id_detalle_prod
        ");
        $stmt->execute([$id]);
        return array_map(function ($fila) use ($corte) {
            return [
                'id_detalle_prod' => intval($fila['id_detalle_prod']),
                'id_producto' => intval($fila['id_producto']),
                'nombre' => $fila['nombre_producto'],
                'cantidad' => intval($fila['cantidad']),
                'precio' => Liquidacion::centavos($fila['precio_unitario_aplicado']),
                'ts' => $fila['fecha_hora'] ? strtotime($fila['fecha_hora']) : $corte,
                'id_promocion' => $fila['id_promocion'] ? intval($fila['id_promocion']) : null,
                'combo' => $fila['id_promocion'] ? ($fila['nombre_promo'] ?: 'Combo') : null,
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Partida de mesa con corte en $corte (timestamp). Incluye el consumo y los cargos aún no cobrados.
    public static function liquidarSesion($pdo, $idSesion, $corte, array $promos = null) {
        if ($promos === null) $promos = self::cargarPromos($pdo);

        $stmt = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
        $stmt->execute([$idSesion]);
        $horaGratis = intval($stmt->fetchColumn()) === 1;

        $lineas = self::lineasGuardadas($pdo, 'd.id_sesion = ? AND d.id_venta IS NULL', $idSesion, $corte);
        $tiempo = self::liquidarTiempo(self::tramosDeSesion($pdo, $idSesion), $horaGratis, $promos, $corte);
        $productos = self::liquidarProductos($lineas, $promos, $tiempo);
        return self::armar($corte, $tiempo, $horaGratis, $lineas, $productos, self::cargarCargos($pdo, 'id_sesion', $idSesion));
    }

    // Vuelve a calcular una venta ya cobrada con las líneas que tiene ahora (después de corregir un producto).
    // Lo cobrado por tiempo no cambia; productos, promos, cargos y redondeo se recalculan con las mismas reglas.
    public static function reliquidarVenta($pdo, $idVenta, array $promos = null) {
        if ($promos === null) $promos = self::cargarPromos($pdo);

        $stmt = $pdo->prepare("SELECT id_venta, id_sesion, subtotal_mesas, fecha_hora_venta FROM ventas WHERE id_venta = ?");
        $stmt->execute([$idVenta]);
        $venta = $stmt->fetch(PDO::FETCH_ASSOC);
        $corte = strtotime($venta['fecha_hora_venta']);

        $tiempo = ['centavos' => 0, 'segundos' => 0, 'seg_por_tipo' => [], 'tramos' => [], 'proximo_cambio' => null];
        $horaGratis = false;
        if ($venta['id_sesion']) {
            $stmtGratis = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
            $stmtGratis->execute([$venta['id_sesion']]);
            $horaGratis = intval($stmtGratis->fetchColumn()) === 1;
            // Los segundos jugados sirven para el incentivo cruzado; el importe del tiempo es el que se cobró.
            $tiempo = self::liquidarTiempo(self::tramosDeSesion($pdo, $venta['id_sesion']), $horaGratis, $promos, $corte);
        }
        $tiempo['centavos'] = self::centavos($venta['subtotal_mesas']);
        $tiempo['proximo_cambio'] = null;

        $lineas = self::lineasGuardadas($pdo, 'd.id_venta = ?', $idVenta, $corte);
        $productos = self::liquidarProductos($lineas, $promos, $tiempo);
        return self::armar($corte, $tiempo, $horaGratis, $lineas, $productos, self::cargarCargos($pdo, 'id_venta', $idVenta));
    }

    // ---------------------------------------------------------------- barra

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

    // Productos sueltos: [{id_producto, cantidad}] → [id => cantidad], validando cantidades.
    public static function sumarCantidades(array $items) {
        $cantidades = [];
        foreach ($items as $item) {
            $id = intval(isset($item['id_producto']) ? $item['id_producto'] : 0);
            $cantidad = intval(isset($item['cantidad']) ? $item['cantidad'] : 0);
            if ($id <= 0 || $cantidad <= 0) {
                throw new ErrorOperacion('Hay un producto o una cantidad no válida.', 'producto_invalido');
            }
            $cantidades[$id] = (isset($cantidades[$id]) ? $cantidades[$id] : 0) + $cantidad;
        }
        return $cantidades;
    }

    // Catálogo de los productos pedidos. Un producto retirado (inactivo) ya no se vende.
    public static function catalogo($pdo, array $ids) {
        $catalogo = [];
        if ($ids) {
            $marcas = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("SELECT id_producto, nombre_producto, precio_venta, tipo, activo FROM productos WHERE id_producto IN ($marcas)");
            $stmt->execute(array_values($ids));
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $fila) $catalogo[intval($fila['id_producto'])] = $fila;
        }
        foreach ($ids as $id) {
            if (!isset($catalogo[$id]) || !intval($catalogo[$id]['activo'])) {
                throw new ErrorOperacion('Uno de los productos ya no se vende. Actualice la pantalla.', 'producto_invalido');
            }
        }
        return $catalogo;
    }

    // Líneas de productos sueltos y de combos pedidos en $ts, con los precios que fija el backend.
    public static function lineasPedido($pdo, array $cantidades, array $combos, $ts, array $promos) {
        $catalogo = self::catalogo($pdo, array_keys($cantidades));
        $lineas = [];
        foreach ($cantidades as $id => $cantidad) {
            $lineas[] = [
                'id_producto' => $id,
                'nombre' => $catalogo[$id]['nombre_producto'],
                'cantidad' => $cantidad,
                'precio' => self::precioVigente($id, $catalogo[$id]['precio_venta'], $ts, $promos),
                'ts' => $ts,
                'id_promocion' => null,
            ];
        }
        foreach ($combos as $combo) {
            $lineas = array_merge($lineas, self::lineasDeCombo(
                $pdo,
                intval(isset($combo['id_promocion']) ? $combo['id_promocion'] : 0),
                intval(isset($combo['cantidad']) ? $combo['cantidad'] : 0),
                $ts,
                $promos
            ));
        }
        return $lineas;
    }

    // Cotiza un carrito de barra. El precio que mande la pantalla no se usa.
    // $pedido: productos [{id_producto, cantidad}], combos [{id_promocion, cantidad}], cargos [{id_concepto, descripcion, monto}]
    // y hora_gratis (true si el cliente aceptó la hora gratis del incentivo en producto).
    public static function cotizarCarrito($pdo, array $pedido, $ts, array $promos) {
        $cantidades = self::sumarCantidades(isset($pedido['productos']) ? $pedido['productos'] : []);
        $lineas = self::lineasPedido($pdo, $cantidades, isset($pedido['combos']) ? $pedido['combos'] : [], $ts, $promos);

        $cargos = [];
        foreach ((isset($pedido['cargos']) ? $pedido['cargos'] : []) as $cargo) $cargos[] = self::validarCargo($pdo, $cargo);

        $promoHora = null;
        if (!empty($pedido['hora_gratis'])) {
            $promoHora = self::promoHoraGratis($promos, $ts, $cantidades);
            if (!$promoHora) {
                throw new ErrorOperacion('La promoción de hora gratis ya no está vigente para este carrito.', 'promo_no_vigente');
            }
            $cargos[] = self::cargoHoraGratis($promoHora);
        }

        $sinTiempo = ['centavos' => 0, 'segundos' => 0, 'seg_por_tipo' => [], 'tramos' => [], 'proximo_cambio' => null];
        $productos = self::liquidarProductos($lineas, $promos, $sinTiempo);
        return [
            'lineas' => $lineas,
            'cargos' => $cargos,
            'promo_hora' => $promoHora,
            'cotizacion' => self::armar($ts, $sinTiempo, false, $lineas, $productos, $cargos),
        ];
    }
}
?>
