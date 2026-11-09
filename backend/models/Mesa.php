<?php
// La mesa pedida no se puede ocupar. Quien la lanza deja que la transacción completa se revierta.
class MesaNoDisponible extends Exception {}

class Mesa {
    // Bloquea las filas hasta el fin de la transacción. Siempre en orden de id, para que dos cajas
    // que bloquean las mismas mesas no queden esperándose una a otra.
    public static function bloquear($pdo, array $ids) {
        $ids = array_unique(array_map('intval', $ids));
        sort($ids);
        $stmt = $pdo->prepare("SELECT id_mesa, numero_mesa, estado_actual FROM mesas WHERE id_mesa = ? FOR UPDATE");
        $mesas = [];
        foreach ($ids as $id) {
            $stmt->execute([$id]);
            $fila = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($fila) {
                $mesas[$id] = $fila;
            }
        }
        return $mesas;
    }

    // Una sesión en juego tiene un tramo abierto dentro de la jornada abierta. Las sesiones que quedaron
    // abiertas en jornadas ya cerradas no cuentan: son restos de errores pasados, no partidas en curso.
    public static function tieneSesionEnJuego($pdo, $idMesa) {
        $stmt = $pdo->prepare("
            SELECT COUNT(*)
            FROM tramos_mesas t
            JOIN sesiones_juego s ON s.id_sesion = t.id_sesion
            JOIN jornadas j ON j.id_jornada = s.id_jornada
            WHERE t.id_mesa = ? AND t.fecha_hora_fin IS NULL AND s.estado = 'activa' AND j.estado = 'abierta'
        ");
        $stmt->execute([intval($idMesa)]);
        return intval($stmt->fetchColumn()) > 0;
    }

    // $mesa es una fila devuelta por bloquear(). $mensaje recibe el nombre de la mesa en %s.
    public static function exigirLibre($pdo, $mesa, $mensaje) {
        if (!$mesa) {
            throw new MesaNoDisponible('La mesa no existe.');
        }
        if ($mesa['estado_actual'] !== 'libre' || self::tieneSesionEnJuego($pdo, $mesa['id_mesa'])) {
            throw new MesaNoDisponible(sprintf($mensaje, $mesa['numero_mesa']));
        }
    }

    public static function reservarLibre($pdo, $idMesa, $mensaje) {
        $mesas = self::bloquear($pdo, [$idMesa]);
        self::exigirLibre($pdo, isset($mesas[intval($idMesa)]) ? $mesas[intval($idMesa)] : null, $mensaje);
    }
}
?>
