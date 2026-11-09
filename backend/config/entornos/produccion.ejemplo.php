<?php
// Plantilla del entorno de producción (hosting). No tiene contraseñas y sí va al repositorio.
// Copiarla como produccion.php y completar los datos de la base que da el panel del hosting.
// produccion.php no se sube a git: tiene la contraseña real.
return [
    'nombre' => 'produccion',
    'db_host' => 'localhost',
    'db_name' => 'COMPLETAR_NOMBRE_DE_LA_BASE',
    'db_user' => 'COMPLETAR_USUARIO',
    'db_pass' => 'COMPLETAR_CONTRASEÑA',
    'zona_horaria' => 'America/La_Paz',
    // En producción los errores van al log del servidor, no a la pantalla.
    'mostrar_errores' => false,
];
