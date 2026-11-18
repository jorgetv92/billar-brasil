<?php
// Recordatorios para el personal de atención.
//
// Cada recordatorio genera "avisos": uno por cada fecha y hora en que debe aparecer. Los avisos se crean
// por adelantado (las próximas 24 horas) en estado pendiente y avanzan así:
//   pendiente -> mostrado     el portal de atención lo recogió con un turno abierto (sale el modal)
//             -> no_mostrado  pasó la tolerancia y ningún portal lo recogió (motivo: sin turno / portal cerrado)
//   mostrado (sin respuesta) -> mostrado (cerró con la X) | aceptado | confirmado
// No hay tareas programadas en el servidor: todo se pone al día cada vez que el portal de atención
// consulta (cada pocos segundos) o el administrador abre la pantalla de recordatorios.
class Recordatorios {
    // Minutos después de la hora programada en que todavía se puede mostrar el aviso.
    // Si en ese lapso ningún portal de atención lo recogió, queda como "no mostrado".
    const MINUTOS_TOLERANCIA = 15;
    // Cuánto por adelantado se crean los avisos pendientes.
    const HORAS_ADELANTO = 24;

    const REPETICIONES = ['una_vez', 'diario', 'dias_semana', 'fin_semana', 'rango'];

    // ¿El recordatorio aplica en esa fecha? (no mira las horas)
    public static function aplicaEnFecha(array $r, DateTime $dia) {
        $fecha = $dia->format('Y-m-d');
        if ($fecha < $r['fecha_inicio']) return false;
        $n = intval($dia->format('N')); // 1 = lunes ... 7 = domingo
        switch ($r['repeticion']) {
            case 'una_vez': return $fecha === $r['fecha_inicio'];
            case 'diario': return true;
            case 'dias_semana': return $n <= 5;
            case 'fin_semana': return $n >= 6;
            case 'rango': return !empty($r['fecha_fin']) && $fecha <= $r['fecha_fin'];
        }
        return false;
    }

    public static function listaHoras(array $r) {
        return array_values(array_filter(array_map('trim', explode(',', $r['horas']))));
    }

    // Fechas y horas ('Y-m-d H:i:s') en que aparece el recordatorio, con $desde < momento <= $hasta.
    public static function momentosEntre(array $r, DateTime $desde, DateTime $hasta) {
        $momentos = [];
        $horas = self::listaHoras($r);
        $dia = new DateTime($desde->format('Y-m-d'));
        $ultimo = $hasta->format('Y-m-d');
        while ($dia->format('Y-m-d') <= $ultimo) {
            if (!empty($r['fecha_fin']) && $dia->format('Y-m-d') > $r['fecha_fin']) break;
            if (self::aplicaEnFecha($r, $dia)) {
                foreach ($horas as $h) {
                    $m = new DateTime($dia->format('Y-m-d') . ' ' . $h . ':00');
                    if ($m > $desde && $m <= $hasta) $momentos[] = $m->format('Y-m-d H:i:s');
                }
            }
            $dia->modify('+1 day');
        }
        return $momentos;
    }

    // Próxima aparición después de ahora, o null si ya no tiene más.
    public static function proximo(array $r) {
        if (!intval($r['activo'])) return null;
        $ahora = new DateTime();
        $desde = max($ahora, new DateTime($r['fecha_inicio'] . ' 00:00:00'));
        if ($desde > $ahora) $desde->modify('-1 second'); // incluye la primera hora del día de inicio
        // Una semana alcanza para encontrar la siguiente en cualquier repetición.
        $hasta = (clone $desde)->modify('+8 days');
        $m = self::momentosEntre($r, $desde, $hasta);
        return $m ? $m[0] : null;
    }

