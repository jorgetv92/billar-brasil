<?php
// Quién puede ver y corregir las ventas de la jornada: un supervisor o un administrador con la sesión
// iniciada, o un usuario de atención mientras un supervisor lo autoriza ingresando sus datos
// (la autorización vive en la sesión de PHP y vence sola si no se usa).
class Supervisor {
    const ROLES = ['supervisor', 'administrador'];
    const MINUTOS_AUTORIZACION = 15;

    private static function abrirSesion() {
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    }

    private static function autorizacionVigente() {
        $a = isset($_SESSION['autorizacion_ventas']) ? $_SESSION['autorizacion_ventas'] : null;
        if ($a && $a['expira'] > time()) return $a;
        unset($_SESSION['autorizacion_ventas']);
        return null;
    }

    // Estado para la pantalla: rol de la sesión y, si la hay, la autorización vigente.
    public static function estado() {
        self::abrirSesion();
        $a = self::autorizacionVigente();
        $rol = isset($_SESSION['rol']) ? $_SESSION['rol'] : null;
        session_write_close();
        return [
            'rol' => $rol,
            'es_supervisor' => in_array($rol, self::ROLES, true),
            'autorizado' => (bool) $a,
            'supervisor' => $a ? $a['nombre'] : null,
        ];
    }

    // Id del supervisor que permite la operación, o null. Cada uso renueva la autorización.
    public static function quienAutoriza() {
        self::abrirSesion();
        $id = null;
        if (isset($_SESSION['rol']) && in_array($_SESSION['rol'], self::ROLES, true)) {
            $id = intval($_SESSION['id_usuario']);
        } elseif ($a = self::autorizacionVigente()) {
            $_SESSION['autorizacion_ventas']['expira'] = time() + self::MINUTOS_AUTORIZACION * 60;
            $id = intval($a['id_usuario']);
        }
        session_write_close();
        return $id;
    }

    // Corta la petición con 403 si nadie la autoriza.
    public static function exigir() {
        $id = self::quienAutoriza();
        if ($id === null) {
            http_response_code(403);
            echo json_encode([
                'status' => 'error',
                'codigo' => 'requiere_supervisor',
                'message' => 'Se necesita la autorización de un supervisor para ver o corregir las ventas.',
            ]);
            exit;
        }
        return $id;
    }

    public static function autorizar(array $usuario) {
        self::abrirSesion();
        $_SESSION['autorizacion_ventas'] = [
            'id_usuario' => intval($usuario['id_usuario']),
            'nombre' => trim($usuario['nombres'] . ' ' . $usuario['apellidos']),
            'expira' => time() + self::MINUTOS_AUTORIZACION * 60,
        ];
        session_write_close();
    }

    public static function revocar() {
        self::abrirSesion();
        unset($_SESSION['autorizacion_ventas']);
        session_write_close();
    }
}
