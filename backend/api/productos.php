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

// inventario: se compra para revender y lleva stock. preparado: se arma en la barra (vaso de fernet, cócteles), sin stock.
function tipoProducto($data) {
    return (isset($data->tipo) && $data->tipo === 'preparado') ? 'preparado' : 'inventario';
}

// Un producto retirado deja de aparecer para vender, cargar o reportar, pero se conserva por las ventas antiguas.
function activoProducto($data) {
    return (isset($data->activo) && !$data->activo) ? 0 : 1;
}

// Propiedades del producto, ya coherentes entre sí:
// - no_vendible: tiene stock y se carga, pero no se vende suelto (solo dentro de combos). No lleva precio.
// - receta: se gasta al preparar en barra (botella de ron para los vasos) y su gasto se registra aparte.
// Ambas necesitan stock, así que el producto queda como 'inventario'.
function propiedadesProducto($data) {
    $noVendible = !empty($data->no_vendible) ? 1 : 0;
    $receta = !empty($data->receta) ? 1 : 0;
    $tipo = ($noVendible || $receta) ? 'inventario' : tipoProducto($data);
    $precio = $noVendible ? 0 : (is_numeric($data->precio_venta ?? null) ? round(floatval($data->precio_venta), 2) : -1);
    return [$tipo, $noVendible, $receta, $precio];
}

switch ($method) {
    case 'GET':
        try {
            $query = "SELECT id_producto, nombre_producto, precio_venta, stock_actual, tipo, activo, no_vendible, receta FROM productos ORDER BY nombre_producto ASC";
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
        if (!empty($data->nombre_producto) && (isset($data->precio_venta) || !empty($data->no_vendible))) {
            list($tipo, $noVendible, $receta, $precio) = propiedadesProducto($data);
            if ($precio < 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Ingrese un precio de venta válido."]);
                break;
            }
            try {
                // stock_actual no se envía, la BD lo pone en 0 por el DEFAULT
                $query = "INSERT INTO productos (nombre_producto, precio_venta, tipo, activo, no_vendible, receta) VALUES (:nombre, :precio, :tipo, :activo, :no_vendible, :receta)";
                $stmt = $db->prepare($query);
                $activo = activoProducto($data);
                $stmt->bindParam(':tipo', $tipo);
                $stmt->bindParam(':activo', $activo);
                $stmt->bindParam(':no_vendible', $noVendible);
                $stmt->bindParam(':receta', $receta);
                $stmt->bindParam(':nombre', $data->nombre_producto);
                $stmt->bindParam(':precio', $precio);

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
        if (!empty($data->id_producto) && !empty($data->nombre_producto) && (isset($data->precio_venta) || !empty($data->no_vendible))) {
            list($tipo, $noVendible, $receta, $precio) = propiedadesProducto($data);
            if ($precio < 0) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "Ingrese un precio de venta válido."]);
                break;
            }
            try {
                // El stock no se edita aquí: solo con cargas, ventas y gastos.
                $query = "UPDATE productos SET nombre_producto = :nombre, precio_venta = :precio, tipo = :tipo, activo = :activo, no_vendible = :no_vendible, receta = :receta WHERE id_producto = :id";
                $stmt = $db->prepare($query);
                $activo = activoProducto($data);
                $stmt->bindParam(':tipo', $tipo);
                $stmt->bindParam(':activo', $activo);
                $stmt->bindParam(':no_vendible', $noVendible);
                $stmt->bindParam(':receta', $receta);
                $stmt->bindParam(':nombre', $data->nombre_producto);
                $stmt->bindParam(':precio', $precio);
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
                    echo json_encode(["status" => "error", "message" => "No se puede eliminar porque este producto ya tiene un historial de ventas. Puede marcarlo como retirado (inactivo) para que deje de aparecer."]);
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