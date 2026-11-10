<?php
// api/combos.php — combos: productos compuestos (ej. 1 Fernet + 2 Coca Cola). No tienen stock propio:
// al venderse descuentan el stock de sus productos. Solo el administrador.
header("Content-Type: application/json; charset=UTF-8");
include_once '../config/database.php';
session_start();

if (!isset($_SESSION['rol']) || $_SESSION['rol'] !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Acceso denegado."]);
    exit;
}

class ErrorCombo extends Exception {}

$database = new Database();
$pdo = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true);
$data = is_array($data) ? $data : [];

// Valida nombre, precio y productos. Devuelve [nombre, precio, activo, [id_producto => cantidad]].
function leerCombo($pdo, array $data) {
    $nombre = trim((string)($data['nombre'] ?? ''));
    $precio = is_numeric($data['precio'] ?? null) ? round(floatval($data['precio']), 2) : 0;
    $activo = isset($data['activo']) && (string)$data['activo'] === '0' ? 0 : 1;
    if ($nombre === '') throw new ErrorCombo('Escriba el nombre del combo.');
    if ($precio <= 0) throw new ErrorCombo('El precio del combo debe ser mayor a cero.');

    $items = [];
    foreach ((isset($data['items']) && is_array($data['items']) ? $data['items'] : []) as $item) {
        $id = intval($item['id_producto'] ?? 0);
        $cant = is_numeric($item['cantidad'] ?? null) ? floatval($item['cantidad']) : 0;
        if ($id <= 0 || $cant <= 0 || floor($cant) != $cant) throw new ErrorCombo('Cada producto del combo necesita una cantidad entera mayor a cero.');
        $items[$id] = (isset($items[$id]) ? $items[$id] : 0) + intval($cant);
    }
    if (!$items) throw new ErrorCombo('Agregue al menos un producto al combo.');

    $stmt = $pdo->prepare("SELECT nombre_producto, activo FROM productos WHERE id_producto = ?");
    foreach (array_keys($items) as $id) {
        $stmt->execute([$id]);
        $p = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$p) throw new ErrorCombo("El producto #$id no existe.");
        if (!intval($p['activo'])) throw new ErrorCombo("{$p['nombre_producto']} está retirado: no puede ser parte de un combo.");
    }
    return [$nombre, $precio, $activo, $items];
}

function guardarItems($pdo, $idCombo, array $items) {
    $pdo->prepare("DELETE FROM combo_items WHERE id_combo = ?")->execute([$idCombo]);
    $stmt = $pdo->prepare("INSERT INTO combo_items (id_combo, id_producto, cantidad) VALUES (?, ?, ?)");
    foreach ($items as $id => $cant) $stmt->execute([$idCombo, $id, $cant]);
}

try {
    if ($method === 'GET') {
        $combos = $pdo->query("SELECT c.id_combo, c.nombre, c.precio, c.activo,
                                      (SELECT COUNT(*) FROM detalle_venta_productos d WHERE d.id_combo = c.id_combo) AS lineas_vendidas
                               FROM combos c ORDER BY c.activo DESC, c.nombre")->fetchAll(PDO::FETCH_ASSOC);
        $stmtItems = $pdo->prepare("SELECT ci.id_producto, ci.cantidad, p.nombre_producto, p.precio_venta, p.stock_actual, p.tipo, p.activo
                                    FROM combo_items ci JOIN productos p ON p.id_producto = ci.id_producto
                                    WHERE ci.id_combo = ? ORDER BY p.nombre_producto");
        foreach ($combos as &$c) {
            $stmtItems->execute([$c['id_combo']]);
            $c['items'] = $stmtItems->fetchAll(PDO::FETCH_ASSOC);
            $c['vendido'] = intval($c['lineas_vendidas']) > 0;
            unset($c['lineas_vendidas']);
        }
        unset($c);
        echo json_encode(["status" => "success", "data" => $combos]);
        exit;
    }

    if ($method === 'POST' || $method === 'PUT') {
        list($nombre, $precio, $activo, $items) = leerCombo($pdo, $data);
        $pdo->beginTransaction();
        if ($method === 'POST') {
            $pdo->prepare("INSERT INTO combos (nombre, precio, activo) VALUES (?, ?, ?)")->execute([$nombre, $precio, $activo]);
            $idCombo = intval($pdo->lastInsertId());
        } else {
            $idCombo = intval($data['id_combo'] ?? 0);
            $stmt = $pdo->prepare("SELECT id_combo FROM combos WHERE id_combo = ? FOR UPDATE");
            $stmt->execute([$idCombo]);
            if (!$stmt->fetch()) throw new ErrorCombo('El combo no existe.');
            // Las ventas ya hechas guardaron sus propios precios: cambiar el combo solo afecta las ventas nuevas.
            $pdo->prepare("UPDATE combos SET nombre = ?, precio = ?, activo = ? WHERE id_combo = ?")->execute([$nombre, $precio, $activo, $idCombo]);
        }
        guardarItems($pdo, $idCombo, $items);
        $pdo->commit();
        http_response_code($method === 'POST' ? 201 : 200);
        echo json_encode(["status" => "success", "message" => "Combo guardado.", "id_combo" => $idCombo]);
        exit;
    }

    if ($method === 'DELETE') {
        $idCombo = intval($data['id_combo'] ?? 0);
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM detalle_venta_productos WHERE id_combo = ?");
        $stmt->execute([$idCombo]);
        if (intval($stmt->fetchColumn()) > 0) {
            // Tiene ventas: se retira para conservar el historial.
            $pdo->prepare("UPDATE combos SET activo = 0 WHERE id_combo = ?")->execute([$idCombo]);
            echo json_encode(["status" => "success", "message" => "El combo tiene ventas: quedó retirado y ya no se ofrece."]);
            exit;
        }
        $pdo->prepare("DELETE FROM combos WHERE id_combo = ?")->execute([$idCombo]);
        echo json_encode(["status" => "success", "message" => "Combo eliminado."]);
        exit;
    }

    http_response_code(405);
    echo json_encode(["status" => "error", "message" => "Método no permitido."]);
} catch (ErrorCombo $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Error de base de datos: " . $e->getMessage()]);
}
?>
