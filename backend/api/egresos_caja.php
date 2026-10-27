<?php
// api/egresos_caja.php
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");
header("Access-Control-Allow-Origin: *");

include_once '../config/database.php';

try {
    $database = new Database();
    $pdo = $database->getConnection();
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => "Error de BD: " . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// ============================================================
// GET: Listar egresos de la jornada activa
// ============================================================
if ($method === 'GET') {
    try {
        $stmtJ = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
        $jornada = $stmtJ->fetch(PDO::FETCH_ASSOC);

        if (!$jornada) {
            echo json_encode(["status" => "sin_jornada", "data" => [], "message" => "No hay jornada activa."]);
            exit;
        }

        $id_jornada = $jornada['id_jornada'];
        $stmt = $pdo->prepare(
            "SELECT id_egreso, descripcion, monto, fecha_hora
             FROM egresos_caja
             WHERE id_jornada = ?
             ORDER BY fecha_hora DESC"
        );
        $stmt->execute([$id_jornada]);
        $egresos = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(["status" => "success", "data" => $egresos, "id_jornada" => $id_jornada]);
        exit;
    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error al obtener egresos: " . $e->getMessage()]);
        exit;
    }
}

// ============================================================
// POST: crear | editar | eliminar
// ============================================================
if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $accion = isset($data['accion']) ? $data['accion'] : '';

    // Obtener jornada activa (requerida para todas las acciones)
    $stmtJ = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1");
    $jornada = $stmtJ->fetch(PDO::FETCH_ASSOC);

    if (!$jornada && $accion !== 'eliminar') {
        echo json_encode(["status" => "error", "message" => "No hay una jornada activa para registrar egresos."]);
        exit;
    }
    $id_jornada = $jornada ? $jornada['id_jornada'] : null;

    try {
        // ---- CREAR ----
        if ($accion === 'crear') {
            $concepto = isset($data['concepto']) ? trim($data['concepto']) : '';
            $monto    = isset($data['monto']) ? floatval($data['monto']) : 0;

            if (empty($concepto) || $monto <= 0) {
                echo json_encode(["status" => "error", "message" => "Concepto y monto válido son requeridos."]);
                exit;
            }

            $stmt = $pdo->prepare(
                "INSERT INTO egresos_caja (id_jornada, descripcion, monto, fecha_hora)
                 VALUES (?, ?, ?, NOW())"
            );
            $stmt->execute([$id_jornada, $concepto, $monto]);

            echo json_encode(["status" => "success", "message" => "Egreso registrado correctamente.", "id_egreso" => $pdo->lastInsertId()]);
            exit;
        }

        // ---- EDITAR ----
        if ($accion === 'editar') {
            $id_egreso = isset($data['id_egreso']) ? intval($data['id_egreso']) : 0;
            $concepto  = isset($data['concepto']) ? trim($data['concepto']) : '';
            $monto     = isset($data['monto']) ? floatval($data['monto']) : 0;

            if (!$id_egreso || empty($concepto) || $monto <= 0) {
                echo json_encode(["status" => "error", "message" => "Datos incompletos para editar."]);
                exit;
            }

            // Verificar que el egreso pertenezca a la jornada activa
            $stmtCheck = $pdo->prepare("SELECT id_egreso FROM egresos_caja WHERE id_egreso = ? AND id_jornada = ?");
            $stmtCheck->execute([$id_egreso, $id_jornada]);
            if (!$stmtCheck->fetch()) {
                echo json_encode(["status" => "error", "message" => "El egreso no pertenece a la jornada activa."]);
                exit;
            }

            $stmt = $pdo->prepare("UPDATE egresos_caja SET descripcion = ?, monto = ? WHERE id_egreso = ?");
            $stmt->execute([$concepto, $monto, $id_egreso]);

            echo json_encode(["status" => "success", "message" => "Egreso actualizado correctamente."]);
            exit;
        }

        // ---- ELIMINAR ----
        if ($accion === 'eliminar') {
            $id_egreso = isset($data['id_egreso']) ? intval($data['id_egreso']) : 0;

            if (!$id_egreso) {
                echo json_encode(["status" => "error", "message" => "ID de egreso requerido."]);
                exit;
            }

            // Verificar que pertenezca a jornada activa (si la hay)
            if ($id_jornada) {
                $stmtCheck = $pdo->prepare("SELECT id_egreso FROM egresos_caja WHERE id_egreso = ? AND id_jornada = ?");
                $stmtCheck->execute([$id_egreso, $id_jornada]);
                if (!$stmtCheck->fetch()) {
                    echo json_encode(["status" => "error", "message" => "Solo se pueden eliminar egresos de la jornada activa."]);
                    exit;
                }
            }

            $stmt = $pdo->prepare("DELETE FROM egresos_caja WHERE id_egreso = ?");
            $stmt->execute([$id_egreso]);

            echo json_encode(["status" => "success", "message" => "Egreso eliminado correctamente."]);
            exit;
        }

        echo json_encode(["status" => "error", "message" => "Acción no reconocida: $accion"]);
        exit;

    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error transaccional: " . $e->getMessage()]);
        exit;
    }
}

echo json_encode(["status" => "error", "message" => "Método HTTP no permitido."]);
exit;
?>
