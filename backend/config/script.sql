-- =======================================================================
-- INSTALACIÓN DESDE CERO DE LA BASE DE DATOS DE PRODUCCIÓN
-- =======================================================================
-- Crea todas las tablas que usa el sistema y carga el catálogo inicial (tipos de mesa, mesas,
-- usuarios, insumos y productos) tomado de la base de producción anterior, con los mismos ids.
--
-- Uso: en phpMyAdmin, seleccionar la base de datos del hosting (vacía, sin tablas) y en
-- "Importar" subir este archivo. No crea la base ni cambia de base: trabaja sobre la seleccionada.
-- Si alguna tabla ya existe se detiene con error en lugar de duplicar datos.
--
-- No se migran: Fernet combo, Promo 2x30 amstel, Vaso de Fernet, Vaso de flor de caña,
-- Vaso o botella rota (ahora es un concepto de cargo) y Cuba libre.
-- Las jornadas, ventas e historial empiezan vacíos.

SET NAMES utf8mb4;

-- =======================================================================
-- MÓDULO 1: USUARIOS Y CONTROL DE ACCESOS
-- =======================================================================

CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol ENUM('administrador', 'atencion') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jornadas (
    id_jornada INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario_apertura INT NOT NULL,
    fecha_hora_apertura DATETIME NOT NULL,
    fecha_hora_cierre DATETIME NULL,
    monto_inicial_caja DECIMAL(10,2) NOT NULL,
    monto_final_efectivo_real DECIMAL(10,2) NULL,
    estado ENUM('abierta', 'cerrada') NOT NULL DEFAULT 'abierta',
    CONSTRAINT fk_jornada_usuario FOREIGN KEY (id_usuario_apertura) REFERENCES usuarios(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================================
-- MÓDULO 2: CONFIGURACIÓN DE MESAS E INVENTARIO
-- =======================================================================

CREATE TABLE tipos_mesa (
    id_tipo_mesa INT AUTO_INCREMENT PRIMARY KEY,
    nombre_tipo VARCHAR(50) NOT NULL,
    precio_hora DECIMAL(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mesas (
    id_mesa INT AUTO_INCREMENT PRIMARY KEY,
    id_tipo_mesa INT NOT NULL,
    numero_mesa VARCHAR(20) NOT NULL,
    estado_actual ENUM('libre', 'ocupada', 'mantenimiento') NOT NULL DEFAULT 'libre',
    CONSTRAINT fk_mesa_tipo FOREIGN KEY (id_tipo_mesa) REFERENCES tipos_mesa(id_tipo_mesa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE productos (
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombre_producto VARCHAR(100) NOT NULL,
    precio_venta DECIMAL(10,2) NOT NULL,
    stock_actual INT NOT NULL DEFAULT 0,
    tipo ENUM('inventario', 'preparado') NOT NULL DEFAULT 'inventario', -- preparado: se arma en la barra, sin stock
    activo TINYINT(1) NOT NULL DEFAULT 1 -- 0: retirado, se conserva por las ventas antiguas
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE insumos (
    id_insumo INT AUTO_INCREMENT PRIMARY KEY,
    nombre_insumo VARCHAR(100) NOT NULL,
    unidad_medida VARCHAR(20) NOT NULL, -- Ej: 'Litros', 'Gramos', 'Unidades'
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foto del stock al abrir la jornada (se borra al cerrarla). Va después de 'jornadas' y 'productos'.
CREATE TABLE jornada_inventario_apertura (
    id_jornada INT NOT NULL,
    id_producto INT NOT NULL,
    stock_apertura INT NOT NULL,
    PRIMARY KEY (id_jornada, id_producto),
    CONSTRAINT fk_inv_apertura_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada) ON DELETE CASCADE,
    CONSTRAINT fk_inv_apertura_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================================
-- MÓDULO 3: OPERACIONES DE CAJA E INSUMOS
-- =======================================================================

CREATE TABLE cargas (
    id_carga INT AUTO_INCREMENT PRIMARY KEY,
    tipo_carga ENUM('producto', 'insumo') NOT NULL,
    fecha_hora DATETIME NOT NULL,
    estado ENUM('activo', 'anulado') DEFAULT 'activo',
    id_jornada INT NULL, -- Jornada abierta cuando se registró (NULL: entre jornadas). Define las cargas del turno
    CONSTRAINT fk_carga_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE detalle_cargas (
    id_detalle_carga INT AUTO_INCREMENT PRIMARY KEY,
    id_carga INT NOT NULL,
    -- Permitimos NULL en ambos porque un detalle de carga afecta a un producto O a un insumo, no a ambos a la vez
    id_producto INT NULL,
    id_insumo INT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_detalle_carga FOREIGN KEY (id_carga) REFERENCES cargas(id_carga) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_carga_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto),
    CONSTRAINT fk_detalle_carga_insumo FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bitacora_cargas (
    id_bitacora INT AUTO_INCREMENT PRIMARY KEY,
    id_carga INT NOT NULL,
    id_usuario INT NOT NULL, -- ID del administrador que hizo el cambio (sin clave foránea: el usuario se puede borrar)
    fecha_modificacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    accion ENUM('modificacion', 'anulacion') NOT NULL,
    detalle_cambios JSON NOT NULL, -- Formato JSON para guardar qué cambió exactamente
    CONSTRAINT fk_bitacora_carga FOREIGN KEY (id_carga) REFERENCES cargas(id_carga) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE egresos_caja (
    id_egreso INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    descripcion TEXT NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_egreso_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE gastos_insumos (
    id_gasto_insumo INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    id_insumo INT NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_gasto_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
    CONSTRAINT fk_gasto_insumo FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================================
-- MÓDULO 4: MOTOR TRANSACCIONAL (Cuentas, Barra, Sesiones y Transferencias)
-- =======================================================================

CREATE TABLE sesiones_juego (
    id_sesion INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    estado ENUM('activa', 'finalizada') NOT NULL DEFAULT 'activa',
    primera_hora_gratis TINYINT(1) NOT NULL DEFAULT 0,
    CONSTRAINT fk_sesion_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tramos_mesas (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ventas (
    id_venta INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NOT NULL,
    id_sesion INT NULL, -- Es NULL si fue venta rápida de barra
    subtotal_mesas DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    subtotal_productos DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    subtotal_cargos DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- Hora gratis y cargos por daños
    descuentos DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    redondeo DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- Ajuste hacia arriba a .00 o .50
    total_pagar DECIMAL(10,2) NOT NULL,
    fecha_hora_venta DATETIME NOT NULL,
    id_operacion VARCHAR(40) NULL, -- Código único del intento de cobro: evita registrar dos veces la misma venta
    UNIQUE KEY uq_ventas_operacion (id_operacion),
    CONSTRAINT fk_venta_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
    CONSTRAINT fk_venta_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE detalle_venta_productos (
    id_detalle_prod INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NULL, -- Puede ser NULL hasta que se cierre la sesión y se genere la venta
    id_sesion INT NULL, -- Para asociar el producto a la mesa antes de que se cobre
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario_aplicado DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NULL, -- Momento del pedido: define qué promos le corresponden
    id_promocion INT NULL, -- Combo en el que se vendió (el precio ya es el del combo)
    CONSTRAINT fk_detalle_vp_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_vp_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion),
    CONSTRAINT fk_detalle_vp_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pagos_venta (
    id_pago INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NOT NULL,
    metodo_pago ENUM('efectivo', 'qr') NOT NULL,
    monto_pagado DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_pago_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================================
-- MÓDULO 5: MOTOR DE PROMOCIONES
-- =======================================================================

CREATE TABLE promociones (
    id_promocion INT AUTO_INCREMENT PRIMARY KEY,
    nombre_promo VARCHAR(100) NOT NULL,
    tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto', 'combo_especifico') NOT NULL,
    fecha_inicio DATE NULL,
    fecha_fin DATE NULL,
    hora_inicio TIME NULL,
    hora_fin TIME NULL,
    dias_semana VARCHAR(50) NULL, -- Ej: "Lunes,Martes,Miércoles"
    valor_descuento DECIMAL(10,2) NULL, -- Porcentaje o monto a descontar
    id_item_condicion INT NULL, -- ID del producto o tipo de mesa necesario para activar
    id_item_secundario INT NULL, -- ID secundario (ej. tipo de mesa en incentivo_producto)
    cantidad_condicion DECIMAL(10,2) NULL -- Cantidad mínima requerida (ej. 2 horas, 3 cervezas)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Productos de un combo específico; el precio del combo va en promociones.valor_descuento
CREATE TABLE promocion_items (
    id_promocion INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    PRIMARY KEY (id_promocion, id_producto),
    CONSTRAINT fk_item_promocion FOREIGN KEY (id_promocion) REFERENCES promociones(id_promocion) ON DELETE CASCADE,
    CONSTRAINT fk_item_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cargos que no son productos: la hora gratis del incentivo y los daños (vaso roto, ventana...)
CREATE TABLE conceptos_cargo (
    id_concepto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    monto_sugerido DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cargos_venta (
    id_cargo INT AUTO_INCREMENT PRIMARY KEY,
    id_venta INT NULL, -- NULL mientras la mesa no se cobra
    id_sesion INT NULL,
    tipo ENUM('hora_gratis', 'cargo') NOT NULL,
    id_concepto INT NULL,
    id_promocion INT NULL,
    descripcion VARCHAR(150) NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_cargo_venta FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
    CONSTRAINT fk_cargo_sesion FOREIGN KEY (id_sesion) REFERENCES sesiones_juego(id_sesion),
    CONSTRAINT fk_cargo_concepto FOREIGN KEY (id_concepto) REFERENCES conceptos_cargo(id_concepto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =======================================================================
-- DATOS INICIALES (copiados de la base de producción anterior, mismos ids)
-- =======================================================================

-- Las roturas se cobran como cargo con monto sugerido, que el cajero puede cambiar.
INSERT INTO conceptos_cargo (nombre, monto_sugerido, activo) VALUES ('Vaso o botella rota', 8.00, 1);

INSERT INTO tipos_mesa (id_tipo_mesa, nombre_tipo, precio_hora) VALUES
(1, 'Billar Privada', 30.00),
(2, 'Billar', 15.00),
(3, 'Cachos', 10.00),
(5, 'Consumo', 0.00);

-- Todas las mesas quedan libres: la base nueva no tiene partidas abiertas.
INSERT INTO mesas (id_mesa, id_tipo_mesa, numero_mesa, estado_actual) VALUES
(1, 1, 'Privada #1', 'libre'),
(2, 2, 'Billar #1', 'libre'),
(3, 2, 'Billar #2', 'libre'),
(4, 3, 'Cachos #1', 'libre'),
(6, 5, 'Consumo #1', 'libre'),
(7, 1, 'Privada #2', 'mantenimiento'),
(8, 2, 'Billar #3', 'libre'),
(9, 2, 'Billar #4', 'libre'),
(10, 5, 'Consumo #2', 'libre'),
(11, 5, 'Consumo #3', 'libre'),
(15, 2, 'Billar #5', 'libre'),
(16, 2, 'Billar #6', 'libre'),
(17, 2, 'Billar #7', 'libre');

INSERT INTO usuarios (id_usuario, nombres, apellidos, usuario, password, rol) VALUES
(1, 'Administrador', 'Principal', 'admin', '$2y$10$Nm/WltmGn/748ISzv6a/7.vLRFcwLTW8G6cjQHDfuDgwMt4cvgnfe', 'administrador'),
(2, 'Hugo Gonzalo', 'Paco Mendoza', 'gpaco', '$2y$10$3xxWIj/mYnbTLlP82CC8ZO8O3MNjn3tHQwooxc3bD4ZZV.L27Xnvm', 'administrador'),
(4, 'Jorge', 'Torquato', 'jtorquato', '$2y$10$.wHURNHgwmKNlnPsrDbVaeZbnMstNG4TV.tbQ/rYtpNt3DKGKQt6C', 'atencion'),
(5, 'Heidy', 'Roman', 'hroman', '$2y$10$rS38xLutjjVR628mEqlhMOZ1D4dH.ulCFclkocGTCSiGLiya2sWlW', 'atencion'),
(6, 'Andrea', 'Ruiz', 'aruiz', '$2y$10$cKIv0eDCVt0eGHB3mitITOAoovp45WnNESYcCUnIrEjH9Tc/JtxKO', 'atencion'),
(7, 'Selene', 'Freita', 'sfreita', '$2y$10$T2vufSFuOtGezMBx2LyaYeBsT76XP69moMOsDqgl5Xx8o.pD4b0QW', 'atencion'),
(8, 'Fabiana', 'Moron', 'fmoron', '$2y$10$SF2q4y.c.Vdf/juN7Khkf.7X/qzPBt9tNVXKURVcLLepbY9V1uFHu', 'atencion'),
(9, 'Amauris', 'Cuba', 'amauris', '$2y$10$v.9El2ftrOM.9jp1JmTJ7eP6tAmGfot8JewVFFybepLZmgWpwnwBe', 'atencion');

INSERT INTO insumos (id_insumo, nombre_insumo, unidad_medida, stock_actual) VALUES
(1, 'Detergente en polvo', 'Bolsas', 20.00),
(2, 'Papel higienico', 'Rollos', 16.00);

INSERT INTO productos (id_producto, nombre_producto, precio_venta, stock_actual, tipo, activo) VALUES
(1, 'Paceña Macanuda', 22.00, 438, 'inventario', 1),
(4, 'Paceña Palito', 9.00, 140, 'inventario', 1),
(6, 'Corona', 24.00, 10, 'inventario', 1),
(7, 'Paceña Gordita', 12.00, 186, 'inventario', 1),
(8, 'Paceña Huari G.', 26.00, 354, 'inventario', 1),
(9, 'Amstel Palito', 8.50, 65, 'inventario', 1),
(11, 'Soda Mini', 3.00, 45, 'inventario', 1),
(12, 'Soda Popular', 8.00, 100, 'inventario', 1),
(13, 'Soda 2Lts', 20.00, 28, 'inventario', 1),
(14, 'Black, Powerade', 10.00, 14, 'inventario', 1),
(15, 'Agua 1Lts', 8.00, 0, 'inventario', 1),
(16, 'Cajetilla Camel', 28.00, 48, 'inventario', 1),
(17, 'Cajetilla Bohem', 20.00, 59, 'inventario', 1),
(18, 'Cajetilla Hills', 13.00, 16, 'inventario', 1),
(19, 'Cigarro Suelto Camel', 1.50, 306, 'inventario', 1),
(20, 'Cigarro Suelto Bohem', 1.50, 511, 'inventario', 1),
(21, 'Cigarro Suelto Hills', 1.00, 192, 'inventario', 1),
(22, 'Encendedor', 4.00, 72, 'inventario', 1),
(23, 'Coca Machucada', 25.00, 12, 'inventario', 1),
(24, 'Ciclon, fury', 8.00, 11, 'inventario', 1),
(25, 'Soda de 1Lts', 10.00, 2, 'inventario', 1),
(26, 'Galleta Club Social, Oreo', 4.00, 8, 'inventario', 1),
(27, 'Galleta Chocosoda', 4.00, 12, 'inventario', 1),
(28, 'Cocacola 1.5Lts', 15.00, 16, 'inventario', 1),
(30, 'Agua 2Lts', 12.00, 2, 'inventario', 1),
(31, 'Energizante Monster', 30.00, 3, 'inventario', 1),
(32, 'Urbano Botella', 30.00, 42, 'inventario', 1),
(33, 'Cerveza Stella Artois', 22.00, 0, 'inventario', 1),
(34, 'Simba 2Lts', 15.00, 4, 'inventario', 1),
(35, 'Chupete Bom Bom Bum', 1.50, 35, 'inventario', 1),
(36, 'Chicle Groso', 1.50, 225, 'inventario', 1),
(37, 'Chicle Tumix, Push', 1.00, 122, 'inventario', 1),
(38, 'Chocolate Bon o Bon', 3.00, 53, 'inventario', 1),
(39, 'Nachos', 5.00, 4, 'inventario', 1),
(40, 'Cheetos', 4.00, 6, 'inventario', 1),
(41, 'Bico', 2.50, 46, 'inventario', 1),
(42, 'Chocolate Momento', 4.00, 16, 'inventario', 1),
(43, 'Galleta Chips', 4.00, 2, 'inventario', 1),
(44, 'Galleta Artesana Chico', 2.50, 25, 'inventario', 1),
(46, 'Amstel Botella', 17.00, 29, 'inventario', 1),
(47, 'Pastilla Mentita', 5.00, 4, 'inventario', 1),
(48, 'Mani Dulce o Salado', 2.00, 5, 'inventario', 1),
(49, 'Chocolate Chubi', 3.00, 27, 'inventario', 1),
(50, 'Pastillas Halls', 6.50, 19, 'inventario', 1),
(51, 'Galleta Tita', 1.50, 21, 'inventario', 1),
(52, 'Papas Fritas Papa Nax, Super Papa', 5.00, 16, 'inventario', 1),
(53, 'Galleta Festival', 3.00, 3, 'inventario', 1),
(54, 'Galleta Sublime', 4.50, 5, 'inventario', 1),
(56, 'Combo de flor de caña', 220.00, 5, 'inventario', 1),
(60, 'Botella ducal', 17.00, 129, 'inventario', 1),
(63, 'Four loco', 45.00, 5, 'inventario', 1),
(65, 'Doblón chocolate', 1.50, 13, 'inventario', 1),
(66, 'Takis', 8.00, 5, 'inventario', 1),
(67, 'Power 1L', 14.00, 16, 'inventario', 1),
(68, 'Huari Miel', 20.00, 1, 'inventario', 1),
(69, 'Chicle globo', 2.00, 25, 'inventario', 1),
(70, 'Cuba 2 litros', 30.00, 6, 'inventario', 1),
(71, 'Jugo valle', 16.00, 5, 'inventario', 1),
(72, 'Agua personal', 7.00, 5, 'inventario', 1);
