// El backend decide cuánto se cobra: ignora precios de la pantalla, exige que los pagos sumen el total,
// rechaza un total desactualizado sin guardar nada y no cobra dos veces la misma mesa.
const fs = require('fs');
const path = require('path');
const { BASE, BASE2, DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q } = require('./lib');

const API = '/backend/api/atencion_barra.php';
const MESA = { Billar2: 3, Billar3: 8, Billar4: 9, Billar5: 15, Billar6: 16, Cachos1: 4 };
const P = { Macanuda: 1, Corona: 6, Chocosoda: 27 };
const VUELTAS = 10;

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}

async function post(base, cuerpo) {
  const r = await fetch(base + API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch (e) {
    return { status: 'no_json', raw: texto.slice(0, 300) };
  }
}

const nVentas = () => +q('SELECT COUNT(*) c FROM ventas')[0].c;
const stock = (id) => +q(`SELECT stock_actual s FROM productos WHERE id_producto=${id}`)[0].s;
const estado = (idMesa) => q(`SELECT estado_actual e FROM mesas WHERE id_mesa=${idMesa}`)[0].e;
const ultimaVenta = () =>
  q(`SELECT v.*, (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta) pagos,
       (SELECT COALESCE(SUM(cantidad*precio_unitario_aplicado),0) FROM detalle_venta_productos d WHERE d.id_venta=v.id_venta) det
     FROM ventas v ORDER BY id_venta DESC LIMIT 1`)[0];
const ventaCuadra = (v) =>
  Math.abs(+v.pagos - +v.total_pagar) < 0.005 &&
  Math.abs(+v.det - +v.subtotal_productos) < 0.005 &&
  Math.abs(+v.subtotal_mesas + +v.subtotal_productos - +v.descuentos + +v.subtotal_cargos + +v.redondeo - +v.total_pagar) < 0.005;

async function probarBarra() {
  console.log('\n--- Barra');
  const antes = nVentas();
  const conPrecioFalso = await post(BASE, {
    accion: 'registrar_venta_barra',
    total: 1,
    metodo_pago: 'efectivo',
    productos: [{ id_producto: P.Macanuda, cantidad: 1, precio_unitario: 1 }],
  });
  comprobar('Precio enviado por la pantalla: se ignora y se avisa el total real', conPrecioFalso.codigo === 'total_cambio' && conPrecioFalso.liquidacion.total === 22, JSON.stringify(conPrecioFalso).slice(0, 160));
  comprobar('Precio enviado por la pantalla: no se guarda nada', nVentas() === antes);

  const cotizacion = await post(BASE, { accion: 'cotizar_carrito', productos: [{ id_producto: P.Macanuda, cantidad: 1 }] });
  comprobar('Cotizar no guarda nada', cotizacion.status === 'success' && cotizacion.cotizacion.total === 22 && nVentas() === antes);

  const noCuadra = await post(BASE, { accion: 'registrar_venta_barra', total_mostrado: 22, pagos: [{ metodo: 'efectivo', monto: 10 }], productos: [{ id_producto: P.Macanuda, cantidad: 1 }] });
  comprobar('Pagos que no suman el total se rechazan', noCuadra.codigo === 'pagos_no_cuadran' && nVentas() === antes, noCuadra.message);

  const metodo = await post(BASE, { accion: 'registrar_venta_barra', total_mostrado: 22, pagos: [{ metodo: 'tarjeta', monto: 22 }], productos: [{ id_producto: P.Macanuda, cantidad: 1 }] });
  comprobar('Método de pago desconocido se rechaza', metodo.codigo === 'pago_invalido' && nVentas() === antes, metodo.message);

  const mixto = await post(BASE, {
    accion: 'registrar_venta_barra',
    total_mostrado: 22,
    pagos: [{ metodo: 'efectivo', monto: 12 }, { metodo: 'qr', monto: 10 }],
    productos: [{ id_producto: P.Macanuda, cantidad: 1, precio_unitario: 1 }],
  });
  const v = ultimaVenta();
  comprobar('Venta mixta con el total correcto: se guarda con el precio de lista', mixto.status === 'success' && +v.total_pagar === 22 && +v.det === 22 && ventaCuadra(v), JSON.stringify(v));

  q(`UPDATE productos SET stock_actual=1 WHERE id_producto=${P.Chocosoda}`);
  const cotChoco = await post(BASE, { accion: 'cotizar_carrito', productos: [{ id_producto: P.Chocosoda, cantidad: 2 }] });
  const sobreventa = await post(BASE, {
    accion: 'registrar_venta_barra',
    total_mostrado: cotChoco.cotizacion.total,
    metodo_pago: 'efectivo',
    productos: [{ id_producto: P.Chocosoda, cantidad: 2 }],
  });
  comprobar('Vender más que el stock se rechaza', sobreventa.codigo === 'stock_insuficiente' && stock(P.Chocosoda) === 1, sobreventa.message);

  const cuatroCorona = [{ id_producto: P.Corona, cantidad: 4 }];
  const otraMesa = await post(BASE, { accion: 'registrar_venta_barra', total_mostrado: 101, metodo_pago: 'efectivo', productos: cuatroCorona, hora_gratis: true, id_mesa_ocupar_promo: MESA.Cachos1 });
  comprobar('Hora con descuento en una mesa de otro tipo se rechaza', otraMesa.codigo === 'promo_no_vigente' && estado(MESA.Cachos1) === 'libre', otraMesa.message);

  const sinCondicion = await post(BASE, {
    accion: 'registrar_venta_barra',
    total_mostrado: 77,
    metodo_pago: 'efectivo',
    productos: [{ id_producto: P.Corona, cantidad: 3 }],
    hora_gratis: true,
    id_mesa_ocupar_promo: MESA.Billar2,
  });
  comprobar('Hora con descuento sin la cantidad requerida se rechaza', sinCondicion.codigo === 'promo_no_vigente' && estado(MESA.Billar2) === 'libre', sinCondicion.message);

  const valida = await post(BASE, { accion: 'registrar_venta_barra', total_mostrado: 101, metodo_pago: 'efectivo', productos: cuatroCorona, hora_gratis: true, id_mesa_ocupar_promo: MESA.Billar2 });
  const gratis = q(`SELECT s.primera_hora_gratis g FROM sesiones_juego s JOIN tramos_mesas t USING(id_sesion) WHERE t.id_mesa=${MESA.Billar2} AND s.estado='activa'`)[0];
  comprobar('Hora con descuento válida: cobra 101 y abre la mesa con la hora con descuento', valida.status === 'success' && estado(MESA.Billar2) === 'ocupada' && gratis && gratis.g === '1', JSON.stringify(valida).slice(0, 120));

  console.log('\n--- Venta de barra enviada dos veces (en producción hubo 5 casos por doble clic)');
  const venta = (idOperacion) => ({
    accion: 'registrar_venta_barra',
    total_mostrado: 22,
    pagos: [{ metodo: 'efectivo', monto: 22 }],
    productos: [{ id_producto: P.Macanuda, cantidad: 1 }],
    id_operacion: idOperacion,
  });
  let ventas = nVentas();
  let macanudas = stock(P.Macanuda);
  const primera = await post(BASE, venta('prueba-repetida-0001'));
  const repetida = await post(BASE, venta('prueba-repetida-0001'));
  comprobar('El mismo envío repetido no se registra dos veces', primera.status === 'success' && repetida.codigo === 'venta_duplicada' && nVentas() === ventas + 1 && stock(P.Macanuda) === macanudas - 1, repetida.message);
  let malas = 0;
  for (let i = 0; i < VUELTAS; i++) {
    ventas = nVentas();
    macanudas = stock(P.Macanuda);
    const r = await Promise.all([post(BASE, venta(`prueba-carrera-${i}-x`)), post(BASE2, venta(`prueba-carrera-${i}-x`))]);
    if (r.filter((x) => x.status === 'success').length !== 1 || !r.some((x) => x.codigo === 'venta_duplicada') || nVentas() !== ventas + 1 || stock(P.Macanuda) !== macanudas - 1) malas++;
  }
  comprobar('Dos envíos simultáneos de la misma venta: se registra una sola', malas === 0, `vueltas con error: ${malas}`);
  // Dos cajas venden el mismo producto a la vez: ninguna puede quedar cancelada por un bloqueo cruzado.
  malas = 0;
  let detalleError = '';
  for (let i = 0; i < VUELTAS; i++) {
    ventas = nVentas();
    const r = await Promise.all([post(BASE, venta(`prueba-distinta-${i}-a`)), post(BASE2, venta(`prueba-distinta-${i}-b`))]);
    if (nVentas() !== ventas + 2) {
      malas++;
      detalleError = JSON.stringify(r.filter((x) => x.status !== 'success'));
    }
  }
  comprobar('Dos ventas iguales de clientes distintos, a la vez: se registran las dos', malas === 0, `vueltas con error: ${malas} ${detalleError}`);
}

async function probarMesa(s) {
  console.log('\n--- Mesa');
  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar3 });
  await s.adv(65 * 60);
  const prep = await post(BASE, { accion: 'preparar_cobro', id_mesa: MESA.Billar3 });
  comprobar('Preparar cobro pausa la mesa y da el desglose (65 min = 16,25 → 16,50)', prep.auto_pausada === true && prep.liquidacion.tiempo === 16.25 && prep.liquidacion.total === 16.5, JSON.stringify(prep.liquidacion && { t: prep.liquidacion.tiempo, r: prep.liquidacion.redondeo, total: prep.liquidacion.total }));

  await s.adv(120);
  const antes = nVentas();
  const viejo = await post(BASE, { accion: 'cobrar_mesa', id_mesa: MESA.Billar3, total_mostrado: 16, pagos: [{ metodo: 'efectivo', monto: 16 }] });
  comprobar('Total desactualizado: no cobra y devuelve el total vigente', viejo.codigo === 'total_cambio' && viejo.liquidacion.total === 16.5 && nVentas() === antes && estado(MESA.Billar3) === 'ocupada', viejo.message);

  const compat = await post(BASE, { accion: 'cobrar_mesa_pago_dividido', id_mesa: MESA.Billar3, metodo_pago: 'dividido', monto_efectivo: 10, monto_qr: 6.5, total_congelado_frontend: 16.5 });
  const v = ultimaVenta();
  comprobar('El tiempo con el modal abierto no se cobra (corte al preparar)', compat.status === 'success' && +v.total_pagar === 16.5, JSON.stringify(compat).slice(0, 120));
  comprobar('La venta guarda el redondeo y cuadra con los pagos', +v.subtotal_mesas === 16.25 && +v.redondeo === 0.25 && ventaCuadra(v), JSON.stringify(v));

  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar6 });
  await s.adv(10 * 60);
  await post(BASE, { accion: 'pausar_mesa', id_mesa: MESA.Billar6 });
  const pausa1 = q(`SELECT fecha_hora_pausa p FROM tramos_mesas WHERE id_mesa=${MESA.Billar6} AND fecha_hora_fin IS NULL`)[0].p;
  await s.adv(5 * 60);
  await post(BASE, { accion: 'pausar_mesa', id_mesa: MESA.Billar6 });
  const pausa2 = q(`SELECT fecha_hora_pausa p FROM tramos_mesas WHERE id_mesa=${MESA.Billar6} AND fecha_hora_fin IS NULL`)[0].p;
  comprobar('Pausar dos veces conserva la primera hora de pausa', pausa1 === pausa2, `${pausa1} / ${pausa2}`);
  await s.adv(5 * 60);
  await post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Billar6, id_mesa_destino: MESA.Billar5 });
  const cierre = q(`SELECT fecha_hora_fin f FROM tramos_mesas WHERE id_mesa=${MESA.Billar6} ORDER BY id_tramo DESC LIMIT 1`)[0].f;
  comprobar('Transferir una mesa pausada no cobra el tiempo en pausa', cierre === pausa1, `fin ${cierre}, pausa ${pausa1}`);
  const libre = await post(BASE, { accion: 'preparar_cobro', id_mesa: MESA.Billar5 });
  await post(BASE, { accion: 'cobrar_mesa', id_mesa: MESA.Billar5, total_mostrado: libre.liquidacion.total, pagos: [{ metodo: 'efectivo', monto: libre.liquidacion.total }] });
}

