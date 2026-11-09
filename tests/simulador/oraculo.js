// Cálculo independiente de lo que DEBE cobrarse según las reglas del negocio.
// No comparte código con el sistema: si ambos dan lo mismo es porque los dos cumplen la regla.
// Las reglas vienen del dueño del negocio y están ejemplificadas en oraculo.test.js.

const SEG_POR_BLOQUE = 300;
const BLOQUES_POR_HORA = 12;
const BLOQUES_HORA_GRATIS = 12;
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const OFFSET_LA_PAZ_MS = 4 * 3600e3;

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const ts = (s) => Date.parse(s.replace(' ', 'T') + '-04:00');
const fmt = (ms) => new Date(ms - OFFSET_LA_PAZ_MS).toISOString().slice(0, 19).replace('T', ' ');

// Inicio incluido y fin excluido: el bloque que empieza a las 21:00 ya va sin una promo que termina a las 21:00.
// Un horario que cruza medianoche pertenece al día en que comienza.
function promoActiva(promo, ms) {
  const hora = fmt(ms).slice(11);
  const hoy = new Date(ms - OFFSET_LA_PAZ_MS).getUTCDay();
  const ayer = (hoy + 6) % 7;
  const horario = promo.h;
  if (horario && horario[0] > horario[1]) {
    if (hora >= horario[0]) return DIAS[hoy] === promo.d;
    if (hora < horario[1]) return DIAS[ayer] === promo.d;
    return false;
  }
  if (DIAS[hoy] !== promo.d) return false;
  return !horario || (hora >= horario[0] && hora < horario[1]);
}

// Tarifa por hora de un bloque según cuándo empieza y cuánto lleva jugado la sesión.
// Si coinciden varios beneficios se aplica el precio más bajo.
function tarifaDelBloque(tipo, inicioMs, segJugados, { promos, lista }) {
  let tarifa = lista[tipo];
  for (const promo of promos) {
    if (promo.item !== tipo || !promoActiva(promo, inicioMs)) continue;
    if (promo.t === 'tarifa_mesa') tarifa = Math.min(tarifa, promo.v);
    // Incentivo en mesa: el precio especial corre solo desde que se cumplen las horas mínimas, no es retroactivo.
    if (promo.t === 'incentivo_mesa' && segJugados >= promo.c * 3600) tarifa = Math.min(tarifa, promo.v);
  }
  return tarifa;
}

// Cada tramo cuenta sus bloques: 00:01 cobra el primero, 05:00 sigue en el primero, 05:01 cobra el segundo.
// La suma se hace en tarifas enteras y se divide una sola vez para no acumular errores de redondeo.
function liquidarTiempo(tramos, gratis, ctx) {
  let sumaTarifasCent = 0;
  let bloques = 0;
  let segJugados = 0;
  let gratisPendientes = gratis ? BLOQUES_HORA_GRATIS : 0;
  const segPorTipo = {};
  for (const tramo of tramos) {
    const seg = Math.max(0, (tramo.b - tramo.a) / 1000);
    const cantidad = Math.ceil(seg / SEG_POR_BLOQUE);
    for (let k = 0; k < cantidad; k++) {
      const inicio = tramo.a + k * SEG_POR_BLOQUE * 1000;
      const tarifa = tarifaDelBloque(tramo.tipo, inicio, segJugados + k * SEG_POR_BLOQUE, ctx);
      bloques++;
      // Hora gratis: los primeros 60 minutos cobrables quedan en cero, con sus tarifas reales.
      if (tarifa > 0 && gratisPendientes > 0) {
        gratisPendientes--;
        continue;
      }
      sumaTarifasCent += Math.round(tarifa * 100);
    }
    segJugados += seg;
    segPorTipo[tramo.tipo] = (segPorTipo[tramo.tipo] || 0) + seg;
  }
  return { tiempo: r2(sumaTarifasCent / BLOQUES_POR_HORA / 100), bloques, segJugados, segPorTipo };
}

// Solo cuentan las unidades pedidas durante la promo: conservan el beneficio aunque se paguen después.
function liquidarProductos(prods, { segJugados, segPorTipo }, { promos }) {
  let prod = 0;
  let desc = 0;
  for (const p of prods) prod += p.qty * p.ef;
  for (const promo of promos) {
    const enPromo = prods.filter((p) => p.id === promo.item && promoActiva(promo, p.t));
    if (promo.t === 'combo_2x1') {
      // Con 5 unidades se pagan 3 precios. Se regalan las más baratas si hubiera precios distintos.
      const precios = enPromo.flatMap((p) => Array(p.qty).fill(p.ef)).sort((a, b) => a - b);
      const gratis = Math.floor(precios.length / 2);
      for (let i = 0; i < gratis; i++) desc += precios[i];
    }
    if (promo.t === 'incentivo_cruzado') {
      const seg = promo.mesa ? segPorTipo[promo.mesa] || 0 : segJugados;
      if (seg < promo.c * 3600) continue;
      for (const p of enPromo) if (p.ef > promo.v) desc += (p.ef - promo.v) * p.qty;
    }
  }
  return { prod: r2(prod), desc: r2(desc) };
}

// Siempre hacia arriba a .00 o .50: en Bolivia no hay moneda menor a 50 centavos.
function redondearACobro(monto) {
  return (Math.ceil(Math.round(monto * 100) / 50) * 50) / 100;
}

function liquidar({ tramos = [], prods = [], gratis = false }, ctx) {
  const t = liquidarTiempo(tramos, gratis, ctx);
  const { prod, desc } = liquidarProductos(prods, t, ctx);
  const neto = r2(Math.max(0, t.tiempo + prod - desc));
  const total = redondearACobro(neto);
  return {
    bloques: t.bloques,
    tiempo: t.tiempo,
    prod,
    desc,
    neto,
    redondeo: r2(total - neto),
    total,
    min: Math.round(t.segJugados / 6) / 10,
  };
}

module.exports = { liquidar, promoActiva, redondearACobro, r2, ts, fmt };
