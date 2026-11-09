// Reportes: lo de mesas más lo de productos es lo que entró a caja, en el pre-cierre, el cierre, el reporte
// del admin y el dashboard. El inventario cuadra con cargas y muestra lo que no explican ventas ni cargas.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q } = require('./lib');

const P = { Corona: 6, SodaPop: 12 };

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}
const iguales = (a, b) => Math.abs(a - b) < 0.005;
const cobradoEn = (idJornada) => +q(`SELECT COALESCE(SUM(monto_pagado),0) t FROM pagos_venta p JOIN ventas v USING(id_venta) WHERE v.id_jornada=${idJornada}`)[0].t;

(async () => {
  const { navegador, page } = await abrirNavegador();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const s = new Sim(page);
  const barra = async (lineas, opciones) => {
    await page.evaluate(() => {
      if (modoActual === 'mesa') gestorUI.deseleccionarMesa();
    });
    return s.ventaBarra(lineas, opciones);
  };

  // Viernes: sin promociones de prueba.
  await s.at('2026-12-11 16:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);
  const id = s.j.id;

  await s.at('2026-12-11 16:05:00');
  await s.carga([[P.Corona, 10]]);
  await barra([[P.Corona, 2]], { caso: 'barra 2 Corona' });

  await s.abrirMesa('Billar #3');
  await s.abrirMesa('Billar #5');
  await s.at('2026-12-11 16:15:00');
  await s.transferir('Billar #3', 'Billar #4');
  await s.at('2026-12-11 16:25:00');
  await s.pausar('Billar #4');
  await s.at('2026-12-11 16:35:00');
  await s.reanudar('Billar #4');
  await s.consumo('Billar #4', P.SodaPop, 1);
  await s.at('2026-12-11 16:50:00');
  await s.cobrarMixto('Billar #4', { caso: 'partida transferida y pausada, mixto' });

  await s.abrirMesa('Billar #2');
  await s.consumo('Billar #2', P.Corona, 1);
  q(`UPDATE productos SET stock_actual = stock_actual - 1 WHERE id_producto=${P.SodaPop}`);

  // Se deja como una venta de antes del motor de cobro: pagó 16,50 pero su total quedó en 16,25.
  await s.at('2026-12-11 17:10:00');
  const antigua = await s.cobrarMesa('Billar #5', { caso: 'Billar 65 min' });
  q(`UPDATE ventas SET redondeo = 0, total_pagar = 16.25 WHERE id_venta = ${antigua.id_venta}`);

  await s.at('2026-12-11 17:15:00');
  console.log('\n--- Pre-cierre con una mesa abierta');
  const pre = await s.api('GET', 'jornada.php?action=precierre');
  const fila = (nombre) => pre.inventario.find((f) => f.nombre_producto === nombre);
  const corona = fila('Corona');
  const soda = fila('Soda Popular');
  comprobar('Las cargas del turno aparecen en el inventario', corona.cargas === 10, JSON.stringify(corona));
  comprobar('El consumo de una mesa abierta se ve aparte y no descuadra', corona.en_mesas === 1 && corona.ajuste === 0, JSON.stringify(corona));
  comprobar('Un cambio manual de stock aparece como diferencia', soda.ajuste === -1, JSON.stringify(soda));
  const cobrado = cobradoEn(id);
  comprobar('Pre-cierre: mesas + productos = cobrado, también con la venta antigua', iguales(pre.ingresos.mesas.total + pre.ingresos.productos.total, cobrado) && iguales(pre.caja.ingresos_efectivo + pre.caja.ingresos_qr, cobrado), `mesas ${pre.ingresos.mesas.total} + productos ${pre.ingresos.productos.total} | cobrado ${cobrado}`);

  const dash = await s.api('GET', 'jornada.php?action=dashboard_admin');
  comprobar('Dashboard del admin: mesas + productos = cobrado', iguales(dash.kpis.ingresos_mesas + dash.kpis.ingresos_productos, cobrado), JSON.stringify(dash.kpis));

  console.log('\n--- Reporte del admin');
  const rep = (await s.api('GET', `reportes.php?tipo=jornada&id_jornada=${id}&apertura=true&mesas=true&productos=true&egresos=true&insumos=true`)).data;
  const mesas = +rep.mesas.resumen.efectivo + +rep.mesas.resumen.qr;
  const productos = +rep.productos.resumen.efectivo + +rep.productos.resumen.qr;
  comprobar('Admin: mesas + productos = cobrado', iguales(mesas + productos, cobrado), `mesas ${mesas} + productos ${productos}`);
  comprobar('Admin: coincide con el pre-cierre', iguales(mesas, pre.ingresos.mesas.total) && iguales(productos, pre.ingresos.productos.total));
  const transferidas = rep.mesas.filas.filter((f) => f.mesa.includes('→'));
  comprobar(
    'Una partida transferida y pausada es una sola fila con su recorrido y el tiempo jugado (10 + 10 + 15 min)',
    transferidas.length === 1 && transferidas[0].mesa === 'Billar #3 → Billar #4' && transferidas[0].tiempo_uso === '00:35:00',
    JSON.stringify(rep.mesas.filas),
  );
  const filaAntigua = rep.mesas.filas.find((f) => +f.id_venta === antigua.id_venta);
  comprobar('La venta antigua reparte lo que realmente se pagó', filaAntigua && filaAntigua.total === '16.50', JSON.stringify(filaAntigua));
  comprobar('Las filas suman el resumen', iguales(rep.mesas.filas.reduce((a, f) => a + +f.total, 0), mesas) && iguales(rep.productos.filas.reduce((a, f) => a + +f.total, 0), productos));

  console.log('\n--- Cierre');
  await s.at('2026-12-11 17:30:00');
  await s.cobrarMesa('Billar #2', { caso: 'cobro antes de cerrar' });
  await s.cerrarJornada();
  const cierre = s.jornadas[s.jornadas.length - 1];
  const texto = cierre.textoFinal.replace(/\s+/g, ' ');
  const kpis = texto.match(/Rendimiento de Mesas ([\d:]+) hrs jugadas (-?[\d.]+) Bs Rendimiento de Productos (\d+) uds vendidas (-?[\d.]+) Bs/i);
  const cobradoFinal = cobradoEn(id);
  comprobar('Reporte de cierre: mesas + productos = cobrado', kpis && iguales(+kpis[2] + +kpis[4], cobradoFinal), `${kpis && kpis[2]} + ${kpis && kpis[4]} | cobrado ${cobradoFinal}`);
  comprobar('Reporte de cierre: muestra las horas jugadas (35 + 65 + 40 min = 2:20)', kpis && kpis[1] === '02:20', kpis && kpis[1]);

  comprobar('Sin errores de JavaScript', errores.length === 0, errores.join(' / '));
  await navegador.close();
  const fallas = resultados.filter((x) => !x.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'reportes.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
