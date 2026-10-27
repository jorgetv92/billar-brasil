<?php
include '../config/database.php';
$db = (new Database())->getConnection();

// 1. Check if column primera_hora_gratis exists in sesiones_juego
$checkCol = $db->query("SHOW COLUMNS FROM sesiones_juego LIKE 'primera_hora_gratis'")->fetch();
if (!$checkCol) {
    $db->exec("ALTER TABLE sesiones_juego ADD COLUMN primera_hora_gratis TINYINT(1) NOT NULL DEFAULT 0");
    echo "Column primera_hora_gratis added to sesiones_juego.\n";
} else {
    echo "Column primera_hora_gratis already exists in sesiones_juego.\n";
}

// 2. Check if product 'Hora Promo (Incentivo)' exists
$checkProd = $db->query("SELECT id_producto FROM productos WHERE nombre_producto = 'Hora Promo (Incentivo)'")->fetch();
if (!$checkProd) {
    $db->exec("INSERT INTO productos (nombre_producto, precio_venta, stock_actual) VALUES ('Hora Promo (Incentivo)', 0.00, 999999)");
    echo "Product 'Hora Promo (Incentivo)' created with id: " . $db->lastInsertId() . "\n";
} else {
    echo "Product 'Hora Promo (Incentivo)' already exists with id: " . $checkProd['id_producto'] . "\n";
}
