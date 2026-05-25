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
            // Unimos con tipos_mesa para obtener el nombre del tipo y enviarlo al Frontend
            $query = "SELECT m.id_mesa, m.id_tipo_mesa, m.numero_mesa, m.estado_actual, 
                             t.nombre_tipo, t.precio_hora 
                      FROM mesas m
                      INNER JOIN tipos_mesa t ON m.id_tipo_mesa = t.id_tipo_mesa
                      ORDER BY m.numero_mesa ASC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $mesas = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $mesas]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->numero_mesa) && !empty($data->id_tipo_mesa) && !empty($data->estado_actual)) {
            try {
                $query = "INSERT INTO mesas (id_tipo_mesa, numero_mesa, estado_actual) 
                          VALUES (:id_tipo, :numero, :estado)";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id_tipo', $data->id_tipo_mesa);
                $stmt->bindParam(':numero', $data->numero_mesa);
                $stmt->bindParam(':estado', $data->estado_actual);
                
                if ($stmt->execute()) {
                    http_response_code(201);
                    echo json_encode(["status" => "success", "message" => "Mesa física registrada."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al guardar: " . $e->getMessage()]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Faltan datos obligatorios."]);
        }
        break;

    case 'PUT':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_mesa) && !empty($data->numero_mesa) && !empty($data->id_tipo_mesa) && !empty($data->estado_actual)) {
            try {
                $query = "UPDATE mesas 
                          SET id_tipo_mesa = :id_tipo, numero_mesa = :numero, estado_actual = :estado 
                          WHERE id_mesa = :id_mesa";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id_tipo', $data->id_tipo_mesa);
                $stmt->bindParam(':numero', $data->numero_mesa);
                $stmt->bindParam(':estado', $data->estado_actual);
                $stmt->bindParam(':id_mesa', $data->id_mesa);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Mesa actualizada."]);
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
        if (!empty($data->id_mesa)) {
            try {
                $query = "DELETE FROM mesas WHERE id_mesa = :id_mesa";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id_mesa', $data->id_mesa);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Mesa eliminada."]);
                }
            } catch (PDOException $e) {
                // Posible error por estar enlazada a historiales (tramos_mesas)
                if($e->getCode() == 23000) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "No se puede eliminar la mesa porque tiene historial de sesiones de juego guardado."]);
                } else {
                    http_response_code(500);
                    echo json_encode(["status" => "error", "message" => "Error al eliminar."]);
                }
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "ID de mesa requerido."]);
        }
        break;
}
?>