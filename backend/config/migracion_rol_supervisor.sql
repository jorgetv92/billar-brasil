-- Rol supervisor: atiende igual que "atencion" y además puede ver y corregir las ventas de la jornada.
-- Un usuario de atención necesita que un supervisor (o un administrador) ingrese sus datos para verlas.
-- Ejecutar una sola vez, después de migracion_combos.sql.
ALTER TABLE usuarios
    MODIFY rol ENUM('administrador', 'supervisor', 'atencion') NOT NULL;

-- Cada corrección de una venta guarda qué supervisor la autorizó.
ALTER TABLE ajustes_venta
    ADD COLUMN id_autorizo INT NULL AFTER id_usuario; -- Supervisor o administrador que autorizó (sin clave foránea: el usuario se puede borrar)
