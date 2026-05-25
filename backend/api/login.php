<?php
// Configuración de cabeceras para aceptar peticiones JSON y CORS
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Max-Age: 3600");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Incluir archivos de configuración y modelos
include_once '../config/database.php';
include_once '../models/Usuario.php';

// Iniciar la sesión segura en el servidor
session_start();

// Instanciar la base de datos
$database = new Database();
$db = $database->getConnection();

// Instanciar el objeto Usuario
$usuario = new Usuario($db);

// Obtener los datos JSON enviados por el Frontend
$data = json_decode(file_get_contents("php://input"));

// Validar que los datos no estén vacíos
if(!empty($data->usuario) && !empty($data->password)) {
    
    // Llamar al método login del modelo
    $resultado = $usuario->login($data->usuario, $data->password);

    if($resultado) {
        // Credenciales correctas: Guardamos datos en la sesión de PHP
        $_SESSION['id_usuario'] = $resultado['id_usuario'];
        $_SESSION['rol'] = $resultado['rol'];

        // Devolvemos un JSON de éxito al Frontend
        http_response_code(200); // OK
        echo json_encode([
            "status" => "success",
            "message" => "Login exitoso",
            "data" => $resultado
        ]);
    } else {
        // Credenciales incorrectas
        http_response_code(401); // No autorizado
        echo json_encode([
            "status" => "error",
            "message" => "Usuario o contraseña incorrectos"
        ]);
    }
} else {
    // Faltan datos en la petición
    http_response_code(400); // Bad Request
    echo json_encode([
        "status" => "error",
        "message" => "Datos incompletos. Se requiere usuario y contraseña."
    ]);
}
?>