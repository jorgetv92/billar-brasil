<?php
// api/atencion_barra.php
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");

// Inclusión de la clase de base de datos según tu entorno unificado
include_once '../config/database.php';
include_once '../models/Mesa.php';
include_once '../models/Liquidacion.php';

try {
    $database = new Database();
    $pdo = $database->getConnection();
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => "Error de configuración de BD: " . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$ahora = date('Y-m-d H:i:s');
// Promociones vigentes ahora (o en $fechaHora), con la misma regla de horario que usa el motor de cobro.
function obtenerPromocionesActivas($pdo, $fechaHora = null) {
    try {
        $ts = strtotime($fechaHora ? $fechaHora : date('Y-m-d H:i:s'));
        return Liquidacion::promosActivasEn(Liquidacion::cargarPromos($pdo), $ts);
    } catch (PDOException $e) {
        return [];
    }
}

// =========================================================================================
// APOYO DE MESAS Y COBROS
// =========================================================================================

// Tramo abierto de la partida en curso de una mesa. En escrituras, la mesa debe estar bloqueada antes.
function tramoAbiertoDeMesa($pdo, $idMesa) {
    $stmt = $pdo->prepare("
        SELECT t.id_tramo, t.id_sesion, t.fecha_hora_inicio, t.fecha_hora_pausa, t.tarifa_hora_aplicada
        FROM tramos_mesas t
        JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
        WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
        ORDER BY t.id_tramo DESC LIMIT 1
    ");
    $stmt->execute([intval($idMesa)]);
    $tramo = $stmt->fetch(PDO::FETCH_ASSOC);
    return $tramo ? $tramo : null;
}

// Bloquea la mesa y exige que tenga una partida en curso.
function exigirMesaEnJuego($pdo, $idMesa) {
    $mesas = Mesa::bloquear($pdo, [$idMesa]);
    $mesa = isset($mesas[intval($idMesa)]) ? $mesas[intval($idMesa)] : null;
    $tramo = ($mesa && $mesa['estado_actual'] === 'ocupada') ? tramoAbiertoDeMesa($pdo, $idMesa) : null;
    if (!$tramo) {
        throw new ErrorOperacion('La mesa ya no tiene una partida en curso. Se actualizó la pantalla.', 'mesa_sin_partida');
    }
    return [$mesa, $tramo];
}

function exigirJornada($idJornada) {
    if (!$idJornada) {
        throw new ErrorOperacion('No hay una jornada de caja abierta.', 'sin_jornada');
    }
}

// Hora de corte de la partida: la pausa si está pausada (manual o al presionar Cobrar), si no, ahora.
function corteDeTramo(array $tramo, $ahora) {
    return strtotime($tramo['fecha_hora_pausa'] ? $tramo['fecha_hora_pausa'] : $ahora);
}

// Tarifa por hora vigente para la mesa. Solo se guarda en el tramo como referencia: el cobro la recalcula por bloque.
function tarifaActualDeMesa($pdo, $idMesa, $ts) {
    $stmt = $pdo->prepare("SELECT m.id_tipo_mesa, tm.precio_hora FROM mesas m JOIN tipos_mesa tm ON tm.id_tipo_mesa = m.id_tipo_mesa WHERE m.id_mesa = ?");
    $stmt->execute([intval($idMesa)]);
    $fila = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$fila) return 0.0;
    $tarifa = floatval($fila['precio_hora']);
    foreach (Liquidacion::promosActivasEn(Liquidacion::cargarPromos($pdo), $ts) as $p) {
        if ($p['tipo_promo'] === 'tarifa_mesa' && intval($p['id_item_condicion']) === intval($fila['id_tipo_mesa']) && $p['valor_descuento'] !== null) {
            $tarifa = min($tarifa, floatval($p['valor_descuento']));
        }
    }
    return $tarifa;
}

// Abre una partida en la mesa, que ya debe estar reservada con Mesa::reservarLibre.
function abrirSesion($pdo, $idJornada, $idMesa, $horaGratis, $ahora) {
    $stmt = $pdo->prepare("INSERT INTO sesiones_juego (id_jornada, estado, primera_hora_gratis) VALUES (?, 'activa', ?)");
    $stmt->execute([$idJornada, $horaGratis ? 1 : 0]);
    $idSesion = $pdo->lastInsertId();

    $stmt = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, ?, ?, 0.00)");
    $stmt->execute([$idSesion, $idMesa, $ahora, tarifaActualDeMesa($pdo, $idMesa, strtotime($ahora))]);

    $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?")->execute([$idMesa]);
    return $idSesion;
}

// Acepta el formato nuevo (pagos: [{metodo, monto}]) y los anteriores (monto_efectivo/monto_qr o metodo_pago).
function leerPagos(array $data) {
    if (isset($data['pagos']) && is_array($data['pagos'])) {
        return array_map(function ($p) {
            return [
                'metodo' => strtolower(trim(isset($p['metodo']) ? $p['metodo'] : '')),
                'monto' => isset($p['monto']) ? $p['monto'] : null,
            ];
        }, $data['pagos']);
    }
    if (isset($data['monto_efectivo']) || isset($data['monto_qr'])) {
        return [
            ['metodo' => 'efectivo', 'monto' => isset($data['monto_efectivo']) ? $data['monto_efectivo'] : 0],
            ['metodo' => 'qr', 'monto' => isset($data['monto_qr']) ? $data['monto_qr'] : 0],
        ];
    }
    $metodo = isset($data['metodo_pago']) ? strtolower(trim($data['metodo_pago'])) : 'efectivo';
    return [['metodo' => $metodo, 'monto' => null]];
}

// Los pagos deben sumar exactamente el total. Devuelve [{metodo, centavos}] sin los montos en cero.
function validarPagos(array $pagos, $totalBs) {
    $total = Liquidacion::centavos($totalBs);
    $validos = [];
    $suma = 0;
    foreach ($pagos as $pago) {
        if (!in_array($pago['metodo'], ['efectivo', 'qr'], true)) {
            throw new ErrorOperacion('Método de pago no válido.', 'pago_invalido');
        }
        $monto = $pago['monto'] === null && count($pagos) === 1 ? $total : Liquidacion::centavos($pago['monto']);
        if ($monto < 0) {
            throw new ErrorOperacion('Los montos de pago no pueden ser negativos.', 'pago_invalido');
        }
        $suma += $monto;
        if ($monto > 0) $validos[] = ['metodo' => $pago['metodo'], 'centavos' => $monto];
    }
    if ($suma !== $total) {
        throw new ErrorOperacion(sprintf('Los pagos suman %.2f Bs y el total es %.2f Bs.', $suma / 100, $total / 100), 'pagos_no_cuadran');
    }
    return $validos;
}

