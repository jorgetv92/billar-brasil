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
            $query = "SELECT id_tipo_mesa, nombre_tipo, precio_hora FROM tipos_mesa ORDER BY id_tipo_mesa ASC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $tipos = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $tipos]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->nombre_tipo) && isset($data->precio_hora)) {
            try {
                $query = "INSERT INTO tipos_mesa (nombre_tipo, precio_hora) VALUES (:nombre, :precio)";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_tipo);
                $stmt->bindParam(':precio', $data->precio_hora);
                
                if ($stmt->execute()) {
                    http_response_code(201);
                    echo json_encode(["status" => "success", "message" => "Tipo de mesa registrado."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al guardar."]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Datos incompletos."]);
        }
        break;

    case 'PUT':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_tipo_mesa) && !empty($data->nombre_tipo) && isset($data->precio_hora)) {
            try {
                $query = "UPDATE tipos_mesa SET nombre_tipo = :nombre, precio_hora = :precio WHERE id_tipo_mesa = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_tipo);
                $stmt->bindParam(':precio', $data->precio_hora);
                $stmt->bindParam(':id', $data->id_tipo_mesa);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Tarifa actualizada."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al actualizar."]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Datos incompletos."]);
        }
        break;

    case 'DELETE':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_tipo_mesa)) {
            try {
                $query = "DELETE FROM tipos_mesa WHERE id_tipo_mesa = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id', $data->id_tipo_mesa);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Tipo de mesa eliminado."]);
                }
            } catch (PDOException $e) {
                // Capturar error 1451: Restricción de llave foránea
                if($e->getCode() == 23000) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "No se puede eliminar porque existen mesas físicas usando este tipo."]);
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