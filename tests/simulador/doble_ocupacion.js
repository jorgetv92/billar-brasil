// Una mesa no debe tener nunca dos sesiones abiertas: ni por doble clic, ni por dos cajas, ni desde el admin.
const fs = require('fs');
const path = require('path');
const { BASE, BASE2, DIR_RESULTADOS } = require('./config');
const { CLAVE_ADMIN_SIM } = require('./preparar');
const { Sim, abrirNavegador, q } = require('./lib');

const API = '/backend/api/atencion_barra.php';
const MESA = { Billar2: 3, Billar3: 8, Billar4: 9, Billar5: 15, Billar6: 16, Cachos1: 4, Privada2: 7 };
const CORONA = 6;
const HORA_PROMO = 47;
const VUELTAS_CARRERA = 25;

const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}

async function post(base, cuerpo) {
  const r = await fetch(base + API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch (e) {
    return { status: 'no_json', raw: texto.slice(0, 300) };
  }
}

const abiertos = (idMesa) =>
  +q(`SELECT COUNT(*) c FROM tramos_mesas t JOIN sesiones_juego s USING(id_sesion)
      WHERE t.id_mesa=${idMesa} AND t.fecha_hora_fin IS NULL AND s.estado='activa'`)[0].c;
const estado = (idMesa) => q(`SELECT estado_actual e FROM mesas WHERE id_mesa=${idMesa}`)[0].e;
const nVentas = () => +q('SELECT COUNT(*) c FROM ventas')[0].c;
const stock = (id) => +q(`SELECT stock_actual s FROM productos WHERE id_producto=${id}`)[0].s;
const rechazoDeMesa = (r) => r.status === 'error' && r.codigo === 'mesa_no_disponible';

// Deja la mesa libre directamente en el clon para empezar la siguiente vuelta.
function liberar(idMesa) {
  q(`UPDATE sesiones_juego s JOIN tramos_mesas t USING(id_sesion) SET s.estado='finalizada'
       WHERE t.id_mesa=${idMesa} AND t.fecha_hora_fin IS NULL AND s.estado='activa';
     UPDATE tramos_mesas SET fecha_hora_fin=fecha_hora_inicio WHERE id_mesa=${idMesa} AND fecha_hora_fin IS NULL;
     UPDATE mesas SET estado_actual='libre' WHERE id_mesa=${idMesa};`);
}

const ventaBarra = (accion, idMesa) => ({
  accion,
  total: 101,
  metodo_pago: 'efectivo',
  monto_efectivo: 101,
  monto_qr: 0,
  id_mesa_ocupar_promo: idMesa,
  productos: [
    { id_producto: CORONA, cantidad: 4, precio_unitario: 24, nombre: 'Corona' },
    { id_producto: HORA_PROMO, cantidad: 1, precio_unitario: 5, nombre: 'Hora Promo' },
  ],
});

async function probarApi() {
  console.log('\n--- Peticiones directas');
  const primera = await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });
  const segunda = await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });
  comprobar('Ocupar una mesa libre funciona', primera.status === 'success', JSON.stringify(primera));
  comprobar('Ocupar de nuevo la misma mesa se rechaza', rechazoDeMesa(segunda), JSON.stringify(segunda));
  comprobar('La mesa queda con una sola sesión abierta', abiertos(MESA.Billar2) === 1, `abiertas: ${abiertos(MESA.Billar2)}`);

  q(`UPDATE mesas SET estado_actual='mantenimiento' WHERE id_mesa=${MESA.Privada2}`);
  const enMantenimiento = await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Privada2 });
  comprobar('Una mesa en mantenimiento no se puede ocupar', rechazoDeMesa(enMantenimiento), JSON.stringify(enMantenimiento));
  comprobar('La mesa en mantenimiento no recibe sesión', abiertos(MESA.Privada2) === 0);

  for (const accion of ['registrar_venta_barra', 'cobrar_carrito_dividido']) {
    const ventas = nVentas();
    const unidades = stock(CORONA);
    const r = await post(BASE, ventaBarra(accion, MESA.Billar2));
    comprobar(`${accion}: hora gratis sobre mesa ocupada se rechaza`, rechazoDeMesa(r), JSON.stringify(r));
    comprobar(`${accion}: no se guarda la venta ni se descuenta stock`, nVentas() === ventas && stock(CORONA) === unidades, `ventas ${ventas}→${nVentas()}, stock ${unidades}→${stock(CORONA)}`);
    comprobar(`${accion}: no se abre otra sesión`, abiertos(MESA.Billar2) === 1, `abiertas: ${abiertos(MESA.Billar2)}`);
    liberar(MESA.Billar2);
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });

    const ventasOk = nVentas();
    const libre = await post(BASE, ventaBarra(accion, MESA.Billar3));
    comprobar(`${accion}: hora gratis sobre mesa libre sigue funcionando`, libre.status === 'success' && estado(MESA.Billar3) === 'ocupada' && nVentas() === ventasOk + 1, JSON.stringify(libre));
    liberar(MESA.Billar3);
  }

  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Cachos1 });
  const aOcupada = await post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Cachos1, id_mesa_destino: MESA.Billar2 });
  comprobar('Transferir a una mesa ocupada se rechaza', rechazoDeMesa(aOcupada), JSON.stringify(aOcupada));
  comprobar('La sesión sigue en la mesa de origen', abiertos(MESA.Cachos1) === 1 && abiertos(MESA.Billar2) === 1);

  const aSiMisma = await post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Cachos1, id_mesa_destino: MESA.Cachos1 });
  comprobar('Transferir una mesa a sí misma se rechaza', rechazoDeMesa(aSiMisma), JSON.stringify(aSiMisma));

  const aLibre = await post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Cachos1, id_mesa_destino: MESA.Billar4 });
  comprobar('Transferir a una mesa libre funciona', aLibre.status === 'success' && estado(MESA.Cachos1) === 'libre' && estado(MESA.Billar4) === 'ocupada', JSON.stringify(aLibre));
  comprobar('Tras transferir hay una sola sesión abierta', abiertos(MESA.Cachos1) === 0 && abiertos(MESA.Billar4) === 1);
  const repetida = await post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Cachos1, id_mesa_destino: MESA.Billar4 });
  comprobar('Repetir la misma transferencia se rechaza', repetida.status === 'error', JSON.stringify(repetida));
  liberar(MESA.Billar4);
  liberar(MESA.Billar2);
}

