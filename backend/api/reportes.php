<?php
// backend/api/reportes.php
header('Content-Type: application/json');
include_once '../config/database.php';

$database = new Database();
$pdo = $database->getConnection();

$method = $_SERVER['REQUEST_METHOD'];
$tipo = $_GET['tipo'] ?? '';

try {
    if (!isset($pdo) || $pdo === null) {
        throw new Exception("Error de conexión a la BD.");
    }

    if ($method == 'GET') {
        // --- 1. BUSCADOR DE JORNADAS POR FECHA ---
        if ($tipo === 'buscar_jornadas') {
            $fecha = $_GET['fecha'] ?? date('Y-m-d');
            $stmt = $pdo->prepare("SELECT id_jornada, DATE_FORMAT(fecha_hora_apertura, '%H:%i:%s') as hora_apertura 
                                   FROM jornadas WHERE DATE(fecha_hora_apertura) = ? ORDER BY id_jornada ASC");
            $stmt->execute([$fecha]);
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            exit;
        }
        // --- 2. GENERADOR DEL REPORTE DE JORNADA ---
        if ($tipo === 'jornada') {
            $id = (int)$_GET['id_jornada'];
            $data = ["filtros" => [
                "apertura" => filter_var($_GET['apertura'], FILTER_VALIDATE_BOOLEAN),
                "mesas" => filter_var($_GET['mesas'], FILTER_VALIDATE_BOOLEAN),
                "productos" => filter_var($_GET['productos'], FILTER_VALIDATE_BOOLEAN),
                "egresos" => filter_var($_GET['egresos'], FILTER_VALIDATE_BOOLEAN),
                "insumos" => filter_var($_GET['insumos'], FILTER_VALIDATE_BOOLEAN)
            ]];

            // ENCABEZADO BASE
            $stmt = $pdo->prepare("SELECT j.id_jornada, j.fecha_hora_apertura, j.fecha_hora_cierre, j.monto_inicial_caja, 
                                          CONCAT(u.nombres, ' ', u.apellidos) as encargado 
                                   FROM jornadas j JOIN usuarios u ON j.id_usuario_apertura = u.id_usuario 
                                   WHERE j.id_jornada = ?");
            $stmt->execute([$id]);
            $jornada = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$jornada) throw new Exception("Jornada no encontrada.");

            $data["encabezado"] = [
                "id_jornada" => $jornada['id_jornada'],
                "encargado" => $jornada['encargado'],
                "apertura" => $jornada['fecha_hora_apertura'],
                "cierre" => $jornada['fecha_hora_cierre']
            ];

            // SECCIÓN: APERTURA Y CIERRE
            if ($data["filtros"]["apertura"]) {
                // Egresos
                $stmtEg = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
                $stmtEg->execute([$id]);
                $t_egresos = $stmtEg->fetchColumn();

                // Ingresos Totales de Ventas (Para caja)
                $stmtIng = $pdo->prepare("SELECT 
                    COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto_pagado ELSE 0 END), 0) as efvo,
                    COALESCE(SUM(CASE WHEN metodo_pago = 'qr' THEN monto_pagado ELSE 0 END), 0) as qr
                    FROM pagos_venta pv JOIN ventas v ON pv.id_venta = v.id_venta WHERE v.id_jornada = ?");
                $stmtIng->execute([$id]);
                $ingresos = $stmtIng->fetch(PDO::FETCH_ASSOC);

                $data["apertura"] = [
                    "monto_inicial" => $jornada['monto_inicial_caja'],
                    "ingreso_efectivo" => $ingresos['efvo'],
                    "ingreso_qr" => $ingresos['qr'],
                    "total_egresos" => $t_egresos
                ];
            }

            // =================================================================
            // SECCIÓN: HORAS DE USO DE MESAS (CORREGIDO Y TOTALIZADO)
            // =================================================================
            if ($data["filtros"]["mesas"]) {
                // 1. Obtener las filas detalladas
                $stmtM = $pdo->prepare("
                    SELECT 
                        m.numero_mesa as mesa, 
                        tm.fecha_hora_inicio as fecha_hora, 
                        TIMEDIFF(tm.fecha_hora_fin, tm.fecha_hora_inicio) as tiempo_uso,
                        (SELECT GROUP_CONCAT(metodo_pago SEPARATOR ' + ') FROM pagos_venta pv WHERE pv.id_venta = v.id_venta) as metodo,
                        v.subtotal_mesas as total,
                        v.id_venta
                    FROM ventas v
                    JOIN sesiones_juego sj ON v.id_sesion = sj.id_sesion
                    JOIN tramos_mesas tm ON sj.id_sesion = tm.id_sesion
                    JOIN mesas m ON tm.id_mesa = m.id_mesa
                    WHERE v.id_jornada = ? AND tm.tarifa_hora_aplicada > 0
                ");
                $stmtM->execute([$id]);
                $filasMesas = $stmtM->fetchAll(PDO::FETCH_ASSOC);
                $data["mesas"]["filas"] = $filasMesas;

                // 2. Calcular Resúmenes Matemáticos Reales
                $totalSegundos = 0;
                $efectivoMesas = 0;
                $qrMesas = 0;

                foreach ($filasMesas as $f) {
                    // CORRECCIÓN AQUÍ: Añadido el '$' faltante a la variable $parts en la línea 108
                    if (!empty($f['tiempo_uso'])) {
                        $parts = explode(':', $f['tiempo_uso']);
                        if (count($parts) == 3) {
                            $totalSegundos += ($parts[0] * 3600) + ($parts[1] * 60) + $parts[2];
                        }
                    }

                    // Extraer los pagos reales de esta venta específica para Mesas
                    $stmtPagos = $pdo->prepare("SELECT metodo_pago, monto_pagado FROM pagos_venta WHERE id_venta = ?");
                    $stmtPagos->execute([$f['id_venta']]);
                    $pagos = $stmtPagos->fetchAll(PDO::FETCH_ASSOC);

                    foreach ($pagos as $p) {
                        if ($p['metodo_pago'] === 'efectivo') {
                            $efectivoMesas += $p['monto_pagado'];
                        } elseif ($p['metodo_pago'] === 'qr') {
                            $qrMesas += $p['monto_pagado'];
                        }
                    }
                }

                // Convertir el total de segundos de vuelta al formato HH:mm:ss
                $horas = floor($totalSegundos / 3600);
                $minutos = floor(($totalSegundos % 3600) / 60);
                $segundos = $totalSegundos % 60;
                $tiempoFormateado = sprintf('%02d:%02d:%02d', $horas, $minutos, $segundos);

                $data["mesas"]["resumen"] = [
                    "horas" => $tiempoFormateado,
                    "efectivo" => number_format($efectivoMesas, 2, '.', ''),
                    "qr" => number_format($qrMesas, 2, '.', '')
                ];
            }

            // =================================================================
            // SECCIÓN: VENTA DE PRODUCTOS (CORREGIDO Y TOTALIZADO)
            // =================================================================
            if ($data["filtros"]["productos"]) {
                // 1. Obtener las filas detalladas
                $stmtP = $pdo->prepare("
                    SELECT 
                        IF(v.id_sesion IS NULL, 'Barra', 'Mesa') as modo,
                        v.fecha_hora_venta as fecha_hora,
                        (SELECT COALESCE(SUM(cantidad), 0) FROM detalle_venta_productos dvp WHERE dvp.id_venta = v.id_venta) as cantidad,
                        (SELECT GROUP_CONCAT(metodo_pago SEPARATOR ' + ') FROM pagos_venta pv WHERE pv.id_venta = v.id_venta) as metodo,
                        v.subtotal_productos as total,
                        v.id_venta
                    FROM ventas v
                    WHERE v.id_jornada = ? AND v.subtotal_productos > 0
                ");
                $stmtP->execute([$id]);
                $filasProductos = $stmtP->fetchAll(PDO::FETCH_ASSOC);
                $data["productos"]["filas"] = $filasProductos;

                // 2. Calcular Resúmenes Matemáticos Reales
                $totalProductos = 0;
                $efectivoProductos = 0;
                $qrProductos = 0;

                foreach ($filasProductos as $f) {
                    $totalProductos += (int)$f['cantidad'];

                    // Extraer los pagos reales de esta venta específica para Productos
                    $stmtPagosP = $pdo->prepare("SELECT metodo_pago, monto_pagado FROM pagos_venta WHERE id_venta = ?");
                    $stmtPagosP->execute([$f['id_venta']]);
                    $pagosP = $stmtPagosP->fetchAll(PDO::FETCH_ASSOC);

                    foreach ($pagosP as $p) {
                        if ($p['metodo_pago'] === 'efectivo') {
                            $efectivoProductos += $p['monto_pagado'];
                        } elseif ($p['metodo_pago'] === 'qr') {
                            $qrProductos += $p['monto_pagado'];
                        }
                    }
                }

                $data["productos"]["resumen"] = [
                    "cantidad" => $totalProductos,
                    "efectivo" => number_format($efectivoProductos, 2, '.', ''),
                    "qr" => number_format($qrProductos, 2, '.', '')
                ];
            }

            // SECCIÓN: EGRESOS
            if ($data["filtros"]["egresos"]) {
                $stmtE = $pdo->prepare("SELECT fecha_hora as fecha, descripcion as concepto, monto FROM egresos_caja WHERE id_jornada = ?");
                $stmtE->execute([$id]);
                $data["egresos"] = $stmtE->fetchAll(PDO::FETCH_ASSOC);
            }

            // SECCIÓN: INSUMOS
            if ($data["filtros"]["insumos"]) {
                $stmtI = $pdo->prepare("SELECT g.fecha_hora as fecha, i.nombre_insumo as insumo, g.cantidad 
                                        FROM gastos_insumos g JOIN insumos i ON g.id_insumo = i.id_insumo 
                                        WHERE g.id_jornada = ?");
                $stmtI->execute([$id]);
                $data["insumos"] = $stmtI->fetchAll(PDO::FETCH_ASSOC);
            }

            echo json_encode(["status" => "success", "data" => $data]);
            exit;
        } elseif ($tipo === 'ingresos_semana') {
            // TODO: Crear query agrupado por semana
            echo json_encode(["status" => "success", "data" => "Datos simulados para Semana"]);
            
        } elseif ($tipo === 'ingresos_mes') {
            // TODO: Crear query agrupado por mes
            echo json_encode(["status" => "success", "data" => "Datos simulados para Mes"]);
            
        } else {
            throw new Exception("El tipo de reporte seleccionado no es válido.");
        }
    }

} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>