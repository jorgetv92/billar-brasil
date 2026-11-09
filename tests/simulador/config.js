// Rutas y programas del simulador. Lo generado (copia del sitio, resultados) queda fuera del repo.
const os = require('os');
const path = require('path');

const RAIZ_REPO = path.resolve(__dirname, '..', '..');
const DIR_SIM = process.env.BILLAR_SIM_DIR || path.join(os.tmpdir(), 'billar-sim');

module.exports = {
  RAIZ_REPO,
  DIR_SIM,
  DIR_SITIO: path.join(DIR_SIM, 'sitio'),
  DIR_RESULTADOS: path.join(DIR_SIM, 'resultados'),
  BD_SIM: 'billar_sim',
  PUERTOS: [8765, 8766],
  BASE: 'http://127.0.0.1:8765',
  BASE2: 'http://127.0.0.1:8766',
  MYSQL: process.env.MYSQL_BIN || 'C:/xampp/mysql/bin/mysql.exe',
  MYSQLDUMP: process.env.MYSQLDUMP_BIN || 'C:/xampp/mysql/bin/mysqldump.exe',
  PHP: process.env.PHP_BIN || 'C:/xampp/php/php.exe',
};
