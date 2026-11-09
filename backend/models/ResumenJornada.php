<?php
// Cifras de una jornada para el pre-cierre, el reporte de cierre, el reporte del admin y el dashboard.
// Todos leen de aquí para que muestren lo mismo.
//
// Lo cobrado (pagos_venta) se reparte entre mesas y productos según la parte de cada uno en la venta.
// Así Mesas + Productos = lo que entró a caja, también en ventas anteriores al motor de cobro.
class ResumenJornada {

    private static function centavos($bs) {
        return (int) round(floatval($bs) * 100);
    }

    // Parte de una venta que corresponde a mesas, productos y otros cargos, en centavos.
    // Lo pagado por la hora gratis es tiempo de mesa. El redondeo acompaña al tiempo; en una venta sin tiempo,
    // a los productos, y si tampoco hay productos, a los cargos.
    private static function partes(array $venta) {
        $mesas = self::centavos($venta['subtotal_mesas']) + self::centavos($venta['cargos_hora']);
        $productos = max(0, self::centavos($venta['subtotal_productos']) - self::centavos($venta['descuentos']));
        $cargos = self::centavos($venta['cargos_otros']);
        $redondeo = self::centavos($venta['redondeo']);
        if ($mesas > 0) {
            $mesas += $redondeo;
        } elseif ($productos > 0) {
            $productos += $redondeo;
        } else {
            $cargos += $redondeo;
        }
        return [$mesas, $productos, $cargos];
    }

    // Reparte $monto en proporción a $pesos con el método del mayor resto: las partes suman exactamente $monto.
    // Sin pesos, todo va a la parte $porDefecto.
    private static function repartirMonto($monto, array $pesos, $porDefecto) {
        $base = array_sum($pesos);
        $partes = array_fill(0, count($pesos), 0);
        if ($base <= 0) {
            $partes[$porDefecto] = $monto;
            return $partes;
        }
        $restos = [];
        foreach ($pesos as $k => $peso) {
            $exacto = $monto * $peso / $base;
            $partes[$k] = (int) floor($exacto);
            $restos[$k] = $exacto - $partes[$k];
        }
        $faltan = $monto - array_sum($partes);
        arsort($restos);
        foreach (array_keys($restos) as $k) {
            if ($faltan <= 0) break;
            $partes[$k]++;
            $faltan--;
        }
        return $partes;
    }

    // Reparte los pagos de una venta. Si la venta cuadra, a cada parte le toca exactamente lo suyo.
    private static function repartir(array $venta) {
        $pesos = self::partes($venta);
        $efectivo = self::centavos($venta['efectivo']);
        $qr = self::centavos($venta['qr']);
        $porDefecto = $venta['id_sesion'] ? 0 : 1;
        $totales = self::repartirMonto($efectivo + $qr, $pesos, $porDefecto);
        // El efectivo se reparte con el mismo peso que lo cobrado: ninguna parte recibe más de lo que le toca.
        $enEfectivo = self::repartirMonto($efectivo, $totales, $porDefecto);
        return [
            'mesas_efectivo' => $enEfectivo[0],
            'mesas_qr' => $totales[0] - $enEfectivo[0],
            'productos_efectivo' => $enEfectivo[1],
            'productos_qr' => $totales[1] - $enEfectivo[1],
            'cargos_efectivo' => $enEfectivo[2],
            'cargos_qr' => $totales[2] - $enEfectivo[2],
        ];
    }

    // Ingresos de la jornada por venta y totales de mesas, productos y cargos, separados por medio de pago.
    public static function ingresos($pdo, $idJornada) {
        $stmt = $pdo->prepare("
            SELECT v.id_venta, v.id_sesion, v.subtotal_mesas, v.subtotal_productos, v.descuentos, v.redondeo,
                   COALESCE((SELECT SUM(c.monto) FROM cargos_venta c WHERE c.id_venta = v.id_venta AND c.tipo = 'hora_gratis'), 0) AS cargos_hora,
                   COALESCE((SELECT SUM(c.monto) FROM cargos_venta c WHERE c.id_venta = v.id_venta AND c.tipo <> 'hora_gratis'), 0) AS cargos_otros,
                   COALESCE((SELECT SUM(p.monto_pagado) FROM pagos_venta p WHERE p.id_venta = v.id_venta AND p.metodo_pago = 'efectivo'), 0) AS efectivo,
                   COALESCE((SELECT SUM(p.monto_pagado) FROM pagos_venta p WHERE p.id_venta = v.id_venta AND p.metodo_pago = 'qr'), 0) AS qr
            FROM ventas v
            WHERE v.id_jornada = ?
        ");
        $stmt->execute([$idJornada]);

        $porVenta = [];
        $suma = ['mesas_efectivo' => 0, 'mesas_qr' => 0, 'productos_efectivo' => 0, 'productos_qr' => 0, 'cargos_efectivo' => 0, 'cargos_qr' => 0];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $venta) {
            $reparto = self::repartir($venta);
            $porVenta[intval($venta['id_venta'])] = $reparto;
            foreach ($reparto as $clave => $centavos) $suma[$clave] += $centavos;
        }

        $parte = function ($nombre) use ($suma) {
            return [
                'efectivo' => round($suma[$nombre . '_efectivo'] / 100, 2),
                'qr' => round($suma[$nombre . '_qr'] / 100, 2),
                'total' => round(($suma[$nombre . '_efectivo'] + $suma[$nombre . '_qr']) / 100, 2),
            ];
        };
        return ['ventas' => $porVenta, 'mesas' => $parte('mesas'), 'productos' => $parte('productos'), 'cargos' => $parte('cargos')];
    }

