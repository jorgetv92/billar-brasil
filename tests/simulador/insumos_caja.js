// Cargas de mercadería e insumos, gastos de insumos, egresos y cuadre de caja. Revisa que el stock de productos
// e insumos y el efectivo cierren exactos, también cuando dos cajas o el cierre se cruzan con otra operación.
const fs = require('fs');
const path = require('path');
const { BASE, BASE2, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, apiAdmin, q } = require('./lib');

const P = { Macanuda: 1, Corona: 6 };
const VUELTAS = 8;

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}
const iguales = (a, b) => Math.abs(a - b) < 0.005;
const r2 = (x) => Math.round(x * 100) / 100;
const json = (x) => JSON.stringify(x).slice(0, 220);

const api = (metodo, ruta, cuerpo, opciones) => apiAdmin(metodo, ruta, cuerpo, opciones);
const stockP = (id) => +q(`SELECT stock_actual s FROM productos WHERE id_producto=${id}`)[0].s;
const stockI = (id) => +q(`SELECT stock_actual s FROM insumos WHERE id_insumo=${id}`)[0].s;
const idProducto = (nombre) => +q(`SELECT id_producto i FROM productos WHERE nombre_producto='${nombre}'`)[0].i;
const idInsumo = (nombre) => +q(`SELECT id_insumo i FROM insumos WHERE nombre_insumo='${nombre}'`)[0].i;
const precio = (id) => +q(`SELECT precio_venta p FROM productos WHERE id_producto=${id}`)[0].p;
const ultimaCarga = () => +q('SELECT MAX(id_carga) i FROM cargas')[0].i;
const estadoCarga = (id) => q(`SELECT estado FROM cargas WHERE id_carga=${id}`)[0].estado;
const jornadaAbierta = () => q("SELECT id_jornada FROM jornadas WHERE estado='abierta'");

const carga = (items, base = BASE) => api('POST', 'cargas.php', { tipo_carga: 'producto', items: items.map(([id_producto, cantidad]) => ({ id_producto, cantidad })) }, { base });
const cargaInsumo = (items) => api('POST', 'cargas_insumos.php', { tipo_carga: 'insumo', items: items.map(([id_insumo, cantidad]) => ({ id_insumo, cantidad })) });
const gasto = (cuerpo, base = BASE) => api('POST', 'gastos_insumos.php', cuerpo, { base });
const egreso = (cuerpo, base = BASE) => api('POST', 'egresos_caja.php', cuerpo, { base });

// Cuánto cobra el sistema un pedido de barra sin promociones: precio de lista redondeado hacia arriba a 0.50.
const totalBarra = (lineas) => Math.ceil(lineas.reduce((t, [id, c]) => t + precio(id) * c, 0) * 2) / 2;
let operacion = 0;
async function venta(lineas, metodo = 'efectivo', base = BASE) {
  const total = totalBarra(lineas);
  const r = await api('POST', 'atencion_barra.php', {
    accion: 'registrar_venta_barra',
    total_mostrado: total,
    pagos: [{ metodo, monto: total }],
    productos: lineas.map(([id_producto, cantidad]) => ({ id_producto, cantidad })),
    id_operacion: `insumos-caja-${Date.now()}-${operacion++}`,
  }, { base });
  return { ...r, total };
}

