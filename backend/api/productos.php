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
            $query = "SELECT id_producto, nombre_producto, precio_venta, stock_actual FROM productos ORDER BY nombre_producto ASC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $productos = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $productos]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
        }
        break;

    case 'POST':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->nombre_producto) && isset($data->precio_venta)) {
            try {
                // stock_actual no se envía, la BD lo pone en 0 por el DEFAULT
                $query = "INSERT INTO productos (nombre_producto, precio_venta) VALUES (:nombre, :precio)";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_producto);
                $stmt->bindParam(':precio', $data->precio_venta);
                
                if ($stmt->execute()) {
                    http_response_code(201);
                    echo json_encode(["status" => "success", "message" => "Producto registrado exitosamente."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al guardar el producto."]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Faltan datos obligatorios."]);
        }
        break;

    case 'PUT':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_producto) && !empty($data->nombre_producto) && isset($data->precio_venta)) {
            try {
                // Solo se permite actualizar nombre y precio. El stock se ignora aquí.
                $query = "UPDATE productos SET nombre_producto = :nombre, precio_venta = :precio WHERE id_producto = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombre', $data->nombre_producto);
                $stmt->bindParam(':precio', $data->precio_venta);
                $stmt->bindParam(':id', $data->id_producto);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Producto actualizado."]);
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
        if (!empty($data->id_producto)) {
            try {
                $query = "DELETE FROM productos WHERE id_producto = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id', $data->id_producto);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Producto eliminado del catálogo."]);
                }
            } catch (PDOException $e) {
                if($e->getCode() == 23000) {
                    http_response_code(409);
                    echo json_encode(["status" => "error", "message" => "No se puede eliminar porque este producto ya tiene un historial de ventas."]);
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