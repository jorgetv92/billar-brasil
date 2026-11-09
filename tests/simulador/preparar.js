// Arma el entorno de simulación: una copia del sitio con reloj controlable y una BD clon.
// La BD real solo se lee con mysqldump. Todo lo que se escribe va a billar_sim.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BD_SIM, DIR_RESULTADOS, DIR_SIM, DIR_SITIO, MYSQL, MYSQLDUMP, PHP, RAIZ_REPO } = require('./config');

const ARCHIVO_DB = path.join('backend', 'config', 'database.php');
const CLAVE_ADMIN_SIM = 'sim-admin';
// Migraciones que el código actual necesita y que la BD de origen puede no tener todavía.
const MIGRACIONES = [path.join('backend', 'config', 'migracion_motor_cobro.sql')];

function leerBdOrigen() {
  const php = fs.readFileSync(path.join(RAIZ_REPO, ARCHIVO_DB), 'utf8');
  const hallado = php.match(/\$db_name\s*=\s*"([^"]+)"/);
  if (!hallado) throw new Error(`No se encontró $db_name en ${ARCHIVO_DB}`);
  if (hallado[1] === BD_SIM) throw new Error(`${ARCHIVO_DB} ya apunta a ${BD_SIM}: no hay de dónde clonar`);
  return hallado[1];
}

function copiarSitio() {
  fs.rmSync(DIR_SITIO, { recursive: true, force: true });
  fs.mkdirSync(DIR_SITIO, { recursive: true });
  fs.mkdirSync(DIR_RESULTADOS, { recursive: true });
  for (const elemento of ['backend', 'frontend', 'index.html']) {
    fs.cpSync(path.join(RAIZ_REPO, elemento), path.join(DIR_SITIO, elemento), { recursive: true });
  }
}

// PHP lee la hora desde un archivo que la simulación va adelantando.
function redirigirReloj() {
  const dirConfig = path.join(DIR_SITIO, 'backend', 'config');
  fs.writeFileSync(
    path.join(dirConfig, 'sim_clock.php'),
    `<?php
function sim_time(){ static $t=null; if($t===null){ $t=(int)trim(file_get_contents(__DIR__.'/sim_clock.txt')); } return $t; }
function sim_date($f,$ts=null){ return date($f, $ts===null ? sim_time() : $ts); }
`,
  );
  fs.writeFileSync(path.join(dirConfig, 'sim_clock.txt'), String(Math.floor(Date.now() / 1000)));
  for (const carpeta of ['api', 'models']) {
    const dir = path.join(DIR_SITIO, 'backend', carpeta);
    for (const archivo of fs.readdirSync(dir).filter((f) => f.endsWith('.php'))) {
      const ruta = path.join(dir, archivo);
      let codigo = fs.readFileSync(ruta, 'utf8');
      let cambios = 0;
      codigo = codigo
        .replace(/(?<![\w>$:])date\(/g, () => (cambios++, 'sim_date('))
        .replace(/(?<![\w>$:])time\(\)/g, () => (cambios++, 'sim_time()'));
      if (cambios) {
        fs.writeFileSync(ruta, codigo.replace('<?php', "<?php require_once __DIR__.'/../config/sim_clock.php';"));
      }
    }
  }
}

// Apunta la copia al clon y sincroniza NOW() de MySQL. Si no se puede garantizar, aborta:
// una simulación corriendo contra la BD real sería peor que no tener simulación.
function apuntarAlClon(origen) {
  const ruta = path.join(DIR_SITIO, ARCHIVO_DB);
  const marcaZona = `$this->conn->exec("SET time_zone = '" . $offset . "'");`;
  let php = fs.readFileSync(ruta, 'utf8');
  php = php
    .replace('<?php', "<?php require_once __DIR__.'/sim_clock.php';")
    .replace(/(\$db_name\s*=\s*")[^"]+(")/, `$1${BD_SIM}$2`)
    .replace(marcaZona, `${marcaZona}\n            $this->conn->exec("SET TIMESTAMP = " . sim_time());`);
  if (php.includes(`"${origen}"`) || !php.includes(`"${BD_SIM}"`) || !php.includes('SET TIMESTAMP')) {
    throw new Error(`No se pudo redirigir ${ARCHIVO_DB} al clon: se aborta para no tocar la BD real`);
  }
  fs.writeFileSync(ruta, php);
}

function clonarBd(origen, { reset }) {
  const volcado = path.join(DIR_SIM, 'origen.sql');
  execFileSync(MYSQLDUMP, [
    '-uroot',
    '--default-character-set=utf8mb4',
    '--single-transaction',
    `--result-file=${volcado}`,
    origen,
  ]);
  const mysql = (args, input) =>
    execFileSync(MYSQL, ['-uroot', '--default-character-set=utf8mb4', ...args], { input, maxBuffer: 1 << 26 });
  mysql(['-e', `DROP DATABASE IF EXISTS ${BD_SIM}; CREATE DATABASE ${BD_SIM} CHARACTER SET utf8mb4;`]);
  mysql([BD_SIM], fs.readFileSync(volcado));
  for (const migracion of MIGRACIONES) {
    const yaAplicada = execFileSync(
      MYSQL,
      ['-uroot', '--batch', '--skip-column-names', BD_SIM, '-e', "SHOW COLUMNS FROM ventas LIKE 'redondeo'"],
      { encoding: 'utf8' },
    ).trim();
    if (!yaAplicada) mysql([BD_SIM], fs.readFileSync(path.join(RAIZ_REPO, migracion)));
  }
  if (reset) {
    mysql([BD_SIM], fs.readFileSync(path.join(__dirname, 'reset.sql')));
    const hash = execFileSync(
      PHP,
      ['-r', `echo password_hash('${CLAVE_ADMIN_SIM}', PASSWORD_BCRYPT);`],
      { encoding: 'utf8' },
    ).trim();
    mysql([BD_SIM], `INSERT INTO usuarios (nombres, apellidos, usuario, password, rol) VALUES ('Sim','Admin','sim_admin','${hash}','administrador');`);
  }
}

function preparar({ reset = true } = {}) {
  const origen = leerBdOrigen();
  copiarSitio();
  redirigirReloj();
  apuntarAlClon(origen);
  clonarBd(origen, { reset });
}

module.exports = { preparar, CLAVE_ADMIN_SIM };
