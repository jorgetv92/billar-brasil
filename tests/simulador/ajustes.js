// Corregir una venta ya cobrada: el total se recalcula con las mismas reglas, los pagos siguen sumando
// el total (devolviendo primero efectivo) y queda registro. Solo con la jornada abierta.
const fs = require('fs');
const path = require('path');
const { BASE, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q } = require('./lib');

const P = { Macanuda: 1, Corona: 6, SodaPop: 12 };

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}

async function llamar(metodo, ruta, cuerpo) {
  const r = await fetch(`${BASE}/backend/api/${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch (e) {
    return { status: 'no_json', raw: texto.slice(0, 300) };
  }
}
const editar = (idDetalle, cantidad) => llamar('PUT', 'jornada.php?action=editar_detalle_venta', { id_detalle: idDetalle, nueva_cantidad: cantidad, id_usuario: 4 });
const borrar = (idDetalle) => llamar('DELETE', `jornada.php?action=eliminar_detalle_venta&id_detalle=${idDetalle}&id_usuario=4`);

const venta = (id) =>
  q(`SELECT v.*, (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta) pagos,
       (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta AND metodo_pago='efectivo') ef,
       (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta AND metodo_pago='qr') qr,
       (SELECT COALESCE(SUM(cantidad*precio_unitario_aplicado),0) FROM detalle_venta_productos d WHERE d.id_venta=v.id_venta) det
     FROM ventas v WHERE id_venta=${id}`)[0];
const detalleDe = (idVenta, idProducto) => +q(`SELECT id_detalle_prod i FROM detalle_venta_productos WHERE id_venta=${idVenta} AND id_producto=${idProducto}`)[0].i;
const stock = (id) => +q(`SELECT stock_actual s FROM productos WHERE id_producto=${id}`)[0].s;
const cuadra = (v) =>
  Math.abs(+v.pagos - +v.total_pagar) < 0.005 &&
  Math.abs(+v.det - +v.subtotal_productos) < 0.005 &&
  Math.abs(+v.subtotal_mesas + +v.subtotal_productos - +v.descuentos + +v.subtotal_cargos + +v.redondeo - +v.total_pagar) < 0.005 &&
  Math.round(+v.total_pagar * 100) % 50 === 0;
const resumen = (v) => `total ${v.total_pagar} (m ${v.subtotal_mesas} p ${v.subtotal_productos} d ${v.descuentos} r ${v.redondeo}) | ef ${v.ef} qr ${v.qr}`;

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

  // ---------- MARTES: 2x1 de Macanuda de 17:00 a 22:00 ----------
  await s.at('2026-12-08 16:00:00');
  await s.cargarPortal();
  await s.carga([[P.Macanuda, 50], [P.Corona, 50], [P.SodaPop, 50]]);
  await s.abrirJornada(100);

  console.log('\n--- 2x1 recalculado');
  await s.at('2026-12-08 17:05:00');
  const v2x1 = (await barra([[P.Macanuda, 2]], { caso: '2 Macanuda en 2x1' })).id_venta;
  const det2x1 = detalleDe(v2x1, P.Macanuda);
  const stockMac = stock(P.Macanuda);
  await s.at('2026-12-08 22:30:00');
  let r = await editar(det2x1, 3);
  let v = venta(v2x1);
  comprobar('Subir a 3 después de la promo: conserva el 2x1 del pedido y cobra 22 más', r.status === 'success' && +v.total_pagar === 44 && +v.ef === 44 && cuadra(v), `${resumen(v)} | ${r.mensaje_caja}`);
  comprobar('El cajero ve cuánto cobrar', r.mensaje_caja === 'Cobrar al cliente 22.00 Bs en efectivo.', r.mensaje_caja);
  comprobar('El stock baja una unidad', stock(P.Macanuda) === stockMac - 1);
  r = await editar(det2x1, 1);
  v = venta(v2x1);
  comprobar('Bajar a 1: sin unidad gratis, devuelve 22', r.status === 'success' && +v.total_pagar === 22 && +v.ef === 22 && cuadra(v) && r.mensaje_caja === 'Devolver al cliente 22.00 Bs en efectivo.', `${resumen(v)} | ${r.mensaje_caja}`);
  comprobar('El stock vuelve', stock(P.Macanuda) === stockMac + 1);
  const sinStock = await editar(det2x1, 1 + stock(P.Macanuda) + 1);
  comprobar('Subir más que el stock se rechaza sin cambios', sinStock.codigo === 'stock_insuficiente' && +venta(v2x1).total_pagar === 22, sinStock.message);

  console.log('\n--- Pago mixto: se devuelve primero el efectivo');
  const vMixto = (await barra([[P.Corona, 3]], { mixto: true, caso: '3 Corona mixto' })).id_venta;
  q(`UPDATE pagos_venta SET monto_pagado = IF(metodo_pago='efectivo', 10, 62) WHERE id_venta=${vMixto}`);
  const detMixto = detalleDe(vMixto, P.Corona);
  r = await editar(detMixto, 2);
  v = venta(vMixto);
  comprobar('Devolver 24 con 10 en efectivo y 62 por QR: 10 de efectivo y 14 de QR', +v.ef === 0 && +v.qr === 48 && cuadra(v) && r.mensaje_caja === 'Devolver al cliente 10.00 Bs en efectivo y 14.00 Bs por QR.', `${resumen(v)} | ${r.mensaje_caja}`);
  r = await editar(detMixto, 3);
  v = venta(vMixto);
  comprobar('Si después hay que cobrar más, se cobra con el medio que quedó', +v.qr === 72 && cuadra(v) && r.mensaje_caja === 'Cobrar al cliente 24.00 Bs por QR.', `${resumen(v)} | ${r.mensaje_caja}`);
  r = await borrar(detMixto);
  v = venta(vMixto);
  comprobar('Borrar el único producto deja la venta en 0 y sin pagos', r.status === 'success' && +v.total_pagar === 0 && +v.pagos === 0 && cuadra(v), `${resumen(v)} | ${r.mensaje_caja}`);
  comprobar('"Mis ventas" muestra el total recalculado de la venta de barra', r.importe === 0, `importe ${r.importe}`);

  console.log('\n--- Venta de mesa: el tiempo no cambia, el redondeo sí');
  await s.at('2026-12-08 22:40:00');
  await s.abrirMesa('Billar #1');
  await s.consumo('Billar #1', P.SodaPop, 2);
  await s.at('2026-12-08 23:45:00');
  const vMesa = (await s.cobrarMesa('Billar #1', { caso: 'Billar 65 min + 2 sodas' })).id_venta;
  v = venta(vMesa);
  const tiempo = +v.subtotal_mesas;
  r = await editar(detalleDe(vMesa, P.SodaPop), 1);
  v = venta(vMesa);
  comprobar('Bajar una soda: 16,25 + 8 = 24,25 → 24,50 y devuelve 8', +v.subtotal_mesas === tiempo && +v.total_pagar === 24.5 && +v.redondeo === 0.25 && cuadra(v), `${resumen(v)} | ${r.mensaje_caja}`);
  comprobar('"Mis ventas" muestra los productos de la venta de mesa', r.importe === 8, `importe ${r.importe}`);

  console.log('\n--- Pantalla "Mis ventas"');
  const idSoda = detalleDe(vMesa, P.SodaPop);
  await s.vista('dashboard_atencion.html', '#jornadaContainer');
  await page.evaluate(() => abrirModalMisVentas());
  await page.waitForSelector(`.btn-accion-editar[data-id="${idSoda}"]`, { state: 'attached', timeout: 15000 });
  await page.evaluate((id) => document.querySelector(`.btn-accion-editar[data-id="${id}"]`).click(), idSoda);
  await page.evaluate((id) => {
    document.getElementById(`input-cantidad-${id}`).value = '2';
    document.querySelector(`.btn-confirmar-edicion[data-id="${id}"]`).click();
  }, idSoda);
  await page.waitForTimeout(400);
  const aviso = await s.toastUltimo();
  const importePantalla = await page.evaluate((id) => document.getElementById(`importe-venta-${id}`).innerText, vMesa);
  v = venta(vMesa);
  comprobar('Editar desde la pantalla avisa al cajero cuánto cobrar', aviso && aviso.t === 'warning' && aviso.m.includes('Cobrar al cliente 8.00 Bs en efectivo.'), aviso && aviso.m);
  comprobar('La fila muestra el importe nuevo y la venta cuadra', importePantalla === '16.00 Bs' && +v.total_pagar === 32.5 && cuadra(v), `${importePantalla} | ${resumen(v)}`);
  await page.evaluate(() => {
    document.getElementById('modalMisVentas').style.display = 'none';
  });

  const bitacora = q(`SELECT * FROM ajustes_venta WHERE id_venta=${vMixto} ORDER BY id_ajuste`);
  comprobar(
    'Cada corrección queda en la bitácora con lo que se movió',
    bitacora.length === 3 && +bitacora[0].ajuste_efectivo === -10 && +bitacora[0].ajuste_qr === -14 && +bitacora[2].cantidad_nueva === 0 && bitacora[2].id_usuario === '4',
    JSON.stringify(bitacora.map((b) => [b.cantidad_anterior, b.cantidad_nueva, b.total_anterior, b.total_nuevo, b.ajuste_efectivo, b.ajuste_qr])),
  );

  console.log('\n--- Caja');
  const pre = await s.api('GET', 'jornada.php?action=precierre');
  const pagosJornada = q(`SELECT metodo_pago m, SUM(monto_pagado) t FROM pagos_venta p JOIN ventas v USING(id_venta) WHERE v.id_jornada=${s.j.id} GROUP BY metodo_pago`);
  const porMetodo = Object.fromEntries(pagosJornada.map((x) => [x.m, +x.t]));
  const totales = +q(`SELECT SUM(total_pagar) t FROM ventas WHERE id_jornada=${s.j.id}`)[0].t;
  comprobar('El pre-cierre suma los pagos ya corregidos', +pre.caja.ingresos_efectivo === (porMetodo.efectivo || 0) && +pre.caja.ingresos_qr === (porMetodo.qr || 0) && Math.abs((porMetodo.efectivo || 0) + (porMetodo.qr || 0) - totales) < 0.005, JSON.stringify(pre.caja));

  const idJornadaCerrada = s.j.id;
  await s.at('2026-12-08 23:55:00');
  await s.cerrarJornada();
  const antes = venta(vMesa);
  const cerrada = await editar(detalleDe(vMesa, P.SodaPop), 2);
  comprobar('Una venta de una jornada cerrada no se puede corregir', cerrada.codigo === 'jornada_cerrada' && venta(vMesa).total_pagar === antes.total_pagar, `${cerrada.message} (jornada ${idJornadaCerrada})`);

  // ---------- SÁBADO: hora gratis por 4 Corona ----------
  await s.at('2026-12-12 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);
  const vHora = (await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #2', caso: 'hora gratis' })).id_venta;
  const hora = await editar(detalleDe(vHora, P.Corona), 3);
  const conHora = venta(vHora);
  comprobar('Corregir una venta con hora gratis conserva el cargo de la hora (3 Corona + 5 = 77)', hora.status === 'success' && +conHora.total_pagar === 77 && +conHora.subtotal_cargos === 5 && cuadra(conHora), `${resumen(conHora)} | ${hora.mensaje_caja}`);

  comprobar('Sin errores de JavaScript', errores.length === 0, errores.join(' / '));
  await navegador.close();
  const fallas = resultados.filter((x) => !x.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'ajustes.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