// El cajero cobró lo que vio en pantalla. Si el total cambió (otra caja agregó algo, o cambió una promo),
// no se guarda nada y se devuelve el total nuevo para que lo confirme.
function exigirTotalMostrado(array $data, array $liquidacion) {
    $claves = ['total_mostrado', 'total_congelado_frontend', 'total'];
    $mostrado = null;
    foreach ($claves as $clave) {
        if (isset($data[$clave])) {
            $mostrado = $data[$clave];
            break;
        }
    }
    if ($mostrado === null || Liquidacion::centavos($mostrado) !== Liquidacion::centavos($liquidacion['total'])) {
        throw new ErrorOperacion(
            sprintf('El total cambió: ahora es %.2f Bs. Revíselo y confirme de nuevo.', $liquidacion['total']),
            'total_cambio',
            ['liquidacion' => $liquidacion]
        );
    }
}

function descontarStock($pdo, $idProducto, $cantidad, $nombre) {
    $stmt = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ? AND stock_actual >= ?");
    $stmt->execute([$cantidad, $idProducto, $cantidad]);
    if ($stmt->rowCount() === 0) {
        throw new ErrorOperacion("Stock insuficiente de {$nombre}.", 'stock_insuficiente');
    }
}

// Código único que la pantalla genera para cada intento de cobro. Sin él (pantallas viejas) no hay protección.
function leerIdOperacion(array $data) {
    $id = isset($data['id_operacion']) ? trim((string) $data['id_operacion']) : '';
    return preg_match('/^[A-Za-z0-9-]{8,40}$/', $id) ? $id : null;
}

// Si la misma venta llega dos veces (doble clic, reintento de red), el índice único de id_operacion rechaza
// la segunda y la transacción completa se revierte: no se repiten pagos ni se descuenta stock dos veces.
function registrarVenta($pdo, $idJornada, $idSesion, array $liq, array $pagos, $idOperacion = null) {
    $stmt = $pdo->prepare("
        INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, subtotal_cargos, descuentos, redondeo, total_pagar, fecha_hora_venta, id_operacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    ");
    try {
        $stmt->execute([$idJornada, $idSesion, $liq['tiempo'], $liq['subtotal_productos'], $liq['subtotal_cargos'], $liq['descuentos'], $liq['redondeo'], $liq['total'], $idOperacion]);
    } catch (PDOException $e) {
        if (isset($e->errorInfo[1]) && intval($e->errorInfo[1]) === 1062) {
            throw new ErrorOperacion('Esta venta ya se registró. No se cobró de nuevo.', 'venta_duplicada');
        }
        throw $e;
    }
    $idVenta = $pdo->lastInsertId();

    $stmt = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
    foreach ($pagos as $pago) {
        $stmt->execute([$idVenta, $pago['metodo'], $pago['centavos'] / 100]);
    }
    return $idVenta;
}

// Guarda cargos ya validados por el motor (montos en centavos) en una venta o en una mesa en curso.
function guardarCargos($pdo, array $cargos, $idVenta, $idSesion, $ahora) {
    $stmt = $pdo->prepare("INSERT INTO cargos_venta (id_venta, id_sesion, tipo, id_concepto, id_promocion, descripcion, monto, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    foreach ($cargos as $c) {
        $stmt->execute([$idVenta, $idSesion, $c['tipo'], $c['id_concepto'], $c['id_promocion'], $c['descripcion'], $c['monto'] / 100, $ahora]);
    }
}

// Guarda las líneas de productos y descuenta stock. Los preparados (cócteles, vasos) no llevan stock.
function guardarLineas($pdo, array $lineas, $idVenta, $idSesion, $ahora) {
    $ids = array_values(array_unique(array_map(function ($l) { return $l['id_producto']; }, $lineas)));
    $tipos = [];
    if ($ids) {
        $stmt = $pdo->prepare("SELECT id_producto, tipo FROM productos WHERE id_producto IN (" . implode(',', array_fill(0, count($ids), '?')) . ")");
        $stmt->execute($ids);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $f) $tipos[intval($f['id_producto'])] = $f['tipo'];
    }
    $stmt = $pdo->prepare("INSERT INTO detalle_venta_productos (id_venta, id_sesion, id_producto, cantidad, precio_unitario_aplicado, fecha_hora, id_promocion, id_combo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    foreach ($lineas as $l) {
        // Primero el stock (bloqueo de escritura del producto) y después la línea: si fuera al revés, dos cajas
        // vendiendo el mismo producto a la vez se bloquearían mutuamente y la base cancelaría una venta.
        if ((isset($tipos[$l['id_producto']]) ? $tipos[$l['id_producto']] : 'inventario') === 'inventario') {
            descontarStock($pdo, $l['id_producto'], $l['cantidad'], $l['nombre']);
        }
        $stmt->execute([$idVenta, $idSesion, $l['id_producto'], $l['cantidad'], $l['precio'] / 100, $ahora,
            isset($l['id_promocion']) ? $l['id_promocion'] : null, isset($l['id_combo']) ? $l['id_combo'] : null]);
    }
}

// Lo que pide la pantalla para cotizar o cobrar un carrito de barra.
function leerPedido(array $data) {
    return [
        'productos' => isset($data['productos']) && is_array($data['productos']) ? $data['productos'] : [],
        'combos' => isset($data['combos']) && is_array($data['combos']) ? $data['combos'] : [],
        // Pares de una promoción "Producto 2x1" elegida en el buscador: [{id_promocion, cantidad}]
        'pares' => isset($data['pares']) && is_array($data['pares']) ? $data['pares'] : [],
        'cargos' => isset($data['cargos']) && is_array($data['cargos']) ? $data['cargos'] : [],
        'hora_gratis' => !empty($data['hora_gratis']),
        // La promoción de hora con descuento que eligió el cajero en el buscador
        'id_promo_hora' => !empty($data['id_promo_hora']) ? intval($data['id_promo_hora']) : null,
    ];
}

function pagosPublicos(array $pagos) {
    return array_map(function ($p) {
        return ['metodo' => $p['metodo'], 'monto' => round($p['centavos'] / 100, 2)];
    }, $pagos);
}

