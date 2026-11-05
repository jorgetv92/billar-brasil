<?php
// Zona horaria única para todo el backend (PHP y MySQL)
date_default_timezone_set('America/La_Paz');

class Database {
    private $host = "localhost";
    private $db_name = "replica_bll_brasil";
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

            // Sincroniza la zona horaria de MySQL con la de PHP (America/La_Paz, UTC-4).
            // En hosting compartido MySQL corre en la zona del servidor (no en la de Bolivia),
            // por lo que NOW() y date() devolvían horas distintas. Se usa el offset numérico
            // porque los hostings no siempre cargan las tablas de zonas horarias de MySQL.
            $offset = (new DateTime('now', new DateTimeZone(date_default_timezone_get())))->format('P');
            $this->conn->exec("SET time_zone = '" . $offset . "'");
        } catch(PDOException $exception) {
            echo "Error de conexión: " . $exception->getMessage();
        }

        return $this->conn;
    }
}
?>