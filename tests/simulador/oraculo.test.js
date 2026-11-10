// Cada prueba es una regla o un ejemplo dado por el dueño del negocio. Se corre con: node --test oraculo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { liquidar, promoActiva, redondearACobro, ts } = require('./oraculo');

// El jueves 2026-12-03 sirve de fecha base. Tarifas por tipo: 1 Privada, 2 Billar, 3 Cachos, 5 Consumo.
const JUEVES = '2026-12-03';
const LISTA = { 1: 30, 2: 15, 3: 10, 5: 0 };
const en = (hora, dia = JUEVES) => ts(`${dia} ${hora}`);
const tramo = (tipo, a, b) => ({ tipo, a: en(a), b: en(b) });
const ctx = (promos = []) => ({ promos, lista: LISTA });
const MACANUDA = 1;
const PROMO_2X1 = { t: 'combo_2x1', d: 'jueves', h: ['17:00:00', '22:00:00'], item: MACANUDA };
const pedido = (qty, hora, ef = 22) => ({ id: MACANUDA, qty, ef, t: en(hora) });
// Pares que el cajero eligió en el buscador ("Promo: ... 2x1"): qty son unidades (2 por par).
const pares = (qty, hora, ef = 22) => ({ id: MACANUDA, qty, ef, t: en(hora), par: true });

test('redondeo: siempre hacia arriba a .00 o .50', () => {
  const casos = [
    [16.25, 16.5],
    [16.75, 17],
    [0.83, 1],
    [16.5, 16.5],
    [16, 16],
    [0, 0],
    [16.01, 16.5],
    [16.51, 17],
  ];
  for (const [monto, esperado] of casos) assert.equal(redondearACobro(monto), esperado, `${monto}`);
});

test('bloques: se cobran al iniciar (00:01, 05:01, 10:01)', () => {
  const bloques = (fin) => liquidar({ tramos: [tramo(2, '10:00:00', fin)] }, ctx()).bloques;
  assert.equal(bloques('10:00:00'), 0);
  assert.equal(bloques('10:00:01'), 1);
  assert.equal(bloques('10:05:00'), 1);
  assert.equal(bloques('10:05:01'), 2);
  assert.equal(bloques('10:10:00'), 2);
  assert.equal(bloques('10:10:01'), 3);
});

test('tarifa: mesa abierta en promo paga la promo solo mientras está activa (ejemplo: 25)', () => {
  const promo = { t: 'tarifa_mesa', d: 'jueves', h: ['15:00:00', '21:00:00'], v: 5, item: 3 };
  const r = liquidar({ tramos: [tramo(3, '18:00:00', '22:00:00')] }, ctx([promo]));
  assert.equal(r.tiempo, 25);
  assert.equal(r.total, 25);
});

test('tarifa: mesa abierta antes de la promo la recibe desde que inicia (ejemplo: 10)', () => {
  const promo = { t: 'tarifa_mesa', d: 'jueves', h: ['15:00:00', '21:00:00'], v: 5, item: 3 };
  const r = liquidar({ tramos: [tramo(3, '14:30:00', '16:00:00')] }, ctx([promo]));
  assert.equal(r.tiempo, 10);
  assert.equal(r.total, 10);
});

test('incentivo en mesa: precio especial solo desde las horas mínimas', () => {
  const promo = { t: 'incentivo_mesa', d: 'jueves', v: 25, item: 1, c: 2 };
  const total = (fin) => liquidar({ tramos: [tramo(1, '10:00:00', fin)] }, ctx([promo])).total;
  assert.equal(total('11:30:00'), 45, 'no alcanza las 2 horas');
  assert.equal(total('12:00:00'), 60, 'exactamente 2 horas: aún no hay bloque con precio especial');
  assert.equal(total('12:30:00'), 72.5, '2 horas a 30 + media hora a 25');
  assert.equal(total('13:00:00'), 85, '2 horas a 30 + 1 hora a 25');
});

test('incentivo en producto: una hora sin cobrar', () => {
  const total = (fin) => liquidar({ tramos: [tramo(2, '10:00:00', fin)], gratis: true }, ctx()).tiempo;
  assert.equal(total('10:30:00'), 0, 'jugó menos de una hora');
  assert.equal(total('11:00:00'), 0, 'jugó justo una hora');
  assert.equal(total('11:20:00'), 5, 'paga los 20 minutos restantes');
});

test('incentivo en producto: la hora con descuento usa la tarifa real si la mesa se transfiere', () => {
  const tramos = [tramo(2, '10:00:00', '10:30:00'), tramo(3, '10:30:00', '11:00:00')];
  assert.equal(liquidar({ tramos, gratis: true }, ctx()).tiempo, 0);
});

test('2x1: no se detecta solo, 2 unidades sueltas pagan precio completo', () => {
  const r = liquidar({ prods: [pedido(2, '18:00:00')] }, ctx([PROMO_2X1]));
  assert.equal(r.total, 44);
});

test('2x1: cada par elegido paga una unidad', () => {
  const r = liquidar({ prods: [pares(2, '18:00:00')] }, ctx([PROMO_2X1]));
  assert.equal(r.total, 22);
});

test('2x1: 5 unidades = 2 pares elegidos + 1 suelta, pagan 3 precios', () => {
  const prods = [pares(2, '18:00:00'), pares(2, '18:10:00'), pedido(1, '18:20:00')];
  assert.equal(liquidar({ prods }, ctx([PROMO_2X1])).total, 66);
});

test('2x1: el par elegido en promo lo conserva aunque se pague después', () => {
  const r = liquidar({ prods: [pares(2, '21:50:00')] }, ctx([PROMO_2X1]));
  assert.equal(r.total, 22);
});

test('total: tiempo + productos, con un solo redondeo al final', () => {
  const promo = { t: 'tarifa_mesa', d: 'lunes', h: ['16:00:00', '19:00:00'], v: 10, item: 2 };
  const dia = '2026-12-07';
  const tramos = [{ tipo: 2, a: en('18:40:05', dia), b: en('20:02:11', dia) }];
  const prods = [{ id: 12, qty: 2, ef: 6, t: en('18:50:00', dia) }];
  const r = liquidar({ tramos, prods }, ctx([promo]));
  assert.equal(r.bloques, 17);
  assert.equal(r.tiempo, 19.58);
  assert.equal(r.neto, 31.58);
  assert.equal(r.redondeo, 0.42);
  assert.equal(r.total, 32);
});

test('horario que cruza medianoche pertenece al día en que comienza', () => {
  const promo = { d: 'jueves', h: ['22:00:00', '02:00:00'] };
  assert.equal(promoActiva(promo, en('23:00:00')), true);
  assert.equal(promoActiva(promo, ts('2026-12-04 01:59:59')), true);
  assert.equal(promoActiva(promo, ts('2026-12-04 02:00:00')), false);
  assert.equal(promoActiva(promo, en('01:00:00')), false, 'madrugada del jueves es del miércoles');
});
