-- Combos como sección propia (ya no son promociones). Ejecutar una sola vez, después de migracion_cargas_jornada.sql.
--
-- Un combo es un producto compuesto: no tiene stock propio y al venderse descuenta el stock de sus productos.
-- Cada producto del combo se guarda en la venta con el precio del combo repartido y la marca id_combo.
-- Las promociones "Producto 2x1" (combo_2x1) siguen en promociones, pero ahora las elige el cajero en el
-- buscador: sus líneas quedan marcadas con id_promocion.
--
-- Los combos que estaban creados como promoción "Combo Específico" pasan a la tabla combos con el mismo id.

CREATE TABLE combos (
    id_combo INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1 -- 0: retirado (se conserva por las ventas antiguas)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE combo_items (
    id_combo INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    PRIMARY KEY (id_combo, id_producto),
    CONSTRAINT fk_combo_item_combo FOREIGN KEY (id_combo) REFERENCES combos(id_combo) ON DELETE CASCADE,
    CONSTRAINT fk_combo_item_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE detalle_venta_productos
    ADD COLUMN id_combo INT NULL AFTER id_promocion,
    ADD KEY fk_detalle_vp_combo (id_combo),
    ADD CONSTRAINT fk_detalle_vp_combo FOREIGN KEY (id_combo) REFERENCES combos(id_combo);

-- Los combos que estaban como promoción, con sus productos y sus ventas
INSERT INTO combos (id_combo, nombre, precio, activo)
SELECT id_promocion, nombre_promo, COALESCE(valor_descuento, 0), 1 FROM promociones WHERE tipo_promo = 'combo_especifico';

INSERT INTO combo_items (id_combo, id_producto, cantidad)
SELECT pi.id_promocion, pi.id_producto, pi.cantidad
FROM promocion_items pi JOIN promociones p ON p.id_promocion = pi.id_promocion
WHERE p.tipo_promo = 'combo_especifico';

UPDATE detalle_venta_productos d JOIN promociones p ON p.id_promocion = d.id_promocion
SET d.id_combo = d.id_promocion, d.id_promocion = NULL
WHERE p.tipo_promo = 'combo_especifico';

DELETE FROM promociones WHERE tipo_promo = 'combo_especifico';
DROP TABLE promocion_items;

ALTER TABLE promociones
MODIFY tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto') NOT NULL;
