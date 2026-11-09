// Combos que elige el cajero, productos preparados sin stock, productos retirados y cargos (roturas,
// hora gratis). Todo por la pantalla real, salvo lo que solo se puede provocar por la API.
const fs = require('fs');
const path = require('path');
const { BASE, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q } = require('./lib');

const P = { Macanuda: 1, Corona: 6, AmstelBot: 46 };
const COMBO_AMSTEL = 109;
const COMBO_NOCTURNO = 110;

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}
const iguales = (a, b) => Math.abs(a - b) < 0.005;

async function post(cuerpo) {
  const r = await fetch(`${BASE}/backend/api/atencion_barra.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return r.json();
}
const stock = (id) => +q(`SELECT stock_actual s FROM productos WHERE id_producto=${id}`)[0].s;
const idProducto = (nombre) => +q(`SELECT id_producto i FROM productos WHERE nombre_producto='${nombre}'`)[0].i;
const venta = (id) =>
  q(`SELECT v.*, (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta) pagos,
       (SELECT COALESCE(SUM(cantidad*precio_unitario_aplicado),0) FROM detalle_venta_productos d WHERE d.id_venta=v.id_venta) det
     FROM ventas v WHERE id_venta=${id}`)[0];
const ultimaVenta = () => venta(q('SELECT MAX(id_venta) i FROM ventas')[0].i);
const cuadra = (v) =>
  iguales(+v.pagos, +v.total_pagar) && iguales(+v.det, +v.subtotal_productos) &&
  iguales(+v.subtotal_mesas + +v.subtotal_productos - +v.descuentos + +v.subtotal_cargos + +v.redondeo, +v.total_pagar);
const resumen = (v) => `total ${v.total_pagar} (m ${v.subtotal_mesas} p ${v.subtotal_productos} c ${v.subtotal_cargos} r ${v.redondeo}) pagos ${v.pagos}`;

(async () => {
  const { navegador, page } = await abrirNavegador();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => {
    errores.push('ALERT ' + d.message());
    d.accept().catch(() => {});
  });
  const s = new Sim(page);

  // Elige en el buscador la opción que empieza con $texto, como lo haría el cajero.
  const elegir = (texto, cantidad = 1) =>
    page.evaluate(({ texto, cantidad }) => {
      const p = gestorUI.productosLocal.find((x) => x.display_nombre.startsWith(texto));
      if (!p) return null;
      document.querySelector('.formulario-venta input[type="text"]').value = p.display_nombre;
      document.querySelector('.formulario-venta input[type="number"]').value = cantidad;
      return p.display_nombre;
    }, { texto, cantidad });
  const agregar = () => page.evaluate(() => gestorUI.agregarProductoAlCarrito());
  const enBarra = () => page.evaluate(() => { if (modoActual === 'mesa') gestorUI.deseleccionarMesa(); });
  const cobrarBarra = async () => {
    await page.evaluate(() => gestorUI.iniciarFlujoCobro('efectivo_qr'));
    const pantalla = await page.evaluate(() => parseFloat(document.getElementById('lblTotalCobrarModal').innerText));
    await page.evaluate(() => gestorUI.ejecutarCobroConfirmado());
    await page.waitForTimeout(100);
    return pantalla;
  };
  const agregarCargo = (concepto, monto, descripcion) =>
    page.evaluate(async ({ concepto, monto, descripcion }) => {
      await gestorUI.abrirModalCargo();
      const sel = document.getElementById('selectConceptoCargo');
      const opcion = Array.from(sel.options).find((o) => o.text.startsWith(concepto));
      sel.value = opcion ? opcion.value : '';
      gestorUI.onConceptoCargo();
      if (monto !== null) document.getElementById('inputMontoCargo').value = monto;
      if (descripcion) document.getElementById('inputDescripcionCargo').value = descripcion;
      await gestorUI.confirmarCargo();
    }, { concepto, monto, descripcion });

  // ---------- VIERNES ----------
  await s.at('2026-12-18 19:00:00');
  await s.cargarPortal();
  await s.carga([[P.AmstelBot, 50], [P.Macanuda, 20], [P.Corona, 20]]);
  await s.abrirJornada(100);

  console.log('\n--- Buscador');
  const opciones = await page.evaluate(() => gestorUI.productosLocal.map((p) => p.display_nombre));
  const conPromo = opciones.filter((o) => o.toLowerCase().includes('promo'));
  comprobar('Al escribir "promo" aparecen los combos y también el producto "Promoras"', conPromo.some((o) => o.startsWith('Promo: SIM Combo 2 Amstel')) && conPromo.some((o) => o.startsWith('Promoras - ')), conPromo.join(' | '));
  comprobar('Cada opción del buscador es distinta', new Set(opciones).size === opciones.length);
  comprobar('Un combo fuera de su horario no aparece', !opciones.some((o) => o.includes('SIM Combo nocturno')));
  comprobar('Un producto retirado no aparece', !opciones.some((o) => o.startsWith('SIM Producto retirado')));
  comprobar('Un preparado aparece sin stock', opciones.some((o) => o.startsWith('SIM Vaso de Fernet - preparado - 30.00 Bs')));

  console.log('\n--- Barra');
  await s.at('2026-12-18 19:05:00');
  const amstel = stock(P.AmstelBot);
  await enBarra();
  await elegir('Promo: SIM Combo 2 Amstel');
  await agregar();
  let pantalla = await cobrarBarra();
  let v = ultimaVenta();
  const lineasCombo = q(`SELECT id_producto, cantidad, precio_unitario_aplicado p, id_promocion FROM detalle_venta_productos WHERE id_venta=${v.id_venta}`);
  comprobar('Combo elegido en barra: se cobra el precio del combo', pantalla === 30 && +v.total_pagar === 30 && cuadra(v), `pantalla ${pantalla} | ${resumen(v)}`);
  comprobar('El combo descuenta el stock de sus productos reales', stock(P.AmstelBot) === amstel - 2 && lineasCombo.length === 1 && +lineasCombo[0].id_promocion === COMBO_AMSTEL && +lineasCombo[0].cantidad === 2, JSON.stringify(lineasCombo));

  const vaso = idProducto('SIM Vaso de Fernet');
  await elegir('SIM Vaso de Fernet', 3);
  await agregar();
  pantalla = await cobrarBarra();
  v = ultimaVenta();
  comprobar('Un preparado se vende sin stock y no lo descuenta', pantalla === 90 && +v.total_pagar === 90 && stock(vaso) === 0 && cuadra(v), `${resumen(v)} | stock ${stock(vaso)}`);

  const retirado = await post({ accion: 'cotizar_carrito', productos: [{ id_producto: idProducto('SIM Producto retirado'), cantidad: 1 }] });
  comprobar('Un producto retirado no se puede vender', retirado.codigo === 'producto_invalido', retirado.message);

  await elegir('Corona -', 1);
  await agregar();
  await agregarCargo('SIM Vaso roto', 12, 'Botella rota en la barra');
  pantalla = await cobrarBarra();
  v = ultimaVenta();
  const cargoBarra = q(`SELECT tipo, descripcion, monto FROM cargos_venta WHERE id_venta=${v.id_venta}`);
  comprobar('Cargo en barra con el monto cambiado por el cajero: 24 + 12', pantalla === 36 && +v.subtotal_cargos === 12 && +v.subtotal_productos === 24 && cuadra(v), resumen(v));
  comprobar('El cargo queda con su descripción y no como producto', cargoBarra.length === 1 && cargoBarra[0].tipo === 'cargo' && cargoBarra[0].descripcion === 'Botella rota en la barra', JSON.stringify(cargoBarra));

  console.log('\n--- Mesa');
  await s.at('2026-12-18 19:10:00');
  await s.abrirMesa('Billar #1');
  await s.sel('Billar #1');
  await elegir('Promo: SIM Combo 2 Amstel');
  await agregar();
  await agregarCargo('SIM Vaso roto', null, null);
  const cargosMesa = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').map((i) => [i.nombre, i.total]));
  comprobar('Cargo en mesa con el monto sugerido', cargosMesa.length === 1 && cargosMesa[0][1] === 8, JSON.stringify(cargosMesa));
  await page.evaluate(() => gestorUI.eliminarDelCarrito(gestorUI.itemsCarrito.findIndex((i) => i.tipo === 'cargo')));
  const sinCargo = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').length);
  comprobar('Un cargo se puede quitar de la mesa', sinCargo === 0);
  await agregarCargo('SIM Vaso roto', null, null);

  await s.at('2026-12-18 20:10:00');
  const nocturno = await elegir('Promo: SIM Combo nocturno');
  comprobar('El combo con horario aparece al empezar su horario', !!nocturno, nocturno);
  await agregar();
  const mesa = await s.cobrarMesa('Billar #1', { caso: 'mesa con 2 combos y un cargo' });
  v = venta(mesa.id_venta);
  comprobar('Mesa: 1 h (15) + combos (30 + 40) + cargo (8) = 93', mesa.pantalla === 93 && +v.total_pagar === 93 && +v.subtotal_cargos === 8 && cuadra(v), `pantalla ${mesa.pantalla} | ${resumen(v)}`);

  const lineaCombo = q(`SELECT id_detalle_prod i FROM detalle_venta_productos WHERE id_venta=${v.id_venta} AND id_promocion IS NOT NULL LIMIT 1`)[0].i;
  const editarCombo = await s.api('PUT', 'jornada.php?action=editar_detalle_venta', { id_detalle: +lineaCombo, nueva_cantidad: 5 });
  comprobar('Los productos de un combo no se corrigen por separado', editarCombo.codigo === 'no_editable', editarCombo.message);

  await s.at('2026-12-18 23:30:00');
  const fuera = await post({ accion: 'cotizar_carrito', combos: [{ id_promocion: COMBO_NOCTURNO, cantidad: 1 }] });
  comprobar('Un combo fuera de su horario no se puede vender', fuera.codigo === 'promo_no_vigente', fuera.message);

  await s.cerrarJornada();
  let rep = s.jornadas[s.jornadas.length - 1].reporte.data;
  let suma = (x) => +x.resumen.efectivo + +x.resumen.qr;
  let cobrado = +rep.apertura.ingreso_efectivo + +rep.apertura.ingreso_qr;
  comprobar('Reporte: mesas + productos + cargos = cobrado', iguales(suma(rep.mesas) + suma(rep.productos) + suma(rep.cargos), cobrado), `${suma(rep.mesas)} + ${suma(rep.productos)} + ${suma(rep.cargos)} | cobrado ${cobrado}`);
  comprobar('Reporte: los cargos van aparte (12 + 8)', iguales(suma(rep.cargos), 20) && rep.cargos.filas.length === 2, JSON.stringify(rep.cargos.filas));

  // ---------- SÁBADO: hora gratis por 4 Corona ----------
  console.log('\n--- Hora gratis');
  await s.at('2026-12-19 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);
  await s.at('2026-12-19 14:05:00');
  const barraHora = await s.ventaBarra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #3', caso: 'barra con hora gratis' });
  v = venta(barraHora.id_venta);
  const cargosHora = q(`SELECT tipo, monto FROM cargos_venta WHERE id_venta=${v.id_venta}`);
  comprobar('Hora gratis en barra: 4 Corona + 5 de cargo, sin producto falso', barraHora.pantalla === 101 && +v.subtotal_productos === 96 && cargosHora.length === 1 && cargosHora[0].tipo === 'hora_gratis' && cuadra(v), `${resumen(v)} | ${JSON.stringify(cargosHora)}`);

  await s.abrirMesa('Billar #2');
  await s.consumo('Billar #2', P.Corona, 4, { incentivo: 'si' });
  const enMesa = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').map((i) => [i.nombre, i.total, i.es_hora_gratis]));
  comprobar('Hora gratis en mesa: queda como cargo de la mesa', enMesa.length === 1 && enMesa[0][1] === 5 && enMesa[0][2] === true, JSON.stringify(enMesa));
  await s.at('2026-12-19 15:15:00');
  const m2 = await s.cobrarMesa('Billar #2', { caso: 'mesa con hora gratis 70 min' });
  v = venta(m2.id_venta);
  comprobar('Mesa con hora gratis: 10 min (2,50) + 96 + 5 = 103,50', m2.pantalla === 103.5 && +v.total_pagar === 103.5 && cuadra(v), resumen(v));
  await s.at('2026-12-19 15:20:00');
  await s.cobrarMesa('Billar #3', { caso: 'mesa abierta por la hora gratis de barra' });
  await s.cerrarJornada();
  rep = s.jornadas[s.jornadas.length - 1].reporte.data;
  cobrado = +rep.apertura.ingreso_efectivo + +rep.apertura.ingreso_qr;
  const horas = +q(`SELECT COALESCE(SUM(c.monto),0) t FROM cargos_venta c JOIN ventas v USING(id_venta) WHERE v.id_jornada=${s.jornadas[s.jornadas.length - 1].id} AND c.tipo='hora_gratis'`)[0].t;
  comprobar('Lo pagado por la hora gratis cuenta como ingreso de mesas', iguales(suma(rep.cargos), 0) && suma(rep.mesas) >= horas && iguales(suma(rep.mesas) + suma(rep.productos), cobrado), `mesas ${suma(rep.mesas)} (horas gratis ${horas}) + productos ${suma(rep.productos)} | cobrado ${cobrado}`);

  comprobar('Sin errores de JavaScript ni alertas', errores.length === 0, errores.join(' / '));
  await navegador.close();
  const fallas = resultados.filter((x) => !x.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'combos_cargos.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