async function probarCarreras(s) {
  console.log(`\n--- Carreras (${VUELTAS} vueltas cada una, dos cajas a la vez)`);
  let malas = 0;
  for (let i = 0; i < VUELTAS; i++) {
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar4 });
    await s.adv(20 * 60);
    const prep = await post(BASE, { accion: 'preparar_cobro', id_mesa: MESA.Billar4 });
    const total = prep.liquidacion.total;
    const antes = nVentas();
    const cuerpo = { accion: 'cobrar_mesa', id_mesa: MESA.Billar4, total_mostrado: total, pagos: [{ metodo: 'efectivo', monto: total }] };
    const r = await Promise.all([post(BASE, cuerpo), post(BASE2, cuerpo)]);
    const exitos = r.filter((x) => x.status === 'success').length;
    if (exitos !== 1 || nVentas() !== antes + 1 || !r.some((x) => x.codigo === 'mesa_sin_partida')) malas++;
  }
  comprobar('Dos cajas cobran la misma mesa: se cobra una sola vez', malas === 0, `vueltas con error: ${malas}`);

  malas = 0;
  let ganoCobro = 0;
  let ganoAgregado = 0;
  for (let i = 0; i < VUELTAS; i++) {
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar4 });
    await s.adv(20 * 60);
    const prep = await post(BASE, { accion: 'preparar_cobro', id_mesa: MESA.Billar4 });
    const total = prep.liquidacion.total;
    const corona = stock(P.Corona);
    const [cobro, agregado] = await Promise.all([
      post(BASE, { accion: 'cobrar_mesa', id_mesa: MESA.Billar4, total_mostrado: total, pagos: [{ metodo: 'efectivo', monto: total }] }),
      post(BASE2, { accion: 'agregar_productos_mesa', id_mesa: MESA.Billar4, productos: [{ id_producto: P.Corona, cantidad: 1 }] }),
    ]);
    if (cobro.status === 'success') {
      // Se cobró primero: el producto llegó tarde y no debe quedar colgado ni descontar stock.
      ganoCobro++;
      if (agregado.codigo !== 'mesa_sin_partida' || stock(P.Corona) !== corona || !ventaCuadra(ultimaVenta())) malas++;
    } else {
      // Se agregó primero: el cobro con el total viejo no debe guardarse.
      ganoAgregado++;
      if (agregado.status !== 'success' || cobro.codigo !== 'total_cambio' || cobro.liquidacion.total !== total + 24) malas++;
      const nuevo = cobro.liquidacion.total;
      await post(BASE, { accion: 'cobrar_mesa', id_mesa: MESA.Billar4, total_mostrado: nuevo, pagos: [{ metodo: 'efectivo', monto: nuevo }] });
      if (!ventaCuadra(ultimaVenta()) || +ultimaVenta().det !== 24) malas++;
    }
  }
  comprobar('Agregar un producto mientras otra caja cobra: nunca queda una venta descuadrada', malas === 0, `vueltas con error: ${malas} (cobro primero ${ganoCobro}, producto primero ${ganoAgregado})`);
}

