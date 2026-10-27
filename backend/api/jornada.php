<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");

// Inclusión correcta de la clase de base de datos según tu entorno
include_once '../config/database.php'; 
$database = new Database();
$pdo = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

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

            // 1. CUADRE DE CAJA: Sumas cruzadas por método de pago y egresos
            $stmtEfectivo = $pdo->prepare("SELECT COALESCE(SUM(pv.monto_pagado), 0) FROM pagos_venta pv 
                                           INNER JOIN ventas v ON pv.id_venta = v.id_venta 
                                           WHERE v.id_jornada = ? AND pv.metodo_pago = 'efectivo'");
            $stmtEfectivo->execute([$id_jornada]);
            $ingresos_efectivo = (float)$stmtEfectivo->fetchColumn();

            $stmtQR = $pdo->prepare("SELECT COALESCE(SUM(pv.monto_pagado), 0) FROM pagos_venta pv 
                                     INNER JOIN ventas v ON pv.id_venta = v.id_venta 
                                     WHERE v.id_jornada = ? AND pv.metodo_pago = 'qr'");
            $stmtQR->execute([$id_jornada]);
            $ingresos_qr = (float)$stmtQR->fetchColumn();

            $stmtEgresos = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
            $stmtEgresos->execute([$id_jornada]);
            $egresos = (float)$stmtEgresos->fetchColumn();

            // 2. CUADRE DE INVENTARIO: Subconsulta limpia para evitar duplicados por joins múltiples
            $stmtInventario = $pdo->prepare("
                SELECT 
                    p.nombre_producto,
                    jia.stock_apertura AS stock_inicial,
                    COALESCE(ventas_prod.total_vendido, 0) AS vendido,
                    p.precio_venta AS precio_unitario,
                    p.stock_actual AS stock_final
                FROM jornada_inventario_apertura jia
                INNER JOIN productos p ON jia.id_producto = p.id_producto
                LEFT JOIN (
                    SELECT dv.id_producto, SUM(dv.cantidad) AS total_vendido
                    FROM detalle_venta_productos dv
                    INNER JOIN ventas v ON dv.id_venta = v.id_venta
                    WHERE v.id_jornada = ?
                    GROUP BY dv.id_producto
                ) ventas_prod ON p.id_producto = ventas_prod.id_producto
                WHERE jia.id_jornada = ?
            ");
            $stmtInventario->execute([$id_jornada, $id_jornada]);
            $cuadre_inventario = $stmtInventario->fetchAll(PDO::FETCH_ASSOC);

            // 3. HORAS TOTALES JUGADAS EN LA JORNADA
            $stmtHoras = $pdo->prepare("SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, tr.fecha_hora_inicio, IFNULL(tr.fecha_hora_fin, NOW())) / 60.0), 0) AS total_horas 
                                        FROM tramos_mesas tr
                                        INNER JOIN sesiones_juego s ON tr.id_sesion = s.id_sesion
                                        INNER JOIN mesas m ON tr.id_mesa = m.id_mesa
                                        INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa
                                        WHERE s.id_jornada = ? AND tm.precio_hora > 0");
            $stmtHoras->execute([$id_jornada]);
            $horas_totales = (float)$stmtHoras->fetchColumn();

            // 4. DETALLE DE EGRESOS DE LA JORNADA (para mostrar en pre-cierre)
            $stmtDetEgresos = $pdo->prepare(
                "SELECT id_egreso, descripcion, monto, fecha_hora
                 FROM egresos_caja
                 WHERE id_jornada = ?
                 ORDER BY fecha_hora ASC"
            );
            $stmtDetEgresos->execute([$id_jornada]);
            $detalle_egresos = $stmtDetEgresos->fetchAll(PDO::FETCH_ASSOC);

            echo json_encode([
                "status" => "success",
                "jornada_id" => $id_jornada,
                "fecha_apertura" => $jornada['fecha_hora_apertura'],
                "horas_totales" => $horas_totales,
                "caja" => [
                    "monto_apertura" => (float)$jornada['monto_inicial_caja'],
                    "ingresos_efectivo" => $ingresos_efectivo,
                    "egresos" => $egresos,
                    "ingresos_qr" => $ingresos_qr
                ],
                "egresos_detalle" => $detalle_egresos,
                "inventario" => $cuadre_inventario
            ]);
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

                // KPI 2: Recuento total de horas jugadas mapeando los tramos de la sesión en esta jornada
                $stmtHoras = $pdo->prepare("SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, tr.fecha_hora_inicio, IFNULL(tr.fecha_hora_fin, NOW())) / 60.0), 0) AS total_horas 
                                            FROM tramos_mesas tr
                                            INNER JOIN sesiones_juego s ON tr.id_sesion = s.id_sesion
                                            INNER JOIN mesas m ON tr.id_mesa = m.id_mesa
                                            INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa
                                            WHERE s.id_jornada = ? AND tm.precio_hora > 0");
                $stmtHoras->execute([$id_jornada]);
                $total_horas = (float)$stmtHoras->fetchColumn();

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
            $stmtJornada = $pdo->prepare("SELECT id_jornada, monto_inicial_caja FROM jornadas WHERE estado = 'abierta' LIMIT 1");
            $stmtJornada->execute();
            $jornada = $stmtJornada->fetch(PDO::FETCH_ASSOC);

            if (!$jornada) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "No se encontró ninguna jornada abierta."]);
                exit;
            }

            $id_jornada = $jornada['id_jornada'];

            // 3. Calcular balances en caliente para guardar el histórico exacto
            $stmtEfectivo = $pdo->prepare("SELECT COALESCE(SUM(pv.monto_pagado), 0) FROM pagos_venta pv 
                                           INNER JOIN ventas v ON pv.id_venta = v.id_venta 
                                           WHERE v.id_jornada = ? AND pv.metodo_pago = 'efectivo'");
            $stmtEfectivo->execute([$id_jornada]);
            $ingresos_efectivo = (float)$stmtEfectivo->fetchColumn();

            $stmtEgresos = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
            $stmtEgresos->execute([$id_jornada]);
            $egresos = (float)$stmtEgresos->fetchColumn();

            // Efectivo real esperado en caja según balance transaccional
            $monto_final_real = (float)$jornada['monto_inicial_caja'] + $ingresos_efectivo - $egresos;

            // 4. Actualizar estado de la jornada a 'cerrada'
            $stmtUpdateJornada = $pdo->prepare("UPDATE jornadas SET fecha_hora_cierre = NOW(), monto_final_efectivo_real = ?, estado = 'cerrada' WHERE id_jornada = ?");
            $stmtUpdateJornada->execute([$monto_final_real, $id_jornada]);

            // 5. Vaciar la fotografía de inventario para dejarla lista para el siguiente turno
            $stmtLimpiarInv = $pdo->prepare("DELETE FROM jornada_inventario_apertura WHERE id_jornada = ?");
            $stmtLimpiarInv->execute([$id_jornada]);

            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Jornada cerrada con éxito de manera segura."]);

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
        $pdo->beginTransaction();

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
            $pdo->beginTransaction();

            // Obtener datos actuales del detalle
            $stmtDetalle = $pdo->prepare("
                SELECT dvp.id_venta, dvp.id_producto, dvp.cantidad, dvp.precio_unitario_aplicado
                FROM detalle_venta_productos dvp
                WHERE dvp.id_detalle_prod = ?
            ");
            $stmtDetalle->execute([$id_detalle]);
            $detalle = $stmtDetalle->fetch(PDO::FETCH_ASSOC);

            if (!$detalle) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Registro de detalle no encontrado."]);
                exit;
            }

            $cantidad_anterior = (int)$detalle['cantidad'];
            $diferencia = $nueva_cantidad - $cantidad_anterior;
            $id_producto = $detalle['id_producto'];
            $id_venta = $detalle['id_venta'];

            // Verificar stock disponible si se incrementa la cantidad
            if ($diferencia > 0) {
                $stmtStock = $pdo->prepare("SELECT stock_actual FROM productos WHERE id_producto = ?");
                $stmtStock->execute([$id_producto]);
                $stock_actual = (int)$stmtStock->fetchColumn();
                if ($stock_actual < $diferencia) {
                    $pdo->rollBack();
                    echo json_encode([
                        "status" => "error",
                        "message" => "Stock insuficiente. Stock disponible: {$stock_actual} unidades."
                    ]);
                    exit;
                }
            }

            // Ajustar el stock del producto (restar si diferencia > 0, sumar si < 0)
            $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");
            $stmtStock->execute([$diferencia, $id_producto]);

            // Actualizar la cantidad en detalle_venta_productos
            $stmtUpdate = $pdo->prepare("UPDATE detalle_venta_productos SET cantidad = ? WHERE id_detalle_prod = ?");
            $stmtUpdate->execute([$nueva_cantidad, $id_detalle]);

            // Recalcular subtotal_productos de la venta
            $stmtSubtotal = $pdo->prepare("
                SELECT COALESCE(SUM(cantidad * precio_unitario_aplicado), 0) AS nuevo_subtotal
                FROM detalle_venta_productos
                WHERE id_venta = ?
            ");
            $stmtSubtotal->execute([$id_venta]);
            $nuevo_subtotal_productos = (float)$stmtSubtotal->fetchColumn();

            // Obtener subtotal_mesas y descuentos para recalcular total_pagar
            $stmtVenta = $pdo->prepare("SELECT subtotal_mesas, descuentos FROM ventas WHERE id_venta = ?");
            $stmtVenta->execute([$id_venta]);
            $venta = $stmtVenta->fetch(PDO::FETCH_ASSOC);
            $nuevo_total = (float)$venta['subtotal_mesas'] + $nuevo_subtotal_productos - (float)$venta['descuentos'];

            $stmtUpdateVenta = $pdo->prepare("
                UPDATE ventas SET subtotal_productos = ?, total_pagar = ? WHERE id_venta = ?
            ");
            $stmtUpdateVenta->execute([$nuevo_subtotal_productos, $nuevo_total, $id_venta]);

            $pdo->commit();
            echo json_encode([
                "status"              => "success",
                "message"             => "Cantidad actualizada correctamente.",
                "nuevo_subtotal_prod" => $nuevo_subtotal_productos,
                "nuevo_total_pagar"   => $nuevo_total
            ]);
        } catch (PDOException $e) {
            $pdo->rollBack();
            echo json_encode(["status" => "error", "message" => "Error al editar: " . $e->getMessage()]);
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
            $pdo->beginTransaction();

            // Obtener datos del detalle antes de borrar
            $stmtDetalle = $pdo->prepare("
                SELECT dvp.id_venta, dvp.id_producto, dvp.cantidad
                FROM detalle_venta_productos dvp
                WHERE dvp.id_detalle_prod = ?
            ");
            $stmtDetalle->execute([$id_detalle]);
            $detalle = $stmtDetalle->fetch(PDO::FETCH_ASSOC);

            if (!$detalle) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Registro no encontrado."]);
                exit;
            }

            $id_venta     = $detalle['id_venta'];
            $id_producto  = $detalle['id_producto'];
            $cantidad     = (int)$detalle['cantidad'];

            // Devolver stock al inventario
            $stmtRestoreStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
            $stmtRestoreStock->execute([$cantidad, $id_producto]);

            // Eliminar el detalle
            $stmtDelete = $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_detalle_prod = ?");
            $stmtDelete->execute([$id_detalle]);

            // Recalcular subtotal_productos
            $stmtSubtotal = $pdo->prepare("
                SELECT COALESCE(SUM(cantidad * precio_unitario_aplicado), 0) AS nuevo_subtotal
                FROM detalle_venta_productos
                WHERE id_venta = ?
            ");
            $stmtSubtotal->execute([$id_venta]);
            $nuevo_subtotal_productos = (float)$stmtSubtotal->fetchColumn();

            // Recalcular total_pagar
            $stmtVenta = $pdo->prepare("SELECT subtotal_mesas, descuentos FROM ventas WHERE id_venta = ?");
            $stmtVenta->execute([$id_venta]);
            $venta = $stmtVenta->fetch(PDO::FETCH_ASSOC);
            $nuevo_total = (float)$venta['subtotal_mesas'] + $nuevo_subtotal_productos - (float)$venta['descuentos'];

            $stmtUpdateVenta = $pdo->prepare("
                UPDATE ventas SET subtotal_productos = ?, total_pagar = ? WHERE id_venta = ?
            ");
            $stmtUpdateVenta->execute([$nuevo_subtotal_productos, $nuevo_total, $id_venta]);

            $pdo->commit();
            echo json_encode([
                "status"              => "success",
                "message"             => "Producto eliminado de la venta y stock restaurado.",
                "nuevo_subtotal_prod" => $nuevo_subtotal_productos,
                "nuevo_total_pagar"   => $nuevo_total
            ]);
        } catch (PDOException $e) {
            $pdo->rollBack();
            echo json_encode(["status" => "error", "message" => "Error al eliminar: " . $e->getMessage()]);
        }
    } else {
        echo json_encode(["status" => "error", "message" => "Acción DELETE no reconocida."]);
    }
    exit;
}

?>