// =========================================================================================
// MÉTODOS DE LECTURA (GET)
// =========================================================================================
if ($method === 'GET') {
    $accion = isset($_GET['accion']) ? $_GET['accion'] : '';

    // 1. OBTENER DATOS INICIALES (Mesa Grid)
    if ($accion === 'get_datos_iniciales') {
        try {
            $promosTodas = Liquidacion::cargarPromos($pdo);
            $promosActivas = Liquidacion::promosActivasEn($promosTodas, strtotime($ahora));

            $query = "
                SELECT
                    tm.id_tipo_mesa, tm.nombre_tipo AS tipo_mesa, tm.precio_hora,
                    m.id_mesa, m.numero_mesa, m.estado_actual,
                    (SELECT t.id_sesion
                     FROM tramos_mesas t
                     JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                     WHERE t.id_mesa = m.id_mesa AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                     ORDER BY t.id_tramo DESC LIMIT 1) AS id_sesion,
                    (SELECT t.fecha_hora_inicio
                     FROM tramos_mesas t
                     JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                     WHERE t.id_mesa = m.id_mesa AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                     ORDER BY t.id_tramo DESC LIMIT 1) AS fecha_hora_inicio,
                    (SELECT t.fecha_hora_pausa
                     FROM tramos_mesas t
                     JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                     WHERE t.id_mesa = m.id_mesa AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                     ORDER BY t.id_tramo DESC LIMIT 1) AS fecha_hora_pausa,
                    (SELECT s.primera_hora_gratis
                     FROM tramos_mesas t
                     JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                     WHERE t.id_mesa = m.id_mesa AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                     ORDER BY t.id_tramo DESC LIMIT 1) AS primera_hora_gratis,
                    (SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, t_all.fecha_hora_inicio, t_all.fecha_hora_fin)), 0)
                     FROM tramos_mesas t_all
                     WHERE t_all.id_sesion = (
                        SELECT t5.id_sesion FROM tramos_mesas t5
                        WHERE t5.id_mesa = m.id_mesa AND t5.fecha_hora_fin IS NULL
                        ORDER BY t5.id_tramo DESC LIMIT 1
                     ) AND t_all.fecha_hora_fin IS NOT NULL
                    ) AS segundos_acumulados
                FROM tipos_mesa tm
                LEFT JOIN mesas m ON tm.id_tipo_mesa = m.id_tipo_mesa AND m.estado_actual != 'mantenimiento'
                ORDER BY tm.id_tipo_mesa, m.numero_mesa ASC
            ";

            $stmt = $pdo->prepare($query);
            $stmt->execute();

            $data = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $id_tipo = $row['id_tipo_mesa'];
                if (!isset($data[$id_tipo])) {
                    $precioHoraBase = floatval($row['precio_hora']);
                    $precioHoraEfectivo = $precioHoraBase;
                    $tienePromoMesa = false;
                    $nombrePromoMesa = '';
                    foreach ($promosActivas as $p) {
                        if ($p['tipo_promo'] === 'tarifa_mesa' && intval($p['id_item_condicion']) === intval($id_tipo)) {
                            if (!is_null($p['valor_descuento'])) {
                                $precioHoraEfectivo = floatval($p['valor_descuento']);
                                $tienePromoMesa = true;
                                $nombrePromoMesa = $p['nombre_promo'];
                                break;
                            }
                        }
                    }
                    $data[$id_tipo] = [
                        'id_tipo_mesa' => $id_tipo,
                        'tipo_mesa' => $row['tipo_mesa'],
                        'precio_hora' => $precioHoraEfectivo,
                        'precio_hora_original' => $precioHoraBase,
                        'tiene_promocion' => $tienePromoMesa,
                        'nombre_promocion' => $nombrePromoMesa,
                        'mesas' => []
                    ];
                }
                if ($row['id_mesa']) {
                    // Lo que se cobraría si la mesa se cerrara ahora, calculado por el mismo motor que cobra.
                    $liq = null;
                    if ($row['estado_actual'] === 'ocupada' && $row['id_sesion']) {
                        $corte = strtotime($row['fecha_hora_pausa'] ? $row['fecha_hora_pausa'] : $ahora);
                        $completa = Liquidacion::liquidarSesion($pdo, $row['id_sesion'], $corte, $promosTodas);
                        $liq = [
                            'tiempo' => $completa['tiempo'],
                            'subtotal_productos' => $completa['subtotal_productos'],
                            'descuentos' => $completa['descuentos'],
                            'redondeo' => $completa['redondeo'],
                            'total' => $completa['total'],
                            'proximo_cambio' => $row['fecha_hora_pausa'] ? null : $completa['proximo_cambio'],
                        ];
                    }
                    $data[$id_tipo]['mesas'][] = [
                        'id_mesa' => $row['id_mesa'],
                        'numero_mesa' => $row['numero_mesa'],
                        'estado_actual' => $row['estado_actual'],
                        'fecha_hora_inicio' => $row['fecha_hora_inicio'],
                        'hora_inicio' => $row['fecha_hora_inicio'],
                        'hora_pausa' => $row['fecha_hora_pausa'],
                        'segundos_acumulados' => $row['segundos_acumulados'],
                        'primera_hora_gratis' => intval($row['primera_hora_gratis'] ?? 0),
                        // Lo usa la tabla de mesas del admin
                        'total_consumo' => $liq ? $liq['subtotal_productos'] : 0,
                        'liquidacion' => $liq
                    ];
                }
            }

            echo json_encode(array_values($data));
            exit;

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener mesas: " . $e->getMessage()]);
            exit;
        }
    }

    // HISTORIAL DE TRAMOS DE LA MESA ACTIVA, con el importe que calcula el motor de cobro
    if ($accion === 'get_historial_tramos') {
        $id_mesa = isset($_GET['id_mesa']) ? $_GET['id_mesa'] : 0;
        try {
            $tramo = tramoAbiertoDeMesa($pdo, $id_mesa);
            if (!$tramo) {
                echo json_encode(['status' => 'success', 'data' => []]);
                exit;
            }
            $liq = Liquidacion::liquidarSesion($pdo, $tramo['id_sesion'], corteDeTramo($tramo, $ahora));
            $tramos = array_map(function ($t) {
                return [
                    'id_tramo' => $t['id_tramo'],
                    'numero_mesa' => $t['numero_mesa'],
                    'fecha_hora_inicio' => $t['inicio'],
                    'fecha_hora_fin' => $t['fin'],
                    'fecha_hora_pausa' => $t['pausa'],
                    'importe_tramo' => $t['importe'],
                ];
            }, $liq['tramos']);
            echo json_encode(['status' => 'success', 'data' => $tramos]);
            exit;
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener tramos: " . $e->getMessage()]);
            exit;
        }
    }

    // LO QUE SE COBRARÍA AHORA POR UNA MESA: tiempo, consumo, descuentos, redondeo y total
    if ($accion === 'get_liquidacion_mesa') {
        $id_mesa = isset($_GET['id_mesa']) ? $_GET['id_mesa'] : 0;
        try {
            $tramo = tramoAbiertoDeMesa($pdo, $id_mesa);
            if (!$tramo) {
                echo json_encode(['status' => 'error', 'codigo' => 'mesa_sin_partida', 'message' => 'La mesa no tiene una partida en curso.']);
                exit;
            }
            $liq = Liquidacion::liquidarSesion($pdo, $tramo['id_sesion'], corteDeTramo($tramo, $ahora));
            echo json_encode(['status' => 'success', 'liquidacion' => $liq]);
            exit;
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al calcular la mesa: " . $e->getMessage()]);
            exit;
        }
    }

    // 1.5. OBTENER PROMOCIONES ACTIVAS VIGENTES
    if ($accion === 'get_promociones_activas') {
        echo json_encode(['status' => 'success', 'data' => obtenerPromocionesActivas($pdo)]);
        exit;
    }

    // CONCEPTOS DE CARGO (rotura de vaso, etc.) con su monto sugerido
    if ($accion === 'get_conceptos_cargo') {
        $stmt = $pdo->query("SELECT id_concepto, nombre, monto_sugerido FROM conceptos_cargo WHERE activo = 1 ORDER BY nombre");
        echo json_encode(['status' => 'success', 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }
    // 2. OBTENER PRODUCTOS PARA EL DATALIST
    // Buscador del cajero: productos, combos y las promociones que se eligen ("Promo: ...").
    // Con id_mesa, los productos con incentivo cruzado muestran su precio especial si esa mesa ya cumplió las horas.
    if ($accion === 'get_productos_datalist') {
        try {
            $ts = strtotime($ahora);
            $promosTodas = Liquidacion::cargarPromos($pdo);
            $promosActivas = Liquidacion::promosActivasEn($promosTodas, $ts);

            // Incentivo cruzado de la mesa seleccionada: [id_producto => ['precio' => centavos, 'nombre' => promo]]
            $especiales = [];
            $tramo = !empty($_GET['id_mesa']) ? tramoAbiertoDeMesa($pdo, $_GET['id_mesa']) : null;
            if ($tramo) {
                $tiempo = Liquidacion::tiempoDeSesion($pdo, $tramo['id_sesion'], $ts, $promosTodas);
                foreach ($promosActivas as $p) {
                    if ($p['tipo_promo'] !== 'incentivo_cruzado' || $p['valor_descuento'] === null) continue;
                    if (!Liquidacion::cumpleIncentivoCruzado($p, $tiempo)) continue;
                    $idP = intval($p['id_item_condicion']);
                    $precio = Liquidacion::centavos($p['valor_descuento']);
                    if (!isset($especiales[$idP]) || $precio < $especiales[$idP]['precio']) {
                        $especiales[$idP] = ['precio' => $precio, 'nombre' => $p['nombre_promo']];
                    }
                }
            }

            $stmt = $pdo->query("SELECT id_producto, nombre_producto, stock_actual, precio_venta, tipo FROM productos WHERE activo = 1");
            $productos = [];
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $idProd = intval($row['id_producto']);
                $precioOriginal = floatval($row['precio_venta']);
                $centavos = Liquidacion::precioVigente($idProd, $precioOriginal, $ts, $promosActivas);
                $nombrePromo = '';
                foreach ($promosActivas as $p) {
                    if ($p['tipo_promo'] === 'descuento_producto' && intval($p['id_item_condicion']) === $idProd) {
                        $nombrePromo = $p['nombre_promo'];
                    }
                }
                if (isset($especiales[$idProd]) && $especiales[$idProd]['precio'] < $centavos) {
                    $centavos = $especiales[$idProd]['precio'];
                    $nombrePromo = $especiales[$idProd]['nombre'];
                }
                $precioEfectivo = $centavos / 100;
                $tienePromoDesc = $precioEfectivo < $precioOriginal;
                $esPreparado = $row['tipo'] === 'preparado';
                $displayLabel = $row['nombre_producto'] . " - " . ($esPreparado ? "preparado" : $row['stock_actual'] . " uds") . " - ";
                if ($tienePromoDesc) {
                    $displayLabel .= "Promo: " . number_format($precioEfectivo, 2, '.', '') . " Bs (Antes " . number_format($precioOriginal, 2, '.', '') . " Bs)";
                } else {
                    $displayLabel .= number_format($precioOriginal, 2, '.', '') . " Bs";
                }
                $productos[] = [
                    'id_producto' => $idProd,
                    'nombre_producto' => $row['nombre_producto'],
                    'display_nombre' => $displayLabel,
                    'stock' => intval($row['stock_actual']),
                    'tipo' => $row['tipo'],
                    'precio' => $precioEfectivo,
                    'precio_original' => $precioOriginal,
                    'tiene_descuento' => $tienePromoDesc,
                    'nombre_promo' => $nombrePromo
                ];
            }

            // Combos: productos compuestos, sin stock propio (descuentan el de sus productos).
            foreach (Liquidacion::combosDisponibles($pdo) as $combo) {
                $contenido = implode(', ', array_map(function ($i) { return $i['cantidad'] . ' ' . $i['nombre']; }, $combo['items']));
                $productos[] = [
                    'es_combo' => true,
                    'id_combo' => $combo['id_combo'],
                    'nombre_producto' => $combo['nombre'],
                    'display_nombre' => "Combo: " . $combo['nombre'] . " (" . $contenido . ") - "
                        . ($combo['disponibles'] === null ? '' : $combo['disponibles'] . " disp. - ")
                        . number_format($combo['precio'], 2, '.', '') . " Bs",
                    'precio' => $combo['precio'],
                    'disponibles' => $combo['disponibles'],
                    'items' => $combo['items']
                ];
            }

            // Producto 2x1: cada vez que se elige suma un par (2 unidades por el precio de 1).
            foreach (Liquidacion::pares2x1Vigentes($pdo, $promosTodas, $ts) as $par) {
                $productos[] = [
                    'es_2x1' => true,
                    'id_promocion' => $par['id_promocion'],
                    'id_producto' => $par['id_producto'],
                    'nombre_producto' => $par['nombre'],
                    'producto' => $par['nombre_producto'],
                    'display_nombre' => "Promo: " . $par['nombre'] . " (2 " . $par['nombre_producto'] . ", paga 1) - "
                        . number_format($par['precio'], 2, '.', '') . " Bs",
                    'precio' => $par['precio'],
                    'stock_producto' => $par['stock'],
                    'tipo_producto' => $par['tipo_producto']
                ];
            }

            // Incentivos en producto (productos + 1 hora con descuento de mesa): también los elige el cajero.
            foreach (Liquidacion::incentivosVigentes($pdo, $promosTodas, $ts) as $inc) {
                $productos[] = [
                    'es_incentivo' => true,
                    'id_promocion' => $inc['id_promocion'],
                    'nombre_producto' => $inc['nombre'],
                    'display_nombre' => "Promo: " . $inc['nombre'] . " (" . $inc['cantidad'] . " " . $inc['nombre_producto']
                        . " + 1 hora con descuento en " . $inc['tipo_mesa'] . ") - " . number_format($inc['precio'], 2, '.', '') . " Bs",
                    'precio' => $inc['precio'],
                    'id_producto' => $inc['id_producto'],
                    'producto' => $inc['nombre_producto'],
                    'cantidad_producto' => $inc['cantidad'],
                    'stock_producto' => $inc['stock'],
                    'tipo_producto' => $inc['tipo_producto'],
                    'id_tipo_mesa' => $inc['id_tipo_mesa'],
                    'tipo_mesa' => $inc['tipo_mesa'],
                    'monto_adicional' => $inc['monto_adicional'],
                ];
            }

            echo json_encode($productos);
            exit;

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener datalist: " . $e->getMessage()]);
            exit;
        }
    }

    // 3. OBTENER CONSUMO DE UNA MESA
    if ($accion === 'get_consumo_mesa') {
        $id_mesa = isset($_GET['id_mesa']) ? $_GET['id_mesa'] : 0;
        try {
            $query = "
                SELECT dvp.id_detalle_prod, p.id_producto, p.nombre_producto, dvp.cantidad, dvp.precio_unitario_aplicado AS precio
                FROM detalle_venta_productos dvp
                JOIN productos p ON dvp.id_producto = p.id_producto
                JOIN sesiones_juego s ON dvp.id_sesion = s.id_sesion
                JOIN tramos_mesas t ON s.id_sesion = t.id_sesion
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND dvp.id_venta IS NULL AND t.fecha_hora_fin IS NULL
            ";
            $stmt = $pdo->prepare($query);
            $stmt->execute([$id_mesa]);

            $productos = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $productos[] = [
                    'id_detalle_prod' => $row['id_detalle_prod'],
                    'id_producto' => $row['id_producto'],
                    'display_nombre' => $row['nombre_producto'],
                    'cantidad' => $row['cantidad'],
                    'precio' => $row['precio']
                ];
            }

            echo json_encode($productos);
            exit;

        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener consumo de mesa: " . $e->getMessage()]);
            exit;
        }
    }

    // 4. MESAS DISPONIBLES
    if ($accion === 'get_mesas_disponibles') {
        try {
            $query = "SELECT m.id_mesa, m.numero_mesa, t.nombre_tipo, t.precio_hora
                      FROM mesas m JOIN tipos_mesa t ON t.id_tipo_mesa = m.id_tipo_mesa
                      WHERE m.estado_actual = 'libre'
                      ORDER BY t.id_tipo_mesa, m.id_mesa";
            $stmt = $pdo->prepare($query);
            $stmt->execute();

            $mesas = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $mesas[] = [
                    'id_mesa' => $row['id_mesa'],
                    'nombre_mesa' => $row['numero_mesa'],
                    'tipo' => $row['nombre_tipo'],
                    'precio_hora' => (float) $row['precio_hora']
                ];
            }

            echo json_encode($mesas);
            exit;
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener mesas disponibles: " . $e->getMessage()]);
            exit;
        }
    }

    echo json_encode(["status" => "error", "message" => "Acción GET no definida o no válida."]);
    exit;
}

