<?php
class Usuario {
    private $conn;
    private $table_name = "usuarios";

    public function __construct($db) {
        $this->conn = $db;
    }

    // Método para validar el login
    public function login($usuario, $password_ingresada) {
        // Consulta SQL usando sentencias preparadas para evitar Inyección SQL
        $query = "SELECT id_usuario, nombres, apellidos, rol, password 
                  FROM " . $this->table_name . " 
                  WHERE usuario = :usuario LIMIT 0,1";

        $stmt = $this->conn->prepare($query);
        $stmt->bindParam(':usuario', $usuario);
        $stmt->execute();

        // Verificamos si el usuario existe en la base de datos
        if($stmt->rowCount() > 0) {
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $hash_en_bd = $row['password'];

            // Verificamos si la contraseña ingresada coincide con el Hash
            if(password_verify($password_ingresada, $hash_en_bd)) {
                // Si es correcta, devolvemos los datos del usuario (excepto el password)
                return [
                    "id_usuario" => $row['id_usuario'],
                    "nombres" => $row['nombres'],
                    "apellidos" => $row['apellidos'],
                    "rol" => $row['rol']
                ];
            }
        }
        
        // Retorna falso si el usuario no existe o la contraseña es incorrecta
        return false;
    }
}
?>