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
            $query = "SELECT id_promocion, nombre_promo, tipo_promo, fecha_inicio, fecha_fin, 
                             hora_inicio, hora_fin, dias_semana, valor_descuento, id_item_condicion, id_item_secundario, cantidad_condicion 
                      FROM promociones ORDER BY id_promocion DESC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $promos = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $promos]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error BD: " . $e->getMessage()]);
        }
        break;

    case 'POST':
    case 'PUT':
        $data = json_decode(file_get_contents("php://input"));
        
        if (empty($data->nombre_promo) || empty($data->tipo_promo)) {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Datos base incompletos."]);
            exit();
        }

        // --- LÓGICA DE FILTRADO ARQUITECTÓNICO ---
        // Normalizamos los datos de la promoción según la ramificación del asistente visual
        $fecha_i = !empty($data->fecha_inicio) ? $data->fecha_inicio : null;
        $fecha_f = !empty($data->fecha_fin) ? $data->fecha_fin : null;
        $hora_i  = !empty($data->hora_inicio) ? $data->hora_inicio : null;
        $hora_f  = !empty($data->hora_fin) ? $data->hora_fin : null;
        $dias    = !empty($data->dias_semana) ? $data->dias_semana : null;

        $valor_desc = null;
        $id_item = null;
        $id_item_secundario = null;
        $cant_cond = null;

        if ($data->tipo_promo === 'tarifa_mesa' || $data->tipo_promo === 'descuento_producto') {
            $valor_desc = $data->valor_descuento;
            $id_item = $data->id_item_condicion;
        } elseif ($data->tipo_promo === 'combo_2x1') {
            $id_item = $data->id_item_condicion;
        } elseif ($data->tipo_promo === 'incentivo_cruzado' || $data->tipo_promo === 'incentivo_mesa') {
            $id_item = $data->id_item_condicion; // ID del producto beneficiado / mesa
            $valor_desc = $data->valor_descuento; // Precio especial del producto / mesa
            $cant_cond = $data->cantidad_condicion; // Horas de juego requeridas
        } elseif ($data->tipo_promo === 'incentivo_producto') {
            $id_item = $data->id_item_condicion; // ID del producto requerido
            $id_item_secundario = $data->id_item_secundario; // Tipo de mesa al que aplica
            $cant_cond = $data->cantidad_condicion; // Cantidad del producto requerido
            $valor_desc = $data->valor_descuento; // Monto a aumentar / Tarifa especial para 1 hora
        }

        try {
            if ($method === 'POST') {
                $query = "INSERT INTO promociones (nombre_promo, tipo_promo, fecha_inicio, fecha_fin, hora_inicio, hora_fin, dias_semana, valor_descuento, id_item_condicion, id_item_secundario, cantidad_condicion) 
                          VALUES (:nombre, :tipo, :f_ini, :f_fin, :h_ini, :h_fin, :dias, :val, :item, :item_sec, :cant)";
                $stmt = $db->prepare($query);
            } else {
                $query = "UPDATE promociones SET nombre_promo = :nombre, tipo_promo = :tipo, fecha_inicio = :f_ini, fecha_fin = :f_fin, hora_inicio = :h_ini, hora_fin = :h_fin, dias_semana = :dias, valor_descuento = :val, id_item_condicion = :item, id_item_secundario = :item_sec, cantidad_condicion = :cant 
                          WHERE id_promocion = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id', $data->id_promocion);
            }

            $stmt->bindParam(':nombre', $data->nombre_promo);
            $stmt->bindParam(':tipo', $data->tipo_promo);
            $stmt->bindParam(':f_ini', $fecha_i);
            $stmt->bindParam(':f_fin', $fecha_f);
            $stmt->bindParam(':h_ini', $hora_i);
            $stmt->bindParam(':h_fin', $hora_f);
            $stmt->bindParam(':dias', $dias);
            $stmt->bindParam(':val', $valor_desc);
            $stmt->bindParam(':item', $id_item);
            $stmt->bindParam(':item_sec', $id_item_secundario);
            $stmt->bindParam(':cant', $cant_cond);

            if ($stmt->execute()) {
                http_response_code($method === 'POST' ? 201 : 200);
                echo json_encode(["status" => "success", "message" => "Promoción guardada con éxito."]);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error transaccional: " . $e->getMessage()]);
        }
        break;

    case 'DELETE':
        $data = json_decode(file_get_contents("php://input"));
        if (!empty($data->id_promocion)) {
            try {
                $query = "DELETE FROM promociones WHERE id_promocion = :id";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id', $data->id_promocion);
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Promoción eliminada."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "No se pudo remover."]);
            }
        }
        break;
}
?>