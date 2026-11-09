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

    // Parte de una venta que corresponde a mesas y a productos, en centavos.
    // El redondeo acompaña al tiempo de mesa; en una venta sin tiempo, a los productos.
    private static function partes(array $venta) {
        $mesas = self::centavos($venta['subtotal_mesas']);
        $productos = max(0, self::centavos($venta['subtotal_productos']) - self::centavos($venta['descuentos']));
        if ($mesas > 0) {
            $mesas += self::centavos($venta['redondeo']);
        } else {
            $productos += self::centavos($venta['redondeo']);
        }
        return [$mesas, $productos];
    }

    // Reparte los pagos de una venta. Si la venta cuadra, a mesas le toca exactamente su parte.
    private static function repartir(array $venta) {
        list($mesas, $productos) = self::partes($venta);
        $efectivo = self::centavos($venta['efectivo']);
        $qr = self::centavos($venta['qr']);
        $base = $mesas + $productos;

        $mesasTotal = $base > 0 ? (int) round(($efectivo + $qr) * $mesas / $base) : 0;
        $mesasEfectivo = min($base > 0 ? (int) round($efectivo * $mesas / $base) : 0, $mesasTotal);
        $mesasQr = $mesasTotal - $mesasEfectivo;
        if ($mesasQr > $qr) {
            $mesasQr = $qr;
            $mesasEfectivo = $mesasTotal - $qr;
        }
        return [
            'mesas_efectivo' => $mesasEfectivo,
            'mesas_qr' => $mesasQr,
            'productos_efectivo' => $efectivo - $mesasEfectivo,
            'productos_qr' => $qr - $mesasQr,
        ];
    }

    // Ingresos de la jornada por venta y totales de mesas y productos, separados por medio de pago.
    public static function ingresos($pdo, $idJornada) {
        $stmt = $pdo->prepare("
            SELECT v.id_venta, v.subtotal_mesas, v.subtotal_productos, v.descuentos, v.redondeo,
                   COALESCE(SUM(CASE WHEN p.metodo_pago = 'efectivo' THEN p.monto_pagado END), 0) AS efectivo,
                   COALESCE(SUM(CASE WHEN p.metodo_pago = 'qr' THEN p.monto_pagado END), 0) AS qr
            FROM ventas v
            LEFT JOIN pagos_venta p ON p.id_venta = v.id_venta
            WHERE v.id_jornada = ?
            GROUP BY v.id_venta
        ");
        $stmt->execute([$idJornada]);

        $porVenta = [];
        $suma = ['mesas_efectivo' => 0, 'mesas_qr' => 0, 'productos_efectivo' => 0, 'productos_qr' => 0];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $venta) {
            $reparto = self::repartir($venta);
            $porVenta[intval($venta['id_venta'])] = $reparto;
            foreach ($reparto as $clave => $centavos) $suma[$clave] += $centavos;
        }

        $bs = function ($centavos) {
            return round($centavos / 100, 2);
        };
        return [
            'ventas' => $porVenta,
            'mesas' => [
                'efectivo' => $bs($suma['mesas_efectivo']),
                'qr' => $bs($suma['mesas_qr']),
                'total' => $bs($suma['mesas_efectivo'] + $suma['mesas_qr']),
            ],
            'productos' => [
                'efectivo' => $bs($suma['productos_efectivo']),
                'qr' => $bs($suma['productos_qr']),
                'total' => $bs($suma['productos_efectivo'] + $suma['productos_qr']),
            ],
        ];
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

    // Inventario del turno por producto: inicial, cargas, vendido (cobrado y aún en mesas abiertas) y final.
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
            WHERE jia.id_jornada = ?
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