    // Crea los avisos pendientes que faltan hasta HORAS_ADELANTO desde ahora.
    private static function generarPendientes(PDO $db) {
        $hasta = (new DateTime())->modify('+' . self::HORAS_ADELANTO . ' hours');
        $hastaTxt = $hasta->format('Y-m-d H:i:s');
        $stmt = $db->prepare("SELECT * FROM recordatorios WHERE activo = 1 AND generado_hasta < ?");
        $stmt->execute([$hastaTxt]);
        $insertar = $db->prepare("INSERT IGNORE INTO recordatorio_avisos (id_recordatorio, programado_para) VALUES (?, ?)");
        $marcar = $db->prepare("UPDATE recordatorios SET generado_hasta = ? WHERE id_recordatorio = ? AND generado_hasta < ?");
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            foreach (self::momentosEntre($r, new DateTime($r['generado_hasta']), $hasta) as $m) {
                $insertar->execute([$r['id_recordatorio'], $m]);
            }
            $marcar->execute([$hastaTxt, $r['id_recordatorio'], $hastaTxt]);
        }
    }

    // Avisos cuya tolerancia ya pasó sin que ningún portal los recogiera. El motivo depende de si hubo
    // un turno abierto en algún momento entre la hora programada y el fin de la tolerancia.
    private static function cerrarVencidos(PDO $db) {
        $tol = intval(self::MINUTOS_TOLERANCIA);
        $turno = "SELECT j.id_jornada FROM jornadas j
            WHERE j.fecha_hora_apertura <= a.programado_para + INTERVAL $tol MINUTE
              AND (j.fecha_hora_cierre IS NULL OR j.fecha_hora_cierre >= a.programado_para)
            ORDER BY j.id_jornada DESC LIMIT 1";
        // El motivo repite la consulta en vez de leer id_jornada: el orden de las asignaciones de un UPDATE
        // depende de la configuración de MySQL/MariaDB.
        $db->exec("UPDATE recordatorio_avisos a
            SET a.motivo_no_mostrado = IF(EXISTS($turno), 'portal_cerrado', 'sin_turno'),
                a.id_jornada = ($turno),
                a.estado = 'no_mostrado'
            WHERE a.estado = 'pendiente' AND a.programado_para <= NOW() - INTERVAL $tol MINUTE");
    }

    // Pone al día los avisos. Lo llaman el portal de atención y la pantalla del administrador.
    public static function sincronizar(PDO $db) {
        self::generarPendientes($db);
        self::cerrarVencidos($db);
    }

    public static function jornadaAbierta(PDO $db) {
        $id = $db->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1")->fetchColumn();
        return $id ? intval($id) : null;
    }

    // Lo que debe ver el portal de atención ahora: los avisos que llegaron a su hora (pasan a mostrado)
    // y los ya mostrados de este turno que nadie respondió todavía (se ven en todos los dispositivos).
    public static function avisosParaAtencion(PDO $db) {
        self::sincronizar($db);
        $idJornada = self::jornadaAbierta($db);
        if (!$idJornada) return [];
        $tol = intval(self::MINUTOS_TOLERANCIA);
        $db->prepare("UPDATE recordatorio_avisos SET estado = 'mostrado', mostrado_en = NOW(), id_jornada = ?
            WHERE estado = 'pendiente' AND programado_para <= NOW() AND programado_para > NOW() - INTERVAL $tol MINUTE")
            ->execute([$idJornada]);
        $stmt = $db->prepare("SELECT a.id_aviso, a.programado_para, a.mostrado_en, r.titulo, r.descripcion
            FROM recordatorio_avisos a INNER JOIN recordatorios r ON r.id_recordatorio = a.id_recordatorio
            WHERE a.estado = 'mostrado' AND a.respondido_en IS NULL AND a.id_jornada = ?
            ORDER BY a.programado_para, a.id_aviso");
        $stmt->execute([$idJornada]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Respuesta del personal al modal. Devuelve false si otro dispositivo ya lo respondió.
    public static function responder(PDO $db, $idAviso, $respuesta, $idUsuario) {
        $estados = ['cerrar' => 'mostrado', 'aceptar' => 'aceptado', 'realizado' => 'confirmado'];
        if (!isset($estados[$respuesta])) throw new InvalidArgumentException('Respuesta no válida.');
        $stmt = $db->prepare("UPDATE recordatorio_avisos SET estado = ?, respondido_en = NOW(), id_usuario_respuesta = ?
            WHERE id_aviso = ? AND estado = 'mostrado' AND respondido_en IS NULL");
        $stmt->execute([$estados[$respuesta], $idUsuario, $idAviso]);
        return $stmt->rowCount() > 0;
    }

    // Tras crear, editar, pausar o reactivar: se borran los pendientes que aún no llegan a su hora
    // y se vuelven a crear con la configuración nueva desde ahora.
    // Si se pausó, se borran todos sus pendientes (también los que estaban por mostrarse).
    public static function reprogramar(PDO $db, $idRecordatorio) {
        $activo = $db->prepare("SELECT activo FROM recordatorios WHERE id_recordatorio = ?");
        $activo->execute([$idRecordatorio]);
        $soloFuturos = intval($activo->fetchColumn()) ? " AND programado_para > NOW()" : "";
        $db->prepare("DELETE FROM recordatorio_avisos WHERE id_recordatorio = ? AND estado = 'pendiente'" . $soloFuturos)
            ->execute([$idRecordatorio]);
        $db->prepare("UPDATE recordatorios SET generado_hasta = NOW() WHERE id_recordatorio = ?")->execute([$idRecordatorio]);
        self::generarPendientes($db);
    }
}
