-- Ejecutar en la base de datos de billar para agregar soporte al nuevo tipo de promoción

-- 1. Modificar el tipo_promo para incluir 'incentivo_producto'
ALTER TABLE promociones 
MODIFY tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto') NOT NULL;

-- 2. Agregar la nueva columna requerida para almacenar el tipo de mesa secundario
ALTER TABLE promociones 
ADD COLUMN id_item_secundario INT NULL AFTER id_item_condicion;

-- 3. Soporte para primera hora gratis en sesiones de juego
ALTER TABLE sesiones_juego 
ADD COLUMN primera_hora_gratis TINYINT(1) NOT NULL DEFAULT 0;

-- 4. Producto especial para item de hora promo con descuento en el carrito
INSERT INTO productos (nombre_producto, precio_venta, stock_actual) 
VALUES ('Hora Promo (Incentivo)', 0.00, 999999);

