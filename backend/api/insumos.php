<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
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

switch ($method) {
    case 'GET':
        try {
            $query = "SELECT id_insumo, nombre_insumo, unidad_medida, stock_actual FROM insumos ORDER BY nombre_insumo ASC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $insumos = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $insumos]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->nombre_insumo) && !empty($data->unidad_medida)) {
            try {
                $query = "INSERT INTO insumos (nombre_insumo, unidad_medida) VALUES (:nombre, :unidad)";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_insumo);
                $stmt->bindParam(':unidad', $data->unidad_medida);
                
                if ($stmt->execute()) {
                    http_response_code(201);
                    echo json_encode(["status" => "success", "message" => "Insumo registrado exitosamente."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al guardar el insumo."]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Faltan datos obligatorios."]);
        }
        break;

    case 'PUT':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_insumo) && !empty($data->nombre_insumo) && !empty($data->unidad_medida)) {
            try {
                $query = "UPDATE insumos SET nombre_insumo = :nombre, unidad_medida = :unidad WHERE id_insumo = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_insumo);
                $stmt->bindParam(':unidad', $data->unidad_medida);
                $stmt->bindParam(':id', $data->id_insumo);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Insumo actualizado."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al actualizar."]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Faltan datos para actualizar."]);
        }
        break;

    case 'DELETE':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_insumo)) {
            try {
                $query = "DELETE FROM insumos WHERE id_insumo = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id', $data->id_insumo);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Insumo eliminado del catálogo."]);
                }
            } catch (PDOException $e) {
                if($e->getCode() == 23000) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "No se puede eliminar porque este insumo ya tiene un historial de cargas o gastos asociado."]);
                } else {
                    http_response_code(500);
                    echo json_encode(["status" => "error", "message" => "Error al eliminar."]);
                }
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "ID requerido."]);
        }
        break;
}
?>