// Otra caja agrega un producto mientras el cajero tiene el modal de cobro abierto.
async function probarModal(s, page) {
  console.log('\n--- Pantalla: el total cambia con el modal abierto');
  await s.at(s.now + 60 * 1000);
  await s.abrirMesa('Billar #7');
  await s.adv(30 * 60);
  await s.sel('Billar #7');
  await page.evaluate(() => gestorUI.prepararCobroMesa());
  const leer = () => page.evaluate(() => parseFloat(document.getElementById('lblTotalCobrarModal').innerText));
  const totalAntes = await leer();
  await post(BASE, { accion: 'agregar_productos_mesa', id_mesa: 17, productos: [{ id_producto: P.Macanuda, cantidad: 1 }] });
  const antes = nVentas();
  await page.evaluate(() => gestorUI.ejecutarCobroConfirmado());
  const aviso = await s.toastUltimo();
  const abierto = await page.evaluate(() => !document.getElementById('modalConfirmarCobro').classList.contains('hidden'));
  const totalDespues = await leer();
  comprobar('No se cobra el total viejo', nVentas() === antes);
  comprobar('El modal sigue abierto con el total nuevo y un aviso', abierto && totalDespues === totalAntes + 22 && aviso && aviso.t === 'warning', `antes ${totalAntes}, ahora ${totalDespues}, aviso ${aviso && aviso.m}`);
  await page.evaluate(() => gestorUI.ejecutarCobroConfirmado());
  const v = ultimaVenta();
  comprobar('Al confirmar de nuevo se cobra el total nuevo', nVentas() === antes + 1 && +v.total_pagar === totalDespues && ventaCuadra(v), JSON.stringify(v));
}

(async () => {
  const { navegador, page } = await abrirNavegador();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const s = new Sim(page);

  // Sábado: está la promo de hora con descuento por 4 Corona en mesas de Billar.
  await s.at('2026-12-12 14:00:00');
  await s.cargarPortal();
  await s.carga([[P.Corona, 300], [P.Macanuda, 100]]);
  await s.abrirJornada(100);

  await probarBarra();
  await probarMesa(s);
  await probarCarreras(s);
  await probarModal(s, page);
  comprobar('Sin errores de JavaScript', errores.length === 0, errores.join(' / '));

  await navegador.close();
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'motor.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
