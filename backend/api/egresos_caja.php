<?php
// api/egresos_caja.php — salidas de efectivo de la caja durante el turno. Restan del efectivo esperado al cierre.
// Solo se registran, corrigen o borran egresos de la jornada abierta: lo de un turno cerrado ya está cuadrado.
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");

include_once '../config/database.php';

class ErrorEgreso extends Exception {}

$database = new Database();
$pdo = $database->getConnection();
if (!$pdo) {
    echo json_encode(["status" => "error", "message" => "Error de conexión a la base de datos."]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// Monto positivo con centavos como máximo, devuelto como texto decimal exacto.
function montoEgreso($valor) {
    $num = is_numeric($valor) ? floatval($valor) : 0;
    $cent = intval(round($num * 100));
    if ($num <= 0 || abs($num * 100 - $cent) > 0.001) {
        throw new ErrorEgreso('Ingresa un monto mayor a cero, con centavos como máximo.');
    }
    return number_format($cent / 100, 2, '.', '');
}

if ($method === 'GET') {
    try {
        $jornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if (!$jornada) {
            echo json_encode(["status" => "sin_jornada", "data" => [], "message" => "No hay jornada activa."]);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id_egreso, descripcion, monto, fecha_hora FROM egresos_caja WHERE id_jornada = ? ORDER BY fecha_hora DESC, id_egreso DESC");
        $stmt->execute([$jornada['id_jornada']]);
        echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC), "id_jornada" => $jornada['id_jornada']]);
    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error al obtener egresos: " . $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $data = is_array($data) ? $data : [];
    $accion = isset($data['accion']) ? $data['accion'] : '';

    try {
        $pdo->beginTransaction();

        // Bloqueo compartido: el cierre de la jornada espera a que termine este egreso y viceversa,
        // así ningún egreso queda guardado en un turno que ya se cuadró.
        $jornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1 LOCK IN SHARE MODE")->fetch(PDO::FETCH_ASSOC);
        if (!$jornada) {
            throw new ErrorEgreso('No hay una jornada activa para registrar egresos.');
        }
        $id_jornada = intval($jornada['id_jornada']);

        $exigirDeJornada = function ($idEgreso) use ($pdo, $id_jornada) {
            $stmt = $pdo->prepare("SELECT id_egreso FROM egresos_caja WHERE id_egreso = ? AND id_jornada = ? FOR UPDATE");
            $stmt->execute([$idEgreso, $id_jornada]);
            if (!$stmt->fetch()) {
                throw new ErrorEgreso('Solo se pueden modificar egresos de la jornada activa.');
            }
        };

        if ($accion === 'crear') {
            $concepto = trim((string)($data['concepto'] ?? ''));
            if ($concepto === '') throw new ErrorEgreso('Concepto y monto válido son requeridos.');
            $monto = montoEgreso($data['monto'] ?? null);
            $pdo->prepare("INSERT INTO egresos_caja (id_jornada, descripcion, monto, fecha_hora) VALUES (?, ?, ?, NOW())")
                ->execute([$id_jornada, $concepto, $monto]);
            $id = $pdo->lastInsertId();
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Egreso registrado correctamente.", "id_egreso" => $id]);
            exit;
        }

        if ($accion === 'editar') {
            $id_egreso = intval($data['id_egreso'] ?? 0);
            $concepto = trim((string)($data['concepto'] ?? ''));
            if (!$id_egreso || $concepto === '') throw new ErrorEgreso('Datos incompletos para editar.');
            $monto = montoEgreso($data['monto'] ?? null);
            $exigirDeJornada($id_egreso);
            $pdo->prepare("UPDATE egresos_caja SET descripcion = ?, monto = ? WHERE id_egreso = ?")->execute([$concepto, $monto, $id_egreso]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Egreso actualizado correctamente."]);
            exit;
        }

        if ($accion === 'eliminar') {
            $id_egreso = intval($data['id_egreso'] ?? 0);
            if (!$id_egreso) throw new ErrorEgreso('ID de egreso requerido.');
            $exigirDeJornada($id_egreso);
            $pdo->prepare("DELETE FROM egresos_caja WHERE id_egreso = ?")->execute([$id_egreso]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Egreso eliminado correctamente."]);
            exit;
        }

        throw new ErrorEgreso("Acción no reconocida: $accion");
    } catch (ErrorEgreso $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => $e->getMessage()]);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => "Error transaccional: " . $e->getMessage()]);
    }
    exit;
}

echo json_encode(["status" => "error", "message" => "Método HTTP no permitido."]);
exit;
?>
