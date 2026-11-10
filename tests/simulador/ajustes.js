// Corregir una venta ya cobrada: el total se recalcula con las mismas reglas, los pagos siguen sumando
// el total (devolviendo primero efectivo) y queda registro. Solo con la jornada abierta.
const fs = require('fs');
const path = require('path');
const { BASE, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, apiAdmin, q } = require('./lib');
const { CLAVE_ADMIN_SIM } = require('./preparar');

const P = { Macanuda: 1, Corona: 6, SodaPop: 12 };

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}

// Las correcciones las hace un supervisor con su sesión (el cajero necesita su autorización).
const llamar = (metodo, ruta, cuerpo, usuario = 'sim_supervisor') => apiAdmin(metodo, ruta, cuerpo, { usuario });
const comoNadie = (metodo, ruta, cuerpo) => apiAdmin(metodo, ruta, cuerpo, { sesion: false });
const comoCaja = (metodo, ruta, cuerpo) => apiAdmin(metodo, ruta, cuerpo, { usuario: 'sim_caja' });
const idUsuario = (usuario) => q(`SELECT id_usuario i FROM usuarios WHERE usuario='${usuario}'`)[0].i;
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

  console.log('\n--- 2x1 y correcciones');
  await s.at('2026-12-08 17:05:00');
  // Un par 2x1 tiene el precio repartido entre sus dos unidades: no se corrige por separado.
  const vPar = (await barra([[P.Macanuda, 2, 'par']], { caso: '1 par Macanuda 2x1' })).id_venta;
  const detPar = detalleDe(vPar, P.Macanuda);
  const rPar = await editar(detPar, 3);
  comprobar('Un par 2x1 no se corrige por separado', rPar.codigo === 'no_editable' && +venta(vPar).total_pagar === 22, rPar.message);

  // Unidades sueltas en horario de 2x1: pagan precio completo y se corrigen como cualquier producto.
  const v2x1 = (await barra([[P.Macanuda, 2]], { caso: '2 Macanuda sueltas en horario 2x1' })).id_venta;
  const det2x1 = detalleDe(v2x1, P.Macanuda);
  const stockMac = stock(P.Macanuda);
  await s.at('2026-12-08 22:30:00');
  let r = await editar(det2x1, 3);
  let v = venta(v2x1);
  comprobar('Subir a 3 unidades sueltas: cobra 22 más', r.status === 'success' && +v.total_pagar === 66 && +v.ef === 66 && cuadra(v), `${resumen(v)} | ${r.mensaje_caja}`);
  comprobar('El cajero ve cuánto cobrar', r.mensaje_caja === 'Cobrar al cliente 22.00 Bs en efectivo.', r.mensaje_caja);
  comprobar('El stock baja una unidad', stock(P.Macanuda) === stockMac - 1);
  r = await editar(det2x1, 1);
  v = venta(v2x1);
  comprobar('Bajar a 1: devuelve 44', r.status === 'success' && +v.total_pagar === 22 && +v.ef === 22 && cuadra(v) && r.mensaje_caja === 'Devolver al cliente 44.00 Bs en efectivo.', `${resumen(v)} | ${r.mensaje_caja}`);
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

  console.log('\n--- Quién ve y corrige las ventas (API)');
  const idDet = detalleDe(vMesa, P.SodaPop);
  const sinSesion = await comoNadie('GET', 'jornada.php?action=ventas_jornada');
  const sinSesionEditar = await comoNadie('PUT', 'jornada.php?action=editar_detalle_venta', { id_detalle: idDet, nueva_cantidad: 5 });
  comprobar('Sin sesión no se ven ni se corrigen las ventas', sinSesion.http === 403 && sinSesion.codigo === 'requiere_supervisor' && sinSesionEditar.http === 403 && +venta(vMesa).total_pagar === 24.5, `${sinSesion.http} / ${sinSesionEditar.http}`);
  const caja = await comoCaja('GET', 'jornada.php?action=ventas_jornada');
  const cajaBorrar = await comoCaja('DELETE', `jornada.php?action=eliminar_detalle_venta&id_detalle=${idDet}`);
  comprobar('Un usuario de atención, con su sesión, tampoco', caja.http === 403 && cajaBorrar.http === 403 && +venta(vMesa).total_pagar === 24.5, `${caja.http} / ${cajaBorrar.http}`);
  const estadoCaja = await comoCaja('GET', 'autorizacion.php');
  const estadoSup = await llamar('GET', 'autorizacion.php');
  comprobar('El estado distingue al supervisor del cajero', estadoCaja.es_supervisor === false && estadoCaja.rol === 'atencion' && estadoSup.es_supervisor === true && estadoSup.rol === 'supervisor', JSON.stringify([estadoCaja, estadoSup]));
  const conCaja = await comoCaja('POST', 'autorizacion.php', { usuario: 'sim_caja', password: CLAVE_ADMIN_SIM });
  const malaClave = await comoCaja('POST', 'autorizacion.php', { usuario: 'sim_supervisor', password: 'equivocada' });
  comprobar('Un cajero no puede autorizar, y una contraseña equivocada tampoco', conCaja.http === 403 && malaClave.http === 401 && (await comoCaja('GET', 'jornada.php?action=ventas_jornada')).http === 403, `${conCaja.message} / ${malaClave.message}`);
  const autorizo = await comoCaja('POST', 'autorizacion.php', { usuario: 'sim_supervisor', password: CLAVE_ADMIN_SIM });
  const autorizado = await comoCaja('GET', 'jornada.php?action=ventas_jornada');
  comprobar('Con la autorización del supervisor el cajero ve las ventas', autorizo.status === 'success' && autorizo.supervisor === 'Sim Supervisor' && autorizado.status === 'success' && autorizado.ventas.length > 0, autorizo.message);
  await comoCaja('DELETE', 'autorizacion.php');
  comprobar('Al retirar la autorización vuelve a pedirla', (await comoCaja('GET', 'jornada.php?action=ventas_jornada')).http === 403);
  const admin = await llamar('GET', 'jornada.php?action=ventas_jornada', null, 'sim_admin');
  comprobar('Un administrador las ve con su sesión', admin.status === 'success');

  console.log('\n--- Pantalla "Mis ventas"');
  const idSoda = detalleDe(vMesa, P.SodaPop);
  await s.vista('dashboard_atencion.html', '#jornadaContainer');
  const panel = () => page.evaluate(() => ({
    login: getComputedStyle(document.getElementById('misVentasLogin')).display !== 'none',
    ventas: getComputedStyle(document.getElementById('misVentasContenido')).display !== 'none',
    filas: document.querySelectorAll('#misVentasTbody .btn-accion-editar').length,
    error: document.getElementById('supError').textContent,
    supervisor: getComputedStyle(document.getElementById('lblSupervisorVentas')).display === 'none' ? '' : document.querySelector('#lblSupervisorVentas span').textContent,
  }));
  const ingresar = async (usuario, clave) => {
    await page.fill('#supUsuario', usuario);
    await page.fill('#supPassword', clave);
    await page.click('#supAutorizar');
    await page.waitForTimeout(700);
  };
  // El portal de prueba no inició sesión: es como un cajero.
  await page.evaluate(() => abrirModalMisVentas());
  await page.waitForTimeout(500);
  let p = await panel();
  comprobar('Cajero: "Mis ventas" muestra primero el login de supervisor, sin ventas', p.login && !p.ventas && p.filas === 0, JSON.stringify(p));
  await ingresar('sim_caja', CLAVE_ADMIN_SIM);
  p = await panel();
  comprobar('Cajero: si ingresa un usuario de atención, avisa y no muestra ventas', p.login && !p.ventas && p.error.includes('no es supervisor'), JSON.stringify(p));
  await ingresar('sim_supervisor', CLAVE_ADMIN_SIM);
  p = await panel();
  comprobar('Cajero: con los datos del supervisor se muestran las ventas y quién autorizó', !p.login && p.ventas && p.filas > 0 && p.supervisor === 'Autorizó: Sim Supervisor', JSON.stringify(p));
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
  await page.click('#btnCerrarMisVentas2');
  await page.waitForTimeout(300);
  const trasCerrar = await page.evaluate(async () => (await fetch('../backend/api/jornada.php?action=ventas_jornada')).status);
  comprobar('Cajero: al cerrar el modal la autorización termina', trasCerrar === 403, `HTTP ${trasCerrar}`);
  await page.evaluate(() => abrirModalMisVentas());
  await page.waitForTimeout(500);
  p = await panel();
  comprobar('Cajero: al volver a abrir pide otra vez al supervisor', p.login && !p.ventas && p.filas === 0, JSON.stringify(p));
  await page.click('#btnCerrarMisVentas');

  // Un supervisor que inició sesión atiende igual y ve las ventas directo.
  const login = await page.request.post(`${BASE}/backend/api/login.php`, { data: { usuario: 'sim_supervisor', password: CLAVE_ADMIN_SIM } });
  await page.evaluate(() => abrirModalMisVentas());
  await page.waitForTimeout(700);
  p = await panel();
  comprobar('Supervisor con sesión: ve las ventas sin login', login.ok() && !p.login && p.ventas && p.filas > 0 && p.supervisor === '', JSON.stringify(p));
  await page.click('#btnCerrarMisVentas2');
  await page.waitForTimeout(200);
  const sigueSupervisor = await page.evaluate(async () => (await fetch('../backend/api/jornada.php?action=ventas_jornada')).status);
  comprobar('Supervisor con sesión: cerrar el modal no le quita el acceso', sigueSupervisor === 200, `HTTP ${sigueSupervisor}`);

  const bitacora = q(`SELECT * FROM ajustes_venta WHERE id_venta=${vMixto} ORDER BY id_ajuste`);
  comprobar(
    'Cada corrección queda en la bitácora con lo que se movió',
    bitacora.length === 3 && +bitacora[0].ajuste_efectivo === -10 && +bitacora[0].ajuste_qr === -14 && +bitacora[2].cantidad_nueva === 0 && bitacora[2].id_usuario === '4' && bitacora.every((b) => b.id_autorizo === idUsuario('sim_supervisor')),
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

  // ---------- SÁBADO: hora con descuento por 4 Corona ----------
  await s.at('2026-12-12 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);
  const vHora = (await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #2', caso: 'hora con descuento' })).id_venta;
  const hora = await editar(detalleDe(vHora, P.Corona), 3);
  const conHora = venta(vHora);
  comprobar('Corregir una venta con hora con descuento conserva el cargo de la hora (3 Corona + 5 = 77)', hora.status === 'success' && +conHora.total_pagar === 77 && +conHora.subtotal_cargos === 5 && cuadra(conHora), `${resumen(conHora)} | ${hora.mensaje_caja}`);

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
