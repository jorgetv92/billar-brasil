-- Cierra las sesiones que quedaron abiertas en jornadas ya cerradas por el error de doble ocupación.
-- Nunca se cobraron ni tienen consumo: no mueve dinero ni inventario, y puede ejecutarse más de una vez.
--
-- Efecto en reportes: esos tramos pasan a durar 0 horas, porque hoy suman tiempo que nadie jugó.
-- No toca sesiones de la jornada abierta ni ninguna que tenga una venta o productos asociados.
--
-- Antes de ejecutarlo: respaldar la base de datos y revisar la primera consulta.

START TRANSACTION;

-- Lo que se va a cerrar
SELECT s.id_sesion, s.id_jornada, t.id_tramo, t.id_mesa, t.fecha_hora_inicio, t.fecha_hora_pausa
FROM sesiones_juego s
JOIN jornadas j ON j.id_jornada = s.id_jornada
JOIN tramos_mesas t ON t.id_sesion = s.id_sesion
WHERE s.estado = 'activa' AND j.estado = 'cerrada' AND t.fecha_hora_fin IS NULL
  AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id_sesion = s.id_sesion)
  AND NOT EXISTS (SELECT 1 FROM detalle_venta_productos d WHERE d.id_sesion = s.id_sesion);

UPDATE tramos_mesas t
JOIN sesiones_juego s ON s.id_sesion = t.id_sesion
JOIN jornadas j ON j.id_jornada = s.id_jornada
SET t.fecha_hora_fin = t.fecha_hora_inicio, t.fecha_hora_pausa = NULL, t.importe_tramo = 0
WHERE s.estado = 'activa' AND j.estado = 'cerrada' AND t.fecha_hora_fin IS NULL
  AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id_sesion = s.id_sesion)
  AND NOT EXISTS (SELECT 1 FROM detalle_venta_productos d WHERE d.id_sesion = s.id_sesion);

UPDATE sesiones_juego s
JOIN jornadas j ON j.id_jornada = s.id_jornada
SET s.estado = 'finalizada'
WHERE s.estado = 'activa' AND j.estado = 'cerrada'
  AND NOT EXISTS (SELECT 1 FROM tramos_mesas t WHERE t.id_sesion = s.id_sesion AND t.fecha_hora_fin IS NULL);

COMMIT;

-- Lo que requiere revisión manual: si esta consulta devuelve filas, esas sesiones tienen venta o productos.
SELECT s.id_sesion, s.id_jornada
FROM sesiones_juego s
JOIN jornadas j ON j.id_jornada = s.id_jornada
WHERE s.estado = 'activa' AND j.estado = 'cerrada';