// =========================================================================================
// MÉTODOS DE ESCRITURA Y TRANSACCIONES (POST)
// =========================================================================================
if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $accion = isset($data['accion']) ? $data['accion'] : '';

    if (!$accion) {
        echo json_encode(["status" => "error", "message" => "Acción POST no especificada."]);
        exit;
    }

    try {
        $pdo->beginTransaction();

        // Lectura con bloqueo compartido: no fija la foto de la transacción, así cada acción bloquea
        // su mesa primero y recién después lee, viendo lo último que guardó otra caja.
        $stmtJornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1 LOCK IN SHARE MODE");
        $jornada = $stmtJornada->fetch(PDO::FETCH_ASSOC);
        $id_jornada = $jornada ? $jornada['id_jornada'] : null;
        $respuesta = null;

        // ACCIÓN A: OCUPAR MESA
        if ($accion === 'ocupar_mesa') {
            exigirJornada($id_jornada);
            Mesa::reservarLibre($pdo, $data['id_mesa'], '%s ya está ocupada o en mantenimiento. Elija otra mesa.');
            abrirSesion($pdo, $id_jornada, intval($data['id_mesa']), false, $ahora);
            $respuesta = ['status' => 'success', 'message' => 'Mesa habilitada correctamente'];
        }

        // ACCIÓN B0: COTIZAR CARRITO DE BARRA (no guarda nada: es lo que la pantalla muestra)
        elseif ($accion === 'cotizar_carrito') {
            $cot = Liquidacion::cotizarCarrito($pdo, leerPedido($data), strtotime($ahora), Liquidacion::cargarPromos($pdo));
            $respuesta = ['status' => 'success', 'cotizacion' => $cot['cotizacion']];
        }

        // ACCIÓN B: VENTA EN BARRA, CON PAGO ÚNICO O MIXTO (cobrar_carrito_dividido queda por compatibilidad)
        elseif ($accion === 'registrar_venta_barra' || $accion === 'cobrar_carrito_dividido') {
            exigirJornada($id_jornada);

            // La mesa de la hora con descuento se bloquea antes de cualquier lectura.
            $idMesaPromo = !empty($data['id_mesa_ocupar_promo']) ? intval($data['id_mesa_ocupar_promo']) : null;
            $mesaPromo = null;
            if ($idMesaPromo) {
                $mesas = Mesa::bloquear($pdo, [$idMesaPromo]);
                $mesaPromo = isset($mesas[$idMesaPromo]) ? $mesas[$idMesaPromo] : null;
                Mesa::exigirLibre($pdo, $mesaPromo, '%s ya no está libre para la hora con descuento. No se cobró nada: elija otra mesa.');
            }

            $pedido = leerPedido($data);
            $cot = Liquidacion::cotizarCarrito($pdo, $pedido, strtotime($ahora), Liquidacion::cargarPromos($pdo));
            if (!$cot['lineas'] && !$cot['cargos']) {
                throw new ErrorOperacion('El carrito está vacío.', 'carrito_vacio');
            }
            if ($cot['promo_hora']) {
                if (!$mesaPromo) {
                    throw new ErrorOperacion('Elija la mesa para la hora con descuento.', 'promo_no_vigente');
                }
                if (intval($cot['promo_hora']['id_item_secundario']) !== intval($mesaPromo['id_tipo_mesa'])) {
                    throw new ErrorOperacion("{$mesaPromo['numero_mesa']} no es del tipo de mesa de la promoción.", 'promo_no_vigente');
                }
            } elseif ($mesaPromo) {
                throw new ErrorOperacion('El carrito ya no incluye la hora con descuento.', 'promo_no_vigente');
            }

            $liq = $cot['cotizacion'];
            exigirTotalMostrado($data, $liq);
            $pagos = validarPagos(leerPagos($data), $liq['total']);
            $idVenta = registrarVenta($pdo, $id_jornada, null, $liq, $pagos, leerIdOperacion($data));
            guardarLineas($pdo, $cot['lineas'], $idVenta, null, $ahora);
            guardarCargos($pdo, $cot['cargos'], $idVenta, null, $ahora);

            if ($mesaPromo) {
                abrirSesion($pdo, $id_jornada, $idMesaPromo, true, $ahora);
            }

            $respuesta = ['status' => 'success', 'message' => 'Venta en barra registrada', 'id_venta' => $idVenta, 'liquidacion' => $liq, 'pagos' => pagosPublicos($pagos)];
        }

        // ACCIÓN B2: AGREGAR PRODUCTOS O COMBOS A UNA MESA OCUPADA (el precio lo fija el backend).
        // aplicar_hora_gratis: el cliente aceptó la hora con descuento del incentivo en producto.
        elseif ($accion === 'agregar_productos_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $id_sesion = $tramo['id_sesion'];
            $ts = strtotime($ahora);
            $promos = Liquidacion::cargarPromos($pdo);

            $cantidades = Liquidacion::sumarCantidades(isset($data['productos']) ? $data['productos'] : []);
            $combos = isset($data['combos']) && is_array($data['combos']) ? $data['combos'] : [];
            $pares = isset($data['pares']) && is_array($data['pares']) ? $data['pares'] : [];
            $horaGratis = !empty($data['aplicar_hora_gratis']);
            if (!$cantidades && !$combos && !$pares && !$horaGratis) {
                throw new ErrorOperacion('No hay productos para agregar.', 'carrito_vacio');
            }
            $lineas = Liquidacion::lineasPedido($pdo, $cantidades, $combos, $ts, $promos, $pares);

            $cargos = [];
            if ($horaGratis) {
                $stmtSes = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
                $stmtSes->execute([$id_sesion]);
                if (intval($stmtSes->fetchColumn()) === 1) {
                    throw new ErrorOperacion('Esta mesa ya tiene la hora con descuento.', 'promo_no_vigente');
                }
                // Cuenta lo que la mesa ya pidió (fuera de combos) más lo que se agrega ahora.
                $unidades = $cantidades;
                $stmtPrev = $pdo->prepare("SELECT id_producto, SUM(cantidad) c FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL AND id_promocion IS NULL AND id_combo IS NULL GROUP BY id_producto");
                $stmtPrev->execute([$id_sesion]);
                foreach ($stmtPrev->fetchAll(PDO::FETCH_ASSOC) as $fila) {
                    $idP = intval($fila['id_producto']);
                    $unidades[$idP] = (isset($unidades[$idP]) ? $unidades[$idP] : 0) + intval($fila['c']);
                }
                $idPromoHora = !empty($data['id_promo_hora']) ? intval($data['id_promo_hora']) : null;
                $promoHora = Liquidacion::promoHoraGratis($promos, $ts, $unidades, $mesa['id_tipo_mesa'], $idPromoHora);
                if (!$promoHora) {
                    throw new ErrorOperacion('La promoción de hora con descuento ya no está vigente para esta mesa.', 'promo_no_vigente');
                }
                $cargos[] = Liquidacion::cargoHoraGratis($promoHora);
                $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 1 WHERE id_sesion = ?")->execute([$id_sesion]);
            }

            guardarLineas($pdo, $lineas, null, $id_sesion, $ahora);
            guardarCargos($pdo, $cargos, null, $id_sesion, $ahora);
            $respuesta = ['status' => 'success', 'message' => 'Productos agregados a la mesa'];
        }

        // ACCIÓN B2b: AGREGAR CARGOS A UNA MESA (rotura de vaso, una ventana...). El monto lo decide el cajero.
        // Llegan en "cargos" (varios, cada uno con su cantidad) o en "cargo" (uno solo).
        elseif ($accion === 'agregar_cargo_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $lista = isset($data['cargos']) && is_array($data['cargos']) ? $data['cargos']
                : (isset($data['cargo']) && is_array($data['cargo']) ? [$data['cargo']] : []);
            if (!$lista) throw new ErrorOperacion('Agregue al menos un cargo.', 'cargo_invalido');
            $cargos = Liquidacion::cargosPedidos($pdo, $lista);
            guardarCargos($pdo, $cargos, null, $tramo['id_sesion'], $ahora);
            $respuesta = ['status' => 'success', 'message' => count($cargos) === 1 ? 'Cargo agregado a la mesa' : count($cargos) . ' cargos agregados a la mesa'];
        }

        // ACCIÓN B2c: QUITAR UN CARGO DE UNA MESA. Quitar la hora con descuento devuelve la mesa a tarifa normal.
        elseif ($accion === 'eliminar_cargo_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $stmt = $pdo->prepare("SELECT tipo FROM cargos_venta WHERE id_cargo = ? AND id_sesion = ? AND id_venta IS NULL FOR UPDATE");
            $stmt->execute([intval($data['id_cargo']), $tramo['id_sesion']]);
            $tipo = $stmt->fetchColumn();
            if ($tipo === false) {
                throw new ErrorOperacion('El cargo ya no está en la mesa.', 'cargo_invalido');
            }
            if ($tipo === 'hora_gratis') {
                $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$tramo['id_sesion']]);
            }
            $pdo->prepare("DELETE FROM cargos_venta WHERE id_cargo = ?")->execute([intval($data['id_cargo'])]);
            $respuesta = ['status' => 'success', 'message' => 'Cargo quitado de la mesa'];
        }

        // ACCIÓN B3: ELIMINAR UN PRODUCTO DE LA MESA (Restaura Inventario)
        elseif ($accion === 'eliminar_producto_mesa') {
            if (!empty($data['id_mesa'])) {
                Mesa::bloquear($pdo, [$data['id_mesa']]);
            }
            $stmtCheck = $pdo->prepare("
                SELECT d.id_detalle_prod, d.id_producto, d.cantidad, d.id_sesion, d.id_venta, d.id_promocion, d.id_combo, d.fecha_hora
                FROM detalle_venta_productos d
                WHERE d.id_detalle_prod = ? FOR UPDATE
            ");
            $stmtCheck->execute([$data['id_detalle_prod']]);
            $detalle = $stmtCheck->fetch(PDO::FETCH_ASSOC);

            if ($detalle && $detalle['id_venta'] === null) {
                // Las líneas de un combo o de un par 2x1 tienen el precio repartido: se quitan todas juntas
                // (las que se agregaron en el mismo pedido), si no la mesa quedaría cobrando de menos.
                $enGrupo = $detalle['id_combo'] || $detalle['id_promocion'];
                if ($enGrupo) {
                    $stmtGrupo = $pdo->prepare("
                        SELECT d.id_detalle_prod, d.id_producto, d.cantidad FROM detalle_venta_productos d
                        WHERE d.id_sesion = ? AND d.id_venta IS NULL AND d.fecha_hora <=> ?
                          AND d.id_combo <=> ? AND d.id_promocion <=> ? FOR UPDATE
                    ");
                    $stmtGrupo->execute([$detalle['id_sesion'], $detalle['fecha_hora'], $detalle['id_combo'], $detalle['id_promocion']]);
                    $lineasQuitar = $stmtGrupo->fetchAll(PDO::FETCH_ASSOC);
                } else {
                    $lineasQuitar = [$detalle];
                }
                $stmtTipo = $pdo->prepare("SELECT tipo FROM productos WHERE id_producto = ?");
                $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
                $stmtDel = $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_detalle_prod = ? AND id_venta IS NULL");
                foreach ($lineasQuitar as $l) {
                    $stmtTipo->execute([$l['id_producto']]);
                    if ($stmtTipo->fetchColumn() === 'inventario') {
                        $stmtStock->execute([$l['cantidad'], $l['id_producto']]);
                    }
                    $stmtDel->execute([$l['id_detalle_prod']]);
                }

                $respuesta = ['status' => 'success', 'message' => $enGrupo
                    ? ($detalle['id_combo'] ? 'Combo quitado completo y stock restaurado' : 'Promoción 2x1 quitada completa y stock restaurado')
                    : 'Producto eliminado y stock restaurado'];
            } else {
                $respuesta = ['status' => 'error', 'message' => 'No se encontró el producto o ya fue cobrado'];
            }
        }

        // ACCIÓN B4: LIMPIAR TODO EL CONSUMO DE LA MESA: productos (devuelve el stock) y cargos
        elseif ($accion === 'limpiar_consumo_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $id_sesion = $tramo['id_sesion'];
            $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$id_sesion]);

            $stmtCheck = $pdo->prepare("
                SELECT d.id_producto, d.cantidad, p.tipo
                FROM detalle_venta_productos d JOIN productos p ON p.id_producto = d.id_producto
                WHERE d.id_sesion = ? AND d.id_venta IS NULL
            ");
            $stmtCheck->execute([$id_sesion]);
            $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
            foreach ($stmtCheck->fetchAll(PDO::FETCH_ASSOC) as $det) {
                if ($det['tipo'] === 'inventario') $stmtStock->execute([$det['cantidad'], $det['id_producto']]);
            }

            $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL")->execute([$id_sesion]);
            $pdo->prepare("DELETE FROM cargos_venta WHERE id_sesion = ? AND id_venta IS NULL")->execute([$id_sesion]);
            $respuesta = ['status' => 'success', 'message' => 'Consumo limpiado y stock restaurado completamente'];
        }

        // ACCIÓN C0: PREPARAR COBRO. Fija la hora de corte (pausando la mesa si no lo estaba) y devuelve el desglose.
        elseif ($accion === 'preparar_cobro') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $autoPausada = false;
            if (!$tramo['fecha_hora_pausa']) {
                $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_pausa = ? WHERE id_tramo = ?")->execute([$ahora, $tramo['id_tramo']]);
                $tramo['fecha_hora_pausa'] = $ahora;
                $autoPausada = true;
            }
            $liq = Liquidacion::liquidarSesion($pdo, $tramo['id_sesion'], corteDeTramo($tramo, $ahora));
            $respuesta = ['status' => 'success', 'auto_pausada' => $autoPausada, 'mesa' => $mesa['numero_mesa'], 'liquidacion' => $liq];
        }

        // ACCIÓN C: COBRAR MESA, CON PAGO ÚNICO O MIXTO (cobrar_mesa_pago_dividido queda por compatibilidad)
        elseif ($accion === 'cobrar_mesa' || $accion === 'cobrar_mesa_pago_dividido') {
            exigirJornada($id_jornada);
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $id_sesion = $tramo['id_sesion'];
            $corte = corteDeTramo($tramo, $ahora);

            $liq = Liquidacion::liquidarSesion($pdo, $id_sesion, $corte);
            exigirTotalMostrado($data, $liq);
            $pagos = validarPagos(leerPagos($data), $liq['total']);
            $idVenta = registrarVenta($pdo, $id_jornada, $id_sesion, $liq, $pagos, leerIdOperacion($data));

            // Cierra la partida en la hora de corte y guarda lo que el motor cobró por cada tramo.
            $fechaCorte = date('Y-m-d H:i:s', $corte);
            $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ? WHERE id_sesion = ? AND fecha_hora_fin IS NULL")->execute([$fechaCorte, $id_sesion]);
            $stmtImporte = $pdo->prepare("UPDATE tramos_mesas SET importe_tramo = ? WHERE id_tramo = ?");
            foreach ($liq['tramos'] as $t) {
                $stmtImporte->execute([$t['importe'], $t['id_tramo']]);
            }
            $pdo->prepare("UPDATE detalle_venta_productos SET id_venta = ? WHERE id_sesion = ? AND id_venta IS NULL")->execute([$idVenta, $id_sesion]);
            $pdo->prepare("UPDATE cargos_venta SET id_venta = ? WHERE id_sesion = ? AND id_venta IS NULL")->execute([$idVenta, $id_sesion]);
            $pdo->prepare("UPDATE sesiones_juego SET estado = 'finalizada' WHERE id_sesion = ?")->execute([$id_sesion]);
            $pdo->prepare("UPDATE mesas SET estado_actual = 'libre' WHERE id_mesa = ?")->execute([$mesa['id_mesa']]);

            $respuesta = [
                'status' => 'success',
                'message' => 'Cobro realizado con éxito',
                'id_venta' => $idVenta,
                'mesa' => $mesa['numero_mesa'],
                'liquidacion' => $liq,
                'pagos' => pagosPublicos($pagos),
            ];
        }

        // ACCIÓN D: PAUSAR TIEMPO DE MESA. Una mesa ya pausada conserva su hora de pausa.
        elseif ($accion === 'pausar_mesa') {
            Mesa::bloquear($pdo, [$data['id_mesa']]);
            $stmt = $pdo->prepare("
                UPDATE tramos_mesas t
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                SET t.fecha_hora_pausa = ?
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL AND t.fecha_hora_pausa IS NULL
            ");
            $stmt->execute([$ahora, $data['id_mesa']]);
            $respuesta = ['status' => 'success', 'message' => 'Tiempo pausado correctamente'];
        }

        // ACCIÓN E: REANUDAR TIEMPO DE MESA
        elseif ($accion === 'reanudar_mesa') {
            $id_mesa = $data['id_mesa'];
            $tipo_pausa = isset($data['tipo_pausa']) ? $data['tipo_pausa'] : 'sistema';
            Mesa::bloquear($pdo, [$id_mesa]);
            $tramoActivo = tramoAbiertoDeMesa($pdo, $id_mesa);

            if ($tramoActivo && $tramoActivo['fecha_hora_pausa']) {
                if ($tipo_pausa === 'sistema') {
                    // Se canceló un cobro: el tiempo sigue corriendo como si no se hubiera pausado.
                    $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_pausa = NULL WHERE id_tramo = ?")->execute([$tramoActivo['id_tramo']]);
                } else {
                    // Pausa manual: el tramo termina en la pausa y el tiempo vuelve a contar desde ahora.
                    $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = fecha_hora_pausa WHERE id_tramo = ?")->execute([$tramoActivo['id_tramo']]);
                    $stmtNuevo = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, ?, ?, 0.00)");
                    $stmtNuevo->execute([$tramoActivo['id_sesion'], $id_mesa, $ahora, $tramoActivo['tarifa_hora_aplicada']]);
                }
            }
            $respuesta = ['status' => 'success', 'message' => 'Tiempo reanudado correctamente'];
        }

        // ACCIÓN F: TRANSFERENCIA DE MESA (la partida sigue en otra mesa; cada tramo se cobra con la tarifa de su mesa)
        elseif ($accion === 'transferir_mesa') {
            $id_mesa_origen = intval($data['id_mesa_origen']);
            $id_mesa_destino = intval($data['id_mesa_destino']);

            if ($id_mesa_origen === $id_mesa_destino) {
                throw new MesaNoDisponible('Elija una mesa de destino distinta a la actual.');
            }
            $mesasBloqueadas = Mesa::bloquear($pdo, [$id_mesa_origen, $id_mesa_destino]);
            $mesaDestino = isset($mesasBloqueadas[$id_mesa_destino]) ? $mesasBloqueadas[$id_mesa_destino] : null;
            Mesa::exigirLibre($pdo, $mesaDestino, '%s ya está ocupada o en mantenimiento. Elija otra mesa.');

            $tramoOrigen = tramoAbiertoDeMesa($pdo, $id_mesa_origen);
            if (!$tramoOrigen) {
                throw new ErrorOperacion('No se encontró una sesión activa en la mesa de origen.', 'mesa_sin_partida');
            }

            // Si la mesa estaba en pausa, el tiempo pausado no se cobra.
            $finOrigen = $tramoOrigen['fecha_hora_pausa'] ? $tramoOrigen['fecha_hora_pausa'] : $ahora;
            $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ? WHERE id_tramo = ?")->execute([$finOrigen, $tramoOrigen['id_tramo']]);

            $stmtNuevoTramo = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, ?, ?, 0.00)");
            $stmtNuevoTramo->execute([$tramoOrigen['id_sesion'], $id_mesa_destino, $ahora, tarifaActualDeMesa($pdo, $id_mesa_destino, strtotime($ahora))]);

            $pdo->prepare("UPDATE mesas SET estado_actual = 'libre' WHERE id_mesa = ?")->execute([$id_mesa_origen]);
            $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?")->execute([$id_mesa_destino]);

            $respuesta = ['status' => 'success', 'message' => 'Mesa transferida exitosamente.'];
        }
        else {
            throw new Exception("Acción no reconocida.");
        }

        $pdo->commit();
        echo json_encode($respuesta);

    } catch (MesaNoDisponible $e) {
        // El cajero ve una mesa libre que otra caja ya tomó: no se guarda nada y la pantalla se refresca.
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(['status' => 'error', 'codigo' => 'mesa_no_disponible', 'message' => $e->getMessage()]);
    } catch (ErrorOperacion $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(array_merge(['status' => 'error', 'codigo' => $e->codigo, 'message' => $e->getMessage()], $e->datos));
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error en la operación: ' . $e->getMessage()]);
    }
    exit;
}
?>
