<?php
class Database {
    private $host = "localhost";
    private $db_name = "billa";
    private $username = "root"; // Cambia esto por tu usuario de MariaDB
    private $password = "";     // Cambia esto por tu contraseña de MariaDB
    public $conn;

    public function getConnection() {
        $this->conn = null;

        try {
            $this->conn = new PDO("mysql:host=" . $this->host . ";dbname=" . $this->db_name, $this->username, $this->password);
            // Forzar el uso de codificación UTF-8
            $this->conn->exec("set names utf8mb4");
            // Configurar PDO para que lance excepciones en caso de error
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        } catch(PDOException $exception) {
            echo "Error de conexión: " . $exception->getMessage();
        }

        return $this->conn;
    }
}
?>