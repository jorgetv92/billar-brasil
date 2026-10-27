-- Creación de la base de datos
CREATE DATABASE IF NOT EXISTS billar_brasil
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;USE billar_brasil;
-- MÓDULO 1: USUARIOS Y CONTROL DE ACCESOS
CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol ENUM('administrador', 'atencion') NOT NULL
) ENGINE=InnoDB;CREATE TABLE jornadas (
    id_jornada INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario_apertura INT NOT NULL,
    fecha_hora_apertura DATETIME NOT NULL,
    fecha_hora_cierre DATETIME NULL,
    monto_inicial_caja DECIMAL(10,2) NOT NULL,
    monto_final_efectivo_real DECIMAL(10,2) NULL,
    estado ENUM('abierta', 'cerrada') NOT NULL DEFAULT 'abierta',
    CONSTRAINT fk_jornada_usuario FOREIGN KEY (id_usuario_apertura) REFERENCES usuarios(id_usuario)
) ENGINE=InnoDB;-- MÓDULO 2: CONFIGURACIÓN DE MESAS E INVENTARIO
CREATE TABLE tipos_mesa (
    id_tipo_mesa INT AUTO_INCREMENT PRIMARY KEY,
    nombre_tipo VARCHAR(50) NOT NULL,
    precio_hora DECIMAL(10,2) NOT NULL
) ENGINE=InnoDB;CREATE TABLE mesas (
    id_mesa INT AUTO_INCREMENT PRIMARY KEY,
    id_tipo_mesa INT NOT NULL,
    numero_mesa VARCHAR(20) NOT NULL,
    estado_actual ENUM('libre', 'ocupada', 'mantenimiento') NOT NULL DEFAULT 'libre',
    CONSTRAINT fk_mesa_tipo FOREIGN KEY (id_tipo_mesa) REFERENCES tipos_mesa(id_tipo_mesa)
) ENGINE=InnoDB;CREATE TABLE productos (
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombre_producto VARCHAR(100) NOT NULL,
    precio_venta DECIMAL(10,2) NOT NULL,
    stock_actual INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;CREATE TABLE insumos (
    id_insumo INT AUTO_INCREMENT PRIMARY KEY,
    nombre_insumo VARCHAR(100) NOT NULL,
    unidad_medida VARCHAR(20) NOT NULL, -- Ej: 'Litros', 'Gramos', 'Unidades'
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB;-- --- REUBICACIÓN CRÍTICA ---
-- Se crea aquí porque tanto 'jornadas' como 'productos' ya existen previamente.
CREATE TABLE IF NOT EXISTS jornada_inventario_apertura (
    id_jornada INT NOT NULL,
    id_producto INT NOT NULL,
    stock_apertura INT NOT NULL,
    PRIMARY KEY (id_jornada, id_producto),
    CONSTRAINT fk_inv_apertura_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada) ON DELETE CASCADE,
    CONSTRAINT fk_inv_apertura_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB;-- MÓDULO 3: OPERACIONES DE CAJA E INSUMOS
CREATE TABLE cargas (
    id_carga INT AUTO_INCREMENT PRIMARY KEY,
    tipo_carga ENUM('producto', 'insumo') NOT NULL,
    fecha_hora DATETIME NOT NULL,
    estado ENUM('activo', 'anulado') DEFAULT 'activo'
) ENGINE=InnoDB;CREATE TABLE detalle_cargas (
    id_detalle_carga INT AUTO_INCREMENT PRIMARY KEY,
    id_carga INT NOT NULL,
    -- Permitimos NULL en ambos porque un detalle de carga afecta a un producto O a un insumo, no a ambos a la vez
    id_producto INT NULL,
    id_insumo INT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_detalle_carga FOREIGN KEY (id_carga) REFERENCES cargas(id_carga) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_carga_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto),
    CONSTRAINT fk_detalle_carga_insumo FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
) ENGINE=InnoDB;CREATE TABLE bitacora_cargas (
    id_bitacora INT AUTO_INCREMENT PRIMARY KEY,
    id_carga INT NOT NULL,
    id_usuario INT NOT NULL, -- ID del administrador que hizo el cambio
    fecha_modificacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    accion ENUM('modificacion', 'anulacion') NOT NULL,
    detalle_cambios JSON NOT NULL, -- Formato JSON para guardar qué cambió exactamente
    CONSTRAINT fk_bitacora_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
    CONSTRAINT fk_bitacora_carga FOREIGN KEY (id_carga) REFERENCES cargas(id_carga) ON DELETE CASCADE
) ENGINE=InnoDB;CREATE TABLE egresos_caja (
    id_egreso INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_egreso_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada)
) ENGINE=InnoDB;CREATE TABLE gastos_insumos (
    id_gasto_insumo INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    id_insumo INT NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_gasto_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
    CONSTRAINT fk_gasto_insumo FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
) ENGINE=InnoDB;-- MÓDULO 4: MOTOR TRANSACCIONAL (Cuentas, Barra, Sesiones y Transferencias)
CREATE TABLE sesiones_juego (
    id_sesion INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    estado ENUM('activa', 'finalizada') NOT NULL DEFAULT 'activa',
    primera_hora_gratis TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_sesion_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada)
) ENGINE=InnoDB;CREATE TABLE tramos_mesas (
    id_tramo INT AUTO_INCREMENT PRIMARY KEY,
    id_sesion INT NOT NULL,
    id_mesa INT NOT NULL,
    fecha_hora_inicio DATETIME NOT NULL,
    fecha_hora_fin DATETIME NULL,
    tarifa_hora_aplicada DECIMAL(10,2) NOT NULL,
    importe_tramo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    fecha_hora_pausa DATETIME NULL DEFAULT NULL,
    CONSTRAINT fk_tramo_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion) ON DELETE CASCADE,
    CONSTRAINT fk_tramo_mesa FOREIGN KEY (id_mesa) REFERENCES mesas(id_mesa)
) ENGINE=InnoDB;CREATE TABLE ventas (
    id_venta INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    id_sesion INT NULL, -- Es NULL si fue venta rápida de barra
    subtotal_mesas DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    subtotal_productos DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    descuentos DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_pagar DECIMAL(10,2) NOT NULL,
    fecha_hora_venta DATETIME NOT NULL,
    CONSTRAINT fk_venta_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
    CONSTRAINT fk_venta_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion)
) ENGINE=InnoDB;CREATE TABLE detalle_venta_productos (
    id_detalle_prod INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NULL, -- Puede ser NULL hasta que se cierre la sesión y se genere la venta
    id_sesion INT NULL, -- Para asociar el producto a la mesa antes de que se cobre
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario_aplicado DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_detalle_vp_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_vp_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion),
    CONSTRAINT fk_detalle_vp_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB;CREATE TABLE pagos_venta (
    id_pago INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NOT NULL,
    metodo_pago ENUM('efectivo', 'qr') NOT NULL,
    monto_pagado DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_pago_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE
) ENGINE=InnoDB;-- MÓDULO 5: MOTOR DE PROMOCIONES
CREATE TABLE promociones (
    id_promocion INT AUTO_INCREMENT PRIMARY KEY,
    nombre_promo VARCHAR(100) NOT NULL,
    tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto') NOT NULL,
    fecha_inicio DATE NULL,
    fecha_fin DATE NULL,
    hora_inicio TIME NULL,
    hora_fin TIME NULL,
    dias_semana VARCHAR(50) NULL, -- Ej: "Lunes,Martes,Miércoles"
    valor_descuento DECIMAL(10,2) NULL, -- Porcentaje o monto a descontar
    id_item_condicion INT NULL, -- ID del producto o tipo de mesa necesario para activar
    id_item_secundario INT NULL, -- ID secundario (ej. tipo de mesa en incentivo_producto)
    cantidad_condicion DECIMAL(10,2) NULL -- Cantidad mínima requerida (ej. 2 horas, 3 cervezas)
) ENGINE=InnoDB;-- INSERCIÓN DE DATOS INICIALES
INSERT INTO usuarios (nombres, apellidos, usuario, password, rol) 
VALUES ('Administrador', 'Principal', 'admin', 'PEGA_TU_HASH_AQUI', 'administrador');