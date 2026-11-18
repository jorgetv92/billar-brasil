<?php
// Recordatorios para el personal de atención.
//   Administrador: GET (lista | avisos), POST (crear | verificar), PUT (editar), DELETE (borrar).
//   Portal de atención: GET ?vista=atencion (avisos a mostrar ahora), POST accion=responder.
// La lógica de fechas y estados está en models/Recordatorios.php.
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");

include_once '../config/database.php';
include_once '../models/Recordatorios.php';

session_start();
$rol = isset($_SESSION['rol']) ? $_SESSION['rol'] : null;
$idUsuario = isset($_SESSION['id_usuario']) ? intval($_SESSION['id_usuario']) : 0;
// El portal de atención consulta seguido: se suelta la sesión para no frenar sus otras peticiones.
session_write_close();

class ErrorRecordatorio extends Exception {}

function responderJson($datos, $codigo = 200) {
    http_response_code($codigo);
    echo json_encode($datos);
    exit();
}

if (!$rol || !$idUsuario) {
    responderJson(["status" => "error", "message" => "La sesión terminó. Vuelva a iniciar sesión."], 401);
}

$database = new Database();
$db = $database->getConnection();
$method = $_SERVER['REQUEST_METHOD'];
$data = json_decode(file_get_contents("php://input"), true) ?: [];
$vista = isset($_GET['vista']) ? $_GET['vista'] : 'lista';
$accion = isset($data['accion']) ? $data['accion'] : '';

// Fecha 'aaaa-mm-dd' válida o error.
function fechaValida($valor, $nombre) {
    $d = DateTime::createFromFormat('!Y-m-d', (string) $valor);
    if (!$d || $d->format('Y-m-d') !== $valor) throw new ErrorRecordatorio("Indique una $nombre válida.");
    return $valor;
}

// Valida y normaliza lo que llega del formulario del administrador.
function leerRecordatorio(array $data) {
    $titulo = trim(isset($data['titulo']) ? $data['titulo'] : '');
    $descripcion = trim(isset($data['descripcion']) ? $data['descripcion'] : '');
    $repeticion = isset($data['repeticion']) ? $data['repeticion'] : '';
    if ($titulo === '') throw new ErrorRecordatorio('Escriba el título del recordatorio.');
    if (mb_strlen($titulo) > 120) throw new ErrorRecordatorio('El título admite hasta 120 caracteres.');
    if (!in_array($repeticion, Recordatorios::REPETICIONES, true)) throw new ErrorRecordatorio('Elija cuándo se repite.');

    $fechaInicio = fechaValida(isset($data['fecha_inicio']) ? $data['fecha_inicio'] : '', $repeticion === 'una_vez' ? 'fecha' : 'fecha de inicio');
    $fechaFin = null;
    if ($repeticion === 'rango') {
        $fechaFin = fechaValida(isset($data['fecha_fin']) ? $data['fecha_fin'] : '', 'fecha final');
        if ($fechaFin < $fechaInicio) throw new ErrorRecordatorio('La fecha final no puede ser anterior a la de inicio.');
    }

    $horas = [];
    foreach ((array) (isset($data['horas']) ? $data['horas'] : []) as $h) {
        if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $h)) throw new ErrorRecordatorio("La hora \"$h\" no es válida (use HH:MM, 24 horas).");
        $horas[$h] = true;
    }
    $horas = array_keys($horas);
    sort($horas);
    if (!$horas) throw new ErrorRecordatorio('Agregue al menos una hora.');
    if (count($horas) > 24) throw new ErrorRecordatorio('Se admiten hasta 24 horas por recordatorio.');

    $activo = (isset($data['activo']) && !$data['activo']) ? 0 : 1;
    $r = [
        'titulo' => $titulo,
        'descripcion' => $descripcion === '' ? null : $descripcion,
        'repeticion' => $repeticion,
        'fecha_inicio' => $fechaInicio,
        'fecha_fin' => $fechaFin,
        'horas' => implode(',', $horas),
        'activo' => $activo,
    ];
    if ($activo && $repeticion !== 'diario' && $repeticion !== 'dias_semana' && $repeticion !== 'fin_semana' && !Recordatorios::proximo($r)) {
        throw new ErrorRecordatorio('Con esa fecha y horas el recordatorio ya no aparecería: todas quedaron en el pasado.');
    }
    return $r;
}

