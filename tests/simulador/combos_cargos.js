// Combos que elige el cajero, productos preparados sin stock, productos retirados y cargos (roturas,
// hora con descuento). Todo por la pantalla real, salvo lo que solo se puede provocar por la API.
const fs = require('fs');
const path = require('path');
const { BASE, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, apiAdmin, q } = require('./lib');

const P = { Macanuda: 1, Corona: 6, AmstelBot: 46 };
const COMBO_AMSTEL = 109;
const COMBO_RETIRADO = 111;

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
  // Arma la lista del modal de cargos tocando los botones, como el cajero, y la agrega de una vez.
  // lista: [{ concepto, cantidad }] para un concepto, [{ otro, monto }] para uno escrito a mano.
  const agregarCargos = (lista) =>
    page.evaluate(async (lista) => {
      await gestorUI.abrirModalCargo();
      for (const c of lista) {
        if (c.otro) {
          document.querySelector('#listaConceptosCargo .cargo-concepto-otro').click();
          document.getElementById('inputDescripcionCargo').value = c.otro;
          document.getElementById('inputMontoCargo').value = c.monto;
          document.querySelector('#formCargoOtro button').click();
        } else {
          const k = gestorUI.conceptosCargo.find((x) => x.nombre.startsWith(c.concepto));
          for (let i = 0; i < (c.cantidad || 1); i++) document.querySelector(`#listaConceptosCargo .cargo-concepto[data-id="${k.id_concepto}"]`).click();
        }
      }
      const boton = document.getElementById('lblBotonCargos').textContent;
      const total = document.getElementById('lblTotalCargosModal').textContent;
      await gestorUI.confirmarCargo();
      return { boton, total, abierto: !document.getElementById('modalAgregarCargo').classList.contains('hidden') };
    }, lista);
  const lineasCargo = () => page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').map((i) => [i.nombre, i.cantidad, i.total]));

  // ---------- VIERNES ----------
  await s.at('2026-12-18 19:00:00');
  await s.cargarPortal();
  await s.carga([[P.AmstelBot, 50], [P.Macanuda, 20], [P.Corona, 20]]);
  await s.abrirJornada(100);

  console.log('\n--- Buscador');
  const opciones = await page.evaluate(() => gestorUI.productosLocal.map((p) => p.display_nombre));
  const conPromo = opciones.filter((o) => o.toLowerCase().includes('promo'));
  const conCombo = opciones.filter((o) => o.toLowerCase().includes('combo'));
  comprobar('Al escribir "combo" aparecen los combos, con lo que traen y lo que alcanza el stock', conCombo.some((o) => /^Combo: SIM Combo 2 Amstel \(2 Amstel ?Botella\) - \d+ disp\. - 30\.00 Bs$/.test(o)), conCombo.join(' | '));
  comprobar('Los combos ya no aparecen como "Promo:"; "promo" sigue mostrando el producto "Promoras"', !conPromo.some((o) => o.includes('SIM Combo')) && conPromo.some((o) => o.startsWith('Promoras - ')), conPromo.join(' | '));
  comprobar('Cada opción del buscador es distinta', new Set(opciones).size === opciones.length);
  comprobar('Un combo retirado no aparece', !opciones.some((o) => o.includes('SIM Combo retirado')));
  comprobar('Un producto retirado no aparece', !opciones.some((o) => o.startsWith('SIM Producto retirado')));
  comprobar('Un preparado aparece sin stock', opciones.some((o) => o.startsWith('SIM Vaso de Fernet - preparado - 30.00 Bs')));

  console.log('\n--- Barra');
  await s.at('2026-12-18 19:05:00');
  const amstel = stock(P.AmstelBot);
  await enBarra();
  await elegir('Combo: SIM Combo 2 Amstel');
  await agregar();
  let pantalla = await cobrarBarra();
  let v = ultimaVenta();
  const lineasCombo = q(`SELECT id_producto, cantidad, precio_unitario_aplicado p, id_combo, id_promocion FROM detalle_venta_productos WHERE id_venta=${v.id_venta}`);
  comprobar('Combo elegido en barra: se cobra el precio del combo', pantalla === 30 && +v.total_pagar === 30 && cuadra(v), `pantalla ${pantalla} | ${resumen(v)}`);
  comprobar('El combo descuenta el stock de sus productos reales', stock(P.AmstelBot) === amstel - 2 && lineasCombo.length === 1 && +lineasCombo[0].id_combo === COMBO_AMSTEL && lineasCombo[0].id_promocion === null && +lineasCombo[0].cantidad === 2, JSON.stringify(lineasCombo));

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
  const modalBarra = await agregarCargos([{ concepto: 'SIM Vaso roto', cantidad: 2 }, { otro: 'Botella rota en la barra', monto: 12 }]);
  comprobar('El modal suma varios cargos con cantidad: "Agregar 3 cargos", 28.00 Bs, y se cierra', modalBarra.boton === 'Agregar 3 cargos' && modalBarra.total === '28.00 Bs' && !modalBarra.abierto, JSON.stringify(modalBarra));
  const enCarritoBarra = await lineasCargo();
  comprobar('Barra: el carrito muestra 2 vasos rotos en una línea y la botella aparte', JSON.stringify(enCarritoBarra) === JSON.stringify([['SIM Vaso roto', 2, 16], ['Botella rota en la barra', 1, 12]]), JSON.stringify(enCarritoBarra));
  pantalla = await cobrarBarra();
  v = ultimaVenta();
  const cargoBarra = q(`SELECT tipo, descripcion, monto FROM cargos_venta WHERE id_venta=${v.id_venta} ORDER BY id_cargo`);
  comprobar('Cargos en barra: 24 + 2 x 8 + 12 escrito por el cajero = 52', pantalla === 52 && +v.subtotal_cargos === 28 && +v.subtotal_productos === 24 && cuadra(v), resumen(v));
  comprobar('Cada cargo queda guardado por unidad, con su descripción y no como producto', cargoBarra.length === 3 && cargoBarra.every((c) => c.tipo === 'cargo') && cargoBarra.filter((c) => c.descripcion === 'SIM Vaso roto').length === 2 && cargoBarra.some((c) => c.descripcion === 'Botella rota en la barra' && +c.monto === 12), JSON.stringify(cargoBarra));
  const cantidadMala = await post({ accion: 'cotizar_carrito', cargos: [{ descripcion: 'Vaso', monto: 8, cantidad: 1.5 }] });
  comprobar('Una cantidad de cargo no entera se rechaza', cantidadMala.codigo === 'cargo_invalido', cantidadMala.message);

  console.log('\n--- Mesa');
  await s.at('2026-12-18 19:10:00');
  await s.abrirMesa('Billar #1');
  await s.sel('Billar #1');
  await elegir('Combo: SIM Combo 2 Amstel');
  await agregar();
  await agregarCargos([{ concepto: 'SIM Vaso roto', cantidad: 2 }, { otro: 'Botella quebrada', monto: 15 }]);
  const cargosMesa = await lineasCargo();
  comprobar('Mesa: 2 vasos rotos (monto sugerido) y una botella, de una vez', JSON.stringify(cargosMesa) === JSON.stringify([['SIM Vaso roto', 2, 16], ['Botella quebrada', 1, 15]]), JSON.stringify(cargosMesa));
  await page.evaluate(() => gestorUI.eliminarDelCarrito(gestorUI.itemsCarrito.findIndex((i) => i.tipo === 'cargo' && i.nombre === 'SIM Vaso roto')));
  await page.evaluate(() => gestorUI.eliminarDelCarrito(gestorUI.itemsCarrito.findIndex((i) => i.tipo === 'cargo' && i.nombre === 'Botella quebrada')));
  const idMesaCargo = await page.evaluate(() => gestorUI.tarjetaSeleccionada().getAttribute('data-id'));
  const sinCargos = await post({ accion: 'agregar_cargo_mesa', id_mesa: +idMesaCargo, cargos: [] });
  comprobar('Agregar una lista vacía de cargos a la mesa se rechaza', sinCargos.codigo === 'cargo_invalido', sinCargos.message);
  const quedanCargos = await lineasCargo();
  comprobar('En la mesa el tacho quita un cargo por vez', JSON.stringify(quedanCargos) === JSON.stringify([['SIM Vaso roto', 1, 8]]), JSON.stringify(quedanCargos));

  await s.at('2026-12-18 20:10:00');
  // Quitar una línea de un combo quita el combo completo y devuelve el stock de todos sus productos.
  const macanuda = stock(P.Macanuda);
  const corona = stock(P.Corona);
  await elegir('Combo: SIM Combo Macanuda Corona');
  await agregar();
  const lineasMesa = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => (i.combo || '').includes('Macanuda Corona')).map((i) => i.nombre));
  comprobar('En la mesa cada producto del combo dice de qué combo es', lineasMesa.length === 2 && lineasMesa.every((n) => n.endsWith('(Combo: SIM Combo Macanuda Corona)')), JSON.stringify(lineasMesa));
  await page.evaluate(() => gestorUI.eliminarDelCarrito(gestorUI.itemsCarrito.findIndex((i) => (i.combo || '').includes('Macanuda Corona'))));
  await page.waitForTimeout(100);
  const quedan = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => (i.combo || '').includes('Macanuda Corona')).length);
  comprobar('Quitar un producto de un combo en la mesa quita el combo completo y devuelve el stock', quedan === 0 && stock(P.Macanuda) === macanuda && stock(P.Corona) === corona, `quedan ${quedan}, Macanuda ${stock(P.Macanuda)}/${macanuda}, Corona ${stock(P.Corona)}/${corona}`);
  await elegir('Combo: SIM Combo Macanuda Corona');
  await agregar();
  const mesa = await s.cobrarMesa('Billar #1', { caso: 'mesa con 2 combos y un cargo' });
  v = venta(mesa.id_venta);
  comprobar('Mesa: 1 h (15) + combos (30 + 40) + cargo (8) = 93', mesa.pantalla === 93 && +v.total_pagar === 93 && +v.subtotal_cargos === 8 && cuadra(v), `pantalla ${mesa.pantalla} | ${resumen(v)}`);

  const lineaCombo = q(`SELECT id_detalle_prod i FROM detalle_venta_productos WHERE id_venta=${v.id_venta} AND id_combo IS NOT NULL LIMIT 1`)[0].i;
  const editarCombo = await s.api('PUT', 'jornada.php?action=editar_detalle_venta', { id_detalle: +lineaCombo, nueva_cantidad: 5 });
  comprobar('Los productos de un combo no se corrigen por separado', editarCombo.codigo === 'no_editable', editarCombo.message);

  await s.at('2026-12-18 23:30:00');
  const retiradoCombo = await post({ accion: 'cotizar_carrito', combos: [{ id_combo: COMBO_RETIRADO, cantidad: 1 }] });
  comprobar('Un combo retirado no se puede vender', retiradoCombo.codigo === 'promo_no_vigente', retiradoCombo.message);

  // Administración de combos (sección Combos del admin)
  const nuevo = await s.api('POST', 'combos.php', { nombre: 'SIM Combo admin', precio: 50, items: [{ id_producto: P.Corona, cantidad: 2 }] });
  const sinProductos = await s.api('POST', 'combos.php', { nombre: 'SIM vacío', precio: 10, items: [] });
  const conRetirado = await s.api('POST', 'combos.php', { nombre: 'SIM con retirado', precio: 10, items: [{ id_producto: idProducto('SIM Producto retirado'), cantidad: 1 }] });
  comprobar('Admin: crea un combo y rechaza uno sin productos o con un producto retirado', nuevo.status === 'success' && sinProductos.status === 'error' && conRetirado.status === 'error', `${sinProductos.message} / ${conRetirado.message}`);
  const borrarVendido = await s.api('DELETE', 'combos.php', { id_combo: COMBO_AMSTEL });
  const borrarNuevo = await s.api('DELETE', 'combos.php', { id_combo: nuevo.id_combo });
  const estadoAmstel = q(`SELECT activo FROM combos WHERE id_combo=${COMBO_AMSTEL}`)[0];
  comprobar('Admin: un combo con ventas se retira (no se borra); uno sin ventas se elimina', estadoAmstel && estadoAmstel.activo === '0' && !q(`SELECT 1 FROM combos WHERE id_combo=${nuevo.id_combo}`).length, `${borrarVendido.message} / ${borrarNuevo.message}`);
  q(`UPDATE combos SET activo=1 WHERE id_combo=${COMBO_AMSTEL}`);
  const sinSesion = await apiAdmin('GET', 'combos.php', null, { sesion: false });
  comprobar('Admin: sin sesión de administrador no se ven ni editan combos', sinSesion.http === 403);

  await s.cerrarJornada();
  let rep = s.jornadas[s.jornadas.length - 1].reporte.data;
  let suma = (x) => +x.resumen.efectivo + +x.resumen.qr;
  let cobrado = +rep.apertura.ingreso_efectivo + +rep.apertura.ingreso_qr;
  comprobar('Reporte: mesas + productos + cargos = cobrado', iguales(suma(rep.mesas) + suma(rep.productos) + suma(rep.cargos), cobrado), `${suma(rep.mesas)} + ${suma(rep.productos)} + ${suma(rep.cargos)} | cobrado ${cobrado}`);
  comprobar('Reporte: los cargos van aparte (barra 8 + 8 + 12, mesa 8)', iguales(suma(rep.cargos), 36) && rep.cargos.filas.length === 4, JSON.stringify(rep.cargos.filas));

  // ---------- SÁBADO: hora con descuento por 4 Corona ----------
  console.log('\n--- Hora con descuento');
  await s.at('2026-12-19 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);
  await s.at('2026-12-19 14:05:00');
  const barraHora = await s.ventaBarra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #3', caso: 'barra con hora con descuento' });
  v = venta(barraHora.id_venta);
  const cargosHora = q(`SELECT tipo, monto FROM cargos_venta WHERE id_venta=${v.id_venta}`);
  comprobar('Hora con descuento en barra: 4 Corona + 5 de cargo, sin producto falso', barraHora.pantalla === 101 && +v.subtotal_productos === 96 && cargosHora.length === 1 && cargosHora[0].tipo === 'hora_gratis' && cuadra(v), `${resumen(v)} | ${JSON.stringify(cargosHora)}`);

  // La promo se elige en el buscador: no se detecta sola por tener 4 Corona.
  const opcionPromo = await page.evaluate(() => (gestorUI.productosLocal.find((x) => x.es_incentivo) || {}).display_nombre);
  comprobar('La promo de hora con descuento está en el buscador con su nombre', opcionPromo === 'Promo: SIM 4 Corona: 1a hora con descuento (4 Corona + 1 hora con descuento en Billar) - 101.00 Bs', opcionPromo);
  await s.at('2026-12-19 14:06:00');
  const sinPromo = await s.ventaBarra([[P.Corona, 4]], { caso: 'barra 4 Corona sin elegir la promo' });
  v = venta(sinPromo.id_venta);
  comprobar('Barra: 4 Corona sin elegir la promo no agrega la hora con descuento', sinPromo.pantalla === 96 && +v.subtotal_cargos === 0 && cuadra(v), resumen(v));
  await s.abrirMesa('Privada #1');
  await s.consumo('Privada #1', P.Corona, 4);
  const cargosPrivada = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').length);
  comprobar('Mesa: 4 Corona sin elegir la promo no agrega la hora con descuento', cargosPrivada === 0);
  await s.elegirPromoHora(null);
  const avisoTipo = await s.toastUltimo();
  const despuesPromo = await page.evaluate(() => gestorUI.itemsCarrito.length);
  comprobar('La promo no se aplica en una mesa de otro tipo', despuesPromo === 1 && avisoTipo && /tipo Billar/.test(avisoTipo.m), JSON.stringify(avisoTipo));

  await s.abrirMesa('Billar #2');
  await s.consumo('Billar #2', P.Corona, 4, { incentivo: 'si' });
  const enMesa = await page.evaluate(() => gestorUI.itemsCarrito.filter((i) => i.tipo === 'cargo').map((i) => [i.nombre, i.total, i.es_hora_gratis]));
  comprobar('Hora con descuento en mesa: queda como cargo de la mesa', enMesa.length === 1 && enMesa[0][1] === 5 && enMesa[0][2] === true, JSON.stringify(enMesa));
  await s.at('2026-12-19 15:15:00');
  const m2 = await s.cobrarMesa('Billar #2', { caso: 'mesa con hora con descuento 70 min' });
  v = venta(m2.id_venta);
  comprobar('Mesa con hora con descuento: 10 min (2,50) + 96 + 5 = 103,50', m2.pantalla === 103.5 && +v.total_pagar === 103.5 && cuadra(v), resumen(v));
  await s.at('2026-12-19 15:20:00');
  await s.cobrarMesa('Billar #3', { caso: 'mesa abierta por la hora con descuento de barra' });
  const privada = await s.cobrarMesa('Privada #1', { caso: 'privada con 4 Corona sin promo' });
  comprobar('Privada: tiempo + 4 Corona, sin cargo', privada && privada.bd.cargos === 0 && iguales(privada.bd.total, privada.oraculo.total), privada && JSON.stringify(privada.bd));
  await s.cerrarJornada();
  rep = s.jornadas[s.jornadas.length - 1].reporte.data;
  cobrado = +rep.apertura.ingreso_efectivo + +rep.apertura.ingreso_qr;
  const horas = +q(`SELECT COALESCE(SUM(c.monto),0) t FROM cargos_venta c JOIN ventas v USING(id_venta) WHERE v.id_jornada=${s.jornadas[s.jornadas.length - 1].id} AND c.tipo='hora_gratis'`)[0].t;
  comprobar('Lo pagado por la hora con descuento cuenta como ingreso de mesas', iguales(suma(rep.cargos), 0) && suma(rep.mesas) >= horas && iguales(suma(rep.mesas) + suma(rep.productos), cobrado), `mesas ${suma(rep.mesas)} (horas gratis ${horas}) + productos ${suma(rep.productos)} | cobrado ${cobrado}`);

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
