<?php
// api/gastos_insumos.php — insumos que se usan en el turno (detergente, papel...). Descuentan stock.
// Solo se registran, corrigen o borran gastos de la jornada abierta: lo de un turno cerrado ya está en su reporte.
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");

include_once '../config/database.php';

class ErrorGasto extends Exception {}

$database = new Database();
$pdo = $database->getConnection();
if (!$pdo) {
    echo json_encode(["status" => "error", "message" => "Error de conexión a la base de datos."]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// Cantidad en centésimas: positiva y con dos decimales como máximo.
function centesimasGasto($valor) {
    $num = is_numeric($valor) ? floatval($valor) : 0;
    $cent = intval(round($num * 100));
    if ($num <= 0 || abs($num * 100 - $cent) > 0.001) {
        throw new ErrorGasto('Ingresa una cantidad mayor a cero, con dos decimales como máximo.');
    }
    return $cent;
}

// Suma $cent (centésimas, puede ser negativo) al stock del insumo, que ya debe estar bloqueado.
function moverStockInsumo($pdo, $idInsumo, $cent) {
    $stmt = $pdo->prepare("SELECT nombre_insumo, stock_actual FROM insumos WHERE id_insumo = ? FOR UPDATE");
    $stmt->execute([$idInsumo]);
    $insumo = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$insumo) {
        throw new ErrorGasto('Insumo no encontrado.');
    }
    $stock = intval(round(floatval($insumo['stock_actual']) * 100));
    if ($stock + $cent < 0) {
        throw new ErrorGasto(sprintf('Stock insuficiente. Disponible: %s de %s.', number_format($stock / 100, 2, '.', ''), $insumo['nombre_insumo']));
    }
    $pdo->prepare("UPDATE insumos SET stock_actual = stock_actual + ? WHERE id_insumo = ?")
        ->execute([number_format($cent / 100, 2, '.', ''), $idInsumo]);
}

if ($method === 'GET') {
    $accion = isset($_GET['accion']) ? $_GET['accion'] : 'listar';
    try {
        if ($accion === 'get_insumos') {
            $stmt = $pdo->query("SELECT id_insumo, nombre_insumo, unidad_medida, stock_actual FROM insumos ORDER BY nombre_insumo ASC");
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            exit;
        }

        $jornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if (!$jornada) {
            echo json_encode(["status" => "sin_jornada", "data" => [], "message" => "No hay jornada activa."]);
            exit;
        }
        $stmt = $pdo->prepare(
            "SELECT gi.id_gasto_insumo, gi.id_insumo, i.nombre_insumo, i.unidad_medida, gi.cantidad, gi.fecha_hora
             FROM gastos_insumos gi
             JOIN insumos i ON gi.id_insumo = i.id_insumo
             WHERE gi.id_jornada = ?
             ORDER BY gi.fecha_hora DESC, gi.id_gasto_insumo DESC"
        );
        $stmt->execute([$jornada['id_jornada']]);
        echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC), "id_jornada" => $jornada['id_jornada']]);
    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error al obtener gastos: " . $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $data = is_array($data) ? $data : [];
    $accion = isset($data['accion']) ? $data['accion'] : '';

    try {
        $pdo->beginTransaction();

        // Bloqueo compartido: el cierre de la jornada espera a que termine este gasto y viceversa.
        $jornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1 LOCK IN SHARE MODE")->fetch(PDO::FETCH_ASSOC);
        if (!$jornada) {
            throw new ErrorGasto('No hay una jornada activa.');
        }
        $id_jornada = intval($jornada['id_jornada']);

        // Gasto existente de la jornada abierta, bloqueado.
        $gastoDeJornada = function ($idGasto) use ($pdo, $id_jornada) {
            $stmt = $pdo->prepare("SELECT id_insumo, cantidad FROM gastos_insumos WHERE id_gasto_insumo = ? AND id_jornada = ? FOR UPDATE");
            $stmt->execute([$idGasto, $id_jornada]);
            $gasto = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$gasto) {
                throw new ErrorGasto('Solo se pueden modificar gastos de la jornada activa.');
            }
            return ['id_insumo' => intval($gasto['id_insumo']), 'cent' => intval(round(floatval($gasto['cantidad']) * 100))];
        };

        if ($accion === 'crear') {
            $id_insumo = intval($data['id_insumo'] ?? 0);
            if (!$id_insumo) throw new ErrorGasto('Elige un insumo.');
            $cent = centesimasGasto($data['cantidad'] ?? null);
            moverStockInsumo($pdo, $id_insumo, -$cent);
            $pdo->prepare("INSERT INTO gastos_insumos (id_jornada, id_insumo, cantidad, fecha_hora) VALUES (?, ?, ?, NOW())")
                ->execute([$id_jornada, $id_insumo, number_format($cent / 100, 2, '.', '')]);
            $id = $pdo->lastInsertId();
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto de insumo registrado y stock actualizado.", "id_gasto" => $id]);
            exit;
        }

        if ($accion === 'editar') {
            $id_gasto = intval($data['id_gasto'] ?? 0);
            $id_insumo = intval($data['id_insumo'] ?? 0);
            if (!$id_gasto || !$id_insumo) throw new ErrorGasto('Datos incompletos para editar.');
            $cent = centesimasGasto($data['cantidad'] ?? null);
            $viejo = $gastoDeJornada($id_gasto);

            // Movimientos por insumo, aplicados en orden de id para no cruzarse con otro gasto.
            $mov = [$viejo['id_insumo'] => $viejo['cent']];
            $mov[$id_insumo] = (isset($mov[$id_insumo]) ? $mov[$id_insumo] : 0) - $cent;
            ksort($mov);
            foreach ($mov as $id => $c) {
                moverStockInsumo($pdo, $id, $c);
            }
            $pdo->prepare("UPDATE gastos_insumos SET id_insumo = ?, cantidad = ? WHERE id_gasto_insumo = ?")
                ->execute([$id_insumo, number_format($cent / 100, 2, '.', ''), $id_gasto]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto actualizado y stock ajustado."]);
            exit;
        }

        if ($accion === 'eliminar') {
            $id_gasto = intval($data['id_gasto'] ?? 0);
            if (!$id_gasto) throw new ErrorGasto('ID de gasto requerido.');
            $viejo = $gastoDeJornada($id_gasto);
            moverStockInsumo($pdo, $viejo['id_insumo'], $viejo['cent']);
            $pdo->prepare("DELETE FROM gastos_insumos WHERE id_gasto_insumo = ?")->execute([$id_gasto]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto eliminado y stock del insumo restaurado."]);
            exit;
        }

        throw new ErrorGasto("Acción no reconocida: $accion");
    } catch (ErrorGasto $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => $e->getMessage()]);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        echo json_encode(["status" => "error", "message" => "Error transaccional: " . $e->getMessage()]);
    }
    exit;
}

echo json_encode(["status" => "error", "message" => "Método HTTP no permitido."]);
exit;
?>
