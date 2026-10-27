<?php
include '../config/database.php';
$database = new Database();
$db = $database->getConnection();

try {
    // 1. Modificar ENUM
    $db->exec("ALTER TABLE promociones MODIFY tipo_promo ENUM('tarifa_mesa', 'descuento_producto', 'combo_2x1', 'incentivo_cruzado', 'incentivo_mesa', 'incentivo_producto') NOT NULL");
    echo "ENUM modificado.\n";
} catch(Exception $e) {
    echo "Error ENUM: " . $e->getMessage() . "\n";
}

try {
    // 2. Agregar columna
    $db->exec("ALTER TABLE promociones ADD COLUMN id_item_secundario INT NULL");
    echo "Columna agregada.\n";
} catch(Exception $e) {
    echo "Error Columna: " . $e->getMessage() . "\n";
}
?>
