<?php
// Cargas de mercadería (productos) y de insumos. Las dos pantallas del admin usan las mismas reglas:
// - una carga solo se modifica o anula mientras está activa, y solo desde la pantalla de su tipo;
// - el stock nunca queda negativo: si ya se vendió o usó lo cargado, la carga no se puede achicar;
// - los productos se cargan por unidades enteras; los insumos admiten hasta dos decimales.
// Las cantidades se manejan en centésimas (enteros) para no arrastrar errores de punto flotante.

class ErrorCarga extends Exception {}

class Cargas {
    const TIPOS = [
        'producto' => ['tabla' => 'productos', 'id' => 'id_producto', 'nombre' => 'nombre_producto', 'etiqueta' => 'producto', 'enteros' => true],
        'insumo' => ['tabla' => 'insumos', 'id' => 'id_insumo', 'nombre' => 'nombre_insumo', 'etiqueta' => 'insumo', 'enteros' => false],
    ];

    public static function listar($pdo, $tipo) {
        $stmt = $pdo->prepare("SELECT c.id_carga, c.fecha_hora, c.estado, COALESCE(SUM(dc.cantidad), 0) AS total_items
                               FROM cargas c
                               LEFT JOIN detalle_cargas dc ON c.id_carga = dc.id_carga
                               WHERE c.tipo_carga = ?
                               GROUP BY c.id_carga, c.fecha_hora, c.estado
                               ORDER BY c.id_carga DESC");
        $stmt->execute([$tipo]);
        return array_map(function ($fila) {
            $fila['total_items'] = floatval($fila['total_items']);
            return $fila;
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Líneas de la carga con las claves que espera la pantalla: {id_producto, producto, cantidad} o {id_insumo, insumo, cantidad}.
    public static function detalle($pdo, $tipo, $idCarga) {
        $t = self::TIPOS[$tipo];
        $stmt = $pdo->prepare("SELECT dc.{$t['id']} AS id, x.{$t['nombre']} AS nombre, dc.cantidad
                               FROM detalle_cargas dc
                               INNER JOIN cargas c ON c.id_carga = dc.id_carga
                               INNER JOIN {$t['tabla']} x ON x.{$t['id']} = dc.{$t['id']}
                               WHERE dc.id_carga = ? AND c.tipo_carga = ?
                               ORDER BY dc.id_detalle_carga");
        $stmt->execute([$idCarga, $tipo]);
        return array_map(function ($fila) use ($t) {
            return [
                $t['id'] => intval($fila['id']),
                $t['etiqueta'] => $fila['nombre'],
                'cantidad' => $t['enteros'] ? intval(round(floatval($fila['cantidad']))) : round(floatval($fila['cantidad']), 2),
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public static function historial($pdo, $tipo, $idCarga) {
        $stmt = $pdo->prepare("SELECT b.* FROM bitacora_cargas b
                               INNER JOIN cargas c ON c.id_carga = b.id_carga
                               WHERE b.id_carga = ? AND c.tipo_carga = ?
                               ORDER BY b.fecha_modificacion DESC, b.id_bitacora DESC");
        $stmt->execute([$idCarga, $tipo]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function crear($pdo, $tipo, $items, $idUsuario) {
        $nuevas = self::normalizar($tipo, $items);
        $pdo->beginTransaction();
        try {
            self::aplicar($pdo, $tipo, $nuevas, array_keys($nuevas));
            // La jornada se lee después de bloquear el stock. La apertura bloquea el stock antes de tomar su
            // foto: o la carga entra en la foto (y queda sin jornada) o se hace después y es del turno.
            // El bloqueo compartido además hace que el cierre espere a que termine la carga.
            $idJornada = $pdo->query("SELECT id_jornada FROM jornadas WHERE estado = 'abierta' ORDER BY id_jornada DESC LIMIT 1 LOCK IN SHARE MODE")->fetchColumn();
            $pdo->prepare("INSERT INTO cargas (tipo_carga, fecha_hora, estado, id_jornada) VALUES (?, NOW(), 'activo', ?)")
                ->execute([$tipo, $idJornada ? intval($idJornada) : null]);
            $idCarga = intval($pdo->lastInsertId());
            self::guardarLineas($pdo, $tipo, $idCarga, $nuevas);
            $pdo->commit();
            return $idCarga;
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    public static function modificar($pdo, $tipo, $idCarga, $items, $idUsuario) {
        $nuevas = self::normalizar($tipo, $items);
        $pdo->beginTransaction();
        try {
            self::bloquearActiva($pdo, $tipo, $idCarga);
            $antes = self::lineas($pdo, $tipo, $idCarga);
            $delta = $nuevas;
            foreach ($antes as $id => $cant) {
                $delta[$id] = (isset($delta[$id]) ? $delta[$id] : 0) - $cant;
            }
            // Solo se validan como "cargables" los ítems que la carga no tenía (un producto que se retiró
            // después puede quedar en la carga corregida).
            self::aplicar($pdo, $tipo, $delta, array_diff(array_keys($nuevas), array_keys($antes)));
            $pdo->prepare("DELETE FROM detalle_cargas WHERE id_carga = ?")->execute([$idCarga]);
            self::guardarLineas($pdo, $tipo, $idCarga, $nuevas);
            self::bitacora($pdo, $idCarga, $idUsuario, 'modificacion', [
                'antes' => self::paraBitacora($tipo, $antes),
                'ahora' => self::paraBitacora($tipo, $nuevas),
            ]);
            $pdo->commit();
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    public static function anular($pdo, $tipo, $idCarga, $idUsuario) {
        $pdo->beginTransaction();
        try {
            self::bloquearActiva($pdo, $tipo, $idCarga);
            $antes = self::lineas($pdo, $tipo, $idCarga);
            $delta = array_map(function ($c) { return -$c; }, $antes);
            self::aplicar($pdo, $tipo, $delta, []);
            $pdo->prepare("UPDATE cargas SET estado = 'anulado' WHERE id_carga = ?")->execute([$idCarga]);
            self::bitacora($pdo, $idCarga, $idUsuario, 'anulacion', [
                'razon' => 'Anulación completa',
                'devuelto' => self::paraBitacora($tipo, $antes),
            ]);
            $pdo->commit();
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    // Atiende la petición HTTP de cargas.php o cargas_insumos.php. El tipo lo fija el archivo, no el cliente.
    public static function atender($pdo, $tipo, $idUsuario) {
        $metodo = $_SERVER['REQUEST_METHOD'];
        $data = json_decode(file_get_contents('php://input'), true);
        $data = is_array($data) ? $data : [];
        $nombre = $tipo === 'producto' ? 'Carga' : 'Carga de insumos';
        try {
            if ($metodo === 'GET') {
                if (isset($_GET['action']) && $_GET['action'] === 'historial') {
                    return ['status' => 'success', 'data' => self::historial($pdo, $tipo, intval($_GET['id_carga'] ?? 0))];
                }
                if (isset($_GET['id_carga'])) {
                    return ['status' => 'success', 'data' => ['detalle' => self::detalle($pdo, $tipo, intval($_GET['id_carga']))]];
                }
                return ['status' => 'success', 'data' => self::listar($pdo, $tipo)];
            }
            if ($metodo === 'POST') {
                $id = self::crear($pdo, $tipo, $data['items'] ?? null, $idUsuario);
                return ['status' => 'success', 'message' => "$nombre registrada.", 'id_carga' => $id];
            }
            if ($metodo === 'PUT') {
                self::modificar($pdo, $tipo, intval($data['id_carga'] ?? 0), $data['items'] ?? null, $idUsuario);
                return ['status' => 'success', 'message' => "$nombre modificada."];
            }
            if ($metodo === 'DELETE') {
                self::anular($pdo, $tipo, intval($data['id_carga'] ?? 0), $idUsuario);
                return ['status' => 'success', 'message' => "$nombre anulada y stock revertido."];
            }
            http_response_code(405);
            return ['status' => 'error', 'message' => 'Método no permitido.'];
        } catch (ErrorCarga $e) {
            http_response_code(409);
            return ['status' => 'error', 'message' => $e->getMessage()];
        } catch (Exception $e) {
            http_response_code(500);
            return ['status' => 'error', 'message' => 'Error de base de datos: ' . $e->getMessage()];
        }
    }

    // [id => centésimas], sumando ítems repetidos. Rechaza cantidades no positivas o con más decimales de los permitidos.
    private static function normalizar($tipo, $items) {
        $t = self::TIPOS[$tipo];
        if (!is_array($items) || count($items) === 0) {
            throw new ErrorCarga('La carga no tiene ítems.');
        }
        $res = [];
        foreach ($items as $item) {
            $id = is_array($item) ? intval($item[$t['id']] ?? 0) : 0;
            $valor = is_array($item) && isset($item['cantidad']) && is_numeric($item['cantidad']) ? floatval($item['cantidad']) : 0;
            if ($id <= 0 || $valor <= 0) {
                throw new ErrorCarga("Cada ítem necesita un {$t['etiqueta']} y una cantidad mayor a cero.");
            }
            $cent = intval(round($valor * 100));
            if (abs($valor * 100 - $cent) > 0.001) {
                throw new ErrorCarga('Las cantidades admiten como máximo dos decimales.');
            }
            if ($t['enteros'] && $cent % 100 !== 0) {
                throw new ErrorCarga('Los productos se cargan por unidades enteras.');
            }
            $res[$id] = (isset($res[$id]) ? $res[$id] : 0) + $cent;
        }
        return $res;
    }

    private static function bloquearActiva($pdo, $tipo, $idCarga) {
        $stmt = $pdo->prepare("SELECT tipo_carga, estado FROM cargas WHERE id_carga = ? FOR UPDATE");
        $stmt->execute([$idCarga]);
        $carga = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$carga || $carga['tipo_carga'] !== $tipo) {
            throw new ErrorCarga('La carga no existe.');
        }
        if ($carga['estado'] !== 'activo') {
            throw new ErrorCarga('La carga ya está anulada: no se puede modificar ni anular de nuevo.');
        }
    }

    private static function lineas($pdo, $tipo, $idCarga) {
        $t = self::TIPOS[$tipo];
        $stmt = $pdo->prepare("SELECT {$t['id']} AS id, SUM(cantidad) AS cantidad FROM detalle_cargas WHERE id_carga = ? AND {$t['id']} IS NOT NULL GROUP BY {$t['id']}");
        $stmt->execute([$idCarga]);
        $res = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $fila) {
            $res[intval($fila['id'])] = intval(round(floatval($fila['cantidad']) * 100));
        }
        return $res;
    }

    // Suma $delta (centésimas) al stock. Bloquea las filas en orden de id para no cruzarse con otra
    // carga o venta, y valida que existan, que $nuevos se puedan cargar y que nada quede negativo.
    private static function aplicar($pdo, $tipo, array $delta, array $nuevos) {
        $t = self::TIPOS[$tipo];
        $ids = array_keys($delta);
        sort($ids);
        $columnas = $tipo === 'producto' ? ', tipo, activo' : '';
        $leer = $pdo->prepare("SELECT {$t['nombre']} AS nombre, stock_actual{$columnas} FROM {$t['tabla']} WHERE {$t['id']} = ? FOR UPDATE");
        $sumar = $pdo->prepare("UPDATE {$t['tabla']} SET stock_actual = stock_actual + ? WHERE {$t['id']} = ?");
        foreach ($ids as $id) {
            $leer->execute([$id]);
            $fila = $leer->fetch(PDO::FETCH_ASSOC);
            if (!$fila) {
                throw new ErrorCarga("El {$t['etiqueta']} #$id no existe.");
            }
            if ($tipo === 'producto' && in_array($id, $nuevos, true)) {
                if ($fila['tipo'] === 'preparado') {
                    throw new ErrorCarga("{$fila['nombre']} es un preparado: no lleva stock.");
                }
                if (intval($fila['activo']) !== 1) {
                    throw new ErrorCarga("{$fila['nombre']} está retirado: no se le carga stock.");
                }
            }
            if ($delta[$id] === 0) continue;
            $stock = intval(round(floatval($fila['stock_actual']) * 100));
            if ($stock + $delta[$id] < 0) {
                throw new ErrorCarga(sprintf(
                    'No alcanza el stock de %s: quedan %s y el cambio quita %s. Lo cargado ya se vendió o se usó.',
                    $fila['nombre'], self::texto($stock, $t['enteros']), self::texto(-$delta[$id], $t['enteros'])
                ));
            }
            $sumar->execute([self::decimal($delta[$id]), $id]);
        }
    }

    private static function guardarLineas($pdo, $tipo, $idCarga, array $cantidades) {
        $t = self::TIPOS[$tipo];
        $stmt = $pdo->prepare("INSERT INTO detalle_cargas (id_carga, {$t['id']}, cantidad) VALUES (?, ?, ?)");
        foreach ($cantidades as $id => $cent) {
            $stmt->execute([$idCarga, $id, self::decimal($cent)]);
        }
    }

    private static function bitacora($pdo, $idCarga, $idUsuario, $accion, $detalle) {
        $pdo->prepare("INSERT INTO bitacora_cargas (id_carga, id_usuario, accion, fecha_modificacion, detalle_cambios) VALUES (?, ?, ?, NOW(), ?)")
            ->execute([$idCarga, $idUsuario, $accion, json_encode($detalle, JSON_UNESCAPED_UNICODE)]);
    }

    private static function paraBitacora($tipo, array $cantidades) {
        $t = self::TIPOS[$tipo];
        $res = [];
        foreach ($cantidades as $id => $cent) {
            $res[] = [$t['id'] => $id, 'cantidad' => $cent / 100];
        }
        return $res;
    }

    private static function decimal($cent) {
        return number_format($cent / 100, 2, '.', '');
    }

    private static function texto($cent, $enteros) {
        return $enteros ? strval(intdiv($cent, 100)) : rtrim(rtrim(self::decimal($cent), '0'), '.');
    }
}
?>
