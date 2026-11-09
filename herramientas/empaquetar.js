// Arma el paquete para subir al hosting:  node herramientas/empaquetar.js [produccion|demo]
//
// Deja en dist/:
//   billar_<entorno>_<fecha>.zip  lo que se sube y descomprime en la carpeta del sitio.
//   script.sql                    (solo producción) se importa en phpMyAdmin. No va dentro del zip:
//                                 tiene los hashes de las contraseñas y no debe quedar en el servidor.
//
// El zip lleva backend/config/entorno.php apuntando al entorno elegido y su archivo de
// backend/config/entornos/. Si ese archivo todavía tiene datos por completar, avisa: se pueden
// completar antes de empaquetar o después, en el servidor.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PHP = process.env.PHP_BIN || 'C:/xampp/php/php.exe';
// tar de Windows (bsdtar): arma zip con rutas "a/b", que es lo que esperan los hostings Linux.
const TAR = process.env.TAR_BIN || 'C:/Windows/System32/tar.exe';

const entorno = process.argv[2] || 'produccion';
if (!['produccion', 'demo'].includes(entorno)) {
  console.error('Uso: node herramientas/empaquetar.js [produccion|demo]');
  process.exit(1);
}

// Lo que va al servidor. Lo demás (tests, herramientas, .sql, PDFs viejos, logs) se queda en local.
const INCLUIR = ['index.html', 'frontend', 'backend/api', 'backend/models', 'backend/config/database.php', 'backend/config/.htaccess'];
const EXCLUIR = [/(^|\/)error_log$/, /\.sql$/i, /(^|\/)sim_clock/, /(^|\/)\.git/, /(^|\/)Thumbs\.db$/i, /(^|\/)\.DS_Store$/];

const DIST = path.join(RAIZ, 'dist');
const ahora = new Date();
const dos = (n) => String(n).padStart(2, '0');
const fecha = `${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}-${dos(ahora.getHours())}${dos(ahora.getMinutes())}`;
const STAGING = path.join(DIST, `billar_${entorno}`);
const ZIP = path.join(DIST, `billar_${entorno}_${fecha}.zip`);

const avisos = [];

function copiar(relativo) {
  const origen = path.join(RAIZ, relativo);
  if (!fs.existsSync(origen)) throw new Error(`No existe ${relativo}`);
  fs.cpSync(origen, path.join(STAGING, relativo), {
    recursive: true,
    filter: (archivo) => {
      const rel = path.relative(RAIZ, archivo).split(path.sep).join('/');
      return !EXCLUIR.some((patron) => patron.test(rel));
    },
  });
}

function archivosDe(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    return e.isDirectory() ? archivosDe(ruta) : [ruta];
  });
}

// 1. Copia limpia de lo que se sube
fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGING, { recursive: true });
INCLUIR.forEach(copiar);

// 2. Entorno: entorno.php apunta al elegido y se incluye solo su archivo
const dirEntornos = path.join(STAGING, 'backend', 'config', 'entornos');
fs.mkdirSync(dirEntornos, { recursive: true });
fs.writeFileSync(
  path.join(STAGING, 'backend', 'config', 'entorno.php'),
  `<?php\n// Entorno que usa este sitio: el nombre de un archivo de backend/config/entornos/ (sin .php).\nreturn '${entorno}';\n`,
);
const real = path.join(RAIZ, 'backend', 'config', 'entornos', `${entorno}.php`);
const ejemplo = path.join(RAIZ, 'backend', 'config', 'entornos', `${entorno}.ejemplo.php`);
if (fs.existsSync(real)) {
  fs.copyFileSync(real, path.join(dirEntornos, `${entorno}.php`));
} else {
  fs.copyFileSync(ejemplo, path.join(dirEntornos, `${entorno}.php`));
  avisos.push(`No existe backend/config/entornos/${entorno}.php: se usó la plantilla.`);
}
const pendientes = (fs.readFileSync(path.join(dirEntornos, `${entorno}.php`), 'utf8').match(/COMPLETAR_[^'"]+/g) || []);
if (pendientes.length) {
  avisos.push(`Falta completar en backend/config/entornos/${entorno}.php: ${pendientes.join(', ')}.` +
    ' Complétalo antes de empaquetar o, después de subir el zip, en el administrador de archivos del hosting.');
}

// 3. Que todo el PHP compile
const php = archivosDe(STAGING).filter((f) => f.endsWith('.php'));
const conErrores = php.filter((f) => {
  try {
    execFileSync(PHP, ['-l', f], { stdio: 'pipe' });
    return false;
  } catch (e) {
    console.error(String(e.stdout || e.message));
    return true;
  }
});
if (conErrores.length) {
  console.error(`PHP con errores de sintaxis: ${conErrores.map((f) => path.relative(STAGING, f)).join(', ')}`);
  process.exit(1);
}

// 4. Zip y, para producción, el script de la base al lado
fs.rmSync(ZIP, { force: true });
execFileSync(TAR, ['-a', '-c', '-f', ZIP, '-C', STAGING, 'index.html', 'frontend', 'backend'], { stdio: 'inherit' });
if (entorno === 'produccion') {
  fs.copyFileSync(path.join(RAIZ, 'backend', 'config', 'script.sql'), path.join(DIST, 'script.sql'));
}

const total = archivosDe(STAGING).length;
console.log(`\nPaquete: ${path.relative(RAIZ, ZIP)} (${total} archivos, ${(fs.statSync(ZIP).size / 1024).toFixed(0)} KB, ${php.length} PHP sin errores)`);
if (entorno === 'produccion') console.log('Base de datos: dist/script.sql (importar en phpMyAdmin; no subirlo al sitio)');
avisos.forEach((a) => console.log(`AVISO: ${a}`));
