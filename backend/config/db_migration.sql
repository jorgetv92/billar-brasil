-- Ejecutar en la base de datos de billar para agregar soporte al nuevo tipo de promoción

-- 1. Modificar el tipo_promo para incluir 'incentivo_producto'
ALTER TABLE promociones 
MODIFY tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto', 'combo_especifico') NOT NULL;

-- 2. Agregar la nueva columna requerida para almacenar el tipo de mesa secundario
ALTER TABLE promociones 
ADD COLUMN id_item_secundario INT NULL AFTER id_item_condicion;

-- 3. Soporte para primera hora con descuento en sesiones de juego
ALTER TABLE sesiones_juego 
ADD COLUMN primera_hora_gratis TINYINT(1) NOT NULL DEFAULT 0;

-- 4. (Retirado) Antes se creaba aquí el producto "Hora Promo (Incentivo)" con precio 0 y stock 999999.
--    La hora con descuento ahora es un cargo de la venta (ver migracion_productos_cargos_combos.sql).
