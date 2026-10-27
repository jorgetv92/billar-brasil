<?php
// api/gastos_insumos.php
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");
header("Access-Control-Allow-Origin: *");

include_once '../config/database.php';

try {
    $database = new Database();
    $pdo = $database->getConnection();
    
    // Crear tabla gastos_insumos si no existe
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS gastos_insumos (
            id_gasto INT AUTO_INCREMENT PRIMARY KEY,
            id_jornada INT NOT NULL,
            id_insumo INT NOT NULL,
            cantidad DECIMAL(10,2) NOT NULL,
            fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
            FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => "Error de BD: " . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// ============================================================
// GET: listar gastos de jornada activa | catálogo de insumos
// ============================================================
if ($method === 'GET') {
    $accion = isset($_GET['accion']) ? $_GET['accion'] : 'listar';

    // Catálogo de insumos disponibles (para el select del modal)
    if ($accion === 'get_insumos') {
        try {
            $stmt = $pdo->query(
                "SELECT id_insumo, nombre_insumo, unidad_medida, stock_actual
                 FROM insumos
                 ORDER BY nombre_insumo ASC"
            );
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            exit;
        } catch (PDOException $e) {
            echo json_encode(["status" => "error", "message" => "Error al obtener insumos: " . $e->getMessage()]);
            exit;
        }
    }

    // Listar gastos de la jornada activa
    try {
        $stmtJ = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
        $jornada = $stmtJ->fetch(PDO::FETCH_ASSOC);

        if (!$jornada) {
            echo json_encode(["status" => "sin_jornada", "data" => [], "message" => "No hay jornada activa."]);
            exit;
        }

        $id_jornada = $jornada['id_jornada'];
        $stmt = $pdo->prepare(
            "SELECT gi.id_gasto_insumo, gi.id_insumo, i.nombre_insumo, i.unidad_medida, gi.cantidad, gi.fecha_hora
             FROM gastos_insumos gi
             JOIN insumos i ON gi.id_insumo = i.id_insumo
             WHERE gi.id_jornada = ?
             ORDER BY gi.fecha_hora DESC"
        );
        $stmt->execute([$id_jornada]);
        $gastos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(["status" => "success", "data" => $gastos, "id_jornada" => $id_jornada]);
        exit;
    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error al obtener gastos: " . $e->getMessage()]);
        exit;
    }
}

// ============================================================
// POST: crear | editar | eliminar
// ============================================================
if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $accion = isset($data['accion']) ? $data['accion'] : '';

    // Obtener jornada activa
    $stmtJ = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
    $jornada = $stmtJ->fetch(PDO::FETCH_ASSOC);

    if (!$jornada && $accion !== 'eliminar') {
        echo json_encode(["status" => "error", "message" => "No hay una jornada activa."]);
        exit;
    }
    $id_jornada = $jornada ? $jornada['id_jornada'] : null;

    try {
        $pdo->beginTransaction();

        // ---- CREAR ----
        if ($accion === 'crear') {
            $id_insumo = isset($data['id_insumo']) ? intval($data['id_insumo']) : 0;
            $cantidad  = isset($data['cantidad']) ? floatval($data['cantidad']) : 0;

            if (!$id_insumo || $cantidad <= 0) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Insumo y cantidad válida son requeridos."]);
                exit;
            }

            // Verificar stock disponible
            $stmtStock = $pdo->prepare("SELECT stock_actual, nombre_insumo FROM insumos WHERE id_insumo = ?");
            $stmtStock->execute([$id_insumo]);
            $insumo = $stmtStock->fetch(PDO::FETCH_ASSOC);

            if (!$insumo) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Insumo no encontrado."]);
                exit;
            }

            if (floatval($insumo['stock_actual']) < $cantidad) {
                $pdo->rollBack();
                echo json_encode([
                    "status"  => "error",
                    "message" => "Stock insuficiente. Disponible: {$insumo['stock_actual']} uds de {$insumo['nombre_insumo']}."
                ]);
                exit;
            }

            // Insertar el gasto
            $stmtInsert = $pdo->prepare(
                "INSERT INTO gastos_insumos (id_jornada, id_insumo, cantidad, fecha_hora)
                 VALUES (?, ?, ?, NOW())"
            );
            $stmtInsert->execute([$id_jornada, $id_insumo, $cantidad]);
            $id_gasto = $pdo->lastInsertId();

            // Descontar del stock del insumo
            $stmtDescontar = $pdo->prepare("UPDATE insumos SET stock_actual = stock_actual - ? WHERE id_insumo = ?");
            $stmtDescontar->execute([$cantidad, $id_insumo]);

            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto de insumo registrado y stock actualizado.", "id_gasto" => $id_gasto]);
            exit;
        }

        // ---- EDITAR ----
        if ($accion === 'editar') {
            $id_gasto    = isset($data['id_gasto']) ? intval($data['id_gasto']) : 0;
            $id_insumo   = isset($data['id_insumo']) ? intval($data['id_insumo']) : 0;
            $nueva_cant  = isset($data['cantidad']) ? floatval($data['cantidad']) : 0;

            if (!$id_gasto || !$id_insumo || $nueva_cant <= 0) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Datos incompletos para editar."]);
                exit;
            }

            // Obtener registro anterior
            $stmtViejo = $pdo->prepare("SELECT id_insumo, cantidad FROM gastos_insumos WHERE id_gasto_insumo = ? AND id_jornada = ?");
            $stmtViejo->execute([$id_gasto, $id_jornada]);
            $viejo = $stmtViejo->fetch(PDO::FETCH_ASSOC);

            if (!$viejo) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Registro no encontrado en la jornada activa."]);
                exit;
            }

            $id_insumo_viejo = intval($viejo['id_insumo']);
            $cantidad_vieja  = floatval($viejo['cantidad']);

            // Devolver stock del insumo anterior (o la cantidad anterior si el mismo insumo)
            $stmtDevolver = $pdo->prepare("UPDATE insumos SET stock_actual = stock_actual + ? WHERE id_insumo = ?");
            $stmtDevolver->execute([$cantidad_vieja, $id_insumo_viejo]);

            // Verificar stock del nuevo insumo
            $stmtStock = $pdo->prepare("SELECT stock_actual, nombre_insumo FROM insumos WHERE id_insumo = ?");
            $stmtStock->execute([$id_insumo]);
            $insumoNuevo = $stmtStock->fetch(PDO::FETCH_ASSOC);

            if (!$insumoNuevo || floatval($insumoNuevo['stock_actual']) < $nueva_cant) {
                $pdo->rollBack();
                $disponible = $insumoNuevo ? $insumoNuevo['stock_actual'] : 0;
                echo json_encode(["status" => "error", "message" => "Stock insuficiente. Disponible: $disponible uds."]);
                exit;
            }

            // Actualizar el gasto
            $stmtUpdate = $pdo->prepare("UPDATE gastos_insumos SET id_insumo = ?, cantidad = ? WHERE id_gasto_insumo = ?");
            $stmtUpdate->execute([$id_insumo, $nueva_cant, $id_gasto]);

            // Descontar nuevo stock
            $stmtDescontar = $pdo->prepare("UPDATE insumos SET stock_actual = stock_actual - ? WHERE id_insumo = ?");
            $stmtDescontar->execute([$nueva_cant, $id_insumo]);

            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto actualizado y stock ajustado."]);
            exit;
        }

        // ---- ELIMINAR ----
        if ($accion === 'eliminar') {
            $id_gasto = isset($data['id_gasto']) ? intval($data['id_gasto']) : 0;

            if (!$id_gasto) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "ID de gasto requerido."]);
                exit;
            }

            // Obtener datos antes de eliminar
            $stmtViejo = $pdo->prepare("SELECT id_insumo, cantidad FROM gastos_insumos WHERE id_gasto_insumo = ?");
            $stmtViejo->execute([$id_gasto]);
            $viejo = $stmtViejo->fetch(PDO::FETCH_ASSOC);

            if (!$viejo) {
                $pdo->rollBack();
                echo json_encode(["status" => "error", "message" => "Registro de gasto no encontrado."]);
                exit;
            }

            // Devolver el stock al inventario
            $stmtDevolver = $pdo->prepare("UPDATE insumos SET stock_actual = stock_actual + ? WHERE id_insumo = ?");
            $stmtDevolver->execute([$viejo['cantidad'], $viejo['id_insumo']]);

            // Eliminar el registro
            $stmtDel = $pdo->prepare("DELETE FROM gastos_insumos WHERE id_gasto_insumo = ?");
            $stmtDel->execute([$id_gasto]);

            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto eliminado y stock del insumo restaurado."]);
            exit;
        }

        $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => "Acción no reconocida: $accion"]);
        exit;

    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => "Error transaccional: " . $e->getMessage()]);
        exit;
    }
}

echo json_encode(["status" => "error", "message" => "Método HTTP no permitido."]);
exit;
?>
