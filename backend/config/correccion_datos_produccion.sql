-- Corrección de datos de producción antes de usar el nuevo motor de cobro.
-- Ejecutar una sola vez, después de las 4 migraciones y antes de limpieza_sesiones_huerfanas.sql.
-- Respaldar la base antes. Puede ejecutarse de nuevo sin efecto: cada paso busca los casos por regla.
--
-- Corrige datos que dejaron errores del sistema anterior:
--   1. Cobros de mesa registrados varias veces en el mismo segundo (doble envío).
--   2. Ventas de barra idénticas registradas dos veces en el mismo segundo (doble clic).
--   3. Partidas olvidadas abiertas días o meses, cobradas por un monto pequeño.
--   4. Horas de pausa o de fin anteriores al inicio del tramo (desfase de zona horaria en el hosting).
--   5. Catálogo: vasos preparados sin stock, la rotura como cargo y productos que ya no se venden.
--
-- No corrige, a propósito, las ventas donde lo pagado no coincide con el total: los reportes nuevos usan
-- lo que realmente se pagó. Tampoco cambia el stock actual (ver el punto 2).

START TRANSACTION;

-- Lo que se va a corregir, para revisar antes de confirmar
SELECT 'mesa duplicada' AS caso, v.id_venta, v.id_sesion, v.fecha_hora_venta, v.total_pagar
FROM ventas v
WHERE v.id_sesion IS NOT NULL
  AND EXISTS (SELECT 1 FROM ventas o WHERE o.id_sesion = v.id_sesion AND o.fecha_hora_venta = v.fecha_hora_venta AND o.id_venta < v.id_venta)
  AND NOT EXISTS (SELECT 1 FROM detalle_venta_productos d WHERE d.id_venta = v.id_venta);

-- ---------------------------------------------------------------------------------------------
-- 1. Cobros de mesa duplicados: se conserva la primera venta de la partida. Si quedó sin pagos,
--    recibe los de la primera copia. Las copias no tienen productos y se borran con sus pagos.
-- ---------------------------------------------------------------------------------------------
CREATE TEMPORARY TABLE corr_dup_mesa AS
SELECT v.id_venta,
       (SELECT MIN(o.id_venta) FROM ventas o WHERE o.id_sesion = v.id_sesion AND o.fecha_hora_venta = v.fecha_hora_venta) AS original
FROM ventas v
WHERE v.id_sesion IS NOT NULL
  AND EXISTS (SELECT 1 FROM ventas o WHERE o.id_sesion = v.id_sesion AND o.fecha_hora_venta = v.fecha_hora_venta AND o.id_venta < v.id_venta)
  AND NOT EXISTS (SELECT 1 FROM detalle_venta_productos d WHERE d.id_venta = v.id_venta);

CREATE TEMPORARY TABLE corr_mover_pagos AS
SELECT d.original, MIN(d.id_venta) AS copia
FROM corr_dup_mesa d
WHERE NOT EXISTS (SELECT 1 FROM pagos_venta p WHERE p.id_venta = d.original)
GROUP BY d.original;

UPDATE pagos_venta p JOIN corr_mover_pagos m ON p.id_venta = m.copia SET p.id_venta = m.original;
DELETE v FROM ventas v JOIN corr_dup_mesa d ON d.id_venta = v.id_venta;

-- ---------------------------------------------------------------------------------------------
-- 2. Ventas de barra duplicadas: mismos productos, cantidades, precios y pagos en el mismo segundo.
--    Se conserva la primera. El stock actual no se toca: si ya hubo conteos o ajustes desde entonces,
--    devolver esas unidades lo descuadraría. Conviene contar los productos afectados.
-- ---------------------------------------------------------------------------------------------
CREATE TEMPORARY TABLE corr_firma_barra AS
SELECT v.id_venta, v.id_jornada, v.fecha_hora_venta, v.total_pagar,
       (SELECT GROUP_CONCAT(CONCAT(d.id_producto, 'x', d.cantidad, '@', d.precio_unitario_aplicado) ORDER BY d.id_producto, d.cantidad, d.precio_unitario_aplicado)
        FROM detalle_venta_productos d WHERE d.id_venta = v.id_venta) AS productos,
       (SELECT GROUP_CONCAT(CONCAT(p.metodo_pago, ' ', p.monto_pagado) ORDER BY p.metodo_pago, p.monto_pagado)
        FROM pagos_venta p WHERE p.id_venta = v.id_venta) AS pagos
FROM ventas v
WHERE v.id_sesion IS NULL;

CREATE TEMPORARY TABLE corr_firma_barra_2 AS SELECT * FROM corr_firma_barra;

CREATE TEMPORARY TABLE corr_dup_barra AS
SELECT DISTINCT b.id_venta
FROM corr_firma_barra a
JOIN corr_firma_barra_2 b
  ON b.id_venta > a.id_venta AND b.id_jornada = a.id_jornada AND b.fecha_hora_venta = a.fecha_hora_venta
 AND b.total_pagar = a.total_pagar AND b.productos = a.productos AND b.pagos <=> a.pagos;