// Dos servidores atienden a la vez, como dos cajas presionando al mismo tiempo.
async function probarCarreras() {
  console.log(`\n--- Carreras (${VUELTAS_CARRERA} vueltas cada una, dos cajas a la vez)`);
  let malas = 0;
  for (let i = 0; i < VUELTAS_CARRERA; i++) {
    const cuerpo = { accion: 'ocupar_mesa', id_mesa: MESA.Billar5 };
    const r = await Promise.all([post(BASE, cuerpo), post(BASE2, cuerpo)]);
    if (r.filter((x) => x.status === 'success').length !== 1 || abiertos(MESA.Billar5) !== 1) malas++;
    liberar(MESA.Billar5);
  }
  comprobar('Dos cajas ocupan la misma mesa: gana una sola', malas === 0, `vueltas con error: ${malas}`);

  malas = 0;
  for (let i = 0; i < VUELTAS_CARRERA; i++) {
    const ventas = nVentas();
    const unidades = stock(CORONA);
    const cuerpo = ventaBarra('registrar_venta_barra', MESA.Billar5);
    const r = await Promise.all([post(BASE, cuerpo), post(BASE2, cuerpo)]);
    const exitos = r.filter((x) => x.status === 'success').length;
    if (exitos !== 1 || abiertos(MESA.Billar5) !== 1 || nVentas() !== ventas + 1 || stock(CORONA) !== unidades - 4) malas++;
    liberar(MESA.Billar5);
  }
  comprobar('Dos ventas con hora gratis sobre la misma mesa: se cobra una sola', malas === 0, `vueltas con error: ${malas}`);

  malas = 0;
  for (let i = 0; i < VUELTAS_CARRERA; i++) {
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar3 });
    const r = await Promise.all([
      post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Billar2, id_mesa_destino: MESA.Billar5 }),
      post(BASE2, { accion: 'transferir_mesa', id_mesa_origen: MESA.Billar3, id_mesa_destino: MESA.Billar5 }),
    ]);
    if (r.filter((x) => x.status === 'success').length !== 1 || abiertos(MESA.Billar5) !== 1) malas++;
    [MESA.Billar2, MESA.Billar3, MESA.Billar5].forEach(liberar);
  }
  comprobar('Dos transferencias hacia la misma mesa: gana una sola', malas === 0, `vueltas con error: ${malas}`);

  malas = 0;
  for (let i = 0; i < VUELTAS_CARRERA; i++) {
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar3 });
    // Transferencias cruzadas: sin un orden fijo de bloqueo terminarían en interbloqueo.
    const r = await Promise.all([
      post(BASE, { accion: 'transferir_mesa', id_mesa_origen: MESA.Billar2, id_mesa_destino: MESA.Billar3 }),
      post(BASE2, { accion: 'transferir_mesa', id_mesa_origen: MESA.Billar3, id_mesa_destino: MESA.Billar2 }),
    ]);
    if (r.some((x) => x.status !== 'error' || x.codigo !== 'mesa_no_disponible')) malas++;
    [MESA.Billar2, MESA.Billar3].forEach(liberar);
  }
  comprobar('Transferencias cruzadas se rechazan sin interbloqueo', malas === 0, `vueltas con error: ${malas}`);
}

