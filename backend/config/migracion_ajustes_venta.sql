-- Bitácora de correcciones a ventas ya cobradas. Ejecutar una sola vez, después de migracion_motor_cobro.sql.
-- Cada corrección de cantidad (o borrado de un producto) deja una fila con lo que cambió en el total
-- y cuánto se devolvió o cobró por cada medio de pago.
CREATE TABLE ajustes_venta (
    id_ajuste INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NOT NULL,
    id_detalle_prod INT NULL, -- Sin clave foránea: el detalle puede haberse borrado
    id_producto INT NOT NULL,
    cantidad_anterior INT NOT NULL,
    cantidad_nueva INT NOT NULL, -- 0 cuando se borró el producto
    total_anterior DECIMAL(10,2) NOT NULL,
    total_nuevo DECIMAL(10,2) NOT NULL,
    ajuste_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- Negativo: se devolvió al cliente
    ajuste_qr DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    id_usuario INT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_ajuste_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE
) ENGINE=InnoDB;
