<?php
// backend/api/reportes.php
header('Content-Type: application/json');
include_once '../config/database.php';
include_once '../models/ResumenJornada.php';
session_start();

// Los reportes son del administrador, como el resto de su portal.
if (!isset($_SESSION['rol']) || $_SESSION['rol'] !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Acceso denegado."]);
    exit;
}
session_write_close();

// Ingresos de un período (semana o mes), con los mismos números que el reporte de cada jornada:
// cada jornada cuenta en el día en que abrió, aunque cierre pasada la medianoche.
function reportePeriodo($pdo, DateTime $desde, DateTime $hasta, array $periodo) {
    $cero = function () {
        return ['jornadas' => 0, 'ventas' => 0, 'mesas' => 0, 'productos' => 0, 'cargos' => 0, 'total' => 0,
                'efectivo' => 0, 'qr' => 0, 'egresos' => 0, 'neto' => 0, 'horas' => 0, 'unidades' => 0];
    };
    $dias = [];
    for ($d = clone $desde; $d <= $hasta; $d->modify('+1 day')) {
        $dias[$d->format('Y-m-d')] = ['fecha' => $d->format('Y-m-d'), 'dia_semana' => intval($d->format('N'))] + $cero();
    }

    $stmt = $pdo->prepare("SELECT id_jornada, DATE(fecha_hora_apertura) AS dia FROM jornadas
                           WHERE fecha_hora_apertura >= ? AND fecha_hora_apertura < ? ORDER BY fecha_hora_apertura");
    $stmt->execute([$desde->format('Y-m-d 00:00:00'), (clone $hasta)->modify('+1 day')->format('Y-m-d 00:00:00')]);
    $jornadas = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmtEg = $pdo->prepare("SELECT COALESCE(SUM(monto), 0) FROM egresos_caja WHERE id_jornada = ?");
    $stmtVentas = $pdo->prepare("SELECT COUNT(*) FROM ventas WHERE id_jornada = ?");
    $stmtUds = $pdo->prepare("SELECT COALESCE(SUM(dv.cantidad), 0) FROM detalle_venta_productos dv JOIN ventas v ON v.id_venta = dv.id_venta WHERE v.id_jornada = ?");
    $ids = [];
    foreach ($jornadas as $j) {
        $id = intval($j['id_jornada']);
        $ids[] = $id;
        $ing = ResumenJornada::ingresos($pdo, $id);
        $stmtEg->execute([$id]);
        $stmtVentas->execute([$id]);
        $stmtUds->execute([$id]);
        $dia = &$dias[$j['dia']];
        $dia['jornadas']++;
        $dia['ventas'] += intval($stmtVentas->fetchColumn());
        $dia['mesas'] += $ing['mesas']['total'];
        $dia['productos'] += $ing['productos']['total'];
        $dia['cargos'] += $ing['cargos']['total'];
        $dia['efectivo'] += $ing['mesas']['efectivo'] + $ing['productos']['efectivo'] + $ing['cargos']['efectivo'];
        $dia['qr'] += $ing['mesas']['qr'] + $ing['productos']['qr'] + $ing['cargos']['qr'];
        $dia['egresos'] += floatval($stmtEg->fetchColumn());
        $dia['horas'] += ResumenJornada::segundosJugados($pdo, $id) / 3600;
        $dia['unidades'] += intval($stmtUds->fetchColumn());
        unset($dia);
    }

    $totales = $cero();
    foreach ($dias as &$dia) {
        $dia['total'] = $dia['mesas'] + $dia['productos'] + $dia['cargos'];
        $dia['neto'] = $dia['total'] - $dia['egresos']; // lo cobrado menos lo que salió de caja
        foreach ($totales as $clave => $_) $totales[$clave] += $dia[$clave];
        foreach (['mesas', 'productos', 'cargos', 'total', 'efectivo', 'qr', 'egresos', 'neto', 'horas'] as $clave) {
            $dia[$clave] = round($dia[$clave], 2);
        }
    }
    unset($dia);
    foreach (['mesas', 'productos', 'cargos', 'total', 'efectivo', 'qr', 'egresos', 'neto', 'horas'] as $clave) {
        $totales[$clave] = round($totales[$clave], 2);
    }

    // Productos más vendidos del período (unidades y lo que suman a su precio de venta, antes de descuentos)
    $productos = [];
    if ($ids) {
        $marcas = implode(',', array_fill(0, count($ids), '?'));
        $stmtP = $pdo->prepare("SELECT p.nombre_producto AS producto, SUM(dv.cantidad) AS unidades,
                                       SUM(dv.cantidad * dv.precio_unitario_aplicado) AS importe
                                FROM detalle_venta_productos dv
                                JOIN ventas v ON v.id_venta = dv.id_venta
                                JOIN productos p ON p.id_producto = dv.id_producto
                                WHERE v.id_jornada IN ($marcas)
                                GROUP BY p.id_producto, p.nombre_producto
                                ORDER BY unidades DESC, importe DESC, p.nombre_producto
                                LIMIT 10");
        $stmtP->execute($ids);
        $productos = array_map(function ($f) {
            return ['producto' => $f['producto'], 'unidades' => intval($f['unidades']), 'importe' => round(floatval($f['importe']), 2)];
        }, $stmtP->fetchAll(PDO::FETCH_ASSOC));
    }

    return [
        'periodo' => $periodo + ['desde' => $desde->format('Y-m-d'), 'hasta' => $hasta->format('Y-m-d')],
        'totales' => $totales,
        'dias' => array_values($dias),
        'productos_top' => $productos,
    ];
}

function fechaValida($texto, $formato) {
    $d = DateTime::createFromFormat('!' . $formato, (string) $texto);
    return ($d && $d->format($formato) === $texto) ? $d : null;
}

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
                "insumos" => filter_var($_GET['insumos'], FILTER_VALIDATE_BOOLEAN),
                "gastos_productos" => filter_var($_GET['gastos_productos'] ?? false, FILTER_VALIDATE_BOOLEAN)
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

            // Lo cobrado en la jornada repartido entre mesas y productos: las dos secciones suman lo que entró a caja.
            $ingresosJornada = ResumenJornada::ingresos($pdo, $id);
            $formatoTiempo = function ($segundos) {
                return sprintf('%02d:%02d:%02d', floor($segundos / 3600), floor(($segundos % 3600) / 60), $segundos % 60);
            };

            // =================================================================
            // SECCIÓN: HORAS DE USO DE MESAS (una fila por cobro, aunque la partida haya pasado por varias mesas)
            // =================================================================
            if ($data["filtros"]["mesas"]) {
                $stmtM = $pdo->prepare("
                    SELECT
                        v.id_venta,
                        GROUP_CONCAT(m.numero_mesa ORDER BY tm.id_tramo SEPARATOR '|') as mesas,
                        MIN(tm.fecha_hora_inicio) as fecha_hora,
                        SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, tm.fecha_hora_inicio, COALESCE(tm.fecha_hora_fin, tm.fecha_hora_pausa, v.fecha_hora_venta)))) as segundos,
                        (SELECT GROUP_CONCAT(metodo_pago SEPARATOR ' + ') FROM pagos_venta pv WHERE pv.id_venta = v.id_venta) as metodo
                    FROM ventas v
                    JOIN tramos_mesas tm ON tm.id_sesion = v.id_sesion
                    JOIN mesas m ON tm.id_mesa = m.id_mesa
                    JOIN tipos_mesa t ON t.id_tipo_mesa = m.id_tipo_mesa
                    WHERE v.id_jornada = ? AND t.precio_hora > 0
                    GROUP BY v.id_venta
                    ORDER BY fecha_hora
                ");
                $stmtM->execute([$id]);

                $filasMesas = [];
                $totalSegundos = 0;
                foreach ($stmtM->fetchAll(PDO::FETCH_ASSOC) as $f) {
                    // Pausar y reanudar repite la mesa: se muestra cada cambio de mesa una sola vez.
                    $recorrido = [];
                    foreach (explode('|', $f['mesas']) as $mesa) {
                        if (end($recorrido) !== $mesa) $recorrido[] = $mesa;
                    }
                    $reparto = isset($ingresosJornada['ventas'][intval($f['id_venta'])]) ? $ingresosJornada['ventas'][intval($f['id_venta'])] : null;
                    $cobrado = $reparto ? ($reparto['mesas_efectivo'] + $reparto['mesas_qr']) / 100 : 0;
                    $totalSegundos += intval($f['segundos']);
                    $filasMesas[] = [
                        "mesa" => implode(' → ', $recorrido),
                        "fecha_hora" => $f['fecha_hora'],
                        "tiempo_uso" => $formatoTiempo(intval($f['segundos'])),
                        "metodo" => $f['metodo'],
                        "total" => number_format($cobrado, 2, '.', ''),
                        "id_venta" => $f['id_venta']
                    ];
                }
                // La hora con descuento vendida en barra se cobra antes de jugar: cuenta como mesas, en su propia fila.
                $stmtHoraBarra = $pdo->prepare("
                    SELECT v.id_venta, v.fecha_hora_venta,
                           (SELECT GROUP_CONCAT(metodo_pago SEPARATOR ' + ') FROM pagos_venta pv WHERE pv.id_venta = v.id_venta) AS metodo
                    FROM ventas v
                    WHERE v.id_jornada = ? AND v.id_sesion IS NULL
                      AND EXISTS (SELECT 1 FROM cargos_venta c WHERE c.id_venta = v.id_venta AND c.tipo = 'hora_gratis')
                    ORDER BY v.fecha_hora_venta
                ");
                $stmtHoraBarra->execute([$id]);
                foreach ($stmtHoraBarra->fetchAll(PDO::FETCH_ASSOC) as $f) {
                    $reparto = isset($ingresosJornada['ventas'][intval($f['id_venta'])]) ? $ingresosJornada['ventas'][intval($f['id_venta'])] : null;
                    $filasMesas[] = [
                        "mesa" => "Hora con descuento (vendida en barra)",
                        "fecha_hora" => $f['fecha_hora_venta'],
                        "tiempo_uso" => "00:00:00",
                        "metodo" => $f['metodo'],
                        "total" => number_format($reparto ? ($reparto['mesas_efectivo'] + $reparto['mesas_qr']) / 100 : 0, 2, '.', ''),
                        "id_venta" => $f['id_venta']
                    ];
                }
                $data["mesas"]["filas"] = $filasMesas;
                $data["mesas"]["resumen"] = [
                    "horas" => $formatoTiempo($totalSegundos),
                    "efectivo" => number_format($ingresosJornada['mesas']['efectivo'], 2, '.', ''),
                    "qr" => number_format($ingresosJornada['mesas']['qr'], 2, '.', '')
                ];
            }

            // =================================================================
            // SECCIÓN: VENTA DE PRODUCTOS (lo cobrado por productos, después de promos)
            // =================================================================
            if ($data["filtros"]["productos"]) {
                $stmtP = $pdo->prepare("
                    SELECT
                        IF(v.id_sesion IS NULL, 'Barra', 'Mesa') as modo,
                        v.fecha_hora_venta as fecha_hora,
                        (SELECT COALESCE(SUM(cantidad), 0) FROM detalle_venta_productos dvp WHERE dvp.id_venta = v.id_venta) as cantidad,
                        (SELECT GROUP_CONCAT(metodo_pago SEPARATOR ' + ') FROM pagos_venta pv WHERE pv.id_venta = v.id_venta) as metodo,
                        v.id_venta
                    FROM ventas v
                    WHERE v.id_jornada = ? AND v.subtotal_productos > 0
                    ORDER BY v.fecha_hora_venta
                ");
                $stmtP->execute([$id]);

                $filasProductos = [];
                $totalProductos = 0;
                foreach ($stmtP->fetchAll(PDO::FETCH_ASSOC) as $f) {
                    $reparto = isset($ingresosJornada['ventas'][intval($f['id_venta'])]) ? $ingresosJornada['ventas'][intval($f['id_venta'])] : null;
                    $cobrado = $reparto ? ($reparto['productos_efectivo'] + $reparto['productos_qr']) / 100 : 0;
                    $totalProductos += (int)$f['cantidad'];
                    $f['total'] = number_format($cobrado, 2, '.', '');
                    $filasProductos[] = $f;
                }
                $data["productos"]["filas"] = $filasProductos;
                $data["productos"]["resumen"] = [
                    "cantidad" => $totalProductos,
                    "efectivo" => number_format($ingresosJornada['productos']['efectivo'], 2, '.', ''),
                    "qr" => number_format($ingresosJornada['productos']['qr'], 2, '.', '')
                ];

                // Otros cargos (rotura de vaso, daños): no son productos ni tiempo de mesa.
                // La hora con descuento se cuenta como tiempo de mesa, por eso no aparece aquí.
                $stmtC = $pdo->prepare("
                    SELECT c.fecha_hora, c.descripcion, c.monto, IF(v.id_sesion IS NULL, 'Barra', 'Mesa') AS modo
                    FROM cargos_venta c JOIN ventas v ON v.id_venta = c.id_venta
                    WHERE v.id_jornada = ? AND c.tipo <> 'hora_gratis'
                    ORDER BY c.fecha_hora
                ");
                $stmtC->execute([$id]);
                $data["cargos"] = [
                    "filas" => $stmtC->fetchAll(PDO::FETCH_ASSOC),
                    "resumen" => [
                        "efectivo" => number_format($ingresosJornada['cargos']['efectivo'], 2, '.', ''),
                        "qr" => number_format($ingresosJornada['cargos']['qr'], 2, '.', '')
                    ]
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

            // SECCIÓN: GASTO DE PRODUCTOS (no vendibles, gastados al preparar en barra)
            if ($data["filtros"]["gastos_productos"]) {
                $stmtGp = $pdo->prepare("SELECT g.fecha_hora AS fecha, p.nombre_producto AS producto, g.cantidad,
                                                COALESCE(CONCAT(u.nombres, ' ', u.apellidos), CONCAT('Usuario #', g.id_usuario)) AS usuario
                                         FROM gastos_productos g
                                         JOIN productos p ON p.id_producto = g.id_producto
                                         LEFT JOIN usuarios u ON u.id_usuario = g.id_usuario
                                         WHERE g.id_jornada = ? ORDER BY g.fecha_hora");
                $stmtGp->execute([$id]);
                $data["gastos_productos"] = $stmtGp->fetchAll(PDO::FETCH_ASSOC);
            }

            echo json_encode(["status" => "success", "data" => $data]);
            exit;
        } elseif ($tipo === 'ingresos_semana') {
            // Semana de lunes a domingo que contiene ?fecha=AAAA-MM-DD
            $dia = fechaValida($_GET['fecha'] ?? '', 'Y-m-d');
            if (!$dia) throw new Exception("Elija un día de la semana (fecha inválida).");
            $desde = (clone $dia)->modify('-' . (intval($dia->format('N')) - 1) . ' days');
            $hasta = (clone $desde)->modify('+6 days');
            echo json_encode(["status" => "success", "data" => reportePeriodo($pdo, $desde, $hasta, ['tipo' => 'semana'])]);
            exit;

        } elseif ($tipo === 'ingresos_mes') {
            // Mes completo: ?mes=AAAA-MM
            $desde = fechaValida(($_GET['mes'] ?? '') . '-01', 'Y-m-d');
            if (!$desde) throw new Exception("Elija un mes (formato inválido).");
            $hasta = (clone $desde)->modify('last day of this month');
            echo json_encode(["status" => "success", "data" => reportePeriodo($pdo, $desde, $hasta, ['tipo' => 'mes'])]);
            exit;

        } else {
            throw new Exception("El tipo de reporte seleccionado no es válido.");
        }
    }

} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>