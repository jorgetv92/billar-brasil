// Maneja el sistema real por el navegador con el reloj adelantado y anota lo que debería cobrarse según oraculo.js.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { BASE, BD_SIM, DIR_SITIO, MYSQL } = require('./config');
const { liquidar, promoActiva, r2, ts, fmt } = require('./oraculo');
const { CLAVE_ADMIN_SIM } = require('./preparar');

const RELOJ = path.join(DIR_SITIO, 'backend', 'config', 'sim_clock.txt');

// La hora gratis no es un producto: para el oráculo es una línea más con el monto adicional, y en la base
// queda como cargo de la venta. Este id no coincide con ningún producto ni promoción.
const CARGO_HORA_GRATIS = 'cargo_hora_gratis';

// Devuelve filas como objetos. Solo puede hablar con el clon.
function q(sql) {
  const salida = execFileSync(MYSQL, ['-uroot', '--default-character-set=utf8mb4', '--batch', BD_SIM, '-e', sql], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  const lineas = salida.split(/\r?\n/).filter(Boolean);
  if (!lineas.length) return [];
  const columnas = lineas[0].split('\t');
  return lineas.slice(1).map((fila) => {
    const celdas = fila.split('\t');
    return Object.fromEntries(columnas.map((c, i) => [c, celdas[i] === 'NULL' ? null : celdas[i]]));
  });
}

const TIPO = { Privada: 1, Billar: 2, Cachos: 3, Consumo: 5 };
const LISTA = { 1: 30, 2: 15, 3: 10, 5: 0 };
const tipoDe = (nombreMesa) => TIPO[nombreMesa.split(' ')[0]];

// Definidas aquí de forma independiente del sistema. Deben coincidir con reset.sql.
const PROMOS = [
  { id: 101, t: 'tarifa_mesa', d: 'lunes', h: ['16:00:00', '19:00:00'], v: 10, item: 2 },
  { id: 102, t: 'descuento_producto', d: 'lunes', v: 6, item: 12 },
  { id: 103, t: 'combo_2x1', d: 'martes', h: ['17:00:00', '22:00:00'], item: 1 },
  { id: 104, t: 'incentivo_cruzado', d: 'martes', v: 12, item: 46, c: 1 },
  { id: 105, t: 'descuento_producto', d: 'martes', h: ['22:00:00', '02:00:00'], v: 7, item: 9 },
  { id: 106, t: 'incentivo_mesa', d: 'sabado', v: 25, item: 1, c: 2 },
  { id: 107, t: 'incentivo_producto', d: 'sabado', v: 5, item: 6, item2: 2, c: 4 },
  { id: 108, t: 'tarifa_mesa', d: 'jueves', h: ['15:00:00', '21:00:00'], v: 5, item: 3 },
];
const CTX = { promos: PROMOS, lista: LISTA };

const difieren = (a, b) => Math.abs(a - b) > 0.009;

// Lo que toda venta debe cumplir. Devuelve la lista de incumplimientos.
function fallasDeVenta(x) {
  const fallas = [];
  if (difieren(x.pantalla, x.bd.total)) fallas.push('PANTALLA≠TOTAL');
  if (difieren(x.bd.pagos, x.bd.total)) fallas.push('PAGOS≠TOTAL');
  if (difieren(x.bd.total, x.oraculo.total)) fallas.push('TOTAL≠REGLAS');
  if (difieren(x.bd.total, Math.max(0, x.bd.mesas + x.bd.prod - x.bd.desc + (x.bd.cargos || 0) + x.bd.redondeo))) fallas.push('TOTAL≠DESGLOSE');
  if (difieren(x.bd.det, x.bd.prod)) fallas.push('DETALLE≠SUBTOTAL');
  if (Math.round(x.bd.total * 100) % 50 !== 0) fallas.push('TOTAL SIN REDONDEAR');
  return fallas;
}

class Sim {
  constructor(page) {
    this.page = page;
    this.now = 0;
    this.ses = {};
    this.sales = [];
    this.notes = [];
    this.j = null;
    this.jornadas = [];
    this.lista = Object.fromEntries(q('SELECT id_producto,precio_venta FROM productos').map((x) => [x.id_producto, +x.precio_venta]));
    this.tieneRedondeo = q("SHOW COLUMNS FROM ventas LIKE 'redondeo'").length > 0;
  }
  say(m) {
    console.log(`[${fmt(this.now)}] ${m}`);
  }
  async at(s) {
    const t = typeof s === 'number' ? s : ts(s);
    if (t < this.now) throw new Error('reloj atras ' + s);
    this.now = t;
    fs.writeFileSync(RELOJ, String(Math.floor(t / 1000)));
    await this.page.clock.setFixedTime(new Date(t));
    // Espera el refresco que dispara la pantalla cuando empieza un bloque nuevo, como pasaría con el reloj real.
    await this.page
      .evaluate(() => {
        if (window.gestorUI && document.querySelector('.mesa-card')) return gestorUI.actualizarRelojes();
      })
      .catch(() => {});
  }
  adv(sec) {
    return this.at(this.now + sec * 1000);
  }
  // Navegación real por el sidebar
  async vista(p, espera) {
    await this.page.evaluate((p) => document.querySelector(`.nav-item[data-page="${p}"]`).click(), p);
    await this.page.waitForSelector(espera, { timeout: 15000, state: 'attached' });
    await this.page.waitForTimeout(150);
  }
  async cargarPortal() {
    await this.page.goto(BASE + '/frontend/portal_atencion.html');
    await this.page.waitForSelector('#jornadaContainer', { timeout: 15000, state: 'attached' });
    await this.page.evaluate(() => {
      window.__toasts = [];
      const original = window.mostrarToast;
      window.mostrarToast = (m, t) => {
        window.__toasts.push({ m, t });
        original(m, t);
      };
    });
    await this.page.waitForTimeout(250);
  }
  async atencion() {
    await this.vista('atencion.html', '.tipos-mesa-contenedor .mesa-card');
    await this.page.waitForFunction(() => gestorUI.productosLocal.length > 0);
    await this.page.waitForTimeout(100);
    await this.page.evaluate(() => gestorUI.actualizarRelojes());
  }
  async refrescarAtencion() {
    await this.vista('dashboard_atencion.html', '#jornadaContainer');
    await this.atencion();
  }
  async toastUltimo() {
    return this.page.evaluate(() => window.__toasts[window.__toasts.length - 1] || null);
  }
  async abrirJornada(monto) {
    this.say(`ABRIR JORNADA con Bs ${monto}`);
    await this.vista('dashboard_atencion.html', '#jornadaContainer');
    await this.page.waitForSelector('#btnAbrirJornadaTemp', { state: 'attached' });
    await this.page.evaluate(() => document.getElementById('btnAbrirJornadaTemp').click());
    await this.page.fill('#montoInicial', String(monto));
    await this.page.evaluate(() => document.getElementById('formAperturaCaja').requestSubmit());
    await this.page.waitForFunction(() => document.getElementById('modalReporteApertura').style.display === 'flex', { timeout: 15000 });
    await this.page.waitForFunction(() => document.getElementById('raIdJornada').innerText.includes('#'), { timeout: 15000 });
    await this.page.evaluate(() => document.getElementById('btnCerrarReporteApertura').click());
    await this.page.waitForTimeout(150);
    const r = q(`SELECT id_jornada FROM jornadas WHERE estado='abierta'`)[0];
    this.j = {
      id: +r.id_jornada,
      monto,
      abre: this.now,
      ventas: [],
      aperturaStock: Object.fromEntries(
        q(`SELECT id_producto,stock_apertura FROM jornada_inventario_apertura WHERE id_jornada=${r.id_jornada}`).map((x) => [x.id_producto, +x.stock_apertura]),
      ),
      vendido: {},
      cargas: {},
      egresos: 0,
    };
    await this.atencion();
  }
  stockActual() {
    return Object.fromEntries(q('SELECT id_producto,stock_actual FROM productos').map((x) => [x.id_producto, +x.stock_actual]));
  }
  async mesaAttr(n, attr) {
    return this.page.evaluate(({ n, attr }) => document.querySelector(`.mesa-card[data-nombre="${n}"]`).getAttribute(attr), { n, attr });
  }
  async abrirMesa(n) {
    this.say(`ocupar ${n}`);
    await this.page.evaluate(async (n) => {
      gestorUI.clickMesa(document.querySelector(`.mesa-card[data-nombre="${n}"]`));
      await gestorUI.confirmarOcupacion();
    }, n);
    this.ses[n] = { mesa: n, tramos: [{ mesa: n, tipo: tipoDe(n), a: this.now, b: null }], prods: [], gratis: false };
  }
  async sel(n) {
    await this.page.evaluate(async (n) => {
      const c = document.querySelector(`.mesa-card[data-nombre="${n}"]`);
      gestorUI.clickMesa(c);
      await gestorUI.cargarConsumoMesaActual(c.getAttribute('data-id'));
      gestorUI.actualizarRelojes();
    }, n);
  }
  // Precio aplicado al momento del pedido
  precioEf(id, ms) {
    let precio = +this.lista[id];
    for (const x of PROMOS) if (x.t === 'descuento_producto' && x.item === +id && promoActiva(x, ms)) precio = x.v;
    return precio;
  }
  async setProducto(id, qty) {
    return this.page.evaluate(
      ({ id, qty }) => {
        const p = gestorUI.productosLocal.find((x) => +x.id_producto === +id && !x.es_combo && !x.es_2x1 && !x.es_incentivo);
        if (!p) return null;
        document.querySelector('.formulario-venta input[type="text"]').value = p.display_nombre;
        document.querySelector('.formulario-venta input[type="number"]').value = qty;
        return p.precio;
      },
      { id, qty },
    );
  }
  // Elige en el buscador la promoción de hora gratis vigente ("Promo: ..."), como lo haría el cajero.
  // En barra además elige la mesa libre que se habilitará al cobrar.
  async elegirPromoHora(mesaId) {
    return this.page.evaluate(
      async ({ mesaId }) => {
        const p = gestorUI.productosLocal.find((x) => x.es_incentivo);
        if (!p) return false;
        document.querySelector('.formulario-venta input[type="text"]').value = p.display_nombre;
        document.querySelector('.formulario-venta input[type="number"]').value = 1;
        await gestorUI.agregarProductoAlCarrito();
        if (mesaId) {
          const select = document.getElementById('selectMesaIncentivo');
          select.value = String(mesaId);
          gestorUI.onSeleccionarMesaIncentivo();
          await gestorUI.confirmarIncentivoProducto();
        }
        return true;
      },
      { mesaId },
    );
  }
  // Elige en el buscador la promo "Producto 2x1" del producto (cada vez suma un par), como el cajero.
  async elegirPar(id, pares) {
    const elegir = () => this.page.evaluate(
      async ({ id, pares }) => {
        const p = gestorUI.productosLocal.find((x) => x.es_2x1 && +x.id_producto === +id);
        if (!p) return false;
        document.querySelector('.formulario-venta input[type="text"]').value = p.display_nombre;
        document.querySelector('.formulario-venta input[type="number"]').value = pares;
        await gestorUI.agregarProductoAlCarrito();
        return true;
      },
      { id, pares },
    );
    if (await elegir()) return true;
    // La pantalla todavía no trae la promo (se abrió antes de su horario): se actualiza el buscador.
    await this.page.evaluate(() => gestorUI.cargarDatalistProductos());
    return elegir();
  }
  // Agregar a una mesa con el flujo real. Con {par: true}, qty son unidades elegidas como pares 2x1.
  async consumo(n, id, qty, { incentivo = 'no', par = false } = {}) {
    await this.sel(n);
    const precioUI = await this.setProducto(id, qty);
    let hubo = false;
    if (incentivo === 'si') {
      hubo = await this.elegirPromoHora(null);
    } else if (par) {
      if (!(await this.elegirPar(id, qty / 2))) throw new Error(`No aparece la promo 2x1 del producto ${id}`);
    } else {
      await this.page.evaluate(() => gestorUI.agregarProductoAlCarrito());
    }
    await this.page.waitForTimeout(60);
    const s = this.ses[n];
    const precio = +precioUI;
    s.prods.push({ id: +id, qty, precio, ef: this.precioEf(id, this.now), t: this.now, par });
    if (hubo && incentivo === 'si') {
      s.gratis = true;
      const promo = PROMOS.find((p) => p.t === 'incentivo_producto' && promoActiva(p, this.now));
      s.prods.push({ id: CARGO_HORA_GRATIS, qty: 1, precio: promo.v, ef: promo.v, t: this.now });
    }
    this.say(`${n}: consumo prod ${id} x${qty} @${precio}${hubo ? ` (promo hora gratis)` : ''}`);
  }
  // Quita la hora gratis de una mesa (el cargo): la mesa vuelve a tarifa normal.
  async quitarHoraGratis(n) {
    await this.sel(n);
    const r = await this.page.evaluate(async (n) => {
      const c = document.querySelector(`.mesa-card[data-nombre="${n}"]`);
      const idMesa = c.getAttribute('data-id');
      const liq = await (await fetch(`${gestorUI.apiURL}?accion=get_liquidacion_mesa&id_mesa=${idMesa}`)).json();
      const cargo = (liq.liquidacion.cargos || []).find((x) => x.tipo === 'hora_gratis');
      if (!cargo) return null;
      return gestorUI.api({ accion: 'eliminar_cargo_mesa', id_mesa: idMesa, id_cargo: cargo.id_cargo });
    }, n);
    const s = this.ses[n];
    s.prods = s.prods.filter((p) => p.id !== CARGO_HORA_GRATIS);
    s.gratis = false;
    this.say(`${n}: quita la hora gratis: ${r && r.status}`);
  }
  async quitarConsumo(n, id) {
    await this.sel(n);
    const r = await this.page.evaluate(
      async ({ n, id }) => {
        const c = document.querySelector(`.mesa-card[data-nombre="${n}"]`);
        const d = await (await fetch(`${gestorUI.apiURL}?accion=get_consumo_mesa&id_mesa=${c.getAttribute('data-id')}`)).json();
        const it = d.find((x) => +x.id_producto === +id);
        if (!it) return null;
        const rs = await fetch(gestorUI.apiURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'eliminar_producto_mesa', id_detalle_prod: it.id_detalle_prod }),
        });
        return rs.json();
      },
      { n, id },
    );
    const s = this.ses[n];
    const i = s.prods.findIndex((p) => p.id === +id);
    if (i >= 0) s.prods.splice(i, 1);
    this.say(`${n}: quita producto ${id}: ${r && r.status}`);
  }
  async pausaToggle(n) {
    await this.sel(n);
    await this.page.evaluate(() => gestorUI.togglePausa());
    await this.page.waitForTimeout(40);
  }
  async pausar(n) {
    this.say(`${n}: PAUSA manual`);
    await this.pausaToggle(n);
    this.ses[n].pausa = this.now;
  }
  async reanudar(n) {
    this.say(`${n}: REANUDA`);
    await this.pausaToggle(n);
    const s = this.ses[n];
    const t = s.tramos[s.tramos.length - 1];
    t.b = s.pausa;
    s.tramos.push({ mesa: n, tipo: t.tipo, a: this.now, b: null });
    s.pausa = null;
  }
  async transferir(o, d) {
    this.say(`transferir ${o} -> ${d}`);
    await this.sel(o);
    const idDestino = await this.mesaAttr(d, 'data-id');
    await this.page.evaluate(async (id) => {
      await gestorUI.abrirModalTransferir();
      const select = document.querySelector('#modalTransferirMesa select');
      select.value = String(id);
      await gestorUI.confirmarTransferencia();
    }, idDestino);
    await this.page.waitForTimeout(80);
    const s = this.ses[o];
    s.tramos[s.tramos.length - 1].b = this.now;
    s.tramos.push({ mesa: d, tipo: tipoDe(d), a: this.now, b: null });
    s.mesa = d;
    this.ses[d] = s;
    delete this.ses[o];
  }
  // Lo que debe cobrarse con corte en t, o en la pausa si la mesa está pausada.
  oraculoMesa(s, t) {
    const tramos = s.tramos.map((x) => ({ tipo: x.tipo, a: x.a, b: x.b ?? s.pausa ?? t }));
    return liquidar({ tramos, prods: s.prods, gratis: s.gratis }, CTX);
  }
  registrar(rec) {
    const redondeo = this.tieneRedondeo ? 'v.redondeo' : '0 AS redondeo';
    const v = q(
      `SELECT v.id_venta,v.subtotal_mesas,v.subtotal_productos,v.subtotal_cargos,v.descuentos,${redondeo},v.total_pagar,
        (SELECT COALESCE(SUM(monto_pagado),0) FROM pagos_venta p WHERE p.id_venta=v.id_venta) pagos,
        (SELECT COALESCE(SUM(cantidad*precio_unitario_aplicado),0) FROM detalle_venta_productos d WHERE d.id_venta=v.id_venta) det
       FROM ventas v WHERE v.id_jornada=${this.j.id} ORDER BY id_venta DESC LIMIT 1`,
    )[0];
    const r = {
      ...rec,
      jornada: this.j.id,
      hora: fmt(this.now),
      id_venta: +v.id_venta,
      bd: {
        mesas: +v.subtotal_mesas,
        prod: +v.subtotal_productos,
        cargos: +v.subtotal_cargos,
        desc: +v.descuentos,
        redondeo: +v.redondeo,
        total: +v.total_pagar,
        pagos: +v.pagos,
        det: +v.det,
      },
    };
    this.sales.push(r);
    this.j.ventas.push(r);
    this.say(`  -> ${rec.caso}: pantalla ${rec.pantalla} | BD total ${r.bd.total} pagos ${r.bd.pagos} | reglas ${rec.oraculo.total}`);
    return r;
  }
  tally(items) {
    // La hora gratis es un cargo: no mueve inventario.
    for (const it of items.filter((x) => x.id !== CARGO_HORA_GRATIS)) this.j.vendido[it.id] = (this.j.vendido[it.id] || 0) + it.qty;
  }
  nVentas() {
    return q('SELECT COUNT(*) c FROM ventas')[0].c;
  }
  async cobrarMesa(n, { metodo = 'efectivo', demora = 0, caso = '' } = {}) {
    const s = this.ses[n];
    await this.sel(n);
    await this.page.evaluate(() => gestorUI.prepararCobroMesa());
    await this.page.waitForTimeout(50);
    const pantalla = await this.page.evaluate(() => parseFloat(document.getElementById('lblTotalCobrarModal').innerText));
    // La hora de corte es cuando se presiona Cobrar, no cuando se confirma el modal.
    const oraculo = this.oraculoMesa(s, this.now);
    if (demora) await this.adv(demora);
    await this.page.evaluate((m) => {
      document.getElementById(m === 'qr' ? 'pagoQR' : 'pagoEfectivo').checked = true;
    }, metodo);
    const antes = this.nVentas();
    await this.page.evaluate(() => gestorUI.ejecutarCobroConfirmado());
    await this.page.waitForTimeout(90);
    if (this.nVentas() === antes) {
      const t = await this.toastUltimo();
      this.notes.push({ tipo: 'cobro_fallo', caso, msg: t && t.m });
      this.say(`  !! cobro fallo: ${JSON.stringify(t)}`);
      await this.page.evaluate(() => gestorUI.cerrarModal('modalConfirmarCobro'));
      return null;
    }
    this.tally(s.prods);
    delete this.ses[n];
    return this.registrar({ caso: caso || `mesa ${n}`, tipo: 'mesa', metodo, pantalla, oraculo, mesa: n });
  }
  async cobrarMixto(n, { efectivoPct = 0.5, caso = '', fallback = 'efectivo' } = {}) {
    const s = this.ses[n];
    await this.sel(n);
    await this.page.evaluate(() => gestorUI.prepararPagoDividido());
    await this.page.waitForTimeout(70);
    // Con total 0 el modal no abre (es correcto): se cobra por la vía normal.
    const abierto = await this.page.evaluate(() => !document.getElementById('modalDividirPago').classList.contains('hidden'));
    if (!abierto) {
      this.say('  (mixto no disponible: total 0, se cobra normal)');
      return this.cobrarMesa(n, { metodo: fallback || 'efectivo', caso: caso + ' (total 0)' });
    }
    const pantalla = await this.page.evaluate(() => parseFloat(document.getElementById('lblTotalDividir').innerText));
    const ef = r2(pantalla * efectivoPct);
    await this.page.evaluate(
      ({ ef, qr }) => {
        document.getElementById('inputDividirEfectivo').value = ef;
        document.getElementById('inputDividirQR').value = qr;
      },
      { ef, qr: r2(pantalla - ef) },
    );
    const oraculo = this.oraculoMesa(s, this.now);
    const antes = this.nVentas();
    await this.page.evaluate(() => gestorUI.confirmarPagoDividido());
    await this.page.waitForTimeout(90);
    if (this.nVentas() === antes) {
      const t = await this.toastUltimo();
      this.say(`  !! MIXTO RECHAZADO (pantalla ${pantalla}, reglas ${oraculo.total}): ${t && t.m}`);
      this.notes.push({ tipo: 'mixto_rechazado', caso, hora: fmt(this.now), pantalla, oraculo: oraculo.total, msg: t && t.m });
      await this.page.evaluate(() => gestorUI.cerrarModal('modalDividirPago'));
      await this.page.waitForTimeout(60);
      if (fallback) return this.cobrarMesa(n, { metodo: fallback, caso: caso + ' (efectivo tras rechazo)' });
      return null;
    }
    this.tally(s.prods);
    delete this.ses[n];
    return this.registrar({ caso: caso || `mesa ${n} mixto`, tipo: 'mesa_mixto', metodo: 'mixto', pantalla, oraculo, mesa: n });
  }
  async ventaBarra(lineas, { metodo = 'efectivo', mixto = false, caso = '', incentivo = null, mesaIncentivo = null } = {}) {
    const items = [];
    const promo = incentivo === 'si' ? PROMOS.find((p) => p.t === 'incentivo_producto' && promoActiva(p, this.now)) : null;
    // Cada línea: [id, unidades] o [id, unidades, 'par'] para pares de una promo "Producto 2x1".
    for (const [id, qty, modo] of lineas) {
      const par = modo === 'par';
      items.push({ id, qty, ef: this.precioEf(id, this.now), t: this.now, par });
      if (par) {
        if (!(await this.elegirPar(id, qty / 2))) throw new Error(`No aparece la promo 2x1 del producto ${id}`);
        continue;
      }
      // Las unidades que trae la promo las agrega la propia promo
      const resto = promo && +id === promo.item ? qty - promo.c : qty;
      if (resto <= 0) continue;
      await this.setProducto(id, resto);
      await this.page.evaluate(() => gestorUI.agregarProductoAlCarrito());
    }
    if (promo) {
      const idMesa = mesaIncentivo ? await this.mesaAttr(mesaIncentivo, 'data-id') : null;
      await this.elegirPromoHora(idMesa);
      await this.page.waitForTimeout(50);
      items.push({ id: CARGO_HORA_GRATIS, qty: 1, ef: promo.v, t: this.now });
    }
    await this.page.evaluate((m) => gestorUI.iniciarFlujoCobro(m), mixto ? 'mixto' : 'efectivo_qr');
    await this.page.waitForTimeout(40);
    const oraculo = liquidar({ prods: items }, CTX);
    const antes = this.nVentas();
    let pantalla;
    if (mixto) {
      pantalla = await this.page.evaluate(() => parseFloat(document.getElementById('lblTotalDividir').innerText));
      const ef = r2(pantalla / 2);
      await this.page.evaluate(
        ({ ef, qr }) => {
          document.getElementById('inputDividirEfectivo').value = ef;
          document.getElementById('inputDividirQR').value = qr;
        },
        { ef, qr: r2(pantalla - ef) },
      );
      await this.page.evaluate(() => gestorUI.confirmarPagoDividido());
    } else {
      pantalla = await this.page.evaluate(() => parseFloat(document.getElementById('lblTotalCobrarModal').innerText));
      await this.page.evaluate((m) => {
        document.getElementById(m === 'qr' ? 'pagoQR' : 'pagoEfectivo').checked = true;
      }, metodo);
      await this.page.evaluate(() => gestorUI.ejecutarCobroConfirmado());
    }
    await this.page.waitForTimeout(90);
    if (this.nVentas() === antes) {
      const t = await this.toastUltimo();
      this.say(`  !! venta barra fallo: ${JSON.stringify(t)}`);
      this.notes.push({ tipo: 'barra_fallo', caso, msg: t && t.m, pantalla, oraculo: oraculo.total });
      await this.page.evaluate(() => {
        ['modalDividirPago', 'modalConfirmarCobro'].forEach((i) => gestorUI.cerrarModal(i));
        gestorUI.limpiarCarrito();
      });
      return null;
    }
    this.tally(items);
    if (incentivo === 'si' && mesaIncentivo) {
      this.ses[mesaIncentivo] = {
        mesa: mesaIncentivo,
        tramos: [{ mesa: mesaIncentivo, tipo: tipoDe(mesaIncentivo), a: this.now, b: null }],
        prods: [],
        gratis: true,
      };
      await this.page.evaluate(async () => {
        await gestorUI.cargarGrillaMesas();
        gestorUI.actualizarRelojes();
      });
    }
    return this.registrar({ caso: caso || 'barra', tipo: mixto ? 'barra_mixto' : 'barra', metodo: mixto ? 'mixto' : metodo, pantalla, oraculo });
  }
  // Llama a la API con la sesión del admin de prueba (las cargas son solo del administrador).
  async api(metodo, ruta, cuerpo) {
    return apiAdmin(metodo, ruta, cuerpo);
  }
  async carga(items) {
    this.say(`carga mercaderia ${JSON.stringify(items)}`);
    const r = await this.api('POST', 'cargas.php', {
      tipo_carga: 'producto',
      items: items.map(([id_producto, cantidad]) => ({ id_producto, cantidad })),
    });
    if (this.j) for (const [id, c] of items) this.j.cargas[id] = (this.j.cargas[id] || 0) + c;
    return r;
  }
  async egreso(concepto, monto) {
    const r = await this.api('POST', 'egresos_caja.php', { accion: 'crear', concepto, monto });
    this.j.egresos += monto;
    this.say(`egreso ${concepto} Bs ${monto}`);
    return r.id_egreso;
  }
  async cerrarJornada() {
    this.say('PRE-CIERRE y CIERRE');
    await this.vista('dashboard_atencion.html', '#jornadaContainer');
    await this.page.waitForSelector('#btnAbrirPreCierre', { state: 'attached' });
    const precierre = await this.api('GET', 'jornada.php?action=precierre');
    await this.page.evaluate(() => document.getElementById('btnAbrirPreCierre').click());
    await this.page.waitForFunction(() => !document.getElementById('infoPreCierre').innerText.includes('Calculando'), { timeout: 15000 });
    const textoPre = await this.page.evaluate(() => document.getElementById('infoPreCierre').innerText);
    await this.page.evaluate(() => document.getElementById('btnConfirmarCierre').click());
    await this.page.waitForFunction(() => document.getElementById('modalReporteFinal').style.display === 'flex', { timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(250);
    const textoFinal = await this.page.evaluate(() => document.getElementById('contenidoReporteFinal').innerText);
    await this.page.evaluate(() => {
      const b = document.getElementById('btnCerrarReporteFinal');
      if (b) b.click();
    });
    const id = this.j.id;
    const reporte = await this.api('GET', `reportes.php?tipo=jornada&id_jornada=${id}&apertura=true&mesas=true&productos=true&egresos=true&insumos=true`);
    const row = q(`SELECT * FROM jornadas WHERE id_jornada=${id}`)[0];
    this.jornadas.push({ ...this.j, cierre: this.now, precierre, textoPre, textoFinal, reporte, row, stockFinal: this.stockActual() });
    this.j = null;
    this.ses = {};
  }
}

// Sesión PHP del admin de prueba que crea preparar.js. Se inicia una vez por servidor.
const cookiesAdmin = {};
async function cookieAdmin(base = BASE) {
  if (!cookiesAdmin[base]) {
    const r = await fetch(`${base}/backend/api/login.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'sim_admin', password: CLAVE_ADMIN_SIM }),
    });
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    if (!r.ok || !cookie) throw new Error('No se pudo iniciar la sesión del admin de prueba');
    cookiesAdmin[base] = cookie;
  }
  return cookiesAdmin[base];
}

// Petición a la API. Con {sesion: false} va sin sesión, como lo haría alguien que no inició sesión.
async function apiAdmin(metodo, ruta, cuerpo, { base = BASE, sesion = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sesion) headers.Cookie = await cookieAdmin(base);
  const r = await fetch(`${base}/backend/api/${ruta}`, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  try {
    return { http: r.status, ...JSON.parse(texto) };
  } catch (e) {
    return { http: r.status, raw: texto.slice(0, 400) };
  }
}

// Abre el navegador con el mismo huso horario del negocio y sin impresora térmica.
async function abrirNavegador() {
  const navegador = await chromium.launch({ channel: 'chrome', headless: true });
  const contexto = await navegador.newContext({ timezoneId: 'America/La_Paz', viewport: { width: 1400, height: 900 } });
  await contexto.addInitScript(() => {
    try {
      localStorage.setItem('imprimirTermicaHabilitado', 'false');
      localStorage.setItem('id_usuario', '4');
      localStorage.setItem('usuario_nombre', 'Sim');
    } catch (e) {}
  });
  const page = await contexto.newPage();
  return { navegador, page };
}

module.exports = { Sim, q, CARGO_HORA_GRATIS, r2, ts, fmt, abrirNavegador, apiAdmin, fallasDeVenta, difieren, PROMOS };
