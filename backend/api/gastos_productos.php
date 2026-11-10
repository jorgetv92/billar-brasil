<?php
// api/gastos_productos.php — productos con receta que se gastan al preparar en barra (botella de ron para los vasos).
// Descuentan stock y entran en el cuadre de inventario del turno.
//
// Modo atención (portal de atención): solo la jornada abierta. Como el resto de las APIs de atención, no exige la
// sesión PHP (vence a los 24 minutos sin uso); el usuario que registra llega desde el navegador.
// Modo administrador (alcance=todos, portal de administración): exige la sesión de administrador; ve todos los gastos
// y puede registrar uno olvidado: queda en la jornada abierta, o sin jornada si no hay ninguna.
// Solo se corrigen o borran gastos del periodo en curso (la jornada abierta, o los registrados después del último
// cierre si no hay jornada abierta): lo de un turno cerrado ya está en su reporte y en su cuadre.
date_default_timezone_set('America/La_Paz');
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");

include_once '../config/database.php';
session_start();
$rolSesion = isset($_SESSION['rol']) ? $_SESSION['rol'] : null;
$idUsuarioSesion = isset($_SESSION['id_usuario']) ? intval($_SESSION['id_usuario']) : 0;
session_write_close();

$method = $_SERVER['REQUEST_METHOD'];
$data = [];
if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"), true);
    $data = is_array($data) ? $data : [];
}
$alcance = $method === 'POST' ? ($data['alcance'] ?? '') : ($_GET['alcance'] ?? '');
$esAdmin = $alcance === 'todos';
if ($esAdmin && $rolSesion !== 'administrador') {
    http_response_code(403);
    echo json_encode(["status" => "error", "message" => "Sesión no válida. Vuelva a iniciar sesión como administrador."]);
    exit;
}

class ErrorGasto extends Exception {}

$database = new Database();
$pdo = $database->getConnection();
if (!$pdo) {
    echo json_encode(["status" => "error", "message" => "Error de conexión a la base de datos."]);
    exit;
}

// Quién registra: el de la sesión si sigue vigente; si no, el que inició sesión en ese navegador.
function usuarioQueRegistra($pdo, $idSesion, $data) {
    $id = $idSesion ?: intval($data['id_usuario'] ?? 0);
    $stmt = $pdo->prepare("SELECT 1 FROM usuarios WHERE id_usuario = ?");
    $stmt->execute([$id]);
    if (!$id || !$stmt->fetchColumn()) {
        throw new ErrorGasto('No se identificó al usuario. Cierra sesión y vuelve a ingresar.');
    }
    return $id;
}

// Cantidad entera mayor a cero (el stock de productos es en unidades).
function unidadesGasto($valor) {
    $num = is_numeric($valor) ? floatval($valor) : 0;
    if ($num <= 0 || floor($num) != $num) {
        throw new ErrorGasto('Ingresa una cantidad entera mayor a cero.');
    }
    return intval($num);
}

// Suma $cant (puede ser negativo) al stock del producto, bloqueándolo.
function moverStockProducto($pdo, $idProducto, $cant) {
    $stmt = $pdo->prepare("SELECT nombre_producto, stock_actual FROM productos WHERE id_producto = ? FOR UPDATE");
    $stmt->execute([$idProducto]);
    $prod = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$prod) {
        throw new ErrorGasto('Producto no encontrado.');
    }
    if (intval($prod['stock_actual']) + $cant < 0) {
        throw new ErrorGasto(sprintf('Stock insuficiente. Disponible: %d de %s.', intval($prod['stock_actual']), $prod['nombre_producto']));
    }
    $pdo->prepare("UPDATE productos SET stock_actual = stock_actual + ? WHERE id_producto = ?")->execute([$cant, $idProducto]);
}

// El producto debe tener receta, estar activo y llevar stock.
function validarProductoReceta($pdo, $idProducto) {
    $stmt = $pdo->prepare("SELECT nombre_producto, receta, activo, tipo FROM productos WHERE id_producto = ?");
    $stmt->execute([$idProducto]);
    $p = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ErrorGasto('Producto no encontrado.');
    if (!intval($p['receta']) || $p['tipo'] !== 'inventario') {
        throw new ErrorGasto("{$p['nombre_producto']} no tiene la propiedad receta: su gasto no se registra aquí.");
    }
    if (!intval($p['activo'])) throw new ErrorGasto("{$p['nombre_producto']} está retirado.");
}

// Jornada abierta (o null) y fecha del último cierre: definen qué gastos se pueden corregir.
function periodoActual($pdo, $bloquear = false) {
    $sql = "SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1" . ($bloquear ? " LOCK IN SHARE MODE" : "");
    $abierta = $pdo->query($sql)->fetchColumn();
    $ultimoCierre = $pdo->query("SELECT MAX(fecha_hora_cierre) FROM jornadas WHERE estado <> 'abierta'")->fetchColumn();
    return [$abierta ? intval($abierta) : null, $ultimoCierre ?: null];
}

function esEditable(array $gasto, $idAbierta, $ultimoCierre) {
    if ($idAbierta) return intval($gasto['id_jornada']) === $idAbierta;
    return $gasto['id_jornada'] === null && ($ultimoCierre === null || $gasto['fecha_hora'] >= $ultimoCierre);
}

