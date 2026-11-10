// Revisa los resultados de turnos.js y dirigidas.js: cobros, caja, inventario y reportes.
// Sale con error si alguna venta o algún cuadre falla.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { q, r2, fallasDeVenta, difieren } = require('./lib');

const leer = (archivo) => JSON.parse(fs.readFileSync(path.join(DIR_RESULTADOS, archivo)));
const R = leer('turnos.json');
const D = leer('dirigidas.json');
const nombre = Object.fromEntries(q('SELECT id_producto,nombre_producto FROM productos').map((x) => [x.id_producto, x.nombre_producto]));
const f2 = (x) => (+x).toFixed(2);
let fallasTotales = 0;

function listarVentas(titulo, ventas) {
  console.log(`\n=== ${titulo}: pantalla = lo que vio el cajero | total = ventas.total_pagar | pagos = pagos_venta | reglas = lo que corresponde`);
  for (const s of ventas) {
    const fallas = fallasDeVenta(s);
    if (fallas.length) fallasTotales++;
    console.log(
      `${fallas.length ? '✗' : '✓'} #${s.id_venta} ${s.caso}\n     pantalla ${f2(s.pantalla)} | total ${f2(s.bd.total)} (mesas ${f2(s.bd.mesas)} + prod ${f2(s.bd.prod)} - desc ${f2(s.bd.desc)} + red ${f2(s.bd.redondeo)}) | pagos ${f2(s.bd.pagos)} | reglas ${f2(s.oraculo.total)} (t ${s.oraculo.tiempo} p ${s.oraculo.prod} d ${s.oraculo.desc}) ${fallas.join(' ')}`,
    );
  }
}

listarVentas('A. VENTAS DIRIGIDAS (T1-T3)', R.sales.filter((x) => !x.caso.startsWith('T4')));
listarVentas('B. PRUEBAS DIRIGIDAS', D.sales);
console.log('\nOtros resultados dirigidos:', JSON.stringify(D.out));

console.log('\n=== C. RECHAZOS Y NOTAS');
for (const n of [...R.notes, ...D.notes]) {
  console.log(JSON.stringify(n));
  fallasTotales++;
}

console.log('\n=== D. FRECUENCIA por turno');
for (const j of R.jornadas) {
  const v = j.ventas;
  const malas = v.filter((x) => fallasDeVenta(x).length);
  const suma = (k) => r2(v.reduce((s, x) => s + k(x), 0));
  console.log(
    `Jornada ${j.id}: ${v.length} ventas | con fallas: ${malas.length} | Σtotal ${suma((x) => x.bd.total)} | Σpagos ${suma((x) => x.bd.pagos)} | Σpantalla ${suma((x) => x.pantalla)} | Σreglas ${suma((x) => x.oraculo.total)}`,
  );
}

console.log('\n=== E. CAJA por turno: lo que entró según la pantalla vs lo que dice el sistema');
for (const j of R.jornadas) {
  const c = j.precierre.caja;
  let ef = 0;
  let qr = 0;
  for (const v of j.ventas) {
    if (v.metodo === 'efectivo') ef += v.pantalla;
    else if (v.metodo === 'qr') qr += v.pantalla;
    else {
      const e = r2(v.pantalla / 2);
      ef += e;
      qr += r2(v.pantalla - e);
    }
  }
  ef = r2(ef + (j.ajusteEfectivo || 0));
  qr = r2(qr + (j.ajusteQR || 0));
  const esperado = r2(j.monto + ef - j.egresos);
  const mal = difieren(+j.row.monto_final_efectivo_real, esperado) || difieren(+c.ingresos_efectivo, ef) || difieren(+c.ingresos_qr, qr);
  if (mal) fallasTotales++;
  console.log(
    `${mal ? '✗' : '✓'} Jornada ${j.id}: efectivo sistema ${f2(c.ingresos_efectivo)} vs real ${f2(ef)} | QR sistema ${f2(c.ingresos_qr)} vs real ${f2(qr)} | egresos ${c.egresos} | efectivo final ${j.row.monto_final_efectivo_real} vs esperado ${f2(esperado)}`,
  );
}

console.log('\n=== F. INVENTARIO por turno: apertura - vendido + cargas = stock final');
for (const j of R.jornadas) {
  let malas = 0;
  let reporteMalo = 0;
  const lineas = [];
  const inv = Object.fromEntries((j.precierre.inventario || []).map((i) => [i.nombre_producto, i]));
  for (const id of new Set([...Object.keys(j.vendido), ...Object.keys(j.cargas)])) {
    const ap = j.aperturaStock[id];
    const vend = j.vendido[id] || 0;
    const car = j.cargas[id] || 0;
    const fin = j.stockFinal[id];
    const ok = ap - vend + car === fin;
    const fila = inv[nombre[id]];
    const repOk = fila ? +fila.stock_inicial - +fila.vendido + (+fila.cargas || 0) === fin && !+fila.ajuste : null;
    if (!ok) malas++;
    if (repOk === false) reporteMalo++;
    if (!ok || repOk === false) lineas.push(`   ✗ ${nombre[id]}: ${ap} - ${vend} + ${car} = ${ap - vend + car} | stock BD ${fin} | reporte vendió ${fila && fila.vendido}`);
  }
  if (malas || reporteMalo) fallasTotales++;
  console.log(`${malas || reporteMalo ? '✗' : '✓'} Jornada ${j.id}: descuadre real ${malas} | filas del reporte que no cierran ${reporteMalo}`);
  if (lineas.length) console.log(lineas.join('\n'));
}

