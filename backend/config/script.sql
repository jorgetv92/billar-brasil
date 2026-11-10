-- =======================================================================
-- BILLARSOFT: CREACIÓN DESDE CERO DE LA BASE DE DATOS
-- =======================================================================
-- Crea la base de datos billarsoft, todas las tablas que usa el sistema y el primer usuario administrador.
-- No carga productos, mesas ni otros datos: se configuran desde el sistema.
--
-- Uso: en phpMyAdmin, pestaña "Importar", subir este archivo. Si el hosting no permite crear bases
-- de datos, crear una vacía desde su panel y quitar las dos líneas CREATE DATABASE y USE de abajo
-- antes de importar (el script entonces trabaja sobre la base seleccionada).
-- Si alguna tabla ya existe se detiene con error en lugar de duplicar datos.
--
-- Primer ingreso: usuario admin, contraseña Admuser123+ (cambiarla desde "Usuarios" al entrar).

CREATE DATABASE IF NOT EXISTS billarsoft CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE billarsoft;

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
    rol ENUM('administrador', 'supervisor', 'atencion') NOT NULL -- supervisor: atiende y además ve y corrige las ventas de la jornada
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
    activo TINYINT(1) NOT NULL DEFAULT 1, -- 0: retirado, se conserva por las ventas antiguas
    no_vendible TINYINT(1) NOT NULL DEFAULT 0, -- 1: tiene stock y se carga, pero no se vende suelto (solo dentro de combos)
    receta TINYINT(1) NOT NULL DEFAULT 0 -- 1: se gasta al preparar en barra (botella de ron); se registra en gastos_productos
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE insumos (
    id_insumo INT AUTO_INCREMENT PRIMARY KEY,
    nombre_insumo VARCHAR(100) NOT NULL,
    unidad_medida VARCHAR(20) NOT NULL, -- Ej: 'Litros', 'Gramos', 'Unidades'
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Combos: productos compuestos sin stock propio. Al venderse descuentan el stock de sus productos.
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

-- Productos con receta que se gastan al preparar en barra (botellas para los vasos). Descuentan stock.
CREATE TABLE gastos_productos (
    id_gasto_producto INT AUTO_INCREMENT PRIMARY KEY,
    id_jornada INT NULL, -- Jornada abierta cuando se registró (NULL: el admin lo registró entre jornadas)
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    id_usuario INT NOT NULL, -- Quién lo registró (sin clave foránea: el usuario se puede borrar)
    fecha_hora DATETIME NOT NULL,
    CONSTRAINT fk_gasto_prod_jornada FOREIGN KEY (id_jornada) REFERENCES jornadas(id_jornada),
    CONSTRAINT fk_gasto_prod_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
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
    subtotal_cargos DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- Hora con descuento y cargos por daños
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
    id_promocion INT NULL, -- Promoción "Producto 2x1" con la que se vendió el par (sin clave foránea: la promo se puede borrar)
    id_combo INT NULL, -- Combo en el que se vendió (el precio ya es el del combo repartido)
    CONSTRAINT fk_detalle_vp_combo FOREIGN KEY (id_combo) REFERENCES combos(id_combo),
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
    id_autorizo INT NULL, -- Supervisor o administrador que autorizó la corrección
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
    tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto') NOT NULL, -- combo_2x1 = "Producto 2x1"
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

-- Cargos que no son productos: la hora con descuento del incentivo y los daños (vaso roto, ventana...)
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
-- PRIMER USUARIO ADMINISTRADOR
-- =======================================================================
INSERT INTO usuarios (nombres, apellidos, usuario, password, rol) VALUES
('Administrador', 'Principal', 'admin', '$2y$10$w1BZW1yOU37hHm.BfDoVaOuBn/tSonxAS3H5hDbHrLxaP7CtrCmkO', 'administrador');
