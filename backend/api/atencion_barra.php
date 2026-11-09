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
// =========================================================================================
// OBTENER ID PRODUCTO PARA ITEM HORA PROMO INCENTIVO
// =========================================================================================
function obtenerIdProductoPromoIncentivo($pdo) {
    try {
        $stmt = $pdo->query("SELECT id_producto FROM productos WHERE nombre_producto LIKE 'Hora Promo%' LIMIT 1");
        $id = $stmt->fetchColumn();
        if (!$id) {
            $pdo->exec("INSERT INTO productos (nombre_producto, precio_venta, stock_actual) VALUES ('Hora Promo (Incentivo)', 0.00, 999999)");
            $id = $pdo->lastInsertId();
        }
        return intval($id);
    } catch (Exception $e) {
        return null;
    }
}

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

function registrarVenta($pdo, $idJornada, $idSesion, array $liq, array $pagos) {
    $stmt = $pdo->prepare("
        INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, descuentos, redondeo, total_pagar, fecha_hora_venta)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    ");
    $stmt->execute([$idJornada, $idSesion, $liq['tiempo'], $liq['subtotal_productos'], $liq['descuentos'], $liq['redondeo'], $liq['total']]);
    $idVenta = $pdo->lastInsertId();

    $stmt = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
    foreach ($pagos as $pago) {
        $stmt->execute([$idVenta, $pago['metodo'], $pago['centavos'] / 100]);
    }
    return $idVenta;
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
        $promos = obtenerPromocionesActivas($pdo);
        $idProdPromo = obtenerIdProductoPromoIncentivo($pdo);
        echo json_encode([
            'status' => 'success',
            'data' => $promos,
            'id_producto_hora_promo' => $idProdPromo
        ]);
        exit;
    }
    // 2. OBTENER PRODUCTOS PARA EL DATALIST
    if ($accion === 'get_productos_datalist') {
        try {
            $promosActivas = obtenerPromocionesActivas($pdo);
            $query = "SELECT id_producto, nombre_producto, stock_actual, precio_venta FROM productos WHERE nombre_producto NOT LIKE 'Hora Promo%'";
            $stmt = $pdo->prepare($query);
            $stmt->execute();

            $productos = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $idProd = intval($row['id_producto']);
                $precioOriginal = floatval($row['precio_venta']);
                $precioEfectivo = Liquidacion::precioVigente($idProd, $precioOriginal, strtotime($ahora), $promosActivas) / 100;
                $tienePromoDesc = $precioEfectivo < $precioOriginal;
                $es2x1 = false;
                $nombrePromo = '';
                foreach ($promosActivas as $p) {
                    if ($p['tipo_promo'] === 'descuento_producto' && intval($p['id_item_condicion']) === $idProd) {
                        $nombrePromo = $p['nombre_promo'];
                    }
                    if ($p['tipo_promo'] === 'combo_2x1' && intval($p['id_item_condicion']) === $idProd) {
                        $es2x1 = true;
                        if (empty($nombrePromo)) $nombrePromo = $p['nombre_promo'];
                    }
                }
                $displayLabel = $row['nombre_producto'] . " - " . $row['stock_actual'] . " uds - ";
                if ($tienePromoDesc) {
                    $displayLabel .= "Promo: " . number_format($precioEfectivo, 2, '.', '') . " Bs (Antes " . number_format($precioOriginal, 2, '.', '') . " Bs)";
                } else {
                    $displayLabel .= number_format($precioOriginal, 2, '.', '') . " Bs";
                }
                if ($es2x1) {
                    $displayLabel .= " [2x1]";
                }
                $productos[] = [
                    'id_producto' => $idProd,
                    'nombre_producto' => $row['nombre_producto'],
                    'display_nombre' => $displayLabel,
                    'stock' => intval($row['stock_actual']),
                    'precio' => $precioEfectivo,
                    'precio_original' => $precioOriginal,
                    'tiene_descuento' => $tienePromoDesc,
                    'es_2x1' => $es2x1,
                    'nombre_promo' => $nombrePromo
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
            $query = "SELECT id_mesa, numero_mesa FROM mesas WHERE estado_actual = 'libre'";
            $stmt = $pdo->prepare($query);
            $stmt->execute();

            $mesas = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $mesas[] = [
                    'id_mesa' => $row['id_mesa'],
                    'nombre_mesa' => $row['numero_mesa']
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
            $cot = Liquidacion::cotizarCarrito($pdo, isset($data['productos']) ? $data['productos'] : [], strtotime($ahora), Liquidacion::cargarPromos($pdo));
            $respuesta = ['status' => 'success', 'cotizacion' => $cot['cotizacion']];
        }

        // ACCIÓN B: VENTA EN BARRA, CON PAGO ÚNICO O MIXTO (cobrar_carrito_dividido queda por compatibilidad)
        elseif ($accion === 'registrar_venta_barra' || $accion === 'cobrar_carrito_dividido') {
            exigirJornada($id_jornada);

            // La mesa de la hora gratis se bloquea antes de cualquier lectura.
            $idMesaPromo = !empty($data['id_mesa_ocupar_promo']) ? intval($data['id_mesa_ocupar_promo']) : null;
            $mesaPromo = null;
            if ($idMesaPromo) {
                $mesas = Mesa::bloquear($pdo, [$idMesaPromo]);
                $mesaPromo = isset($mesas[$idMesaPromo]) ? $mesas[$idMesaPromo] : null;
                Mesa::exigirLibre($pdo, $mesaPromo, '%s ya no está libre para la hora gratis. No se cobró nada: elija otra mesa.');
            }

            $cot = Liquidacion::cotizarCarrito($pdo, isset($data['productos']) ? $data['productos'] : [], strtotime($ahora), Liquidacion::cargarPromos($pdo));
            if (!$cot['lineas']) {
                throw new ErrorOperacion('El carrito está vacío.', 'carrito_vacio');
            }
            if ($cot['promo_hora']) {
                if (!$mesaPromo) {
                    throw new ErrorOperacion('Elija la mesa para la hora gratis.', 'promo_no_vigente');
                }
                if (intval($cot['promo_hora']['id_item_secundario']) !== intval($mesaPromo['id_tipo_mesa'])) {
                    throw new ErrorOperacion("{$mesaPromo['numero_mesa']} no es del tipo de mesa de la promoción.", 'promo_no_vigente');
                }
            } elseif ($mesaPromo) {
                throw new ErrorOperacion('El carrito ya no incluye la hora gratis.', 'promo_no_vigente');
            }

            $liq = $cot['cotizacion'];
            exigirTotalMostrado($data, $liq);
            $pagos = validarPagos(leerPagos($data), $liq['total']);
            $idVenta = registrarVenta($pdo, $id_jornada, null, $liq, $pagos);

            $stmtDetalle = $pdo->prepare("INSERT INTO detalle_venta_productos (id_venta, id_sesion, id_producto, cantidad, precio_unitario_aplicado, fecha_hora) VALUES (?, NULL, ?, ?, ?, ?)");
            foreach ($cot['lineas'] as $linea) {
                $stmtDetalle->execute([$idVenta, $linea['id_producto'], $linea['cantidad'], $linea['precio'] / 100, $ahora]);
                descontarStock($pdo, $linea['id_producto'], $linea['cantidad'], $linea['nombre']);
            }

            if ($mesaPromo) {
                abrirSesion($pdo, $id_jornada, $idMesaPromo, true, $ahora);
            }

            $respuesta = ['status' => 'success', 'message' => 'Venta en barra registrada', 'id_venta' => $idVenta, 'liquidacion' => $liq, 'pagos' => pagosPublicos($pagos)];
        }

        // ACCIÓN B2: AGREGAR PRODUCTOS A UNA MESA OCUPADA (el precio lo fija el backend)
        elseif ($accion === 'agregar_productos_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $id_sesion = $tramo['id_sesion'];
            $ts = strtotime($ahora);
            $promos = Liquidacion::cargarPromos($pdo);
            $idHoraPromo = Liquidacion::idHoraPromo($pdo);

            $cantidades = [];
            foreach ((isset($data['productos']) ? $data['productos'] : []) as $prod) {
                $idProd = intval(isset($prod['id_producto']) ? $prod['id_producto'] : 0);
                $cant = intval(isset($prod['cantidad']) ? $prod['cantidad'] : 0);
                if ($idProd <= 0 || $cant <= 0) {
                    throw new ErrorOperacion('Producto o cantidad no válida.', 'producto_invalido');
                }
                $cantidades[$idProd] = (isset($cantidades[$idProd]) ? $cantidades[$idProd] : 0) + $cant;
            }
            if (!$cantidades) {
                throw new ErrorOperacion('No hay productos para agregar.', 'carrito_vacio');
            }

            $marcas = implode(',', array_fill(0, count($cantidades), '?'));
            $stmtCat = $pdo->prepare("SELECT id_producto, nombre_producto, precio_venta FROM productos WHERE id_producto IN ($marcas)");
            $stmtCat->execute(array_keys($cantidades));
            $catalogo = [];
            foreach ($stmtCat->fetchAll(PDO::FETCH_ASSOC) as $fila) $catalogo[intval($fila['id_producto'])] = $fila;

            $precioHora = null;
            if ($idHoraPromo && isset($cantidades[$idHoraPromo])) {
                $stmtSes = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
                $stmtSes->execute([$id_sesion]);
                if (intval($stmtSes->fetchColumn()) === 1) {
                    throw new ErrorOperacion('Esta mesa ya tiene la hora gratis.', 'promo_no_vigente');
                }
                // Cuenta lo que la mesa ya pidió más lo que se agrega ahora.
                $unidades = $cantidades;
                unset($unidades[$idHoraPromo]);
                $stmtPrev = $pdo->prepare("SELECT id_producto, SUM(cantidad) c FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL GROUP BY id_producto");
                $stmtPrev->execute([$id_sesion]);
                foreach ($stmtPrev->fetchAll(PDO::FETCH_ASSOC) as $fila) {
                    $idP = intval($fila['id_producto']);
                    $unidades[$idP] = (isset($unidades[$idP]) ? $unidades[$idP] : 0) + intval($fila['c']);
                }
                $promoHora = Liquidacion::promoHoraGratis($promos, $ts, $unidades, $mesa['id_tipo_mesa']);
                if (!$promoHora || $cantidades[$idHoraPromo] !== 1) {
                    throw new ErrorOperacion('La promoción de hora gratis ya no está vigente para esta mesa.', 'promo_no_vigente');
                }
                $precioHora = Liquidacion::centavos($promoHora['valor_descuento']);
                $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 1 WHERE id_sesion = ?")->execute([$id_sesion]);
            }

            $stmtDetalle = $pdo->prepare("INSERT INTO detalle_venta_productos (id_sesion, id_venta, id_producto, cantidad, precio_unitario_aplicado, fecha_hora) VALUES (?, NULL, ?, ?, ?, ?)");
            foreach ($cantidades as $idProd => $cant) {
                if (!isset($catalogo[$idProd])) {
                    throw new ErrorOperacion('Uno de los productos ya no existe. Actualice la pantalla.', 'producto_invalido');
                }
                $precio = $idProd === $idHoraPromo ? $precioHora : Liquidacion::precioVigente($idProd, $catalogo[$idProd]['precio_venta'], $ts, $promos);
                $stmtDetalle->execute([$id_sesion, $idProd, $cant, $precio / 100, $ahora]);
                descontarStock($pdo, $idProd, $cant, $catalogo[$idProd]['nombre_producto']);
            }

            $respuesta = ['status' => 'success', 'message' => 'Productos agregados a la mesa'];
        }

        // ACCIÓN B3: ELIMINAR UN PRODUCTO DE LA MESA (Restaura Inventario)
        elseif ($accion === 'eliminar_producto_mesa') {
            if (!empty($data['id_mesa'])) {
                Mesa::bloquear($pdo, [$data['id_mesa']]);
            }
            $stmtCheck = $pdo->prepare("SELECT id_producto, cantidad, id_sesion, id_venta FROM detalle_venta_productos WHERE id_detalle_prod = ? FOR UPDATE");
            $stmtCheck->execute([$data['id_detalle_prod']]);
            $detalle = $stmtCheck->fetch(PDO::FETCH_ASSOC);

            if ($detalle && $detalle['id_venta'] === null) {
                $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
                $stmtStock->execute([$detalle['cantidad'], $detalle['id_producto']]);

                // Si se elimina el item hora con descuento de la mesa, revertir primera_hora_gratis a 0
                $idPromoProd = Liquidacion::idHoraPromo($pdo);
                if ($idPromoProd && intval($detalle['id_producto']) === $idPromoProd && $detalle['id_sesion']) {
                    $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$detalle['id_sesion']]);
                }

                $stmtDel = $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_detalle_prod = ? AND id_venta IS NULL");
                $stmtDel->execute([$data['id_detalle_prod']]);

                $respuesta = ['status' => 'success', 'message' => 'Producto eliminado y stock restaurado'];
            } else {
                $respuesta = ['status' => 'error', 'message' => 'No se encontró el producto o ya fue cobrado'];
            }
        }

        // ACCIÓN B4: LIMPIAR TODO EL CONSUMO DE LA MESA (Restaura Inventario)
        elseif ($accion === 'limpiar_consumo_mesa') {
            list($mesa, $tramo) = exigirMesaEnJuego($pdo, $data['id_mesa']);
            $id_sesion = $tramo['id_sesion'];
            $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$id_sesion]);

            $stmtCheck = $pdo->prepare("SELECT id_producto, cantidad FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL");
            $stmtCheck->execute([$id_sesion]);
            $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
            foreach ($stmtCheck->fetchAll(PDO::FETCH_ASSOC) as $det) {
                $stmtStock->execute([$det['cantidad'], $det['id_producto']]);
            }

            $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL")->execute([$id_sesion]);
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
            $idVenta = registrarVenta($pdo, $id_jornada, $id_sesion, $liq, $pagos);

            // Cierra la partida en la hora de corte y guarda lo que el motor cobró por cada tramo.
            $fechaCorte = date('Y-m-d H:i:s', $corte);
            $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ? WHERE id_sesion = ? AND fecha_hora_fin IS NULL")->execute([$fechaCorte, $id_sesion]);
            $stmtImporte = $pdo->prepare("UPDATE tramos_mesas SET importe_tramo = ? WHERE id_tramo = ?");
            foreach ($liq['tramos'] as $t) {
                $stmtImporte->execute([$t['importe'], $t['id_tramo']]);
            }
            $pdo->prepare("UPDATE detalle_venta_productos SET id_venta = ? WHERE id_sesion = ? AND id_venta IS NULL")->execute([$idVenta, $id_sesion]);
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