async function probarAdmin() {
  console.log('\n--- Administración de mesas');
  const login = await fetch(`${BASE}/backend/api/login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'sim_admin', password: CLAVE_ADMIN_SIM }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  comprobar('El admin de prueba inicia sesión', login.ok && cookie.length > 0);

  const editar = async (id, estadoNuevo, numero) => {
    const fila = q(`SELECT numero_mesa,id_tipo_mesa FROM mesas WHERE id_mesa=${id}`)[0];
    const r = await fetch(`${BASE}/backend/api/mesas.php`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ id_mesa: id, numero_mesa: numero || fila.numero_mesa, id_tipo_mesa: fila.id_tipo_mesa, estado_actual: estadoNuevo }),
    });
    return { http: r.status, ...(await r.json()) };
  };

  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar6 });
  const aLibre = await editar(MESA.Billar6, 'libre');
  comprobar('No se puede marcar libre una mesa en juego', aLibre.status === 'error' && estado(MESA.Billar6) === 'ocupada', JSON.stringify(aLibre));
  const aMantenimiento = await editar(MESA.Billar6, 'mantenimiento');
  comprobar('No se puede poner en mantenimiento una mesa en juego', aMantenimiento.status === 'error' && estado(MESA.Billar6) === 'ocupada', JSON.stringify(aMantenimiento));
  const renombrar = await editar(MESA.Billar6, 'ocupada', 'Billar #6 bis');
  comprobar('Una mesa en juego sí se puede renombrar', renombrar.status === 'success', JSON.stringify(renombrar));
  await editar(MESA.Billar6, 'ocupada', 'Billar #6');
  liberar(MESA.Billar6);

  const aOcupada = await editar(MESA.Billar6, 'ocupada');
  comprobar('No se puede marcar ocupada a mano una mesa sin sesión', aOcupada.status === 'error' && estado(MESA.Billar6) === 'libre', JSON.stringify(aOcupada));
  const mantenimiento = await editar(MESA.Billar6, 'mantenimiento');
  const devuelta = await editar(MESA.Billar6, 'libre');
  comprobar('Libre y mantenimiento siguen funcionando', mantenimiento.status === 'success' && devuelta.status === 'success' && estado(MESA.Billar6) === 'libre');

  // Salida de emergencia: si una mesa quedó ocupada sin sesión, el admin debe poder liberarla.
  q(`UPDATE mesas SET estado_actual='ocupada' WHERE id_mesa=${MESA.Billar6}`);
  const rescate = await editar(MESA.Billar6, 'libre');
  comprobar('Una mesa ocupada sin sesión sí se puede liberar', rescate.status === 'success' && estado(MESA.Billar6) === 'libre', JSON.stringify(rescate));
}

// La pantalla de esta caja sigue mostrando la mesa libre mientras otra caja ya la tomó.
async function probarPantalla(s, page) {
  console.log('\n--- Pantalla desactualizada');
  await page.evaluate(async () => {
    await gestorUI.cargarGrillaMesas();
    gestorUI.actualizarRelojes();
  });
  const modalAbierto = (id) => page.evaluate((id) => !document.getElementById(id).classList.contains('hidden'), id);
  const claseTarjeta = (nombre) => page.evaluate((n) => document.querySelector(`.mesa-card[data-nombre="${n}"]`).className, nombre);

  await page.evaluate(() => gestorUI.clickMesa(document.querySelector('.mesa-card[data-nombre="Billar #4"]')));
  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar4 });
  await page.evaluate(() => gestorUI.confirmarOcupacion());
  await page.waitForTimeout(120);
  let aviso = await s.toastUltimo();
  comprobar('Ocupar con pantalla vieja: avisa al cajero', aviso && aviso.t === 'warning', JSON.stringify(aviso));
  comprobar('Ocupar con pantalla vieja: cierra el modal', !(await modalAbierto('modalOcuparMesa')));
  comprobar('Ocupar con pantalla vieja: la tarjeta pasa a ocupada', !(await claseTarjeta('Billar #4')).includes('disponible'), await claseTarjeta('Billar #4'));
  comprobar('Ocupar con pantalla vieja: una sola sesión', abiertos(MESA.Billar4) === 1, `abiertas: ${abiertos(MESA.Billar4)}`);

  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar2 });
  await page.evaluate(async () => {
    await gestorUI.cargarGrillaMesas();
    const c = document.querySelector('.mesa-card[data-nombre="Billar #2"]');
    gestorUI.clickMesa(c);
    await gestorUI.cargarConsumoMesaActual(c.getAttribute('data-id'));
    await gestorUI.abrirModalTransferir();
  });
  await page.evaluate((id) => {
    document.querySelector('#modalTransferirMesa select').value = String(id);
  }, MESA.Billar3);
  await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar3 });
  await page.evaluate(() => gestorUI.confirmarTransferencia());
  await page.waitForTimeout(120);
  aviso = await s.toastUltimo();
  comprobar('Transferir con pantalla vieja: avisa al cajero', aviso && aviso.t === 'warning', JSON.stringify(aviso));
  comprobar('Transferir con pantalla vieja: cierra el modal', !(await modalAbierto('modalTransferirMesa')));
  comprobar('Transferir con pantalla vieja: la sesión sigue en origen', abiertos(MESA.Billar2) === 1 && abiertos(MESA.Billar3) === 1);
  await page.evaluate(() => gestorUI.deseleccionarMesa());

  for (const [flujo, modal] of [['efectivo_qr', 'modalConfirmarCobro'], ['mixto', 'modalDividirPago']]) {
    await page.evaluate(async () => {
      await gestorUI.cargarGrillaMesas();
    });
    await s.setProducto(CORONA, 4);
    await page.evaluate(() => gestorUI.agregarProductoAlCarrito());
    await page.evaluate((f) => gestorUI.iniciarFlujoCobro(f), flujo);
    await page.waitForTimeout(60);
    await s.incentivo('si', MESA.Billar5);
    await page.waitForTimeout(60);
    await post(BASE, { accion: 'ocupar_mesa', id_mesa: MESA.Billar5 });
    const ventas = nVentas();
    await page.evaluate(
      async ({ flujo, total }) => {
        if (flujo === 'mixto') {
          document.getElementById('inputDividirEfectivo').value = total;
          document.getElementById('inputDividirQR').value = 0;
          await gestorUI.confirmarPagoDividido();
        } else {
          document.getElementById('pagoEfectivo').checked = true;
          await gestorUI.ejecutarCobroConfirmado();
        }
      },
      { flujo, total: 101 },
    );
    await page.waitForTimeout(150);
    aviso = await s.toastUltimo();
    const carrito = await page.evaluate(() => gestorUI.itemsCarrito.map((i) => ({ nombre: i.nombre, promo: !!i.es_promo_hora, cantidad: i.cantidad })));
    comprobar(`Hora gratis ${flujo} con pantalla vieja: avisa al cajero`, aviso && aviso.t === 'warning', JSON.stringify(aviso));
    comprobar(`Hora gratis ${flujo} con pantalla vieja: no se cobra`, nVentas() === ventas);
    comprobar(`Hora gratis ${flujo} con pantalla vieja: cierra el cobro`, !(await modalAbierto(modal)));
    comprobar(`Hora gratis ${flujo} con pantalla vieja: quita la hora y conserva los productos`, carrito.length === 1 && !carrito[0].promo && carrito[0].cantidad === 4, JSON.stringify(carrito));
    comprobar(`Hora gratis ${flujo} con pantalla vieja: una sola sesión`, abiertos(MESA.Billar5) === 1, `abiertas: ${abiertos(MESA.Billar5)}`);
    await page.evaluate(() => gestorUI.limpiarCarrito());
    liberar(MESA.Billar5);
  }
}

(async () => {
  const { navegador, page } = await abrirNavegador();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const s = new Sim(page);

  // Sábado: hace falta la promo de hora gratis por 4 Corona.
  await s.at('2026-12-19 14:00:00');
  await s.cargarPortal();
  await s.carga([[CORONA, 500]]);
  await s.abrirJornada(100);

  await probarApi();
  await probarCarreras();
  await probarAdmin();
  await probarPantalla(s, page);
  comprobar('Sin errores de JavaScript', errores.length === 0, errores.join(' / '));

  await navegador.close();
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'doble_ocupacion.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
