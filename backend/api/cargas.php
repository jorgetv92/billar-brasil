<?php
// Cargas de mercadería: suman stock a los productos con inventario. Solo el administrador.
header('Content-Type: application/json; charset=UTF-8');
include_once '../config/database.php';
include_once '../models/Cargas.php';
session_start();

if (!isset($_SESSION['rol']) || $_SESSION['rol'] !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Acceso denegado."]);
    exit;
}

$database = new Database();
$pdo = $database->getConnection();
echo json_encode(Cargas::atender($pdo, 'producto', intval($_SESSION['id_usuario'])));
?>
