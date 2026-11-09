<?php
// Conexión a la base de datos. Los datos de conexión, la zona horaria y si se muestran los errores
// salen del entorno activo (backend/config/entorno.php -> backend/config/entornos/<nombre>.php),
// así el mismo código sirve en local, en la demo y en producción.

function entornoBillar() {
    static $config = null;
    if ($config === null) {
        $nombre = require __DIR__ . '/entorno.php';
        $archivo = __DIR__ . '/entornos/' . $nombre . '.php';
        if (!is_string($nombre) || !preg_match('/^[a-z0-9_]+$/', $nombre) || !is_file($archivo)) {
            falloConexionBillar('Falta configurar la conexión: no existe backend/config/entornos/' . $nombre . '.php.');
        }
        $config = require $archivo;
    }
    return $config;
}

// Responde en JSON (lo que esperan las pantallas) y corta la petición.
function falloConexionBillar($mensaje) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=UTF-8');
    }
    echo json_encode(["status" => "error", "message" => $mensaje]);
    exit;
}

$entornoBillar = entornoBillar();
// Zona horaria única para todo el backend (PHP y MySQL)
date_default_timezone_set($entornoBillar['zona_horaria']);
if (empty($entornoBillar['mostrar_errores'])) {
    ini_set('display_errors', '0');
    ini_set('log_errors', '1');
}

class Database {
    public $conn;

    public function getConnection() {
        $this->conn = null;
        $config = entornoBillar();
        if (strpos($config['db_name'] . $config['db_user'] . $config['db_pass'], 'COMPLETAR_') !== false) {
            falloConexionBillar('Falta configurar la conexión en backend/config/entornos/' . $config['nombre'] . '.php.');
        }

        try {
            $this->conn = new PDO("mysql:host=" . $config['db_host'] . ";dbname=" . $config['db_name'], $config['db_user'], $config['db_pass']);
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
            error_log('Billar: error de conexión a la base: ' . $exception->getMessage());
            $detalle = empty($config['mostrar_errores']) ? '' : ' ' . $exception->getMessage();
            falloConexionBillar('No se pudo conectar a la base de datos.' . $detalle);
        }

        return $this->conn;
    }
}
?>
