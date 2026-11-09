<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");

// Inclusión correcta de la clase de base de datos según tu entorno
include_once '../config/database.php'; 
include_once '../models/Liquidacion.php';
include_once '../models/ResumenJornada.php';
$database = new Database();
$pdo = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

// Lo que muestran el pre-cierre y el reporte de cierre. El cierre lo calcula dentro de su transacción,
// así el reporte coincide con lo que quedó guardado aunque alguien haya vendido después del pre-cierre.
function datosPrecierre($pdo, array $jornada) {
    $id_jornada = $jornada['id_jornada'];

    $stmtPagos = $pdo->prepare("SELECT
            COALESCE(SUM(CASE WHEN pv.metodo_pago = 'efectivo' THEN pv.monto_pagado END), 0) AS efectivo,
            COALESCE(SUM(CASE WHEN pv.metodo_pago = 'qr' THEN pv.monto_pagado END), 0) AS qr
        FROM pagos_venta pv INNER JOIN ventas v ON pv.id_venta = v.id_venta WHERE v.id_jornada = ?");
    $stmtPagos->execute([$id_jornada]);
    $pagos = $stmtPagos->fetch(PDO::FETCH_ASSOC);

    $stmtEgresos = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
    $stmtEgresos->execute([$id_jornada]);

    $stmtDetEgresos = $pdo->prepare("SELECT id_egreso, descripcion, monto, fecha_hora FROM egresos_caja WHERE id_jornada = ? ORDER BY fecha_hora ASC");
    $stmtDetEgresos->execute([$id_jornada]);

    $ingresos = ResumenJornada::ingresos($pdo, $id_jornada);
    return [
        "status" => "success",
        "jornada_id" => $id_jornada,
        "fecha_apertura" => $jornada['fecha_hora_apertura'],
        "horas_totales" => ResumenJornada::segundosJugados($pdo, $id_jornada) / 3600,
        "caja" => [
            "monto_apertura" => (float)$jornada['monto_inicial_caja'],
            "ingresos_efectivo" => (float)$pagos['efectivo'],
            "egresos" => (float)$stmtEgresos->fetchColumn(),
            "ingresos_qr" => (float)$pagos['qr']
        ],
        // Lo cobrado repartido entre mesas y productos: suma lo mismo que los ingresos totales
        "ingresos" => [
            "mesas" => $ingresos['mesas'],
            "productos" => $ingresos['productos'],
            "cargos" => $ingresos['cargos']
        ],
        "egresos_detalle" => $stmtDetEgresos->fetchAll(PDO::FETCH_ASSOC),
        "inventario" => ResumenJornada::inventario($pdo, $id_jornada),
        "preparados" => ResumenJornada::preparados($pdo, $id_jornada)
    ];
}

if ($method === 'GET') {
    $action = $_GET['action'] ?? 'status';
    
    try {
        // Verificar si hay alguna jornada activa en el sistema
        $stmt = $pdo->prepare("SELECT j.*, u.nombres, u.apellidos FROM jornadas j
                               INNER JOIN usuarios u ON j.id_usuario_apertura = u.id_usuario
                               WHERE j.estado = 'abierta' LIMIT 1");
        $stmt->execute();
        $jornada = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$jornada) {
            echo json_encode(["status" => "cerrada"]);
            exit;
        }
        $id_jornada = $jornada['id_jornada'];

        // ACCIÓN: DASHBOARD DEL PORTAL ADMIN (datos del turno + KPIs acumulados)
        if ($action === 'dashboard_admin') {
            // Segundos jugados en todas las mesas con tarifa (mismo criterio que el pre-cierre).
            $segundos_jugados = ResumenJornada::segundosJugados($pdo, $id_jornada);

            // Unidades vendidas (solo productos ya cobrados en una venta del turno)
            $stmtProductos = $pdo->prepare("
                SELECT COALESCE(SUM(dv.cantidad), 0)
                FROM detalle_venta_productos dv
                INNER JOIN ventas v ON dv.id_venta = v.id_venta
                WHERE v.id_jornada = ?
            ");
            $stmtProductos->execute([$id_jornada]);
            $productos_vendidos = (int)$stmtProductos->fetchColumn();

            // Bs cobrados por tiempo de mesa y por productos (el mismo reparto que usan los reportes)
            $resumenIngresos = ResumenJornada::ingresos($pdo, $id_jornada);
            $ingresos = ['mesas' => $resumenIngresos['mesas']['total'], 'productos' => $resumenIngresos['productos']['total'], 'cargos' => $resumenIngresos['cargos']['total']];

            echo json_encode([
                "status" => "success",
                "jornada" => [
                    "id_jornada" => (int)$id_jornada,
                    "fecha_hora_apertura" => $jornada['fecha_hora_apertura'],
                    "encargado" => trim($jornada['nombres'] . ' ' . $jornada['apellidos']),
                    "monto_inicial_caja" => (float)$jornada['monto_inicial_caja']
                ],
                "kpis" => [
                    "segundos_jugados" => $segundos_jugados,
                    "productos_vendidos" => $productos_vendidos,
                    "ingresos_mesas" => (float)$ingresos['mesas'],
                    "ingresos_productos" => (float)$ingresos['productos'],
                    "ingresos_cargos" => (float)$ingresos['cargos']
                ]
            ]);
            exit;
        }

        // ACCIÓN: INVENTARIO DE APERTURA (Fotografía del stock al abrir jornada)
        if ($action === 'inventario_apertura') {
            $stmtInv = $pdo->prepare("
                SELECT p.nombre_producto, jia.stock_apertura, p.precio_venta
                FROM jornada_inventario_apertura jia
                INNER JOIN productos p ON jia.id_producto = p.id_producto
                WHERE jia.id_jornada = ?
            ");
            $stmtInv->execute([$id_jornada]);
            echo json_encode([
                "status" => "success",
                "id_jornada" => $id_jornada,
                "fecha_apertura" => $jornada['fecha_hora_apertura'],
                "encargado" => trim($jornada['nombres'] . ' ' . $jornada['apellidos']),
                "inventario" => $stmtInv->fetchAll(PDO::FETCH_ASSOC)
            ]);
            exit;
        }

        if ($action === 'ventas_jornada') {
            // Traer todas las ventas de la jornada que tengan al menos un producto vendido
            $stmtVentas = $pdo->prepare("
                SELECT 
                    v.id_venta,
                    v.fecha_hora_venta,
                    v.id_sesion,
                    v.subtotal_productos,
                    v.subtotal_mesas,
                    v.descuentos,
                    v.total_pagar
                FROM ventas v
                WHERE v.id_jornada = ?
                  AND EXISTS (
                    SELECT 1 FROM detalle_venta_productos dvp WHERE dvp.id_venta = v.id_venta
                  )
                ORDER BY v.fecha_hora_venta ASC
            ");
            $stmtVentas->execute([$id_jornada]);
            $ventas = $stmtVentas->fetchAll(PDO::FETCH_ASSOC);

            $resultado = [];
            foreach ($ventas as $venta) {
                $id_venta = $venta['id_venta'];

                // Determinar método de pago (efectivo, qr o mixto)
                $stmtPagos = $pdo->prepare("SELECT metodo_pago FROM pagos_venta WHERE id_venta = ?");
                $stmtPagos->execute([$id_venta]);
                $pagos = $stmtPagos->fetchAll(PDO::FETCH_COLUMN);
                $tieneEfectivo = in_array('efectivo', $pagos);
                $tieneQR = in_array('qr', $pagos);
                if ($tieneEfectivo && $tieneQR) {
                    $metodoPago = 'mixto';
                } elseif ($tieneQR) {
                    $metodoPago = 'qr';
                } elseif ($tieneEfectivo) {
                    $metodoPago = 'efectivo';
                } else {
                    $metodoPago = 'sin pago';
                }

                // Modo venta
                $modoVenta = ($venta['id_sesion'] === null) ? 'barra' : 'mesa';

                // Importe: si es mesa, mostrar solo subtotal_productos; si es barra, total_pagar
                $importe = ($modoVenta === 'mesa')
                    ? (float)$venta['subtotal_productos']
                    : (float)$venta['total_pagar'];

                // Detalle de productos de esta venta
                $stmtDetalle = $pdo->prepare("
                    SELECT dvp.id_detalle_prod, p.nombre_producto, dvp.precio_unitario_aplicado, dvp.cantidad
                    FROM detalle_venta_productos dvp
                    INNER JOIN productos p ON dvp.id_producto = p.id_producto
                    WHERE dvp.id_venta = ?
                    ORDER BY dvp.id_detalle_prod ASC
                ");
                $stmtDetalle->execute([$id_venta]);
                $detalle = $stmtDetalle->fetchAll(PDO::FETCH_ASSOC);

                $resultado[] = [
                    'id_venta'       => $id_venta,
                    'fecha_hora'     => $venta['fecha_hora_venta'],
                    'modo_venta'     => $modoVenta,
                    'metodo_pago'    => $metodoPago,
                    'importe'        => $importe,
                    'detalle'        => $detalle
                ];
            }

            echo json_encode(['status' => 'success', 'ventas' => $resultado]);
            exit;
        }

        if ($action === 'precierre') {
            echo json_encode(datosPrecierre($pdo, $jornada));
            exit;
        } else {
            if ($jornada) {
                // KPI 1: Traer los tipos de mesas y el conteo de mesas disponibles ('libre') por cada tipo
                $stmtMesas = $pdo->prepare("SELECT tm.nombre_tipo AS tipo, 
                                            COUNT(CASE WHEN m.estado_actual = 'libre' THEN 1 END) AS disponibles
                                            FROM tipos_mesa tm
                                            LEFT JOIN mesas m ON tm.id_tipo_mesa = m.id_tipo_mesa
                                            GROUP BY tm.id_tipo_mesa, tm.nombre_tipo");
                $stmtMesas->execute();
                $kpi_mesas = $stmtMesas->fetchAll(PDO::FETCH_ASSOC);

                // KPI 2: Horas jugadas en mesas con tarifa (mismo criterio que el pre-cierre)
                $total_horas = ResumenJornada::segundosJugados($pdo, $id_jornada) / 3600;

                // KPI 3: Cantidad total de productos vendidos consolidados en detalle_venta_productos
                $stmtProductos = $pdo->prepare("SELECT COALESCE(SUM(dv.cantidad), 0) AS total_productos
                                                FROM detalle_venta_productos dv
                                                INNER JOIN ventas v ON dv.id_venta = v.id_venta
                                                WHERE v.id_jornada = ?");
                $stmtProductos->execute([$id_jornada]);
                $total_productos = (int)$stmtProductos->fetchColumn();

                // KPI 4: Total de egresos de caja de la jornada
                $stmtEgresosKPI = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
                $stmtEgresosKPI->execute([$id_jornada]);
                $total_egresos_kpi = (float)$stmtEgresosKPI->fetchColumn();

                // Empaquetamos la data de la jornada junto a su batería de estadísticas frescas
                echo json_encode([
                    "status" => "activa",
                    "jornada" => $jornada,
                    "kpis" => [
                        "mesas_disponibles" => $kpi_mesas,
                        "horas_jugadas" => $total_horas,
                        "productos_vendidos" => $total_productos,
                        "total_egresos" => $total_egresos_kpi
                    ]
                ]);
            } else {
                echo json_encode(["status" => "cerrada"]);
            }
        }
    } catch (PDOException $e) {
                echo json_encode(["status" => "error", "message" => "Error: " . $e->getMessage()]);
    }
}

if ($method === 'POST') {
    // =======================================================================
    // FLUJO A: CIERRE DE JORNADA (?action=cerrar)
    // =======================================================================
    if (isset($_GET['action']) && $_GET['action'] === 'cerrar') {
        try {
            $pdo->beginTransaction();

            // 0. Bloquear la jornada: espera a los cobros en curso (que la leen con bloqueo compartido) y
            // frena los nuevos hasta terminar. Las lecturas siguientes ven todo lo que ya se guardó.
            $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' FOR UPDATE")->fetchAll();

            // 1. Validación crítica: Asegurar que no existan mesas ocupadas
            $stmtCheckMesas = $pdo->prepare("SELECT COUNT(*) FROM mesas WHERE estado_actual = 'ocupada'");
            $stmtCheckMesas->execute();
            $mesasOcupadas = (int)$stmtCheckMesas->fetchColumn();

            if ($mesasOcupadas > 0) {
                $pdo->rollBack();
                echo json_encode([
                    "status" => "error", 
                    "message" => "No se puede cerrar la jornada. Hay {$mesasOcupadas} mesa(s) ocupada(s) actualmente."
                ]);
                exit;
            }

            // 2. Obtener la jornada abierta actual
            $stmtJornada = $pdo->prepare("SELECT id_jornada, monto_inicial_caja, fecha_hora_apertura FROM jornadas WHERE estado = 'abierta' LIMIT 1");
            $stmtJornada->execute();
            $jornada = $stmtJornada->fetch(PDO::FETCH_ASSOC);

            if (!$jornada) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "No se encontró ninguna jornada abierta."]);
                exit;
            }

            $id_jornada = $jornada['id_jornada'];

            // 3. Calcular balances en caliente para guardar el histórico exacto. Se calculan antes de borrar la
            // foto de inventario y se devuelven: el reporte de cierre muestra exactamente lo que quedó cerrado.
            $reporte = datosPrecierre($pdo, $jornada);
            $caja = $reporte['caja'];

            // Efectivo real esperado en caja según balance transaccional
            $monto_final_real = $caja['monto_apertura'] + $caja['ingresos_efectivo'] - $caja['egresos'];

            // 4. Actualizar estado de la jornada a 'cerrada'
            $stmtUpdateJornada = $pdo->prepare("UPDATE jornadas SET fecha_hora_cierre = NOW(), monto_final_efectivo_real = ?, estado = 'cerrada' WHERE id_jornada = ?");
            $stmtUpdateJornada->execute([$monto_final_real, $id_jornada]);

            // 5. Vaciar la fotografía de inventario para dejarla lista para el siguiente turno
            $stmtLimpiarInv = $pdo->prepare("DELETE FROM jornada_inventario_apertura WHERE id_jornada = ?");
            $stmtLimpiarInv->execute([$id_jornada]);

            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Jornada cerrada con éxito de manera segura.", "reporte" => $reporte]);

        } catch (PDOException $e) {
            $pdo->rollBack();
            echo json_encode(["status" => "error", "message" => "Error transaccional en base de datos: " . $e->getMessage()]);
        }
        exit;
    }

    // =======================================================================
    // FLUJO B: APERTURA DE JORNADA DE CAJA (Flujo por defecto)
    // =======================================================================
    $data = json_decode(file_get_contents("php://input"), true);
    $monto_inicial = filter_var($data['monto_inicial'] ?? null, FILTER_VALIDATE_FLOAT);
    $id_usuario = filter_var($data['id_usuario'] ?? null, FILTER_VALIDATE_INT);

    if ($monto_inicial === false || $monto_inicial < 0 || !$id_usuario) {
        echo json_encode(["status" => "error", "message" => "Datos de apertura inválidos o negativos."]);
        exit;
    }

    try {
        // Candado con nombre: si dos cajas abren a la vez, la segunda espera y luego ve la jornada de la primera.
        // (Se libera solo al terminar la petición.)
        if ((int)$pdo->query("SELECT GET_LOCK('billar_apertura_jornada', 10)")->fetchColumn() !== 1) {
            echo json_encode(["status" => "error", "message" => "Otra caja está abriendo la jornada. Intente de nuevo."]);
            exit;
        }
        $pdo->beginTransaction();

        // 0. Bloquear el stock antes de crear la jornada: espera a las cargas en curso (quedan en la foto
        // de apertura) y frena las nuevas hasta terminar (quedan como cargas de esta jornada).
        $pdo->query("SELECT id_producto FROM productos LOCK IN SHARE MODE")->fetchAll();

        // 1. Doble verificación: Asegurar que no se abrió otra jornada en simultáneo
        $stmtCheck = $pdo->prepare("SELECT id_jornada FROM jornadas WHERE estado = 'abierta'");
        $stmtCheck->execute();
        if ($stmtCheck->fetch()) {
            $pdo->rollBack();
            echo json_encode(["status" => "bloqueado", "message" => "Ya existe una jornada abierta por otro usuario."]);
            exit;
        }

        // 2. Insertar nueva jornada operativa
        $stmtJornada = $pdo->prepare("INSERT INTO jornadas (id_usuario_apertura, fecha_hora_apertura, monto_inicial_caja, estado) VALUES (?, NOW(), ?, 'abierta')");
        $stmtJornada->execute([$id_usuario, $monto_inicial]);
        $id_jornada = $pdo->lastInsertId();

        // 3. Capturar instantánea aplicando la corrección del campo: stock_actual
        $stmtSnap = $pdo->prepare("INSERT INTO jornada_inventario_apertura (id_jornada, id_producto, stock_apertura) 
                                   SELECT ?, id_producto, stock_actual FROM productos");
        $stmtSnap->execute([$id_jornada]);

        $pdo->commit();
        
        // Retornar datos frescos de la jornada creada para pintar la interfaz
        $stmtFetch = $pdo->prepare("SELECT j.*, u.nombres, u.apellidos FROM jornadas j 
                                    INNER JOIN usuarios u ON j.id_usuario_apertura = u.id_usuario 
                                    WHERE j.id_jornada = ?");
        $stmtFetch->execute([$id_jornada]);
        $nuevaJornada = $stmtFetch->fetch(PDO::FETCH_ASSOC);

        echo json_encode(["status" => "success", "message" => "Jornada abierta correctamente.", "jornada" => $nuevaJornada]);

    } catch (PDOException $e) {
        $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => "Fallo operativo en base de datos: " . $e->getMessage()]);
    }
}

// =======================================================================
// CORRECCIÓN DE UNA VENTA YA COBRADA: editar la cantidad o borrar un producto
// =======================================================================
// La venta se recalcula con el motor de cobro (2x1, promos, redondeo), los pagos se ajustan para que
// sigan sumando el total y el cambio queda en ajustes_venta. Solo con la jornada de la venta abierta:
// una jornada cerrada ya cuadró su caja.
function corregirDetalleVenta($pdo, $idDetalle, $nuevaCantidad, $idUsuario) {
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT d.id_venta, d.id_producto, d.cantidad, d.id_promocion, p.tipo FROM detalle_venta_productos d JOIN productos p ON p.id_producto = d.id_producto WHERE d.id_detalle_prod = ? FOR UPDATE");
        $stmt->execute([$idDetalle]);
        $detalle = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$detalle || !$detalle['id_venta']) {
            throw new ErrorOperacion('Registro de detalle no encontrado.', 'no_encontrado');
        }

        $stmt = $pdo->prepare("SELECT id_venta, id_jornada, id_sesion, total_pagar FROM ventas WHERE id_venta = ? FOR UPDATE");
        $stmt->execute([$detalle['id_venta']]);
        $venta = $stmt->fetch(PDO::FETCH_ASSOC);

        // Bloqueo compartido: el cierre de la jornada espera a que termine esta corrección.
        $stmt = $pdo->prepare("SELECT estado FROM jornadas WHERE id_jornada = ? LOCK IN SHARE MODE");
        $stmt->execute([$venta['id_jornada']]);
        if ($stmt->fetchColumn() !== 'abierta') {
            throw new ErrorOperacion('Solo se pueden corregir ventas de la jornada abierta.', 'jornada_cerrada');
        }
        // Los productos de un combo tienen el precio del combo repartido: corregir uno solo rompería el combo.
        if ($detalle['id_promocion']) {
            throw new ErrorOperacion('Los productos de un combo no se corrigen por separado.', 'no_editable');
        }

        $anterior = intval($detalle['cantidad']);
        $diferencia = $nuevaCantidad - $anterior;
        // Los preparados (cócteles, vasos) no llevan stock.
        $conStock = $detalle['tipo'] === 'inventario';
        if ($conStock && $diferencia > 0) {
            $stmt = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ? AND stock_actual >= ?");
            $stmt->execute([$diferencia, $detalle['id_producto'], $diferencia]);
            if ($stmt->rowCount() === 0) {
                $stmtStock = $pdo->prepare("SELECT stock_actual FROM productos WHERE id_producto = ?");
                $stmtStock->execute([$detalle['id_producto']]);
                throw new ErrorOperacion("Stock insuficiente. Stock disponible: {$stmtStock->fetchColumn()} unidades.", 'stock_insuficiente');
            }
        } elseif ($conStock && $diferencia < 0) {
            $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?")->execute([-$diferencia, $detalle['id_producto']]);
        }

        if ($nuevaCantidad === 0) {
            $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_detalle_prod = ?")->execute([$idDetalle]);
        } else {
            $pdo->prepare("UPDATE detalle_venta_productos SET cantidad = ? WHERE id_detalle_prod = ?")->execute([$nuevaCantidad, $idDetalle]);
        }

        $liq = Liquidacion::reliquidarVenta($pdo, $venta['id_venta']);
        $pdo->prepare("UPDATE ventas SET subtotal_productos = ?, descuentos = ?, redondeo = ?, total_pagar = ? WHERE id_venta = ?")
            ->execute([$liq['subtotal_productos'], $liq['descuentos'], $liq['redondeo'], $liq['total'], $venta['id_venta']]);

        $cambio = Liquidacion::centavos($liq['total']) - Liquidacion::centavos($venta['total_pagar']);
        $movimientos = ajustarPagos($pdo, $venta['id_venta'], $cambio);

        $pdo->prepare("
            INSERT INTO ajustes_venta (id_venta, id_detalle_prod, id_producto, cantidad_anterior, cantidad_nueva,
                                       total_anterior, total_nuevo, ajuste_efectivo, ajuste_qr, id_usuario, fecha_hora)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ")->execute([
            $venta['id_venta'], $idDetalle, $detalle['id_producto'], $anterior, $nuevaCantidad,
            $venta['total_pagar'], $liq['total'], $movimientos['efectivo'] / 100, $movimientos['qr'] / 100, $idUsuario ?: null,
        ]);

        $pdo->commit();
        return ['venta' => $venta, 'liquidacion' => $liq, 'movimientos' => $movimientos];
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// Cambia los pagos de la venta en $cambio centavos. Si el cliente debe pagar más, lo paga con el mismo medio
// (en pago mixto, en efectivo). Si hay que devolver, se devuelve primero del efectivo y después del QR.
// Devuelve lo que se movió por cada medio, en centavos (negativo: se devolvió).
function ajustarPagos($pdo, $idVenta, $cambio) {
    $stmt = $pdo->prepare("SELECT id_pago, metodo_pago, monto_pagado FROM pagos_venta WHERE id_venta = ? ORDER BY metodo_pago = 'efectivo' DESC, id_pago FOR UPDATE");
    $stmt->execute([$idVenta]);
    $pagos = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $movimientos = ['efectivo' => 0, 'qr' => 0];

    if ($cambio > 0) {
        if ($pagos) {
            $pago = $pagos[0];
            $pdo->prepare("UPDATE pagos_venta SET monto_pagado = monto_pagado + ? WHERE id_pago = ?")->execute([$cambio / 100, $pago['id_pago']]);
            $movimientos[$pago['metodo_pago']] += $cambio;
        } else {
            $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, 'efectivo', ?)")->execute([$idVenta, $cambio / 100]);
            $movimientos['efectivo'] += $cambio;
        }
    } elseif ($cambio < 0) {
        $devolver = -$cambio;
        foreach ($pagos as $pago) {
            if ($devolver === 0) break;
            $monto = Liquidacion::centavos($pago['monto_pagado']);
            $quitar = min($monto, $devolver);
            if ($monto - $quitar > 0) {
                $pdo->prepare("UPDATE pagos_venta SET monto_pagado = ? WHERE id_pago = ?")->execute([($monto - $quitar) / 100, $pago['id_pago']]);
            } else {
                $pdo->prepare("DELETE FROM pagos_venta WHERE id_pago = ?")->execute([$pago['id_pago']]);
            }
            $movimientos[$pago['metodo_pago']] -= $quitar;
            $devolver -= $quitar;
        }
    }
    return $movimientos;
}

// Lo que el cajero tiene que hacer con el cliente después de la corrección.
function mensajeCaja(array $movimientos) {
    $partes = [];
    foreach (['efectivo' => 'en efectivo', 'qr' => 'por QR'] as $metodo => $texto) {
        if ($movimientos[$metodo] !== 0) $partes[] = sprintf('%.2f Bs %s', abs($movimientos[$metodo]) / 100, $texto);
    }
    if (!$partes) return 'El total de la venta no cambió.';
    $verbo = ($movimientos['efectivo'] + $movimientos['qr']) < 0 ? 'Devolver al cliente' : 'Cobrar al cliente';
    return $verbo . ' ' . implode(' y ', $partes) . '.';
}

function responderCorreccion(array $resultado, $mensaje) {
    $liq = $resultado['liquidacion'];
    echo json_encode([
        "status" => "success",
        "message" => $mensaje,
        "mensaje_caja" => mensajeCaja($resultado['movimientos']),
        "nuevo_subtotal_prod" => $liq['subtotal_productos'],
        "nuevo_total_pagar" => $liq['total'],
        // Lo que muestra "Mis ventas": productos en ventas de mesa, total en ventas de barra
        "importe" => $resultado['venta']['id_sesion'] ? $liq['subtotal_productos'] : $liq['total'],
        "ajuste" => [
            "efectivo" => $resultado['movimientos']['efectivo'] / 100,
            "qr" => $resultado['movimientos']['qr'] / 100,
        ],
    ]);
}

function responderErrorCorreccion(Exception $e, $prefijo) {
    if ($e instanceof ErrorOperacion) {
        echo json_encode(["status" => "error", "codigo" => $e->codigo, "message" => $e->getMessage()]);
    } else {
        echo json_encode(["status" => "error", "message" => $prefijo . $e->getMessage()]);
    }
}

// =======================================================================
// FLUJO PUT: EDITAR CANTIDAD DE UN DETALLE DE VENTA
// =======================================================================
if ($method === 'PUT') {
    $action = $_GET['action'] ?? '';
    if ($action === 'editar_detalle_venta') {
        $data = json_decode(file_get_contents("php://input"), true);
        $id_detalle = filter_var($data['id_detalle'] ?? null, FILTER_VALIDATE_INT);
        $nueva_cantidad = filter_var($data['nueva_cantidad'] ?? null, FILTER_VALIDATE_INT);

        if (!$id_detalle || $nueva_cantidad === false || $nueva_cantidad <= 0) {
            echo json_encode(["status" => "error", "message" => "Datos inválidos. La cantidad debe ser un entero positivo."]);
            exit;
        }

        try {
            $resultado = corregirDetalleVenta($pdo, $id_detalle, $nueva_cantidad, $data['id_usuario'] ?? null);
            responderCorreccion($resultado, "Cantidad actualizada correctamente.");
        } catch (Exception $e) {
            responderErrorCorreccion($e, "Error al editar: ");
        }
    } else {
        echo json_encode(["status" => "error", "message" => "Acción PUT no reconocida."]);
    }
    exit;
}

// =======================================================================
// FLUJO DELETE: ELIMINAR UN DETALLE DE VENTA
// =======================================================================
if ($method === 'DELETE') {
    $action = $_GET['action'] ?? '';
    if ($action === 'eliminar_detalle_venta') {
        $id_detalle = filter_var($_GET['id_detalle'] ?? null, FILTER_VALIDATE_INT);

        if (!$id_detalle) {
            echo json_encode(["status" => "error", "message" => "ID de detalle inválido."]);
            exit;
        }

        try {
            $resultado = corregirDetalleVenta($pdo, $id_detalle, 0, $_GET['id_usuario'] ?? null);
            responderCorreccion($resultado, "Producto eliminado de la venta y stock restaurado.");
        } catch (Exception $e) {
            responderErrorCorreccion($e, "Error al eliminar: ");
        }
    } else {
        echo json_encode(["status" => "error", "message" => "Acción DELETE no reconocida."]);
    }
    exit;
}

?>