function exigirAdmin($rol) {
    if ($rol !== 'administrador') responderJson(["status" => "error", "message" => "Acceso denegado."], 403);
}

try {
    // ---------------- PORTAL DE ATENCIÓN ----------------
    if ($method === 'GET' && $vista === 'atencion') {
        responderJson(["status" => "success", "data" => Recordatorios::avisosParaAtencion($db)]);
    }
    if ($method === 'POST' && $accion === 'responder') {
        $ok = Recordatorios::responder($db, intval(isset($data['id_aviso']) ? $data['id_aviso'] : 0), isset($data['respuesta']) ? $data['respuesta'] : '', $idUsuario);
        responderJson($ok
            ? ["status" => "success", "message" => "Respuesta registrada."]
            : ["status" => "respondido", "message" => "Este recordatorio ya fue respondido en otro dispositivo."]);
    }

    // ---------------- ADMINISTRADOR ----------------
    exigirAdmin($rol);

    if ($method === 'GET' && $vista === 'lista') {
        Recordatorios::sincronizar($db);
        $lista = $db->query("SELECT r.*,
                (SELECT COUNT(*) FROM recordatorio_avisos a WHERE a.id_recordatorio = r.id_recordatorio
                    AND a.estado IN ('mostrado', 'aceptado') AND a.respondido_en IS NOT NULL AND a.verificacion IS NULL) AS por_verificar
            FROM recordatorios r ORDER BY r.activo DESC, r.creado_en DESC")->fetchAll(PDO::FETCH_ASSOC);
        $ultimo = $db->prepare("SELECT estado, programado_para, motivo_no_mostrado, respondido_en FROM recordatorio_avisos
            WHERE id_recordatorio = ? AND estado <> 'pendiente' ORDER BY programado_para DESC, id_aviso DESC LIMIT 1");
        foreach ($lista as &$r) {
            $r['proximo'] = Recordatorios::proximo($r);
            $ultimo->execute([$r['id_recordatorio']]);
            $r['ultimo_aviso'] = $ultimo->fetch(PDO::FETCH_ASSOC) ?: null;
            unset($r['generado_hasta']);
        }
        responderJson(["status" => "success", "data" => $lista, "tolerancia_minutos" => Recordatorios::MINUTOS_TOLERANCIA]);
    }

    if ($method === 'GET' && $vista === 'avisos') {
        Recordatorios::sincronizar($db);
        $where = ["1 = 1"];
        $params = [];
        if (!empty($_GET['id_recordatorio'])) { $where[] = "a.id_recordatorio = ?"; $params[] = intval($_GET['id_recordatorio']); }
        if (!empty($_GET['estado'])) {
            if ($_GET['estado'] === 'por_verificar') {
                $where[] = "a.estado IN ('mostrado', 'aceptado') AND a.respondido_en IS NOT NULL AND a.verificacion IS NULL";
            } else {
                $where[] = "a.estado = ?";
                $params[] = $_GET['estado'];
            }
        }
        if (!empty($_GET['desde'])) { $where[] = "a.programado_para >= ?"; $params[] = fechaValida($_GET['desde'], 'fecha desde') . ' 00:00:00'; }
        if (!empty($_GET['hasta'])) { $where[] = "a.programado_para <= ?"; $params[] = fechaValida($_GET['hasta'], 'fecha hasta') . ' 23:59:59'; }
        $stmt = $db->prepare("SELECT a.*, r.titulo, r.descripcion,
                CONCAT(ur.nombres, ' ', ur.apellidos) AS usuario_respuesta,
                CONCAT(uv.nombres, ' ', uv.apellidos) AS usuario_verifico
            FROM recordatorio_avisos a
            INNER JOIN recordatorios r ON r.id_recordatorio = a.id_recordatorio
            LEFT JOIN usuarios ur ON ur.id_usuario = a.id_usuario_respuesta
            LEFT JOIN usuarios uv ON uv.id_usuario = a.id_usuario_verifico
            WHERE " . implode(' AND ', $where) . "
            ORDER BY (a.estado = 'pendiente') DESC,
                CASE WHEN a.estado = 'pendiente' THEN a.programado_para END ASC,
                a.programado_para DESC, a.id_aviso DESC
            LIMIT 500");
        $stmt->execute($params);
        responderJson(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }

    if ($method === 'POST' && $accion === 'verificar') {
        $verificacion = isset($data['verificacion']) ? $data['verificacion'] : null;
        if (!in_array($verificacion, ['realizado', 'no_realizado', null], true)) throw new ErrorRecordatorio('Verificación no válida.');
        $stmt = $db->prepare("UPDATE recordatorio_avisos SET verificacion = ?, verificado_en = IF(? IS NULL, NULL, NOW()), id_usuario_verifico = IF(? IS NULL, NULL, ?)
            WHERE id_aviso = ? AND estado IN ('mostrado', 'aceptado') AND respondido_en IS NOT NULL");
        $stmt->execute([$verificacion, $verificacion, $verificacion, $idUsuario, intval(isset($data['id_aviso']) ? $data['id_aviso'] : 0)]);
        if (!$stmt->rowCount()) throw new ErrorRecordatorio('Solo se verifican los avisos mostrados o aceptados que ya fueron respondidos.');
        responderJson(["status" => "success", "message" => $verificacion === null ? "Verificación quitada." : "Verificación guardada."]);
    }

    if ($method === 'POST') {
        $r = leerRecordatorio($data);
        $db->prepare("INSERT INTO recordatorios (titulo, descripcion, repeticion, fecha_inicio, fecha_fin, horas, activo, generado_hasta, id_usuario_creo, creado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())")
            ->execute([$r['titulo'], $r['descripcion'], $r['repeticion'], $r['fecha_inicio'], $r['fecha_fin'], $r['horas'], $r['activo'], $idUsuario]);
        Recordatorios::reprogramar($db, intval($db->lastInsertId()));
        responderJson(["status" => "success", "message" => "Recordatorio registrado."], 201);
    }

    if ($method === 'PUT') {
        $id = intval(isset($data['id_recordatorio']) ? $data['id_recordatorio'] : 0);
        $r = leerRecordatorio($data);
        $stmt = $db->prepare("UPDATE recordatorios SET titulo = ?, descripcion = ?, repeticion = ?, fecha_inicio = ?, fecha_fin = ?, horas = ?, activo = ?
            WHERE id_recordatorio = ?");
        $stmt->execute([$r['titulo'], $r['descripcion'], $r['repeticion'], $r['fecha_inicio'], $r['fecha_fin'], $r['horas'], $r['activo'], $id]);
        Recordatorios::reprogramar($db, $id);
        responderJson(["status" => "success", "message" => "Recordatorio actualizado."]);
    }

    if ($method === 'DELETE') {
        $id = intval(isset($_GET['id']) ? $_GET['id'] : 0);
        $db->prepare("DELETE FROM recordatorios WHERE id_recordatorio = ?")->execute([$id]);
        responderJson(["status" => "success", "message" => "Recordatorio eliminado junto con su historial."]);
    }

    responderJson(["status" => "error", "message" => "Petición no válida."], 400);
} catch (ErrorRecordatorio $e) {
    responderJson(["status" => "error", "message" => $e->getMessage()], 400);
} catch (InvalidArgumentException $e) {
    responderJson(["status" => "error", "message" => $e->getMessage()], 400);
} catch (PDOException $e) {
    error_log('Billar recordatorios: ' . $e->getMessage());
    responderJson(["status" => "error", "message" => "Error al guardar en la base de datos."], 500);
}
