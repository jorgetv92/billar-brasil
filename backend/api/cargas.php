<?php
// cargas.php
header('Content-Type: application/json');
include_once '../config/database.php'; 

// Instanciar la clase Database y obtener la conexión PDO
$database = new Database();
$pdo = $database->getConnection();

$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$id_usuario_actual = 1; // Reemplazar luego con $_SESSION

try {
    if (!isset($pdo) || $pdo === null) {
        throw new Exception("Error interno: La variable de conexión a la base de datos no está definida.");
    }

    if ($method == 'GET') {
        if (isset($_GET['action']) && $_GET['action'] == 'historial') {
            $stmt = $pdo->prepare("SELECT * FROM bitacora_cargas WHERE id_carga = ? ORDER BY fecha_modificacion DESC");
            $stmt->execute([$_GET['id_carga']]);
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } elseif (isset($_GET['id_carga'])) {
            $stmt = $pdo->prepare("SELECT dc.id_producto, p.nombre_producto as producto, dc.cantidad 
                                   FROM detalle_cargas dc 
                                   JOIN productos p ON dc.id_producto = p.id_producto 
                                   WHERE dc.id_carga = ?");
            $stmt->execute([$_GET['id_carga']]);
            echo json_encode(["status" => "success", "data" => ["detalle" => $stmt->fetchAll(PDO::FETCH_ASSOC)]]);
        } else {
            $stmt = $pdo->query("SELECT c.id_carga, c.fecha_hora, c.estado, COALESCE(SUM(dc.cantidad), 0) as total_items 
                                 FROM cargas c 
                                 LEFT JOIN detalle_cargas dc ON c.id_carga = dc.id_carga 
                                 GROUP BY c.id_carga ORDER BY c.id_carga DESC");
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        }
    } 
    
    elseif ($method == 'POST') {
        $pdo->beginTransaction();
        
        $stmt = $pdo->prepare("INSERT INTO cargas (tipo_carga, fecha_hora, estado) VALUES (?, NOW(), 'activo')");
        $stmt->execute([$data['tipo_carga']]);
        $id_carga = $pdo->lastInsertId();

        $stmtDetalle = $pdo->prepare("INSERT INTO detalle_cargas (id_carga, id_producto, cantidad) VALUES (?, ?, ?)");
        // CORRECCIÓN: stock_actual
        $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");

        foreach ($data['items'] as $item) {
            $stmtDetalle->execute([$id_carga, $item['id_producto'], $item['cantidad']]);
            $stmtStock->execute([$item['cantidad'], $item['id_producto']]);
        }
        
        $pdo->commit();
        echo json_encode(["status" => "success", "message" => "Carga registrada exitosamente."]);
    } 
    
    elseif ($method == 'PUT') {
        $pdo->beginTransaction();
        $id_carga = $data['id_carga'];
        
        $stmtViejos = $pdo->prepare("SELECT id_producto, cantidad FROM detalle_cargas WHERE id_carga = ?");
        $stmtViejos->execute([$id_carga]);
        $viejos = $stmtViejos->fetchAll(PDO::FETCH_ASSOC);
        
        // CORRECCIÓN: stock_actual
        $stmtRevertir = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");
        foreach($viejos as $v) {
            $stmtRevertir->execute([$v['cantidad'], $v['id_producto']]);
        }
        
        $pdo->prepare("DELETE FROM detalle_cargas WHERE id_carga = ?")->execute([$id_carga]);
        
        $stmtDetalle = $pdo->prepare("INSERT INTO detalle_cargas (id_carga, id_producto, cantidad) VALUES (?, ?, ?)");
        // CORRECCIÓN: stock_actual
        $stmtStock = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?");
        foreach ($data['items'] as $item) {
            $stmtDetalle->execute([$id_carga, $item['id_producto'], $item['cantidad']]);
            $stmtStock->execute([$item['cantidad'], $item['id_producto']]);
        }
        
        $stmtBitacora = $pdo->prepare("INSERT INTO bitacora_cargas (id_carga, id_usuario, accion, detalle_cambios) VALUES (?, ?, 'modificacion', ?)");
        $cambiosJSON = json_encode(["antes" => $viejos, "ahora" => $data['items']]);
        $stmtBitacora->execute([$id_carga, $id_usuario_actual, $cambiosJSON]);

        $pdo->commit();
        echo json_encode(["status" => "success", "message" => "Carga modificada exitosamente."]);
    } 
    
    elseif ($method == 'DELETE') {
        $pdo->beginTransaction();
        $id_carga = $data['id_carga'];

        $pdo->prepare("UPDATE cargas SET estado = 'anulado' WHERE id_carga = ?")->execute([$id_carga]);

        $stmtDetalles = $pdo->prepare("SELECT id_producto, cantidad FROM detalle_cargas WHERE id_carga = ?");
        $stmtDetalles->execute([$id_carga]);
        $detalles = $stmtDetalles->fetchAll(PDO::FETCH_ASSOC);

        // CORRECCIÓN: stock_actual
        $stmtRevertir = $pdo->prepare("UPDATE productos SET stock_actual = stock_actual - ? WHERE id_producto = ?");
        foreach($detalles as $d) {
            $stmtRevertir->execute([$d['cantidad'], $d['id_producto']]);
        }

        $stmtBitacora = $pdo->prepare("INSERT INTO bitacora_cargas (id_carga, id_usuario, accion, detalle_cambios) VALUES (?, ?, 'anulacion', ?)");
        $stmtBitacora->execute([$id_carga, $id_usuario_actual, json_encode(["razon" => "Anulación completa"])]);

        $pdo->commit();
        echo json_encode(["status" => "success", "message" => "Carga anulada y stock revertido."]);
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo !== null && $pdo->inTransaction()) { 
        $pdo->rollBack(); 
    }
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>