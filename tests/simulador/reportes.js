// Reportes: lo de mesas más lo de productos es lo que entró a caja, en el pre-cierre, el cierre, el reporte
// del admin y el dashboard. El inventario cuadra con cargas y muestra lo que no explican ventas ni cargas.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, apiAdmin, q } = require('./lib');

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

  console.log('\n--- Ingresos por semana y por mes');
  // Sábado: una jornada que cruza la medianoche cuenta en el sábado. Lunes 14: ya es otra semana.
  await s.at('2026-12-12 22:00:00');
  await s.abrirJornada(100);
  const idSabado = s.j.id;
  await barra([[P.Corona, 3]], { caso: 'sábado barra' });
  await s.egreso('Hielo', 15);
  await s.at('2026-12-13 00:30:00');
  await barra([[P.SodaPop, 2]], { caso: 'pasada la medianoche', metodo: 'qr' });
  await s.cerrarJornada();
  await s.at('2026-12-14 18:00:00');
  await s.abrirJornada(100);
  const idLunes = s.j.id;
  await barra([[P.Corona, 1]], { caso: 'lunes barra' });
  await s.cerrarJornada();

  const enRango = (desde, hasta) => q(`SELECT id_jornada i FROM jornadas WHERE fecha_hora_apertura >= '${desde} 00:00:00' AND fecha_hora_apertura < '${hasta} 00:00:00'`).map((x) => +x.i);
  const sumaCobrada = (ids) => ids.reduce((a, j) => a + cobradoEn(j), 0);
  const sumaEgresos = (ids) => (ids.length ? +q(`SELECT COALESCE(SUM(monto),0) t FROM egresos_caja WHERE id_jornada IN (${ids.join(',')})`)[0].t : 0);
  const cuadraPeriodo = (d) =>
    iguales(d.totales.mesas + d.totales.productos + d.totales.cargos, d.totales.total) &&
    iguales(d.totales.efectivo + d.totales.qr, d.totales.total) &&
    iguales(d.dias.reduce((a, x) => a + x.total, 0), d.totales.total) &&
    iguales(d.totales.neto, d.totales.total - d.totales.egresos);

  const semana = (await s.api('GET', 'reportes.php?tipo=ingresos_semana&fecha=2026-12-10')).data;
  const idsSemana = enRango('2026-12-07', '2026-12-14');
  comprobar('Semana: va del lunes 07/12 al domingo 13/12, con sus 7 días', semana.periodo.desde === '2026-12-07' && semana.periodo.hasta === '2026-12-13' && semana.dias.length === 7 && semana.dias[0].dia_semana === 1, JSON.stringify(semana.periodo));
  comprobar('Semana: lo cobrado coincide con los pagos de sus jornadas (sin la del lunes 14)', iguales(semana.totales.total, sumaCobrada(idsSemana)) && semana.totales.jornadas === idsSemana.length && idsSemana.includes(id) && idsSemana.includes(idSabado) && !idsSemana.includes(idLunes), `${semana.totales.total} | ${sumaCobrada(idsSemana)} | jornadas ${idsSemana}`);
  comprobar('Semana: mesas + productos + cargos = efectivo + QR = suma de los días', cuadraPeriodo(semana), JSON.stringify(semana.totales));
  const sabado = semana.dias.find((x) => x.fecha === '2026-12-12');
  const domingo = semana.dias.find((x) => x.fecha === '2026-12-13');
  comprobar('Semana: la jornada que pasa la medianoche cuenta toda en el sábado', sabado.jornadas === 1 && iguales(sabado.total, cobradoEn(idSabado)) && domingo.jornadas === 0 && domingo.total === 0, JSON.stringify([sabado, domingo]));
  comprobar('Semana: egresos e "ingresos − egresos"', iguales(semana.totales.egresos, sumaEgresos(idsSemana)) && iguales(sabado.egresos, 15), `egresos ${semana.totales.egresos}`);
  const viernes = semana.dias.find((x) => x.fecha === '2026-12-11');
  const repViernes = s.jornadas.find((j) => j.id === id).reporte.data;
  comprobar('Semana: el viernes muestra lo mismo que el reporte de su jornada', iguales(viernes.mesas, +repViernes.mesas.resumen.efectivo + +repViernes.mesas.resumen.qr) && iguales(viernes.productos, +repViernes.productos.resumen.efectivo + +repViernes.productos.resumen.qr), JSON.stringify(viernes));

  const mes = (await s.api('GET', 'reportes.php?tipo=ingresos_mes&mes=2026-12')).data;
  const idsMes = enRango('2026-12-01', '2027-01-01');
  comprobar('Mes: diciembre con 31 días y todas sus jornadas (también la del lunes 14)', mes.dias.length === 31 && mes.periodo.desde === '2026-12-01' && mes.periodo.hasta === '2026-12-31' && mes.totales.jornadas === idsMes.length && idsMes.includes(idLunes), `${mes.dias.length} días, ${mes.totales.jornadas} jornadas`);
  comprobar('Mes: lo cobrado coincide con los pagos y cuadra por partes', iguales(mes.totales.total, sumaCobrada(idsMes)) && cuadraPeriodo(mes), JSON.stringify(mes.totales));
  comprobar('Mes: productos más vendidos con unidades', mes.productos_top.length > 0 && mes.productos_top.some((p) => p.producto === 'Corona' && p.unidades >= 6), JSON.stringify(mes.productos_top.slice(0, 3)));

  const fechaMala = await s.api('GET', 'reportes.php?tipo=ingresos_semana&fecha=2026-13-40');
  const mesMalo = await s.api('GET', 'reportes.php?tipo=ingresos_mes&mes=2026-1');
  const sinSesion = await apiAdmin('GET', 'reportes.php?tipo=ingresos_mes&mes=2026-12', null, { sesion: false });
  const comoCaja = await apiAdmin('GET', 'reportes.php?tipo=ingresos_mes&mes=2026-12', null, { usuario: 'sim_caja' });
  comprobar('Una fecha o un mes inválido se rechaza; sin ser administrador no hay reportes', fechaMala.status === 'error' && mesMalo.status === 'error' && sinSesion.http === 403 && comoCaja.http === 403, `${fechaMala.message} / ${mesMalo.message} / ${sinSesion.http} / ${comoCaja.http}`);

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