console.log('\n=== G. CONTINUIDAD entre turnos (stock final del turno N = apertura del turno N+1)');
for (let i = 1; i < R.jornadas.length; i++) {
  const a = R.jornadas[i - 1];
  const b = R.jornadas[i];
  const dif = Object.keys(b.aperturaStock).filter((k) => a.stockFinal[k] !== b.aperturaStock[k] && !R.cargasT4[k]);
  if (dif.length) fallasTotales++;
  console.log(`${dif.length ? '✗ ' + dif.join(',') : '✓'} J${a.id} -> J${b.id}`);
}

console.log('\n=== H. REPORTES: Mesas + Productos = cobrado, admin = cierre, mesas = lo cobrado por tiempo');
for (const j of R.jornadas) {
  const d0 = j.reporte.data;
  const real = +d0.apertura.ingreso_efectivo + +d0.apertura.ingreso_qr;
  const me = +d0.mesas.resumen.efectivo + +d0.mesas.resumen.qr;
  const pr = +d0.productos.resumen.efectivo + +d0.productos.resumen.qr;
  const cg = d0.cargos ? +d0.cargos.resumen.efectivo + +d0.cargos.resumen.qr : 0;
  const filasMesas = d0.mesas.filas.reduce((s, f) => s + +f.total, 0);
  const filasProductos = d0.productos.filas.reduce((s, f) => s + +f.total, 0);
  // Lo cobrado por tiempo: el tiempo de cada venta más su redondeo (las ventas nuevas cuadran al centavo).
  // Lo pagado por la hora con descuento también es tiempo de mesa.
  const tiempoCobrado = +q(`SELECT COALESCE(SUM(x.m + x.h + IF(x.m + x.h > 0, x.r, 0)), 0) t FROM (SELECT v.subtotal_mesas m, v.redondeo r, COALESCE((SELECT SUM(c.monto) FROM cargos_venta c WHERE c.id_venta = v.id_venta AND c.tipo = 'hora_gratis'), 0) h FROM ventas v WHERE v.id_jornada=${j.id}) x`)[0].t;
  const t = j.textoFinal.replace(/\s+/g, ' ');
  const cierre = t.match(/Rendimiento de Mesas ([\d:]+) hrs jugadas (-?[\d.]+) Bs Rendimiento de Productos (\d+) uds vendidas (-?[\d.]+) Bs (?:Otros Cargos \(roturas, daños\) (-?[\d.]+) Bs )?Total Recaudado \(Limpio de Egresos\) (-?[\d.]+)/i);
  const cargosCierre = cierre && cierre[5] ? +cierre[5] : 0;
  const mesasCierre = cierre ? +cierre[2] : NaN;
  const prodCierre = cierre ? +cierre[4] : NaN;
  const fallas = [];
  if (difieren(me + pr + cg, real)) fallas.push('ADMIN≠COBRADO');
  if (difieren(mesasCierre + prodCierre + cargosCierre, real)) fallas.push('CIERRE≠COBRADO');
  if (difieren(me, mesasCierre) || difieren(pr, prodCierre) || difieren(cg, cargosCierre)) fallas.push('ADMIN≠CIERRE');
  if (difieren(me, tiempoCobrado)) fallas.push('MESAS≠TIEMPO_COBRADO');
  if (difieren(filasMesas, me) || difieren(filasProductos, pr)) fallas.push('FILAS≠RESUMEN');
  if (fallas.length) fallasTotales++;
  console.log(
    `${fallas.length ? '✗' : '✓'} Jornada ${j.id}: cobrado ${f2(real)} | admin: mesas ${f2(me)} + productos ${f2(pr)} | cierre: mesas ${cierre && cierre[2]} + productos ${cierre && cierre[4]} | tiempo cobrado ${f2(tiempoCobrado)} | filas ${f2(filasMesas)} / ${f2(filasProductos)} ${fallas.join(' ')}`,
  );
}

console.log('\n=== I. OTROS');
console.log('bloqueo cierre con mesa ocupada:', JSON.stringify(R.res.bloqueoCierre));
console.log('edición venta pagada:', JSON.stringify(R.res.edicion));
console.log('borrado detalle pagado:', JSON.stringify(R.res.borrado));
console.log('doble ocupación:', JSON.stringify(R.res.dobleOcupacion));
console.log('sesiones abiertas tras cobrar en T3:', JSON.stringify(R.res.huerfanas));
console.log('errores JS/HTTP:', R.errs.length + D.errs.length, [...R.errs, ...D.errs].slice(0, 8));

console.log('\n=== J. STOCK GLOBAL');
let malasStock = 0;
const vendido = {};
for (const j of R.jornadas) for (const [k, v] of Object.entries(j.vendido)) vendido[k] = (vendido[k] || 0) + v;
const cargas = { ...R.cargasPrevias };
for (const j of R.jornadas) for (const [k, v] of Object.entries(j.cargas)) cargas[k] = (cargas[k] || 0) + v;
for (const k in R.cargasT4) cargas[k] = (cargas[k] || 0) + R.cargasT4[k];
for (const k of new Set([...Object.keys(vendido), ...Object.keys(cargas)])) {
  const esperado = R.stockIni[k] - (vendido[k] || 0) + (cargas[k] || 0);
  if (esperado !== R.stockFin[k]) {
    malasStock++;
    console.log('✗', nombre[k], R.stockIni[k], 'esperado', esperado, 'bd', R.stockFin[k]);
  }
}
if (malasStock) fallasTotales++;
console.log(malasStock ? `descuadres ${malasStock}` : '✓ stock global cuadra para todos los productos movidos');

console.log(`\n${fallasTotales ? `✗ ${fallasTotales} problemas` : '✓ todo cuadra'}`);
process.exit(fallasTotales ? 1 : 0);
