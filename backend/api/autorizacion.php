<?php
// Autorización de un supervisor para "Ventas de la jornada" sin cambiar el usuario que atiende.
//   GET    → estado: rol de la sesión y si hay una autorización vigente
//   POST   → {usuario, password} de un supervisor o administrador: autoriza esta sesión
//   DELETE → quita la autorización (al cerrar el modal)
header("Content-Type: application/json; charset=UTF-8");

include_once '../config/database.php';
include_once '../models/Usuario.php';
include_once '../models/Supervisor.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    echo json_encode(['status' => 'success'] + Supervisor::estado());
    exit;
}

if ($method === 'DELETE') {
    Supervisor::revocar();
    echo json_encode(['status' => 'success', 'message' => 'Autorización retirada.']);
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $usuario = trim(isset($data['usuario']) ? (string) $data['usuario'] : '');
    $password = isset($data['password']) ? (string) $data['password'] : '';
    if ($usuario === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Ingrese el usuario y la contraseña del supervisor.']);
        exit;
    }

    $database = new Database();
    $resultado = (new Usuario($database->getConnection()))->login($usuario, $password);
    if (!$resultado) {
        usleep(400000); // frena los intentos repetidos
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Usuario o contraseña incorrectos.']);
        exit;
    }
    if (!in_array($resultado['rol'], Supervisor::ROLES, true)) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Ese usuario no es supervisor: no puede autorizar.']);
        exit;
    }

    Supervisor::autorizar($resultado);
    echo json_encode([
        'status' => 'success',
        'message' => 'Autorizado.',
        'supervisor' => trim($resultado['nombres'] . ' ' . $resultado['apellidos']),
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['status' => 'error', 'message' => 'Método no permitido.']);
