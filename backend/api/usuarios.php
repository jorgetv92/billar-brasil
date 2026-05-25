<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

include_once '../config/database.php';

session_start();

// Control de seguridad: Verificar si hay sesión activa y si el rol es administrador
if (!isset($_SESSION['rol']) || $_SESSION['rol'] !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Acceso denegado. Permisos insuficientes."]);
    exit();
}

$database = new Database();
$db = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        // Listar todos los usuarios (excluyendo el hash de la contraseña por seguridad)
        try {
            $query = "SELECT id_usuario, nombres, apellidos, usuario, rol FROM usuarios ORDER BY id_usuario DESC";
            $stmt = $db->prepare($query);
            $stmt->execute();
            $usuarios = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            http_response_code(200);
            echo json_encode(["status" => "success", "data" => $usuarios]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(["status" => "error", "message" => "Error al obtener usuarios: " . $e->getMessage()]);
        }
        break;

    case 'POST':
        // Crear un nuevo usuario
        $data = json_decode(file_get_contents("php://input"));
        
        if (!empty($data->nombres) && !empty($data->apellidos) && !empty($data->usuario) && !empty($data->password) && !empty($data->rol)) {
            try {
                // Verificar primero si el nombre de usuario ya está registrado
                $checkQuery = "SELECT id_usuario FROM usuarios WHERE usuario = :usuario";
                $checkStmt = $db->prepare($checkQuery);
                $checkStmt->bindParam(':usuario', $data->usuario);
                $checkStmt->execute();
                if ($checkStmt->rowCount() > 0) {
                    http_response_code(400);
                    echo json_encode(["status" => "error", "message" => "El nombre de usuario ya existe."]);
                    exit();
                }

                $query = "INSERT INTO usuarios (nombres, apellidos, usuario, password, rol) 
                          VALUES (:nombres, :apellidos, :usuario, :password, :rol)";
                $stmt = $db->prepare($query);
                
                // Hashear la contraseña con BCRYPT
                $hashed_password = password_hash($data->password, PASSWORD_BCRYPT);
                
                $stmt->bindParam(':nombres', $data->nombres);
                $stmt->bindParam(':apellidos', $data->apellidos);
                $stmt->bindParam(':usuario', $data->usuario);
                $stmt->bindParam(':password', $hashed_password);
                $stmt->bindParam(':rol', $data->rol);
                
                if ($stmt->execute()) {
                    http_response_code(201);
                    echo json_encode(["status" => "success", "message" => "Usuario creado exitosamente."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al registrar: " . $e->getMessage()]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Datos incompletos."]);
        }
        break;

    case 'PUT':
        // Editar un usuario existente
        $data = json_decode(file_get_contents("php://input"));
        
        if (!empty($data->id_usuario) && !empty($data->nombres) && !empty($data->apellidos) && !empty($data->usuario) && !empty($data->rol)) {
            try {
                // Si el campo de password no está vacío, se actualiza también la contraseña hasheada
                if (!empty($data->password)) {
                    $query = "UPDATE usuarios 
                              SET nombres = :nombres, apellidos = :apellidos, usuario = :usuario, password = :password, rol = :rol 
                              WHERE id_usuario = :id_usuario";
                    $hashed_password = password_hash($data->password, PASSWORD_BCRYPT);
                } else {
                    $query = "UPDATE usuarios 
                              SET nombres = :nombres, apellidos = :apellidos, usuario = :usuario, rol = :rol 
                              WHERE id_usuario = :id_usuario";
                }
                
                $stmt = $db->prepare($query);
                $stmt->bindParam(':nombres', $data->nombres);
                $stmt->bindParam(':apellidos', $data->apellidos);
                $stmt->bindParam(':usuario', $data->usuario);
                $stmt->bindParam(':rol', $data->rol);
                $stmt->bindParam(':id_usuario', $data->id_usuario);
                
                if (!empty($data->password)) {
                    $stmt->bindParam(':password', $hashed_password);
                }
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Usuario actualizado exitosamente."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al actualizar: " . $e->getMessage()]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "Datos insuficientes para la edición."]);
        }
        break;

    case 'DELETE':
        // Eliminar un usuario
        $data = json_decode(file_get_contents("php://input"));
        
        if (!empty($data->id_usuario)) {
            // Regla de UX/Negocio preventiva: Un administrador no debería poder borrarse a sí mismo por accidente
            if ($data->id_usuario == $_SESSION['id_usuario']) {
                http_response_code(400);
                echo json_encode(["status" => "error", "message" => "No puedes eliminar tu propio usuario activo."]);
                exit();
            }

            try {
                $query = "DELETE FROM usuarios WHERE id_usuario = :id_usuario";
                $stmt = $db->prepare($query);
                $stmt->bindParam(':id_usuario', $data->id_usuario);
                
                if ($stmt->execute()) {
                    http_response_code(200);
                    echo json_encode(["status" => "success", "message" => "Usuario eliminado."]);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(["status" => "error", "message" => "Error al eliminar: " . $e->getMessage()]);
            }
        } else {
            http_response_code(400);
            echo json_encode(["status" => "error", "message" => "ID de usuario requerido."]);
        }
        break;
        
    default:
        http_response_code(405);
        echo json_encode(["status" => "error", "message" => "Método no permitido."]);
        break;
}
?>