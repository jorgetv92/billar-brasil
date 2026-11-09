-- Cada carga guarda la jornada en la que se hizo (NULL si se hizo entre jornadas).
-- Ejecutar una sola vez, después de migracion_productos_cargos_combos.sql.
--
-- Antes el inventario del turno tomaba como "cargas del turno" las hechas desde la hora de apertura.
-- Una carga guardada en el mismo segundo en que se abría la jornada quedaba en la foto de apertura
-- y además se sumaba como carga del turno. Ahora la carga se asigna a la jornada al registrarse.
ALTER TABLE cargas
    ADD COLUMN id_jornada INT NULL AFTER estado,
    ADD KEY fk_carga_jornada (id_jornada),
    ADD CONSTRAINT fk_carga_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada);

-- Historial: cada carga pasada queda en la jornada que estaba abierta a esa hora.
UPDATE cargas c
JOIN jornadas j ON c.fecha_hora > j.fecha_hora_apertura
               AND (j.fecha_hora_cierre IS NULL OR c.fecha_hora <= j.fecha_hora_cierre)
SET c.id_jornada = j.id_jornada
WHERE c.id_jornada IS NULL;
