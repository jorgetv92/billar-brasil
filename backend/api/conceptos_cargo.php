<?php
// Conceptos para cobrar roturas o daños (vaso roto, botella rota...). El monto es una sugerencia:
// el cajero puede cambiarlo al cobrar. No se borran: se retiran para conservar los cargos antiguos.
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");

include_once '../config/database.php';
session_start();

if (!isset($_SESSION['rol']) || $_SESSION['rol'] !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Acceso denegado."]);
    exit();
}

$database = new Database();
$db = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

function leerConcepto() {
    $data = json_decode(file_get_contents("php://input"));
    $nombre = isset($data->nombre) ? trim($data->nombre) : '';
    $monto = isset($data->monto_sugerido) ? round(floatval($data->monto_sugerido), 2) : 0;
    if ($nombre === '' || $monto < 0) {
        http_response_code(400);
        echo json_encode(["status" => "error", "message" => "Escriba el nombre y un monto sugerido válido."]);
        exit();
    }
    return [$data, $nombre, $monto];
}

try {
    if ($method === 'GET') {
        $stmt = $db->query("SELECT id_concepto, nombre, monto_sugerido, activo FROM conceptos_cargo ORDER BY activo DESC, nombre");
        echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    } elseif ($method === 'POST') {
        list($data, $nombre, $monto) = leerConcepto();
        $db->prepare("INSERT INTO conceptos_cargo (nombre, monto_sugerido) VALUES (?, ?)")->execute([$nombre, $monto]);
        http_response_code(201);
        echo json_encode(["status" => "success", "message" => "Concepto registrado."]);
    } elseif ($method === 'PUT') {
        list($data, $nombre, $monto) = leerConcepto();
        $activo = (isset($data->activo) && !$data->activo) ? 0 : 1;
        $db->prepare("UPDATE conceptos_cargo SET nombre = ?, monto_sugerido = ?, activo = ? WHERE id_concepto = ?")
            ->execute([$nombre, $monto, $activo, intval($data->id_concepto)]);
        echo json_encode(["status" => "success", "message" => "Concepto actualizado."]);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
}
?>