    // Segundos jugados en mesas con tarifa. Un tramo en pausa cuenta hasta la pausa; uno en curso, hasta ahora.
    public static function segundosJugados($pdo, $idJornada) {
        $stmt = $pdo->prepare("
            SELECT COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, tr.fecha_hora_inicio,
                       COALESCE(tr.fecha_hora_fin, tr.fecha_hora_pausa, NOW())))), 0)
            FROM tramos_mesas tr
            INNER JOIN sesiones_juego s ON tr.id_sesion = s.id_sesion
            INNER JOIN mesas m ON tr.id_mesa = m.id_mesa
            INNER JOIN tipos_mesa tm ON m.id_tipo_mesa = tm.id_tipo_mesa
            WHERE s.id_jornada = ? AND tm.precio_hora > 0
        ");
        $stmt->execute([$idJornada]);
        return (int) $stmt->fetchColumn();
    }

    // Preparados vendidos en la jornada (cócteles, vasos): no tienen stock, pero sí son venta de productos.
    public static function preparados($pdo, $idJornada) {
        $stmt = $pdo->prepare("
            SELECT p.nombre_producto, SUM(dv.cantidad) AS vendido, SUM(dv.cantidad * dv.precio_unitario_aplicado) AS importe_vendido
            FROM detalle_venta_productos dv
            INNER JOIN ventas v ON v.id_venta = dv.id_venta
            INNER JOIN productos p ON p.id_producto = dv.id_producto
            WHERE v.id_jornada = ? AND p.tipo = 'preparado'
            GROUP BY p.id_producto, p.nombre_producto
            ORDER BY p.nombre_producto
        ");
        $stmt->execute([$idJornada]);
        return array_map(function ($f) {
            return ['nombre_producto' => $f['nombre_producto'], 'vendido' => intval($f['vendido']), 'importe_vendido' => round(floatval($f['importe_vendido']), 2)];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    // Inventario del turno por producto: inicial, cargas, vendido (cobrado y aún en mesas abiertas) y final.
    // Solo productos con stock: los preparados no se cuentan, y los retirados solo si se movieron en el turno.
    // "ajuste" es lo que no explican las ventas ni las cargas (por ejemplo, un cambio manual de stock).
    // Necesita la foto de apertura, que se borra al cerrar la jornada.
    public static function inventario($pdo, $idJornada, $apertura, $cierre = null) {
        $stmt = $pdo->prepare("
            SELECT p.id_producto, p.nombre_producto,
                   jia.stock_apertura AS stock_inicial,
                   COALESCE(c.cantidad, 0) AS cargas,
                   COALESCE(v.cantidad, 0) AS vendido,
                   COALESCE(v.importe, 0) AS importe_vendido,
                   COALESCE(m.cantidad, 0) AS en_mesas,
                   p.precio_venta AS precio_unitario,
                   p.stock_actual AS stock_final
            FROM jornada_inventario_apertura jia
            INNER JOIN productos p ON jia.id_producto = p.id_producto
            LEFT JOIN (
                SELECT dv.id_producto, SUM(dv.cantidad) AS cantidad, SUM(dv.cantidad * dv.precio_unitario_aplicado) AS importe
                FROM detalle_venta_productos dv
                INNER JOIN ventas vt ON dv.id_venta = vt.id_venta
                WHERE vt.id_jornada = ?
                GROUP BY dv.id_producto
            ) v ON v.id_producto = p.id_producto
            LEFT JOIN (
                SELECT dv.id_producto, SUM(dv.cantidad) AS cantidad
                FROM detalle_venta_productos dv
                INNER JOIN sesiones_juego s ON dv.id_sesion = s.id_sesion
                WHERE dv.id_venta IS NULL AND s.estado = 'activa' AND s.id_jornada = ?
                GROUP BY dv.id_producto
            ) m ON m.id_producto = p.id_producto
            LEFT JOIN (
                SELECT dc.id_producto, SUM(dc.cantidad) AS cantidad
                FROM detalle_cargas dc
                INNER JOIN cargas cg ON cg.id_carga = dc.id_carga
                WHERE cg.tipo_carga = 'producto' AND cg.estado = 'activo'
                  AND cg.fecha_hora >= ? AND cg.fecha_hora <= COALESCE(?, NOW())
                GROUP BY dc.id_producto
            ) c ON c.id_producto = p.id_producto
            WHERE jia.id_jornada = ? AND p.tipo = 'inventario'
              AND (p.activo = 1 OR COALESCE(v.cantidad, 0) > 0 OR COALESCE(c.cantidad, 0) > 0 OR COALESCE(m.cantidad, 0) > 0)
            ORDER BY p.nombre_producto
        ");
        $stmt->execute([$idJornada, $idJornada, $apertura, $cierre, $idJornada]);

        return array_map(function ($fila) {
            $inicial = intval($fila['stock_inicial']);
            $cargas = intval($fila['cargas']);
            $vendido = intval($fila['vendido']);
            $enMesas = intval($fila['en_mesas']);
            $final = intval($fila['stock_final']);
            return [
                'id_producto' => intval($fila['id_producto']),
                'nombre_producto' => $fila['nombre_producto'],
                'stock_inicial' => $inicial,
                'cargas' => $cargas,
                'vendido' => $vendido,
                'en_mesas' => $enMesas,
                // Importe a los precios con que se vendió (promos de precio incluidas, sin 2x1)
                'importe_vendido' => round(floatval($fila['importe_vendido']), 2),
                'precio_unitario' => floatval($fila['precio_unitario']),
                'stock_final' => $final,
                'ajuste' => $final - ($inicial + $cargas - $vendido - $enMesas),
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
    }
}
?>
