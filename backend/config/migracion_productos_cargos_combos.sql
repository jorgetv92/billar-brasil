-- Productos preparados, cargos y combos. Ejecutar una sola vez, después de migracion_ajustes_venta.sql.
--
-- 1. Tipo de producto: "inventario" se compra para revender y lleva stock; "preparado" (vaso de fernet,
--    cócteles) se arma en la barra y no lleva stock. "activo" permite retirar un producto sin borrarlo:
--    las ventas antiguas lo siguen necesitando, pero deja de aparecer para vender, cargar o reportar.
ALTER TABLE productos
ADD COLUMN tipo ENUM('inventario', 'preparado') NOT NULL DEFAULT 'inventario' AFTER stock_actual,
ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER tipo;

-- 2. Cargos: lo que se cobra en una venta y no es un producto. La hora gratis del incentivo en producto
--    (el monto adicional que paga el cliente) y los cargos por daños (vaso o botella rota, una ventana).
CREATE TABLE conceptos_cargo (
    id_concepto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    monto_sugerido DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- El cajero puede cambiarlo al cobrar
    activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE cargos_venta (
    id_cargo INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NULL, -- NULL mientras la mesa no se cobra
    id_sesion INT NULL, -- Cargo de una mesa
    tipo ENUM('hora_gratis', 'cargo') NOT NULL,
    id_concepto INT NULL,
    id_promocion INT NULL, -- Promo de hora gratis que lo originó
    descripcion VARCHAR(150) NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_cargo_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
    CONSTRAINT fk_cargo_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion),
    CONSTRAINT fk_cargo_concepto FOREIGN KEY (id_concepto) REFERENCES conceptos_cargo(id_concepto)
) ENGINE=InnoDB;

-- total_pagar = subtotal_mesas + subtotal_productos - descuentos + subtotal_cargos + redondeo
ALTER TABLE ventas
ADD COLUMN subtotal_cargos DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER subtotal_productos;

-- 3. Combo específico: N productos por un precio (promociones.valor_descuento). El cajero lo elige.
ALTER TABLE promociones
MODIFY tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto', 'combo_especifico') NOT NULL;

CREATE TABLE promocion_items (
    id_promocion INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    PRIMARY KEY (id_promocion, id_producto),
    CONSTRAINT fk_item_promocion FOREIGN KEY (id_promocion) REFERENCES promociones(id_promocion) ON DELETE CASCADE,
    CONSTRAINT fk_item_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB;

-- Los productos vendidos dentro de un combo llevan el combo: su precio ya es el del combo.
ALTER TABLE detalle_venta_productos
ADD COLUMN id_promocion INT NULL AFTER fecha_hora;

-- 4. La hora gratis ya no es un producto. Si existe el producto "Hora Promo" de la versión anterior
--    (no existe en producción), se retira sin borrarlo porque puede tener ventas antiguas.
UPDATE productos SET activo = 0, stock_actual = 0 WHERE nombre_producto LIKE 'Hora Promo%';
