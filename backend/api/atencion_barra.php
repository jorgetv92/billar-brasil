<?php
// api/atencion_barra.php
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");

// Inclusión de la clase de base de datos según tu entorno unificado
include_once '../config/database.php'; 

try {
    $database = new Database();
    $pdo = $database->getConnection();
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => "Error de configuración de BD: " . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
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
// =========================================================================================
// MOTOR DE EVALUACIÓN DE PROMOCIONES VIGENTES
// =========================================================================================
function obtenerPromocionesActivas($pdo, $fechaHora = null) {
    if (!$fechaHora) {
        $fechaHora = date('Y-m-d H:i:s');
    }
    $ts = strtotime($fechaHora);
    $fechaActual = date('Y-m-d', $ts);
    $horaActual = date('H:i:s', $ts);
    $diasEsp = [
        1 => 'Lunes',
        2 => 'Martes',
        3 => 'Miércoles',
        4 => 'Jueves',
        5 => 'Viernes',
        6 => 'Sábado',
        7 => 'Domingo'
    ];
    $numDia = intval(date('N', $ts));
    $diaActual = isset($diasEsp[$numDia]) ? $diasEsp[$numDia] : '';
    try {
        $query = "SELECT * FROM promociones";
        $stmt = $pdo->prepare($query);
        $stmt->execute();
        $promos = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $activas = [];
        foreach ($promos as $p) {
            if (!empty($p['fecha_inicio']) && $fechaActual < $p['fecha_inicio']) {
                continue;
            }
            if (!empty($p['fecha_fin']) && $fechaActual > $p['fecha_fin']) {
                continue;
            }
            if (!empty($p['hora_inicio']) && $horaActual < $p['hora_inicio']) {
                continue;
            }
            if (!empty($p['hora_fin']) && $horaActual > $p['hora_fin']) {
                continue;
            }
            if (!empty($p['dias_semana'])) {
                $diasArr = array_map('trim', explode(',', strtolower($p['dias_semana'])));
                $diaActualClean = strtolower($diaActual);
                $diasArrNorm = array_map(function($d) {
                    return str_replace(['é', 'á', 'í', 'ó', 'ú'], ['e', 'a', 'i', 'o', 'u'], $d);
                }, $diasArr);
                $diaActualNorm = str_replace(['é', 'á', 'í', 'ó', 'ú'], ['e', 'a', 'i', 'o', 'u'], $diaActualClean);
                if (!in_array($diaActualNorm, $diasArrNorm)) {
                    continue;
                }
            }
            $activas[] = $p;
        }
        // Solo retorna el array; quien necesite hacer echo lo hace en su propio contexto
        return $activas;
    } catch (PDOException $e) {
        return [];
    }
}
function calcularPromocionesSesion($pdo, $id_sesion = null, $productosArray = null) {
    $promosActivas = obtenerPromocionesActivas($pdo);
    $descuentoTotal = 0.00;
    $detallesDescuento = [];
    $detallesProd = [];
    if ($id_sesion) {
        $stmt = $pdo->prepare("SELECT dvp.id_producto, p.nombre_producto, dvp.cantidad, dvp.precio_unitario_aplicado AS precio 
                               FROM detalle_venta_productos dvp 
                               JOIN productos p ON dvp.id_producto = p.id_producto 
                               WHERE dvp.id_sesion = ? AND dvp.id_venta IS NULL");
        $stmt->execute([$id_sesion]);
        $detallesProd = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } elseif (!empty($productosArray)) {
        foreach ($productosArray as $p) {
            $idP = intval($p['id_producto']);
            $cant = intval($p['cantidad']);
            $prec = floatval(isset($p['precio_unitario']) ? $p['precio_unitario'] : (isset($p['precio']) ? $p['precio'] : 0));
            $nombre = isset($p['nombre']) ? $p['nombre'] : ('Producto #' . $idP);
            $detallesProd[] = [
                'id_producto' => $idP,
                'nombre_producto' => $nombre,
                'cantidad' => $cant,
                'precio' => $prec
            ];
        }
    }
    // 1. EVALUAR COMBO 2X1
    $comboPromos = array_filter($promosActivas, function($p) { return $p['tipo_promo'] === 'combo_2x1'; });
    foreach ($comboPromos as $cp) {
        $idProdCond = intval($cp['id_item_condicion']);
        foreach ($detallesProd as $dp) {
            if (intval($dp['id_producto']) === $idProdCond && intval($dp['cantidad']) >= 2) {
                $unidadesGratis = floor(intval($dp['cantidad']) / 2);
                $montoDesc = $unidadesGratis * floatval($dp['precio']);
                $descuentoTotal += $montoDesc;
                $detallesDescuento[] = [
                    'tipo' => 'combo_2x1',
                    'nombre' => $cp['nombre_promo'],
                    'producto' => $dp['nombre_producto'],
                    'monto' => $montoDesc
                ];
            }
        }
    }
    // 2. EVALUAR INCENTIVO CRUZADO (MESA + BARRA)
    if ($id_sesion) {
        $stmtSeg = $pdo->prepare("SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, fecha_hora_inicio, COALESCE(fecha_hora_fin, NOW()))), 0) FROM tramos_mesas WHERE id_sesion = ?");
        $stmtSeg->execute([$id_sesion]);
        $segundosTotales = floatval($stmtSeg->fetchColumn());
        $horasJuego = $segundosTotales / 3600;
        $cruzPromos = array_filter($promosActivas, function($p) { return $p['tipo_promo'] === 'incentivo_cruzado'; });
        foreach ($cruzPromos as $xp) {
            $horasMinimas = floatval($xp['cantidad_condicion']);
            if ($horasJuego >= $horasMinimas) {
                $idProdBenef = intval($xp['id_item_condicion']);
                $precioEspecial = floatval($xp['valor_descuento']);
                foreach ($detallesProd as $dp) {
                    if (intval($dp['id_producto']) === $idProdBenef) {
                        $precNormal = floatval($dp['precio']);
                        if ($precNormal > $precioEspecial) {
                            $montoDesc = ($precNormal - $precioEspecial) * intval($dp['cantidad']);
                            $descuentoTotal += $montoDesc;
                            $detallesDescuento[] = [
                                'tipo' => 'incentivo_cruzado',
                                'nombre' => $xp['nombre_promo'],
                                'producto' => $dp['nombre_producto'],
                                'monto' => $montoDesc
                            ];
                        }
                    }
                }
            }
        }

        // 3. EVALUAR INCENTIVO EN MESA
        $incMesaPromos = array_filter($promosActivas, function($p) { return $p['tipo_promo'] === 'incentivo_mesa'; });
        foreach ($incMesaPromos as $imp) {
            $horasMinimas = floatval($imp['cantidad_condicion']);
            if ($horasJuego >= $horasMinimas) {
                // Obtener el tipo de mesa de esta sesión
                $stmtMesa = $pdo->prepare("
                    SELECT m.id_tipo_mesa, tm.nombre_tipo
                    FROM tramos_mesas tm_tbl
                    JOIN mesas m ON tm_tbl.id_mesa = m.id_mesa
                    JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa
                    WHERE tm_tbl.id_sesion = ? LIMIT 1
                ");
                $stmtMesa->execute([$id_sesion]);
                $mesaInfo = $stmtMesa->fetch(PDO::FETCH_ASSOC);

                if ($mesaInfo && intval($mesaInfo['id_tipo_mesa']) === intval($imp['id_item_condicion'])) {
                    // Costo total cargado hasta el momento en todos los tramos
                    $stmtImporte = $pdo->prepare("SELECT COALESCE(SUM(importe_tramo), 0) FROM tramos_mesas WHERE id_sesion = ?");
                    $stmtImporte->execute([$id_sesion]);
                    $importeTotalActual = floatval($stmtImporte->fetchColumn());

                    // Calcular el importe en caso de cerrar AHORA (último tramo)
                    // Este cálculo aproxima lo que faltaría sumar si el tramo no ha sido cerrado aún
                    // Aunque en cobrar_mesa, se llama después de calcular importeTiempoFinal
                    // Para ser exactos, tomamos el subtotalMesas que se está construyendo,
                    // Pero `calcularPromocionesSesion` no recibe `subtotalMesas`.
                    // Vamos a basar el descuento en el costo especial total
                    $precioEspecialHora = floatval($imp['valor_descuento']);
                    $costoEspecialTotal = $precioEspecialHora * $horasJuego;
                    
                    // Nota: dado que el frontend lo calcula con el total proyectado actual, y aquí el backend lo usará durante el cierre,
                    // $importeTotalActual tendrá el valor casi exacto del importe anterior, o el total definitivo si el tramo ya cerró (lo cual ocurre antes en cobrar_mesa).
                    // En cobrar_mesa, se cierra el tramo primero: UPDATE tramos_mesas SET fecha_hora_fin = ?, importe_tramo = ? WHERE id_tramo = ?
                    // Y LUEGO calcula el descuento?
                    // Revisando el código: en `cobrar_mesa` el tramo NO ESTÁ CERRADO en la BD cuando llama a calcularPromocionesSesion!
                    // Llama a calcularPromocionesSesion ANTES de insertar en ventas.
                    // Efectivamente, el tramo se cierra al final. Por lo que calcularPromocionesSesion debe simular el importe actual o recibir el $subtotalMesas.
                    // Como el esquema no nos permite pasarlo fácilmente sin romper compatibilidad, asumimos que el descuento es:
                    
                    // Vamos a calcular el importe real proyectado del tramo activo
                    $stmtTramo = $pdo->prepare("
                        SELECT fecha_hora_inicio, tarifa_hora_aplicada 
                        FROM tramos_mesas 
                        WHERE id_sesion = ? AND fecha_hora_fin IS NULL 
                        ORDER BY id_tramo DESC LIMIT 1
                    ");
                    $stmtTramo->execute([$id_sesion]);
                    $tramoActivo = $stmtTramo->fetch(PDO::FETCH_ASSOC);
                    
                    if ($tramoActivo) {
                        $minutosTramo = (time() - strtotime($tramoActivo['fecha_hora_inicio'])) / 60;
                        $bloques = ceil($minutosTramo / 5);
                        $importeActivo = round(($bloques * 5 / 60) * floatval($tramoActivo['tarifa_hora_aplicada']), 2);
                        $importeTotalActual += $importeActivo;
                    }

                    if ($importeTotalActual > $costoEspecialTotal) {
                        $montoDesc = $importeTotalActual - $costoEspecialTotal;
                        $descuentoTotal += $montoDesc;
                        $detallesDescuento[] = [
                            'tipo' => 'incentivo_mesa',
                            'nombre' => $imp['nombre_promo'],
                            'producto' => 'Descuento en Mesa',
                            'monto' => $montoDesc
                        ];
                    }
                }
            }
        }
    }
    return [
        'descuento_total' => round($descuentoTotal, 2),
        'detalles' => $detallesDescuento
    ];
}
// =========================================================================================
// MÉTODOS DE LECTURA (GET)
// =========================================================================================
if ($method === 'GET') {
    $accion = isset($_GET['accion']) ? $_GET['accion'] : '';

    // 1. OBTENER DATOS INICIALES (Mesa Grid)
    if ($accion === 'get_datos_iniciales') {
        try {
            // Obtener promociones activas ANTES del loop de mesas
            $promosActivas = obtenerPromocionesActivas($pdo);

            $query = "
                SELECT 
                    tm.id_tipo_mesa, tm.nombre_tipo AS tipo_mesa, tm.precio_hora,
                    m.id_mesa, m.numero_mesa, m.estado_actual,
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
                    (SELECT COALESCE(SUM(dvp.cantidad * dvp.precio_unitario_aplicado), 0)
                     FROM detalle_venta_productos dvp
                     JOIN sesiones_juego s ON dvp.id_sesion = s.id_sesion
                     WHERE s.estado = 'activa' AND dvp.id_venta IS NULL AND s.id_sesion = (
                        SELECT t3.id_sesion FROM tramos_mesas t3 
                        WHERE t3.id_mesa = m.id_mesa AND t3.fecha_hora_fin IS NULL 
                        ORDER BY t3.id_tramo DESC LIMIT 1
                     )
                    ) AS total_consumo,
                    (SELECT COALESCE(SUM(t_all.importe_tramo), 0.00)
                     FROM tramos_mesas t_all
                     WHERE t_all.id_sesion = (
                        SELECT t4.id_sesion FROM tramos_mesas t4 
                        WHERE t4.id_mesa = m.id_mesa AND t4.fecha_hora_fin IS NULL 
                        ORDER BY t4.id_tramo DESC LIMIT 1
                     )
                    ) AS importe_acumulado_tiempo,
                    
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
                    $data[$id_tipo]['mesas'][] = [
                        'id_mesa' => $row['id_mesa'],
                        'numero_mesa' => $row['numero_mesa'],
                        'estado_actual' => $row['estado_actual'],
                        'fecha_hora_inicio' => $row['fecha_hora_inicio'], 
                        'hora_inicio' => $row['fecha_hora_inicio'],       
                        'hora_pausa' => $row['fecha_hora_pausa'],         
                        'total_consumo' => $row['total_consumo'],
                        'importe_acumulado_tiempo' => $row['importe_acumulado_tiempo'],
                        'segundos_acumulados' => $row['segundos_acumulados'],
                        'primera_hora_gratis' => intval($row['primera_hora_gratis'] ?? 0)
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

    // NUEVO: OBTENER HISTORIAL DE TRAMOS DE LA MESA ACTIVA
    if ($accion === 'get_historial_tramos') {
        $id_mesa = isset($_GET['id_mesa']) ? $_GET['id_mesa'] : 0;
        try {
            // Buscamos la sesión activa en esa mesa, y traemos todos sus tramos (incluso de transferencias)
            $query = "
                SELECT t.id_tramo, m.numero_mesa, t.fecha_hora_inicio, t.fecha_hora_fin, t.fecha_hora_pausa, t.importe_tramo, t.tarifa_hora_aplicada
                FROM tramos_mesas t
                JOIN mesas m ON t.id_mesa = m.id_mesa
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                WHERE s.estado = 'activa' 
                  AND t.id_sesion = (
                      SELECT t2.id_sesion 
                      FROM tramos_mesas t2 
                      WHERE t2.id_mesa = ? 
                      ORDER BY t2.id_tramo DESC LIMIT 1
                  )
                ORDER BY t.id_tramo ASC
            ";
            $stmt = $pdo->prepare($query);
            $stmt->execute([$id_mesa]);
            
            $tramos = [];
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $tramos[] = $row;
            }
            
            echo json_encode(['status' => 'success', 'data' => $tramos]);
            exit;
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Fallo al obtener tramos: " . $e->getMessage()]);
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
                $precioEfectivo = $precioOriginal;
                $tienePromoDesc = false;
                $es2x1 = false;
                $nombrePromo = '';
                foreach ($promosActivas as $p) {
                    if ($p['tipo_promo'] === 'descuento_producto' && intval($p['id_item_condicion']) === $idProd) {
                        if (!is_null($p['valor_descuento'])) {
                            $precioEfectivo = floatval($p['valor_descuento']);
                            $tienePromoDesc = true;
                            $nombrePromo = $p['nombre_promo'];
                        }
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

        // REUTILIZABLE: Obtener Jornada Abierta Obligatoria para persistencia transaccional
        $stmtJornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
        $jornada = $stmtJornada->fetch(PDO::FETCH_ASSOC);
        $id_jornada = $jornada ? $jornada['id_jornada'] : null;

        // ACCIÓN A: OCUPAR MESA
        if ($accion === 'ocupar_mesa') {
            $id_mesa = $data['id_mesa'];
            
            if (!$id_jornada) {
                echo json_encode(['status' => 'error', 'message' => 'No hay una jornada abierta actual en el sistema.']);
                $pdo->rollBack();
                exit;
            }

            // 2. Obtener tarifa por hora de la mesa
            $stmtTarifa = $pdo->prepare("SELECT m.id_tipo_mesa, tm.precio_hora FROM mesas m INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa WHERE m.id_mesa = ?");
            $stmtTarifa->execute([$id_mesa]);
            $resMesa = $stmtTarifa->fetch(PDO::FETCH_ASSOC);

            if (!$resMesa) {
                echo json_encode(['status' => 'error', 'message' => 'Mesa no encontrada.']);
                $pdo->rollBack();
                exit;
            }
            $tarifa = floatval($resMesa['precio_hora']);
            $id_tipo = intval($resMesa['id_tipo_mesa']);
            // Verificar si existe promoción activa tarifa_mesa
            $promosActivas = obtenerPromocionesActivas($pdo);
            foreach ($promosActivas as $p) {
                if ($p['tipo_promo'] === 'tarifa_mesa' && intval($p['id_item_condicion']) === $id_tipo) {
                    if (!is_null($p['valor_descuento'])) {
                        $tarifa = floatval($p['valor_descuento']);
                        break;
                    }
                }
            }
            // 3. Crear sesión de juego y tramo (con importe_tramo inicializado en 0)
            $primera_hora_gratis = (isset($data['primera_hora_gratis']) && $data['primera_hora_gratis']) ? 1 : 0;
            $stmtSesion = $pdo->prepare("INSERT INTO sesiones_juego (id_jornada, estado, primera_hora_gratis) VALUES (?, 'activa', ?)");
            $stmtSesion->execute([$id_jornada, $primera_hora_gratis]);
            $id_sesion = $pdo->lastInsertId();

            $stmtTramo = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, NOW(), ?, 0.00)");
            $stmtTramo->execute([$id_sesion, $id_mesa, $tarifa]);
            
            // 4. Actualizar estado de la mesa
            $stmt = $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?");
            $stmt->execute([$id_mesa]);

            echo json_encode(['status' => 'success', 'message' => 'Mesa habilitada correctamente']);
        } 
        
        // ACCIÓN B: REGISTRAR VENTA EN BARRA DIRECTA (Sin Mesa)
        elseif ($accion === 'registrar_venta_barra') {
            $total = floatval($data['total']);
            $productos = $data['productos'];
            $metodo_pago = isset($data['metodo_pago']) ? strtolower(trim($data['metodo_pago'])) : 'efectivo';

            if (!$id_jornada) {
                echo json_encode(['status' => 'error', 'message' => 'No se puede vender en barra sin una jornada de caja abierta.']);
                $pdo->rollBack();
                exit;
            }
             $resPromo = calcularPromocionesSesion($pdo, null, $productos);
            $descuentos = $resPromo['descuento_total'];
            $subtotalProductos = 0.00;
            foreach ($productos as $prod) {
                $subtotalProductos += floatval($prod['cantidad']) * floatval($prod['precio_unitario']);
            }
            $totalPagar = max(0, $subtotalProductos - $descuentos);
            $stmtVenta = $pdo->prepare("
                INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, descuentos, total_pagar, fecha_hora_venta) 
                VALUES (?, NULL, 0.00, ?, ?, ?, NOW())
            ");
            $stmtVenta->execute([$id_jornada, $subtotalProductos, $descuentos, $totalPagar]);
            $id_venta = $pdo->lastInsertId();

            $stmtPago = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
            $stmtPago->execute([$id_venta, $metodo_pago, $totalPagar]);

            $stmtDetalle = $pdo->prepare("INSERT INTO detalle_venta_productos (id_venta, id_sesion, id_producto, cantidad, precio_unitario_aplicado) VALUES (?, NULL, ?, ?, ?)");
            $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");

            foreach ($productos as $prod) {
                $stmtDetalle->execute([$id_venta, $prod['id_producto'], $prod['cantidad'], $prod['precio_unitario']]);
                $stmtStock->execute([$prod['cantidad'], $prod['id_producto']]);
            }

            // Si se aplicó la promoción incentivo_producto desde barra, ocupar la mesa con primera hora gratis
            if (!empty($data['id_mesa_ocupar_promo'])) {
                $id_mesa_promo = intval($data['id_mesa_ocupar_promo']);
                $stmtTarifaP = $pdo->prepare("SELECT tm.precio_hora FROM mesas m INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa WHERE m.id_mesa = ?");
                $stmtTarifaP->execute([$id_mesa_promo]);
                $tarifaMesa = floatval($stmtTarifaP->fetchColumn() ?: 0);

                $stmtSesionP = $pdo->prepare("INSERT INTO sesiones_juego (id_jornada, estado, primera_hora_gratis) VALUES (?, 'activa', 1)");
                $stmtSesionP->execute([$id_jornada]);
                $id_sesion_p = $pdo->lastInsertId();

                $stmtTramoP = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, NOW(), ?, 0.00)");
                $stmtTramoP->execute([$id_sesion_p, $id_mesa_promo, $tarifaMesa]);

                $stmtMesaP = $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?");
                $stmtMesaP->execute([$id_mesa_promo]);
            }

            echo json_encode(['status' => 'success', 'message' => 'Venta en barra registrada']);
        }

        // ACCIÓN B2: AGREGAR PRODUCTOS A UNA MESA OCUPADA
        elseif ($accion === 'agregar_productos_mesa') {
            $id_mesa = $data['id_mesa'];
            $productos = $data['productos'];

            $stmtSesion = $pdo->prepare("
                SELECT t.id_sesion 
                FROM tramos_mesas t 
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion 
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL 
                ORDER BY t.id_tramo DESC LIMIT 1
            ");
            $stmtSesion->execute([$id_mesa]);
            $sesion = $stmtSesion->fetch(PDO::FETCH_ASSOC);

            if (!$sesion) {
                echo json_encode(['status' => 'error', 'message' => 'La mesa no tiene una sesión activa.']);
                $pdo->rollBack();
                exit;
            }
            $id_sesion = $sesion['id_sesion'];
            $promosActivas = obtenerPromocionesActivas($pdo);

            // Si se activa la promoción incentivo en producto para esta mesa
            if (!empty($data['aplicar_primera_hora_gratis'])) {
                $stmtUpdSes = $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 1 WHERE id_sesion = ?");
                $stmtUpdSes->execute([$id_sesion]);
            }

            $stmtDetalle = $pdo->prepare("INSERT INTO detalle_venta_productos (id_sesion, id_venta, id_producto, cantidad, precio_unitario_aplicado) VALUES (?, NULL, ?, ?, ?)");
            $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");

            foreach ($productos as $prod) {
                $idProd = intval($prod['id_producto']);
                $cant = intval($prod['cantidad']);
                $prec = floatval($prod['precio_unitario']);
                foreach ($promosActivas as $p) {
                    if ($p['tipo_promo'] === 'descuento_producto' && intval($p['id_item_condicion']) === $idProd) {
                        if (!is_null($p['valor_descuento'])) {
                            $prec = floatval($p['valor_descuento']);
                            break;
                        }
                    }
                }
                $stmtDetalle->execute([$id_sesion, $idProd, $cant, $prec]);
                $stmtStock->execute([$cant, $idProd]);
            }

            echo json_encode(['status' => 'success', 'message' => 'Productos agregados a la mesa']);
        }

        // ACCIÓN B3: ELIMINAR UN PRODUCTO DE LA MESA (Restaura Inventario)
        elseif ($accion === 'eliminar_producto_mesa') {
            $id_detalle_prod = $data['id_detalle_prod'];

            $stmtCheck = $pdo->prepare("SELECT id_producto, cantidad FROM detalle_venta_productos WHERE id_detalle_prod = ? AND id_venta IS NULL");
            $stmtCheck->execute([$id_detalle_prod]);
            $detalle = $stmtCheck->fetch(PDO::FETCH_ASSOC);

            if ($detalle) {
                $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
                $stmtStock->execute([$detalle['cantidad'], $detalle['id_producto']]);

                // Si se elimina el item hora con descuento de la mesa, revertir primera_hora_gratis a 0
                $idPromoProd = obtenerIdProductoPromoIncentivo($pdo);
                if ($idPromoProd && intval($detalle['id_producto']) === $idPromoProd) {
                    $stmtSesDet = $pdo->prepare("SELECT id_sesion FROM detalle_venta_productos WHERE id_detalle_prod = ?");
                    $stmtSesDet->execute([$id_detalle_prod]);
                    $id_ses_det = $stmtSesDet->fetchColumn();
                    if ($id_ses_det) {
                        $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$id_ses_det]);
                    }
                }

                $stmtDel = $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_detalle_prod = ?");
                $stmtDel->execute([$id_detalle_prod]);

                echo json_encode(['status' => 'success', 'message' => 'Producto eliminado y stock restaurado']);
            } else {
                echo json_encode(['status' => 'error', 'message' => 'No se encontró el producto o ya fue cobrado']);
            }
        }

        // ACCIÓN B4: LIMPIAR TODO EL CONSUMO DE LA MESA (Restaura Inventario)
        elseif ($accion === 'limpiar_consumo_mesa') {
            $id_mesa = $data['id_mesa'];

            $stmtSesion = $pdo->prepare("
                SELECT t.id_sesion 
                FROM tramos_mesas t 
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion 
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL 
                ORDER BY t.id_tramo DESC LIMIT 1
            ");
            $stmtSesion->execute([$id_mesa]);
            $sesion = $stmtSesion->fetch(PDO::FETCH_ASSOC);

            if ($sesion) {
                $id_sesion = $sesion['id_sesion'];
                $pdo->prepare("UPDATE sesiones_juego SET primera_hora_gratis = 0 WHERE id_sesion = ?")->execute([$id_sesion]);
                
                $stmtCheck = $pdo->prepare("SELECT id_producto, cantidad FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL");
                $stmtCheck->execute([$id_sesion]);
                $detalles = $stmtCheck->fetchAll(PDO::FETCH_ASSOC);

                $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
                foreach ($detalles as $det) {
                    $stmtStock->execute([$det['cantidad'], $det['id_producto']]);
                }

                $stmtDel = $pdo->prepare("DELETE FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL");
                $stmtDel->execute([$id_sesion]);
                
                echo json_encode(['status' => 'success', 'message' => 'Consumo limpiado y stock restaurado completamente']);
            } else {
                echo json_encode(['status' => 'error', 'message' => 'No hay sesión activa para limpiar']);
            }
        }

        // ACCIÓN C: COBRAR MESA (TIEMPO CALCULADO + PRODUCTOS + CARRITO EN SALIDA)
        elseif ($accion === 'cobrar_mesa') {
            $id_mesa = $data['id_mesa'];
            $total_recibido_fe = floatval($data['total']); // Guardamos por auditoría lo que envió el Front
            $pagos = $data['pagos']; 
            $productos_carrito = isset($data['productos']) ? $data['productos'] : [];

            if (!$id_jornada) {
                echo json_encode(['status' => 'error', 'message' => 'Fallo operativo: No se puede liquidar cuentas sin una jornada abierta.']);
                $pdo->rollBack();
                exit;
            }

            // 1. Obtener la sesión activa y el tramo actualmente abierto de la mesa
            $stmtTramo = $pdo->prepare("
                SELECT t.id_tramo, t.id_sesion, t.fecha_hora_inicio, t.tarifa_hora_aplicada 
                FROM tramos_mesas t 
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion 
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL 
                ORDER BY t.id_tramo DESC LIMIT 1
            ");
            $stmtTramo->execute([$id_mesa]);
            $tramoActivo = $stmtTramo->fetch(PDO::FETCH_ASSOC);

            if (!$tramoActivo) {
                echo json_encode(['status' => 'error', 'message' => 'No se encontró una sesión de juego activa para esta mesa.']);
                $pdo->rollBack();
                exit;
            }
            
            $id_tramo_actual = $tramoActivo['id_tramo'];
            $id_sesion = $tramoActivo['id_sesion'];
            $fechaInicioTramo = $tramoActivo['fecha_hora_inicio'];
            $tarifaHora = floatval($tramoActivo['tarifa_hora_aplicada']);
            $ahora = date('Y-m-d H:i:s');

            // 2. CALCULAR EL COSTO DEL ÚLTIMO TRAMO ABIERTO (Aplicando redondeo de 5 min)
            $segundos = strtotime($ahora) - strtotime($fechaInicioTramo);
            $minutos = $segundos / 60;
            $importeUltimoTramo = 0.00;

            if ($tarifaHora > 0 && $minutos > 0) {
                $bloquesDe5 = ceil($minutos / 5);
                $minutosFacturar = $bloquesDe5 * 5;
                $importeUltimoTramo = round(($minutosFacturar / 60) * $tarifaHora, 2);
            }

            // 3. Cerrar el último tramo inyectando físicamente su importe monetario calculado
            $stmtCerrarTramo = $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ?, importe_tramo = ? WHERE id_tramo = ?");
            $stmtCerrarTramo->execute([$ahora, $importeUltimoTramo, $id_tramo_actual]);

            // 4. Asegurar el cierre de cualquier tramo huérfano (seguridad del motor)
            $stmtLimpieza = $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ? WHERE id_sesion = ? AND fecha_hora_fin IS NULL");
            $stmtLimpieza->execute([$ahora, $id_sesion]);

            // 5. CALCULAR LOS SUBTOTALES MAESTROS DESDE LA BASE DE DATOS (MÁXIMA FIABILIDAD)
            // Subtotal Mesas = Suma de TODOS los tramos de la sesión (Pasados + El que acabamos de cerrar)
            $stmtSumMesas = $pdo->prepare("SELECT COALESCE(SUM(importe_tramo), 0) FROM tramos_mesas WHERE id_sesion = ?");
            $stmtSumMesas->execute([$id_sesion]);
            $subtotalMesas = floatval($stmtSumMesas->fetchColumn());

            // Verificar si la sesión tiene primera hora gratis
            $stmtGratis = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
            $stmtGratis->execute([$id_sesion]);
            $primeraHoraGratis = intval($stmtGratis->fetchColumn());

            if ($primeraHoraGratis === 1 && $tarifaHora > 0) {
                $subtotalMesas = max(0.00, $subtotalMesas - $tarifaHora);
            }

            // Subtotal Productos Pregrabados en la mesa
            $stmtSumProds = $pdo->prepare("SELECT COALESCE(SUM(cantidad * precio_unitario_aplicado), 0) FROM detalle_venta_productos WHERE id_sesion = ? AND id_venta IS NULL");
            $stmtSumProds->execute([$id_sesion]);
            $subtotalProductosAcumulados = floatval($stmtSumProds->fetchColumn());

            // 6. Inyectar productos que venían en el Carrito en caliente en el momento del Cobro
            if (!empty($productos_carrito)) {
                $stmtDetalleNew = $pdo->prepare("INSERT INTO detalle_venta_productos (id_sesion, id_venta, id_producto, cantidad, precio_unitario_aplicado) VALUES (?, NULL, ?, ?, ?)");
                $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");
                foreach ($productos_carrito as $prod) {
                    $cant = intval($prod['cantidad']);
                    $prec = floatval($prod['precio_unitario']);
                    $stmtDetalleNew->execute([$id_sesion, $prod['id_producto'], $cant, $prec]);
                    $stmtStock->execute([$cant, $prod['id_producto']]);
                    // Sumamos al subtotal de productos
                    $subtotalProductosAcumulados += ($cant * $prec);
                }
            }

             // Calculamos promociones y el Gran Total Real del backend
            $resPromo = calcularPromocionesSesion($pdo, $id_sesion);
            $descuentos = $resPromo['descuento_total'];
            $totalRealCobrar = max(0, $subtotalMesas + $subtotalProductosAcumulados - $descuentos);

            // 7. Registrar venta maestra oficial del sistema
            $stmtVenta = $pdo->prepare("
                INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, descuentos, total_pagar, fecha_hora_venta) 
                VALUES (?, ?, ?, ?, ?, ?, NOW())
            ");
            $stmtVenta->execute([$id_jornada, $id_sesion, $subtotalMesas, $subtotalProductosAcumulados, $descuentos, $totalRealCobrar]);
            $id_venta = $pdo->lastInsertId();

            // 8. Vincular consumos previos de productos a la ID de venta generada
            $stmtVincular = $pdo->prepare("UPDATE detalle_venta_productos SET id_venta = ? WHERE id_sesion = ? AND id_venta IS NULL");
            $stmtVincular->execute([$id_venta, $id_sesion]);

            // 9. Registrar los pagos en la tabla pagos_venta
            $stmtPago = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
            foreach ($pagos as $pago) {
                if (floatval($pago['monto']) > 0) {
                    $metodoClean = strtolower(trim($pago['metodo']));
                    $stmtPago->execute([$id_venta, $metodoClean, $pago['monto']]);
                }
            }

            // 10. Cerrar estado maestro de la Sesión y liberar Mesa
            $stmtFinalizarSesion = $pdo->prepare("UPDATE sesiones_juego SET estado = 'finalizada' WHERE id_sesion = ?");
            $stmtFinalizarSesion->execute([$id_sesion]);

            $stmtLiberar = $pdo->prepare("UPDATE mesas SET estado_actual = 'libre' WHERE id_mesa = ?");
            $stmtLiberar->execute([$id_mesa]);

            echo json_encode([
                'status' => 'success', 
                'message' => 'Cobro realizado con éxito',
                'desglose' => ['tiempo' => $subtotalMesas, 'productos' => $subtotalProductosAcumulados, 'total' => $totalRealCobrar]
            ]);
        }

        // ACCIÓN D: PAUSAR TIEMPO DE MESA
        elseif ($accion === 'pausar_mesa') {
            $id_mesa = $data['id_mesa'];
            
            $queryPausar = "
                UPDATE tramos_mesas t
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                SET t.fecha_hora_pausa = NOW()
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
            ";
            $stmt = $pdo->prepare($queryPausar);
            $stmt->execute([$id_mesa]);

            echo json_encode(['status' => 'success', 'message' => 'Tiempo pausado correctamente']);
        }

        // ACCIÓN E: REANUDAR TIEMPO DE MESA
        elseif ($accion === 'reanudar_mesa') {
            $id_mesa = $data['id_mesa'];
            $tipo_pausa = isset($data['tipo_pausa']) ? $data['tipo_pausa'] : 'sistema';
            
            if ($tipo_pausa === 'sistema') {
                // Si es pausa por sistema, simplemente eliminamos la hora de pausa
                $queryReanudar = "
                    UPDATE tramos_mesas t
                    JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                    SET t.fecha_hora_pausa = NULL
                    WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                ";
                $stmt = $pdo->prepare($queryReanudar);
                $stmt->execute([$id_mesa]);
            } else {
                // Si es pausa manual, cerramos el tramo actual en el tiempo de pausa y creamos uno nuevo
                $stmtTramo = $pdo->prepare("
                    SELECT t.id_tramo, t.id_sesion, t.fecha_hora_inicio, t.fecha_hora_pausa, t.tarifa_hora_aplicada 
                    FROM tramos_mesas t 
                    JOIN sesiones_juego s ON t.id_sesion = s.id_sesion 
                    WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL 
                    ORDER BY t.id_tramo DESC LIMIT 1
                ");
                $stmtTramo->execute([$id_mesa]);
                $tramoActivo = $stmtTramo->fetch(PDO::FETCH_ASSOC);

                if ($tramoActivo && $tramoActivo['fecha_hora_pausa']) {
                    $id_tramo_actual = $tramoActivo['id_tramo'];
                    $id_sesion = $tramoActivo['id_sesion'];
                    $fechaInicioTramo = $tramoActivo['fecha_hora_inicio'];
                    $fechaPausa = $tramoActivo['fecha_hora_pausa'];
                    $tarifaHora = floatval($tramoActivo['tarifa_hora_aplicada']);
                    
                    // Calcular costo hasta la pausa
                    $segundos = strtotime($fechaPausa) - strtotime($fechaInicioTramo);
                    $minutos = $segundos / 60;
                    $importeUltimoTramo = 0.00;

                    if ($tarifaHora > 0 && $minutos > 0) {
                        $bloquesDe5 = ceil($minutos / 5);
                        $minutosFacturar = $bloquesDe5 * 5;
                        $importeUltimoTramo = round(($minutosFacturar / 60) * $tarifaHora, 2);
                    }

                    // Cerrar el tramo actual en la fecha de pausa
                    $stmtCerrarTramo = $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ?, importe_tramo = ? WHERE id_tramo = ?");
                    $stmtCerrarTramo->execute([$fechaPausa, $importeUltimoTramo, $id_tramo_actual]);

                    // Crear el nuevo tramo iniciando AHORA
                    $stmtNuevoTramo = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, NOW(), ?, 0.00)");
                    $stmtNuevoTramo->execute([$id_sesion, $id_mesa, $tarifaHora]);
                }
            }

            echo json_encode(['status' => 'success', 'message' => 'Tiempo reanudado correctamente']);
        }

        // ACCIÓN F: TRANSFERENCIA DE MESA (Traspaso de Sesión Activa) -> TOTALMENTE ADAPTADA AL NUEVO CAMPO
        elseif ($accion === 'transferir_mesa') {
            $id_mesa_origen = $data['id_mesa_origen'];
            $id_mesa_destino = $data['id_mesa_destino'];

            // 1. Validar que la mesa de destino esté libre
            $stmtCheck = $pdo->prepare("SELECT estado_actual FROM mesas WHERE id_mesa = ?");
            $stmtCheck->execute([$id_mesa_destino]);
            $estadoDestino = $stmtCheck->fetchColumn();

            if ($estadoDestino !== 'libre') {
                echo json_encode(['status' => 'error', 'message' => 'La mesa de destino no se encuentra disponible.']);
                $pdo->rollBack();
                exit;
            }

            // 2. Obtener la sesión y tramo activo de la mesa de origen
            $stmtTramo = $pdo->prepare("
                SELECT t.id_tramo, t.id_sesion, t.fecha_hora_inicio, t.tarifa_hora_aplicada 
                FROM tramos_mesas t
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                ORDER BY t.id_tramo DESC LIMIT 1
            ");
            $stmtTramo->execute([$id_mesa_origen]);
            $tramoOrigen = $stmtTramo->fetch(PDO::FETCH_ASSOC);

            if (!$tramoOrigen) {
                echo json_encode(['status' => 'error', 'message' => 'No se encontró una sesión activa en la mesa de origen.']);
                $pdo->rollBack();
                exit;
            }

            $id_tramo_origen = $tramoOrigen['id_tramo'];
            $id_sesion = $tramoOrigen['id_sesion'];
            $fechaInicioOriginal = $tramoOrigen['fecha_hora_inicio'];
            $tarifaOrigen = floatval($tramoOrigen['tarifa_hora_aplicada']);
            $ahora = date('Y-m-d H:i:s');

            // 3. Obtener la tarifa por hora de la nueva mesa destino
            $stmtTarifa = $pdo->prepare("
                SELECT tm.precio_hora 
                FROM mesas m 
                JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa 
                WHERE m.id_mesa = ?
            ");
            $stmtTarifa->execute([$id_mesa_destino]);
            $tarifaDestino = $stmtTarifa->fetchColumn();

            // 3.5 Calcular matemáticamente el dinero devengado por la mesa origen antes del traspaso
            $segundosTranscurridos = strtotime($ahora) - strtotime($fechaInicioOriginal);
            $minutosTranscurridos = $segundosTranscurridos / 60;
            $importeTiempoOrigen = 0.00;

            if ($tarifaOrigen > 0 && $minutosTranscurridos > 0) {
                $bloquesDe5 = ceil($minutosTranscurridos / 5);
                $minutosFacturar = $bloquesDe5 * 5;
                $importeTiempoOrigen = round(($minutosFacturar / 60) * $tarifaOrigen, 2);
            }

            // 4. Cerrar el tramo de la mesa de origen inyectando y congelando el dinero real
            $stmtCerrar = $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ?, importe_tramo = ? WHERE id_tramo = ?");
            $stmtCerrar->execute([$ahora, $importeTiempoOrigen, $id_tramo_origen]);

            // 5. Crear el nuevo tramo para la mesa destino bajo la misma sesión arrancando desde YA
            $stmtNuevoTramo = $pdo->prepare("
                INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) 
                VALUES (?, ?, ?, ?, 0.00)
            ");
            $stmtNuevoTramo->execute([$id_sesion, $id_mesa_destino, $ahora, $tarifaDestino]);

            // 6. Actualizar estados maestros de ambas mesas
            $stmtLibera = $pdo->prepare("UPDATE mesas SET estado_actual = 'libre' WHERE id_mesa = ?");
            $stmtLibera->execute([$id_mesa_origen]);

            $stmtOcupa = $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?");
            $stmtOcupa->execute([$id_mesa_destino]);

            echo json_encode(['status' => 'success', 'message' => 'Mesa transferida exitosamente.']);
        }
        // ACCIÓN G: COBRAR MESA (Soporta Pago Único y Pago Dividido Mixto adaptado al Esquema Real)
        elseif ($accion === 'cobrar_mesa_pago_dividido') {
            $id_mesa = $data['id_mesa'];
            $metodo_pago = isset($data['metodo_pago']) ? $data['metodo_pago'] : 'efectivo';

            // =========================================================================
            // BLINDAJE ANTI-COLISIÓN: Solo abrimos si no hay una transacción activa previa
            // =========================================================================
            if (!$pdo->inTransaction()) {
                $pdo->beginTransaction();
            }
            // =========================================================================

            // 1. Obtener el tramo activo, la sesión y el id_jornada esencial para la venta
            $stmtTramo = $pdo->prepare("
                SELECT t.id_tramo, t.id_sesion, t.fecha_hora_inicio, t.tarifa_hora_aplicada, s.id_jornada
                FROM tramos_mesas t
                JOIN sesiones_juego s ON t.id_sesion = s.id_sesion
                WHERE t.id_mesa = ? AND s.estado = 'activa' AND t.fecha_hora_fin IS NULL
                ORDER BY t.id_tramo DESC LIMIT 1
            ");
            $stmtTramo->execute([$id_mesa]);
            $tramoActivo = $stmtTramo->fetch(PDO::FETCH_ASSOC);

            if (!$tramoActivo) {
                echo json_encode(['status' => 'error', 'message' => 'No se encontró una sesión activa para esta mesa.']);
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                exit;
            }

            $id_tramo = $tramoActivo['id_tramo'];
            $id_sesion = $tramoActivo['id_sesion'];
            $id_jornada = $tramoActivo['id_jornada']; // <--- CAPTURADO PARA TABLA VENTAS
            $fechaInicio = $tramoActivo['fecha_hora_inicio'];
            $tarifaHora = floatval($tramoActivo['tarifa_hora_aplicada']);
            $ahora = date('Y-m-d H:i:s');

            // 2. Calcular el importe final del tramo actual (Redondeo por bloques de 5 minutos hacia arriba)
            $segundos = strtotime($ahora) - strtotime($fechaInicio);
            $minutos = $segundos / 60;
            $importeTiempoFinal = 0.00;

            if ($tarifaHora > 0 && $minutos > 0) {
                $bloques = ceil($minutos / 5);
                $minutosFacturar = $bloques * 5;
                $importeTiempoFinal = round(($minutosFacturar / 60) * $tarifaHora, 2);
            }

            // 3. Obtener el total acumulado de consumo de productos sin pagar
            $stmtConsumo = $pdo->prepare("
                SELECT COALESCE(SUM(cantidad * precio_unitario_aplicado), 0.00) 
                FROM detalle_venta_productos 
                WHERE id_sesion = ? AND id_venta IS NULL
            ");
            $stmtConsumo->execute([$id_sesion]);
            $totalConsumoProductos = floatval($stmtConsumo->fetchColumn());

            // 4. Obtener importes de tramos anteriores ya cerrados en esta misma sesión (si hubo transferencias)
            $stmtTramosViejos = $pdo->prepare("
                SELECT COALESCE(SUM(importe_tramo), 0.00) 
                FROM tramos_mesas 
                WHERE id_sesion = ? AND id_tramo != ?
            ");
            $stmtTramosViejos->execute([$id_sesion, $id_tramo]);
            $totalTramosAnteriores = floatval($stmtTramosViejos->fetchColumn());

            // Estructuramos los subtotales limpios requeridos por tu esquema
            $subtotalMesas = $totalTramosAnteriores + $importeTiempoFinal;

            // Verificar si la sesión tiene primera hora gratis
            $stmtGratis = $pdo->prepare("SELECT primera_hora_gratis FROM sesiones_juego WHERE id_sesion = ?");
            $stmtGratis->execute([$id_sesion]);
            $primeraHoraGratis = intval($stmtGratis->fetchColumn());

            if ($primeraHoraGratis === 1 && $tarifaHora > 0) {
                $subtotalMesas = max(0.00, $subtotalMesas - $tarifaHora);
            }

            $subtotalProductos = $totalConsumoProductos;
            $resPromo = calcularPromocionesSesion($pdo, $id_sesion);
            $descuentos = $resPromo['descuento_total'];
            $totalCalculadoBackend = max(0, $subtotalMesas + $subtotalProductos - $descuentos);

            // PROTECCIÓN DE REDONDEO: Sincronización con el Total Congelado del Frontend
            if (isset($data['total_congelado_frontend'])) {
                $totalFrontend = floatval($data['total_congelado_frontend']);
                if (abs($totalCalculadoBackend - $totalFrontend) > 0.01 && abs(($subtotalMesas + $subtotalProductos) - $totalFrontend) <= 0.01) {
                    // Si el frontend envió el total bruto, mantener totalCalculadoBackend con descuento 
                }
            }

            // 5. Determinar la distribución contable de los ingresos según el método de pago
            $efectivo_pagado = 0.00;
            $qr_pagado = 0.00;

            if ($metodo_pago === 'dividido') {
                $efectivo_pagado = floatval($data['monto_efectivo']);
                $qr_pagado = floatval($data['monto_qr']);
                
                if (abs(($efectivo_pagado + $qr_pagado) - $totalCalculadoBackend) > 0.02) {
                    echo json_encode(['status' => 'error', 'message' => 'Los montos divididos enviados no concilian con el total calculado.']);
                    if ($pdo->inTransaction()) {
                        $pdo->rollBack();
                    }
                    exit;
                }
            } elseif ($metodo_pago === 'qr') {
                $qr_pagado = $totalCalculadoBackend;
            } else {
                $efectivo_pagado = $totalCalculadoBackend;
            }

            // 6. Cerrar y congelar el último tramo de la mesa
            $stmtCerrarTramo = $pdo->prepare("UPDATE tramos_mesas SET fecha_hora_fin = ?, importe_tramo = ? WHERE id_tramo = ?");
            $stmtCerrarTramo->execute([$ahora, $importeTiempoFinal, $id_tramo]);

            // 7. Insertar el registro maestro de la Venta con las columnas EXACTAS de tu esquema
            $stmtVenta = $pdo->prepare("
                INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, descuentos, total_pagar, fecha_hora_venta) 
                VALUES (?, ?, ?, ?, ?, ?, NOW())
            ");
            $stmtVenta->execute([$id_jornada, $id_sesion, $subtotalMesas, $subtotalProductos, $descuentos, $totalCalculadoBackend]);
            $id_venta_generada = $pdo->lastInsertId();

            // =========================================================================
            // NUEVA ADICIÓN SEGURO: Registro de transacciones en la tabla pagos_venta
            // =========================================================================
            $stmtPago = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
            
            if ($metodo_pago === 'dividido') {
                if ($efectivo_pagado > 0) {
                    $stmtPago->execute([$id_venta_generada, 'efectivo', $efectivo_pagado]);
                }
                if ($qr_pagado > 0) {
                    $stmtPago->execute([$id_venta_generada, 'qr', $qr_pagado]);
                }
            } else {
                // Pagos únicos puros (efectivo o qr completo)
                $stmtPago->execute([$id_venta_generada, $metodo_pago, $totalCalculadoBackend]);
            }
            // =========================================================================

            // 8. Vincular todos los productos consumidos a esta venta
            $stmtVincularProductos = $pdo->prepare("UPDATE detalle_venta_productos SET id_venta = ? WHERE id_sesion = ? AND id_venta IS NULL");
            $stmtVincularProductos->execute([$id_venta_generada, $id_sesion]);

            // 9. Finalizar la sesión de juego de la mesa (Corregido: Sin columna obsoleta 'fecha_hora_fin')
            $stmtCerrarSesion = $pdo->prepare("UPDATE sesiones_juego SET estado = 'finalizada' WHERE id_sesion = ?");
            $stmtCerrarSesion->execute([$id_sesion]);

            // 10. Liberar el estado de la mesa física
            $stmtLiberarMesa = $pdo->prepare("UPDATE mesas SET estado_actual = 'libre' WHERE id_mesa = ?");
            $stmtLiberarMesa->execute([$id_mesa]);

            // Confirmamos de forma segura la transacción
            if ($pdo->inTransaction()) {
                $pdo->commit();
            }

            echo json_encode([
                'status' => 'success', 
                'message' => 'Mesa cobrada exitosamente.', 
                'total_cobrado' => number_format($totalCalculadoBackend, 2, '.', ''),
                'subtotal_mesas' => number_format($subtotalMesas, 2, '.', ''),
                'subtotal_productos' => number_format($subtotalProductos, 2, '.', ''),
                'descuentos' => number_format($descuentos, 2, '.', '')
            ]);
            exit;
        }
        // ACCIÓN: COBRAR VENTA PURA EN BARRA - EXCLUSIVO PAGO MIXTO/DIVIDIDO
        elseif ($accion === 'cobrar_carrito_dividido') {
            $productos = isset($data['productos']) ? $data['productos'] : [];

            if (!$pdo->inTransaction()) {
                $pdo->beginTransaction();
            }

            // 1. Validar jornada activa
            $stmtJornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
            $id_jornada = $stmtJornada->fetchColumn();

            if (!$id_jornada) {
                echo json_encode(['status' => 'error', 'message' => 'No hay una jornada abierta para cobrar.']);
                if ($pdo->inTransaction()) $pdo->rollBack();
                exit;
            }

            // 2. Calcular los subtotales del carrito y promociones
            $subtotalProductos = 0.00;
            foreach ($productos as $prod) {
                $subtotalProductos += floatval($prod['cantidad']) * floatval($prod['precio_unitario']);
            }
            $resPromo = calcularPromocionesSesion($pdo, null, $productos);
            $descuentos = $resPromo['descuento_total'];
            $totalCalculadoBackend = max(0, $subtotalProductos - $descuentos);

            // PROTECCIÓN DE REDONDEO / CONGELAMIENTO
            if (isset($data['total_congelado_frontend'])) {
                $totalFrontend = floatval($data['total_congelado_frontend']);
                if (abs($totalCalculadoBackend - $totalFrontend) > 0.01) {
                    $totalCalculadoBackend = $totalFrontend; // Fuerza sincronización
                }
            }

            // 3. Procesamiento y validación estricta de los montos divididos enviados
            $efectivo_pagado = floatval($data['monto_efectivo']);
            $qr_pagado = floatval($data['monto_qr']);
            
            // Blindaje backend: la suma de ambos montos debe coincidir con el total
            if (abs(($efectivo_pagado + $qr_pagado) - $totalCalculadoBackend) > 0.02) {
                echo json_encode(['status' => 'error', 'message' => 'Los montos mixtos enviados no cuadran con el total calculado.']);
                if ($pdo->inTransaction()) $pdo->rollBack();
                exit;
            }

            // 4. Crear la Factura/Venta Maestra
            $stmtVenta = $pdo->prepare("
                INSERT INTO ventas (id_jornada, id_sesion, subtotal_mesas, subtotal_productos, descuentos, total_pagar, fecha_hora_venta) 
                VALUES (?, NULL, 0.00, ?, ?, ?, NOW())
            ");
            $stmtVenta->execute([$id_jornada, $subtotalProductos, $descuentos, $totalCalculadoBackend]);
            $id_venta_generada = $pdo->lastInsertId();

            // 5. Registrar movimientos financieros (Dos filas en la tabla para control detallado)
            $stmtPago = $pdo->prepare("INSERT INTO pagos_venta (id_venta, metodo_pago, monto_pagado) VALUES (?, ?, ?)");
            if ($efectivo_pagado > 0) {
                $stmtPago->execute([$id_venta_generada, 'efectivo', $efectivo_pagado]);
            }
            if ($qr_pagado > 0) {
                $stmtPago->execute([$id_venta_generada, 'qr', $qr_pagado]);
            }

            // 6. Insertar detalle de productos y descontar el inventario usando "stock_actual"
            $stmtDetalle = $pdo->prepare("INSERT INTO detalle_venta_productos (id_venta, id_sesion, id_producto, cantidad, precio_unitario_aplicado) VALUES (?, NULL, ?, ?, ?)");
            $stmtRestarStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");

            foreach ($productos as $prod) {
                $stmtDetalle->execute([$id_venta_generada, $prod['id_producto'], $prod['cantidad'], $prod['precio_unitario']]);
                $stmtRestarStock->execute([$prod['cantidad'], $prod['id_producto']]);
            }

            // Si se aplicó la promoción incentivo_producto desde barra en pago mixto
            if (!empty($data['id_mesa_ocupar_promo'])) {
                $id_mesa_promo = intval($data['id_mesa_ocupar_promo']);
                $stmtTarifaP = $pdo->prepare("SELECT tm.precio_hora FROM mesas m INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa WHERE m.id_mesa = ?");
                $stmtTarifaP->execute([$id_mesa_promo]);
                $tarifaMesa = floatval($stmtTarifaP->fetchColumn() ?: 0);

                $stmtSesionP = $pdo->prepare("INSERT INTO sesiones_juego (id_jornada, estado, primera_hora_gratis) VALUES (?, 'activa', 1)");
                $stmtSesionP->execute([$id_jornada]);
                $id_sesion_p = $pdo->lastInsertId();

                $stmtTramoP = $pdo->prepare("INSERT INTO tramos_mesas (id_sesion, id_mesa, fecha_hora_inicio, tarifa_hora_aplicada, importe_tramo) VALUES (?, ?, NOW(), ?, 0.00)");
                $stmtTramoP->execute([$id_sesion_p, $id_mesa_promo, $tarifaMesa]);

                $stmtMesaP = $pdo->prepare("UPDATE mesas SET estado_actual = 'ocupada' WHERE id_mesa = ?");
                $stmtMesaP->execute([$id_mesa_promo]);
            }

            if ($pdo->inTransaction()) {
                $pdo->commit();
            }

            echo json_encode([
                'status' => 'success', 
                'message' => 'Venta mixta cobrada exitosamente.', 
                'total_cobrado' => number_format($totalCalculadoBackend, 2, '.', '')
            ]);
            exit;
        }
        else {
            throw new Exception("Acción no reconocida.");
        }

        $pdo->commit();

    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error en la operación: ' . $e->getMessage()]);
    }
    exit;
}
?>