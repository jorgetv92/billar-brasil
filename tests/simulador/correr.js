// Punto de entrada: node correr.js <unidad|doble|limpieza|reglas|turnos|todo>
// Cada grupo parte de un clon nuevo de la BD para que los resultados no dependan del orden.
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const { DIR_SITIO, PHP, PUERTOS } = require('./config');
const { preparar } = require('./preparar');

const GRUPOS = {
  unidad: { nodo: ['--test', 'oraculo.test.js'], sinEntorno: true },
  doble: { archivos: ['doble_ocupacion.js'] },
  motor: { archivos: ['motor.js'] },
  ajustes: { archivos: ['ajustes.js'] },
  reportes: { archivos: ['reportes.js'] },
  combos: { archivos: ['combos_cargos.js'] },
  insumos: { archivos: ['insumos_caja.js'] },
  limpieza: { archivos: ['limpieza.js'], reset: false },
  reglas: { archivos: ['reglas_negocio.js'] },
  turnos: { archivos: ['turnos.js', 'dirigidas.js', 'analizar.js'] },
};

function esperarPuerto(puerto, intentos = 50) {
  return new Promise((resolve, reject) => {
    const probar = (resto) => {
      const conexion = net.connect(puerto, '127.0.0.1');
      conexion.once('connect', () => {
        conexion.destroy();
        resolve();
      });
      conexion.once('error', () => {
        conexion.destroy();
        if (resto <= 0) return reject(new Error(`El servidor no respondió en el puerto ${puerto}`));
        setTimeout(() => probar(resto - 1), 100);
      });
    };
    probar(intentos);
  });
}

// Dos servidores sobre la misma copia: php -S atiende de a una petición y las carreras necesitan paralelismo real.
async function iniciarServidores() {
  const servidores = PUERTOS.map((puerto) =>
    spawn(PHP, ['-S', `127.0.0.1:${puerto}`, '-t', DIR_SITIO], { stdio: 'ignore' }),
  );
  await Promise.all(PUERTOS.map((puerto) => esperarPuerto(puerto)));
  return () => servidores.forEach((servidor) => servidor.kill());
}

const correrNodo = (args) => spawnSync(process.execPath, args, { cwd: __dirname, stdio: 'inherit' }).status === 0;

async function correrGrupo(nombre) {
  const grupo = GRUPOS[nombre];
  console.log(`\n========== ${nombre.toUpperCase()} ==========`);
  if (grupo.sinEntorno) return correrNodo(grupo.nodo);
  preparar({ reset: grupo.reset !== false });
  const detener = await iniciarServidores();
  try {
    let ok = true;
    for (const archivo of grupo.archivos) ok = correrNodo([archivo]) && ok;
    return ok;
  } finally {
    detener();
  }
}

(async () => {
  const pedido = process.argv[2] || 'todo';
  const nombres = pedido === 'todo' ? Object.keys(GRUPOS) : [pedido];
  if (nombres.some((n) => !GRUPOS[n])) {
    console.error(`Grupo desconocido: ${pedido}. Opciones: ${Object.keys(GRUPOS).join(', ')}, todo`);
    process.exit(2);
  }
  const resultados = [];
  for (const nombre of nombres) resultados.push([nombre, await correrGrupo(nombre)]);
  console.log('\n========== RESUMEN ==========');
  for (const [nombre, ok] of resultados) console.log(`${ok ? '✓' : '✗'} ${nombre}`);
  process.exit(resultados.every(([, ok]) => ok) ? 0 : 1);
})().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