(async () => {
  const { navegador, page } = await abrirNavegador();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const s = new Sim(page);
  const PROMORAS = idProducto('Promoras');
  const PREPARADO = idProducto('SIM Vaso de Fernet');
  const RETIRADO = idProducto('SIM Producto retirado');
  const I = { Det: idInsumo('SIM Detergente'), Papel: idInsumo('SIM Papel'), Hielo: idInsumo('SIM Hielo') };

  // ================= SIN JORNADA: cargas y validaciones =================
  await s.at('2026-12-02 10:00:00');
  await s.cargarPortal();
  console.log('\n--- Permisos y validaciones de cargas');
  const corona0 = stockP(P.Corona);
  const sinSesion = await api('POST', 'cargas.php', { items: [{ id_producto: P.Corona, cantidad: 100 }] }, { sesion: false });
  const sinSesionInsumo = await api('POST', 'cargas_insumos.php', { items: [{ id_insumo: I.Det, cantidad: 100 }] }, { sesion: false });
  comprobar('Sin sesión de administrador no se carga stock', sinSesion.http === 403 && sinSesionInsumo.http === 403 && stockP(P.Corona) === corona0 && stockI(I.Det) === 4, `${sinSesion.http} ${sinSesionInsumo.http}`);

  const invalidas = [
    ['sin ítems', []],
    ['cantidad cero', [[P.Corona, 0]]],
    ['cantidad negativa', [[P.Corona, -5]]],
    ['media unidad', [[P.Corona, 1.5]]],
    ['producto preparado', [[PREPARADO, 5]]],
    ['producto retirado', [[RETIRADO, 5]]],
    ['producto inexistente', [[999999, 5]]],
    ['una línea válida y otra inválida', [[P.Corona, 5], [P.Macanuda, -1]]],
  ];
  for (const [caso, items] of invalidas) {
    const antes = ultimaCarga();
    const r = await carga(items);
    comprobar(`Carga rechazada: ${caso}`, r.status === 'error' && ultimaCarga() === antes && stockP(P.Corona) === corona0, r.message);
  }
  const tresDecimales = await cargaInsumo([[I.Det, 1.255]]);
  comprobar('Carga de insumo con tres decimales rechazada', tresDecimales.status === 'error' && stockI(I.Det) === 4, tresDecimales.message);

  console.log('\n--- Cargas válidas, edición y anulación');
  const macanuda0 = stockP(P.Macanuda);
  const c1 = await carga([[P.Corona, 10], [P.Macanuda, 5], [P.Corona, 2]]);
  const lineasC1 = q(`SELECT id_producto, cantidad FROM detalle_cargas WHERE id_carga=${c1.id_carga} ORDER BY id_producto`);
  comprobar('Carga con un producto repetido: se suma en una sola línea', c1.status === 'success' && stockP(P.Corona) === corona0 + 12 && stockP(P.Macanuda) === macanuda0 + 5 && lineasC1.length === 2, json(lineasC1));

  const ci = await cargaInsumo([[I.Det, 2.5], [I.Papel, 10]]);
  comprobar('Carga de insumos con decimales', ci.status === 'success' && iguales(stockI(I.Det), 6.5) && iguales(stockI(I.Papel), 30), `${stockI(I.Det)} ${stockI(I.Papel)}`);

  const listaProd = (await api('GET', 'cargas.php')).data.map((c) => +c.id_carga);
  const listaIns = (await api('GET', 'cargas_insumos.php')).data.map((c) => +c.id_carga);
  comprobar('Cada pantalla lista solo sus cargas', listaProd.includes(c1.id_carga) && !listaProd.includes(ci.id_carga) && listaIns.includes(ci.id_carga) && !listaIns.includes(c1.id_carga));
  const cruzada = await api('DELETE', 'cargas.php', { id_carga: ci.id_carga });
  comprobar('Una carga de insumos no se anula desde la pantalla de mercadería', cruzada.status === 'error' && estadoCarga(ci.id_carga) === 'activo' && iguales(stockI(I.Det), 6.5), cruzada.message);

  const detalle = (await api('GET', `cargas.php?id_carga=${c1.id_carga}`)).data.detalle;
  comprobar('El detalle para editar trae números, no texto', detalle.every((d) => typeof d.cantidad === 'number' && typeof d.id_producto === 'number'), json(detalle));
  const editada = await api('PUT', 'cargas.php', { id_carga: c1.id_carga, items: [{ id_producto: P.Corona, cantidad: 8 }, { id_producto: P.Macanuda, cantidad: 5 }] });
  comprobar('Editar una carga mueve solo la diferencia', editada.status === 'success' && stockP(P.Corona) === corona0 + 8 && stockP(P.Macanuda) === macanuda0 + 5, editada.message);
  const sinMacanuda = await api('PUT', 'cargas.php', { id_carga: c1.id_carga, items: [{ id_producto: P.Corona, cantidad: 8 }] });
  comprobar('Quitar un producto de la carga le descuenta lo cargado', sinMacanuda.status === 'success' && stockP(P.Macanuda) === macanuda0, sinMacanuda.message);
  const conPreparado = await api('PUT', 'cargas.php', { id_carga: c1.id_carga, items: [{ id_producto: P.Corona, cantidad: 8 }, { id_producto: PREPARADO, cantidad: 3 }] });
  comprobar('Editar no permite agregar un preparado', conPreparado.status === 'error' && stockP(P.Corona) === corona0 + 8, conPreparado.message);

  const insumoEditado = await api('PUT', 'cargas_insumos.php', { id_carga: ci.id_carga, items: [{ id_insumo: I.Det, cantidad: 3.75 }, { id_insumo: I.Papel, cantidad: 10 }] });
  comprobar('Editar una carga de insumos con decimales', insumoEditado.status === 'success' && iguales(stockI(I.Det), 7.75), `${stockI(I.Det)}`);
  const anuladaI = await api('DELETE', 'cargas_insumos.php', { id_carga: ci.id_carga });
  comprobar('Anular la carga de insumos devuelve el stock', anuladaI.status === 'success' && iguales(stockI(I.Det), 4) && iguales(stockI(I.Papel), 20), `${stockI(I.Det)} ${stockI(I.Papel)}`);
  const anuladaP = await api('DELETE', 'cargas.php', { id_carga: c1.id_carga });
  const deNuevo = await api('DELETE', 'cargas.php', { id_carga: c1.id_carga });
  const editarAnulada = await api('PUT', 'cargas.php', { id_carga: c1.id_carga, items: [{ id_producto: P.Corona, cantidad: 50 }] });
  comprobar('Una carga anulada no se anula dos veces ni se edita', anuladaP.status === 'success' && deNuevo.status === 'error' && editarAnulada.status === 'error' && stockP(P.Corona) === corona0, `${deNuevo.message} / ${editarAnulada.message}`);
  const bitacora = q(`SELECT accion FROM bitacora_cargas WHERE id_carga=${c1.id_carga} ORDER BY id_bitacora`).map((b) => b.accion).join(',');
  comprobar('La bitácora guarda las ediciones y la anulación', bitacora === 'modificacion,modificacion,anulacion', bitacora);

  console.log('\n--- Sin jornada abierta');
  const gastoSin = await gasto({ accion: 'crear', id_insumo: I.Det, cantidad: 1 });
  const egresoSin = await egreso({ accion: 'crear', concepto: 'x', monto: 10 });
  comprobar('Sin jornada no se registran gastos de insumo ni egresos', gastoSin.status === 'error' && egresoSin.status === 'error' && stockI(I.Det) === 4);

  // ================= JORNADA PRINCIPAL =================
  q(`UPDATE productos SET stock_actual=0 WHERE id_producto=${PROMORAS}`);
  await s.at('2026-12-02 14:00:00');
  await s.abrirJornada(200);
  const insumosInicio = Object.fromEntries(Object.entries(I).map(([k, id]) => [k, stockI(id)]));
  const esperadoI = { ...insumosInicio };
  let efectivo = 0;
  let qr = 0;
  let egresos = 0;

  console.log('\n--- Una carga que ya se vendió no se puede deshacer');
  await s.at('2026-12-02 14:05:00');
  const cp = await carga([[PROMORAS, 10]]);
  await s.at('2026-12-02 14:10:00');
  const v1 = await venta([[PROMORAS, 7]]);
  efectivo += v1.total;
  comprobar('Venta de 7 Promoras', v1.status === 'success' && stockP(PROMORAS) === 3, v1.message);
  const anularVendida = await api('DELETE', 'cargas.php', { id_carga: cp.id_carga });
  comprobar('Anular una carga ya vendida se rechaza', anularVendida.status === 'error' && stockP(PROMORAS) === 3 && estadoCarga(cp.id_carga) === 'activo', anularVendida.message);
  const achicarDemasiado = await api('PUT', 'cargas.php', { id_carga: cp.id_carga, items: [{ id_producto: PROMORAS, cantidad: 5 }] });
  comprobar('Achicar la carga por debajo de lo vendido se rechaza', achicarDemasiado.status === 'error' && stockP(PROMORAS) === 3, achicarDemasiado.message);
  const achicar = await api('PUT', 'cargas.php', { id_carga: cp.id_carga, items: [{ id_producto: PROMORAS, cantidad: 7 }] });
  comprobar('Achicar la carga hasta lo vendido sí se puede', achicar.status === 'success' && stockP(PROMORAS) === 0, achicar.message);
  const sinStock = await venta([[PROMORAS, 1]]);
  comprobar('Sin stock no se vende', sinStock.status === 'error' && stockP(PROMORAS) === 0, sinStock.message);

  console.log('\n--- Cargas y ventas del mismo producto a la vez, en dos cajas');
  await s.at('2026-12-02 15:00:00');
  let malas = 0;
  let detalleMalas = '';
  for (let i = 0; i < VUELTAS; i++) {
    const antes = stockP(P.Corona);
    const [rv, rc] = await Promise.all([venta([[P.Corona, 2]], 'efectivo', BASE), carga([[P.Corona, 3]], BASE2)]);
    if (rv.status === 'success') efectivo += rv.total;
    if (rv.status !== 'success' || rc.status !== 'success' || stockP(P.Corona) !== antes + 1) {
      malas++;
      detalleMalas = json([rv.message, rc.message]);
    }
  }
  comprobar('Carga y venta simultáneas: ninguna falla y el stock queda exacto', malas === 0, `vueltas con error: ${malas} ${detalleMalas}`);
  const vqr = await venta([[P.Macanuda, 1]], 'qr');
  qr += vqr.total;
  comprobar('Venta por QR', vqr.status === 'success', vqr.message);

  console.log('\n--- Gastos de insumos');
  await s.at('2026-12-02 16:00:00');
  const g1 = await gasto({ accion: 'crear', id_insumo: I.Det, cantidad: 1.25 });
  const g2 = await gasto({ accion: 'crear', id_insumo: I.Papel, cantidad: 3 });
  esperadoI.Det -= 1.25;
  esperadoI.Papel -= 3;
  comprobar('Gastos registrados descuentan el insumo', g1.status === 'success' && g2.status === 'success' && iguales(stockI(I.Det), esperadoI.Det) && iguales(stockI(I.Papel), esperadoI.Papel));
  for (const [caso, cuerpo] of [
    ['más de lo que hay', { accion: 'crear', id_insumo: I.Papel, cantidad: 1000 }],
    ['cantidad cero', { accion: 'crear', id_insumo: I.Papel, cantidad: 0 }],
    ['tres decimales', { accion: 'crear', id_insumo: I.Papel, cantidad: 0.001 }],
    ['texto', { accion: 'crear', id_insumo: I.Papel, cantidad: 'dos' }],
    ['insumo inexistente', { accion: 'crear', id_insumo: 999999, cantidad: 1 }],
  ]) {
    const r = await gasto(cuerpo);
    comprobar(`Gasto rechazado: ${caso}`, r.status === 'error' && iguales(stockI(I.Papel), esperadoI.Papel), r.message);
  }
  const g2mas = await gasto({ accion: 'editar', id_gasto: +g2.id_gasto, id_insumo: I.Papel, cantidad: 4 });
  esperadoI.Papel -= 1;
  comprobar('Editar la cantidad de un gasto mueve la diferencia', g2mas.status === 'success' && iguales(stockI(I.Papel), esperadoI.Papel), g2mas.message);
  const g1otro = await gasto({ accion: 'editar', id_gasto: +g1.id_gasto, id_insumo: I.Papel, cantidad: 1 });
  esperadoI.Det += 1.25;
  esperadoI.Papel -= 1;
  comprobar('Cambiar el insumo de un gasto devuelve uno y descuenta el otro', g1otro.status === 'success' && iguales(stockI(I.Det), esperadoI.Det) && iguales(stockI(I.Papel), esperadoI.Papel), `${stockI(I.Det)} ${stockI(I.Papel)}`);
  const g1borrado = await gasto({ accion: 'eliminar', id_gasto: +g1.id_gasto });
  esperadoI.Papel += 1;
  comprobar('Borrar un gasto devuelve el insumo', g1borrado.status === 'success' && iguales(stockI(I.Papel), esperadoI.Papel), g1borrado.message);
  const g3 = await gasto({ accion: 'crear', id_insumo: I.Det, cantidad: 0.5 });
  esperadoI.Det -= 0.5;
  comprobar('Gasto de medio kilo', g3.status === 'success' && iguales(stockI(I.Det), esperadoI.Det));

  // SIM Hielo tiene 5 bolsas: de 10 pedidos simultáneos de 1 bolsa solo pueden pasar 5.
  const hielo = stockI(I.Hielo);
  const pedidos = await Promise.all(Array.from({ length: 10 }, (_, i) => gasto({ accion: 'crear', id_insumo: I.Hielo, cantidad: 1 }, i % 2 ? BASE2 : BASE)));
  const pasaron = pedidos.filter((r) => r.status === 'success').length;
  const registrados = +q(`SELECT COALESCE(SUM(cantidad),0) c FROM gastos_insumos WHERE id_insumo=${I.Hielo}`)[0].c;
  esperadoI.Hielo -= pasaron;
  comprobar('Gastos simultáneos no dejan el insumo negativo', pasaron === hielo && stockI(I.Hielo) === 0 && registrados === pasaron, `pasaron ${pasaron} de 10, stock ${stockI(I.Hielo)}, registrados ${registrados}`);

  console.log('\n--- Egresos de caja');
  const e1 = await egreso({ accion: 'crear', concepto: 'Hielo', monto: 30 });
  const e2 = await egreso({ accion: 'crear', concepto: 'Limpieza', monto: 12.5 });
  egresos += 42.5;
  for (const [caso, monto] of [['negativo', -5], ['cero', 0], ['texto', 'abc'], ['tres decimales', 1.005]]) {
    const r = await egreso({ accion: 'crear', concepto: 'x', monto });
    comprobar(`Egreso rechazado: monto ${caso}`, r.status === 'error', r.message);
  }
  const sinConcepto = await egreso({ accion: 'crear', concepto: '   ', monto: 5 });
  comprobar('Egreso rechazado: sin concepto', sinConcepto.status === 'error', sinConcepto.message);
  const e2edit = await egreso({ accion: 'editar', id_egreso: +e2.id_egreso, concepto: 'Limpieza', monto: 15 });
  egresos += 2.5;
  const e1borrado = await egreso({ accion: 'eliminar', id_egreso: +e1.id_egreso });
  egresos -= 30;
  comprobar('Editar y borrar egresos de la jornada', e2edit.status === 'success' && e1borrado.status === 'success');

  console.log('\n--- Pre-cierre y cierre de la jornada principal');
  await s.at('2026-12-02 20:00:00');
  const jornadaPrincipal = s.j.id;
  const pre = await api('GET', 'jornada.php?action=precierre');
  const ajustes = pre.inventario.filter((f) => f.ajuste !== 0);
  comprobar('Inventario de productos sin descuadres', ajustes.length === 0, json(ajustes));
  const promoras = pre.inventario.find((f) => f.id_producto === PROMORAS);
  comprobar('Promoras: inicial 0 + cargas 7 − vendido 7 = 0', promoras && promoras.stock_inicial === 0 && promoras.cargas === 7 && promoras.vendido === 7 && promoras.stock_final === 0, json(promoras));
  const corona = pre.inventario.find((f) => f.id_producto === P.Corona);
  comprobar(`Corona: cargas ${VUELTAS * 3} y vendido ${VUELTAS * 2} en el turno`, corona && corona.cargas === VUELTAS * 3 && corona.vendido === VUELTAS * 2, json(corona));
  comprobar('Efectivo, QR y egresos del pre-cierre', iguales(pre.caja.ingresos_efectivo, efectivo) && iguales(pre.caja.ingresos_qr, qr) && iguales(pre.caja.egresos, egresos), `ef ${pre.caja.ingresos_efectivo}/${efectivo} qr ${pre.caja.ingresos_qr}/${qr} eg ${pre.caja.egresos}/${egresos}`);
  const repartido = pre.ingresos.mesas.total + pre.ingresos.productos.total + pre.ingresos.cargos.total;
  comprobar('Mesas + productos + cargos = lo cobrado', iguales(repartido, efectivo + qr), `${repartido} vs ${efectivo + qr}`);
  const insumosOk = Object.entries(I).every(([k, id]) => iguales(stockI(id), esperadoI[k]));
  const gastosTurno = Object.fromEntries(q(`SELECT id_insumo, SUM(cantidad) c FROM gastos_insumos WHERE id_jornada=${jornadaPrincipal} GROUP BY id_insumo`).map((g) => [+g.id_insumo, +g.c]));
  const insumosCuadran = Object.entries(I).every(([k, id]) => iguales(insumosInicio[k] - (gastosTurno[id] || 0), stockI(id)));
  comprobar('Insumos: inicio − gastos del turno = stock actual', insumosOk && insumosCuadran, json({ esperadoI, gastosTurno }));
  await s.cerrarJornada();
  const cerrada = s.jornadas[s.jornadas.length - 1];
  comprobar('Efectivo final = apertura + efectivo − egresos', iguales(+cerrada.row.monto_final_efectivo_real, 200 + efectivo - egresos), `${cerrada.row.monto_final_efectivo_real} vs ${r2(200 + efectivo - egresos)}`);
  const filasGasto = +q(`SELECT COUNT(*) c FROM gastos_insumos WHERE id_jornada=${jornadaPrincipal}`)[0].c;
  const enReporte = (cerrada.reporte.data && cerrada.reporte.data.insumos) || [];
  const sumaReporte = enReporte.reduce((t, g) => t + +g.cantidad, 0);
  const sumaBd = Object.values(gastosTurno).reduce((t, c) => t + c, 0);
  comprobar('El reporte del admin trae los gastos de insumos del turno', enReporte.length === filasGasto && filasGasto === 7 && iguales(sumaReporte, sumaBd), `${enReporte.length} filas, ${sumaReporte} vs ${sumaBd}`);

  console.log('\n--- Lo de una jornada cerrada no se toca');
  const borrarCerrado = await egreso({ accion: 'eliminar', id_egreso: +e2.id_egreso });
  const editarCerrado = await egreso({ accion: 'editar', id_egreso: +e2.id_egreso, concepto: 'x', monto: 1 });
  const gastoCerrado = await gasto({ accion: 'eliminar', id_gasto: +g3.id_gasto });
  comprobar('Sin jornada abierta: no se borran egresos ni gastos de un turno cerrado', [borrarCerrado, editarCerrado, gastoCerrado].every((r) => r.status === 'error') && q(`SELECT COUNT(*) c FROM egresos_caja WHERE id_egreso=${e2.id_egreso} AND monto=15`)[0].c === '1' && iguales(stockI(I.Det), esperadoI.Det));
  await s.at('2026-12-02 21:00:00');
  const nueva = await api('POST', 'jornada.php', { monto_inicial: 100, id_usuario: 4 });
  const borrarDeOtra = await egreso({ accion: 'eliminar', id_egreso: +e2.id_egreso });
  const gastoDeOtra = await gasto({ accion: 'editar', id_gasto: +g3.id_gasto, id_insumo: I.Det, cantidad: 0.1 });
  comprobar('Con otra jornada abierta: tampoco', nueva.status === 'success' && borrarDeOtra.status === 'error' && gastoDeOtra.status === 'error' && iguales(stockI(I.Det), esperadoI.Det), `${borrarDeOtra.message} / ${gastoDeOtra.message}`);
  await api('POST', 'jornada.php?action=cerrar');

  console.log('\n--- Egresos y gastos que se cruzan con el cierre');
  let descuadres = 0;
  let detalleCruce = '';
  const resultadosCruce = { dentro: 0, rechazados: 0 };
  for (let i = 0; i < VUELTAS; i++) {
    await s.at(`2026-12-03 ${String(10 + i).padStart(2, '0')}:00:00`);
    const abierta = await api('POST', 'jornada.php', { monto_inicial: 50, id_usuario: 4 });
    const id = +abierta.jornada.id_jornada;
    const vv = await venta([[P.Corona, 1]]);
    const [re, rg, rc] = await Promise.all([
      egreso({ accion: 'crear', concepto: `cruce ${i}`, monto: 7 }, BASE2),
      gasto({ accion: 'crear', id_insumo: I.Papel, cantidad: 1 }, BASE2),
      api('POST', 'jornada.php?action=cerrar'),
    ]);
    const enBd = +q(`SELECT COALESCE(SUM(monto),0) m FROM egresos_caja WHERE id_jornada=${id}`)[0].m;
    const final = +q(`SELECT monto_final_efectivo_real m FROM jornadas WHERE id_jornada=${id}`)[0].m;
    const cierreOk = rc.status === 'success';
    const egresoOk = re.status === 'success' ? enBd === 7 && iguales(rc.reporte.caja.egresos, 7) : enBd === 0 && iguales(rc.reporte.caja.egresos, 0);
    if (re.status === 'success') resultadosCruce.dentro++;
    else resultadosCruce.rechazados++;
    if (rg.status === 'success') esperadoI.Papel -= 1;
    if (!cierreOk || !egresoOk || !iguales(final, 50 + vv.total - enBd) || !iguales(stockI(I.Papel), esperadoI.Papel)) {
      descuadres++;
      detalleCruce = json({ re: re.message, rc: rc.message, enBd, final, vv: vv.total });
    }
  }
  comprobar('El cierre incluye el egreso o lo rechaza, nunca a medias', descuadres === 0, `descuadres ${descuadres} ${detalleCruce} ${json(resultadosCruce)}`);

  console.log('\n--- Dos cajas abren la jornada a la vez');
  let dobles = 0;
  for (let i = 0; i < VUELTAS; i++) {
    await s.at(`2026-12-04 ${String(10 + i).padStart(2, '0')}:00:00`);
    const r = await Promise.all([
      api('POST', 'jornada.php', { monto_inicial: 10, id_usuario: 4 }, { base: BASE }),
      api('POST', 'jornada.php', { monto_inicial: 20, id_usuario: 4 }, { base: BASE2 }),
    ]);
    if (r.filter((x) => x.status === 'success').length !== 1 || jornadaAbierta().length !== 1) dobles++;
    while (jornadaAbierta().length) await api('POST', 'jornada.php?action=cerrar');
  }
  comprobar('Nunca quedan dos jornadas abiertas', dobles === 0, `vueltas con error: ${dobles}`);

  console.log('\n--- Cargas que coinciden con la apertura de la jornada');
  const ajustesDelTurno = async () => (await api('GET', 'jornada.php?action=precierre')).inventario.filter((f) => f.ajuste !== 0);
  await s.at('2026-12-05 09:00:00');
  const mismoSegundo = await carga([[P.Corona, 12]]);
  const abreMismoSegundo = await api('POST', 'jornada.php', { monto_inicial: 10, id_usuario: 4 });
  const ajustesMismo = await ajustesDelTurno();
  comprobar('Carga en el mismo segundo de la apertura: no se cuenta dos veces', mismoSegundo.status === 'success' && abreMismoSegundo.status === 'success' && ajustesMismo.length === 0, json(ajustesMismo));
  await api('POST', 'jornada.php?action=cerrar');
  let cruzadas = 0;
  let detalleCruzadas = '';
  for (let i = 0; i < VUELTAS; i++) {
    await s.at(`2026-12-05 ${String(10 + i).padStart(2, '0')}:00:00`);
    const [ra, rc] = await Promise.all([
      api('POST', 'jornada.php', { monto_inicial: 10, id_usuario: 4 }, { base: BASE }),
      carga([[P.Corona, 1], [P.Macanuda, 1]], BASE2),
    ]);
    const malos = ra.status === 'success' ? await ajustesDelTurno() : ['no abrió'];
    if (ra.status !== 'success' || rc.status !== 'success' || malos.length) {
      cruzadas++;
      detalleCruzadas = json({ ra: ra.message, rc: rc.message, malos });
    }
    while (jornadaAbierta().length) await api('POST', 'jornada.php?action=cerrar');
  }
  comprobar('Carga y apertura simultáneas: el inventario del turno cuadra', cruzadas === 0, `vueltas con error: ${cruzadas} ${detalleCruzadas}`);

  console.log('\n--- Stock final');
  const negativos = q('SELECT nombre_producto n, stock_actual s FROM productos WHERE stock_actual < 0 UNION ALL SELECT nombre_insumo, stock_actual FROM insumos WHERE stock_actual < 0');
  comprobar('Ningún producto ni insumo quedó negativo', negativos.length === 0, json(negativos));
  comprobar('Sin errores de JavaScript en la pantalla', errores.length === 0, errores.join(' | '));

  await navegador.close();
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'insumos_caja.json'), JSON.stringify(resultados, null, 2));
  const fallas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} comprobaciones correctas`);
  process.exit(fallas.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
