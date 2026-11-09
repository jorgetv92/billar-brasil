<?php
// Entorno local (XAMPP). Lo usa backend/config/entorno.php en la computadora de desarrollo.
return [
    'nombre' => 'local',
    'db_host' => 'localhost',
    'db_name' => 'replica_bll_brasil',
    'db_user' => 'root',
    'db_pass' => '',
    'zona_horaria' => 'America/La_Paz',
    // En local los errores de PHP se muestran para depurar.
    'mostrar_errores' => true,
];