if ($method === 'GET') {
    $accion = isset($_GET['accion']) ? $_GET['accion'] : 'listar';
    try {
        if ($accion === 'get_productos') {
            $stmt = $pdo->query("SELECT id_producto, nombre_producto, stock_actual FROM productos
                                 WHERE receta = 1 AND activo = 1 AND tipo = 'inventario' ORDER BY nombre_producto ASC");
            echo json_encode(["status" => "success", "data" => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            exit;
        }

        list($idAbierta, $ultimoCierre) = periodoActual($pdo);
        $todos = $esAdmin;
        if (!$todos && !$idAbierta) {
            echo json_encode(["status" => "sin_jornada", "data" => [], "message" => "No hay jornada activa."]);
            exit;
        }

        $sql = "SELECT g.id_gasto_producto, g.id_jornada, g.id_producto, p.nombre_producto, g.cantidad, g.fecha_hora,
                       COALESCE(CONCAT(u.nombres, ' ', u.apellidos), CONCAT('Usuario #', g.id_usuario)) AS usuario
                FROM gastos_productos g
                JOIN productos p ON p.id_producto = g.id_producto
                LEFT JOIN usuarios u ON u.id_usuario = g.id_usuario";
        if ($todos) {
            $stmt = $pdo->query($sql . " ORDER BY g.fecha_hora DESC, g.id_gasto_producto DESC");
        } else {
            $stmt = $pdo->prepare($sql . " WHERE g.id_jornada = ? ORDER BY g.fecha_hora DESC, g.id_gasto_producto DESC");
            $stmt->execute([$idAbierta]);
        }
        $filas = array_map(function ($g) use ($idAbierta, $ultimoCierre) {
            $g['editable'] = esEditable($g, $idAbierta, $ultimoCierre);
            return $g;
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        echo json_encode(["status" => "success", "data" => $filas, "id_jornada" => $idAbierta]);
    } catch (PDOException $e) {
        echo json_encode(["status" => "error", "message" => "Error al obtener gastos: " . $e->getMessage()]);
    }
    exit;
}

if ($method === 'POST') {
    $accion = isset($data['accion']) ? $data['accion'] : '';

    try {
        $pdo->beginTransaction();

        // Bloqueo compartido: el cierre de la jornada espera a que termine este gasto y viceversa.
        list($idAbierta, $ultimoCierre) = periodoActual($pdo, true);
        // Sin jornada abierta solo el administrador puede registrar o corregir gastos.
        if (!$idAbierta && !$esAdmin) {
            throw new ErrorGasto('No hay una jornada activa.');
        }

        // Gasto existente del periodo en curso, bloqueado.
        $gastoEditable = function ($idGasto) use ($pdo, $idAbierta, $ultimoCierre) {
            $stmt = $pdo->prepare("SELECT id_jornada, id_producto, cantidad, fecha_hora FROM gastos_productos WHERE id_gasto_producto = ? FOR UPDATE");
            $stmt->execute([$idGasto]);
            $gasto = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$gasto) throw new ErrorGasto('Gasto no encontrado.');
            if (!esEditable($gasto, $idAbierta, $ultimoCierre)) {
                throw new ErrorGasto('Este gasto pertenece a una jornada cerrada: ya está en su reporte y no se puede modificar.');
            }
            return ['id_producto' => intval($gasto['id_producto']), 'cantidad' => intval($gasto['cantidad'])];
        };

        if ($accion === 'crear') {
            $idProducto = intval($data['id_producto'] ?? 0);
            if (!$idProducto) throw new ErrorGasto('Elige un producto.');
            $cant = unidadesGasto($data['cantidad'] ?? null);
            $idUsuario = usuarioQueRegistra($pdo, $idUsuarioSesion, $data);
            validarProductoReceta($pdo, $idProducto);
            moverStockProducto($pdo, $idProducto, -$cant);
            $pdo->prepare("INSERT INTO gastos_productos (id_jornada, id_producto, cantidad, id_usuario, fecha_hora) VALUES (?, ?, ?, ?, NOW())")
                ->execute([$idAbierta, $idProducto, $cant, $idUsuario]);
            $id = $pdo->lastInsertId();
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto de producto registrado y stock actualizado.", "id_gasto" => $id]);
            exit;
        }

        if ($accion === 'editar') {
            $idGasto = intval($data['id_gasto'] ?? 0);
            $idProducto = intval($data['id_producto'] ?? 0);
            if (!$idGasto || !$idProducto) throw new ErrorGasto('Datos incompletos para editar.');
            $cant = unidadesGasto($data['cantidad'] ?? null);
            $viejo = $gastoEditable($idGasto);
            // Se puede corregir la cantidad de un producto que ya no tiene receta; cambiar a otro exige que la tenga.
            if ($idProducto !== $viejo['id_producto']) validarProductoReceta($pdo, $idProducto);

            // Movimientos por producto, aplicados en orden de id para no cruzarse con otra operación.
            $mov = [$viejo['id_producto'] => $viejo['cantidad']];
            $mov[$idProducto] = (isset($mov[$idProducto]) ? $mov[$idProducto] : 0) - $cant;
            ksort($mov);
            foreach ($mov as $id => $c) {
                if ($c !== 0) moverStockProducto($pdo, $id, $c);
            }
            $pdo->prepare("UPDATE gastos_productos SET id_producto = ?, cantidad = ? WHERE id_gasto_producto = ?")
                ->execute([$idProducto, $cant, $idGasto]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto actualizado y stock ajustado."]);
            exit;
        }

        if ($accion === 'eliminar') {
            $idGasto = intval($data['id_gasto'] ?? 0);
            if (!$idGasto) throw new ErrorGasto('ID de gasto requerido.');
            $viejo = $gastoEditable($idGasto);
            moverStockProducto($pdo, $viejo['id_producto'], $viejo['cantidad']);
            $pdo->prepare("DELETE FROM gastos_productos WHERE id_gasto_producto = ?")->execute([$idGasto]);
            $pdo->commit();
            echo json_encode(["status" => "success", "message" => "Gasto eliminado y stock del producto restaurado."]);
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