SELECT 'barra duplicada' AS caso, f.id_venta, f.fecha_hora_venta, f.productos, f.pagos
FROM corr_firma_barra f JOIN corr_dup_barra d ON d.id_venta = f.id_venta;

DELETE v FROM ventas v JOIN corr_dup_barra d ON d.id_venta = v.id_venta;

-- ---------------------------------------------------------------------------------------------
-- 3. Partidas de más de 24 horas cobradas por un monto pequeño: eran partidas olvidadas que el
--    sistema anterior dejó abiertas. El total queda en lo que realmente se pagó y la duración del
--    tramo se ajusta a ese monto con la tarifa de lista, para que los reportes no sumen cientos de horas.
--    Solo partidas de un tramo, sin productos y con lo pagado menor al tiempo registrado.
-- ---------------------------------------------------------------------------------------------
CREATE TEMPORARY TABLE corr_largas AS
SELECT v.id_venta, t.id_tramo, tm.precio_hora,
       (SELECT COALESCE(SUM(p.monto_pagado), 0) FROM pagos_venta p WHERE p.id_venta = v.id_venta) AS pagado
FROM ventas v
JOIN tramos_mesas t ON t.id_sesion = v.id_sesion
JOIN mesas m ON m.id_mesa = t.id_mesa
JOIN tipos_mesa tm ON tm.id_tipo_mesa = m.id_tipo_mesa
WHERE v.subtotal_productos = 0
  AND (SELECT COUNT(*) FROM tramos_mesas x WHERE x.id_sesion = v.id_sesion) = 1
  AND TIMESTAMPDIFF(HOUR, t.fecha_hora_inicio, t.fecha_hora_fin) >= 24
  AND tm.precio_hora > 0
  AND (SELECT COALESCE(SUM(p.monto_pagado), 0) FROM pagos_venta p WHERE p.id_venta = v.id_venta) < v.subtotal_mesas;

SELECT 'partida olvidada' AS caso, c.id_venta, c.id_tramo, c.pagado, v.subtotal_mesas, t.fecha_hora_inicio, t.fecha_hora_fin
FROM corr_largas c JOIN ventas v USING (id_venta) JOIN tramos_mesas t USING (id_tramo);

UPDATE ventas v JOIN corr_largas c USING (id_venta)
SET v.subtotal_mesas = c.pagado, v.total_pagar = c.pagado;

UPDATE tramos_mesas t JOIN corr_largas c USING (id_tramo)
SET t.fecha_hora_inicio = t.fecha_hora_fin - INTERVAL (CEIL(c.pagado / c.precio_hora * 12) * 5) MINUTE,
    t.fecha_hora_pausa = NULL,
    t.importe_tramo = c.pagado;

-- ---------------------------------------------------------------------------------------------
-- 4. Fechas al revés en tramos ya cerrados. La pausa de un tramo cerrado ya no se usa; un fin
--    anterior al inicio deja el tramo en 0 minutos, que es lo que se cobró.
-- ---------------------------------------------------------------------------------------------
UPDATE tramos_mesas SET fecha_hora_pausa = NULL
WHERE fecha_hora_fin IS NOT NULL AND fecha_hora_pausa < fecha_hora_inicio;

UPDATE tramos_mesas SET fecha_hora_fin = fecha_hora_inicio
WHERE fecha_hora_fin < fecha_hora_inicio;

-- ---------------------------------------------------------------------------------------------
-- 5. Catálogo (necesita migracion_productos_cargos_combos.sql).
--    Los vasos se preparan en la barra: dejan de llevar stock (el que tenían era inventado para poder venderlos).
--    "Vaso o botella rota" pasa a ser un concepto de cargo con monto sugerido de Bs 8, y el producto se retira.
--    "Promo 2x30 amstel" se retira: no se puede borrar porque tiene ventas; el combo se crea como promoción.
--    "Cuba libre" queda como está hasta consultarlo con el dueño.
-- ---------------------------------------------------------------------------------------------
UPDATE productos SET tipo = 'preparado', stock_actual = 0
WHERE nombre_producto IN ('Vaso de Fernet', 'Vaso de flor de caña') AND tipo = 'inventario';

INSERT INTO conceptos_cargo (nombre, monto_sugerido)
SELECT 'Vaso o botella rota', 8.00 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM conceptos_cargo WHERE nombre = 'Vaso o botella rota');

-- El stock que tenían era inventado para poder venderlos como producto.
UPDATE productos SET activo = 0, stock_actual = 0
WHERE nombre_producto IN ('Vaso o botella rota', 'Promo 2x30 amstel');

COMMIT;

DROP TEMPORARY TABLE IF EXISTS corr_dup_mesa, corr_mover_pagos, corr_firma_barra, corr_firma_barra_2, corr_dup_barra, corr_largas;
