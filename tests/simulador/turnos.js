// Cuatro turnos completos con el reloj adelantado: tres dirigidos a promociones y uno aleatorio sin promos.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q, ts } = require('./lib');

const P = { Macanuda: 1, Corona: 6, Gordita: 7, Palito: 9, SodaPop: 12, CigBohem: 20, Soda1L: 25, Galleta: 26, AmstelBot: 46 };

(async () => {
  const { navegador, page: p } = await abrirNavegador();
  const errs = [];
  p.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  p.on('dialog', (d) => {
    errs.push(`DIALOG ${d.message()}`);
    d.accept().catch(() => {});
  });
  p.on('response', async (r) => {
    if (r.url().includes('/backend/api/') && r.request().method() !== 'GET') {
      const t = await r.text().catch(() => '');
      if (!t.trim().startsWith('{')) errs.push(`RESPUESTA_NO_JSON ${r.url()} ${t.slice(0, 300)}`);
    }
  });
  const s = new Sim(p);
  const barra = async (l, o) => {
    await p.evaluate(() => {
      if (modoActual === 'mesa') gestorUI.deseleccionarMesa();
    });
    return s.ventaBarra(l, o);
  };
  const editar = async (idVenta, idProd, nueva, caso) => {
    const d = q(`SELECT id_detalle_prod,cantidad FROM detalle_venta_productos WHERE id_venta=${idVenta} AND id_producto=${idProd}`)[0];
    const r = await s.api('PUT', 'jornada.php?action=editar_detalle_venta', { id_detalle: +d.id_detalle_prod, nueva_cantidad: nueva });
    s.say(`${caso}: ${JSON.stringify(r)}`);
    s.j.vendido[idProd] += nueva - d.cantidad;
    return r;
  };
  const borrarDet = async (idVenta, idProd, caso) => {
    const d = q(`SELECT id_detalle_prod,cantidad FROM detalle_venta_productos WHERE id_venta=${idVenta} AND id_producto=${idProd}`)[0];
    const r = await s.api('DELETE', `jornada.php?action=eliminar_detalle_venta&id_detalle=${d.id_detalle_prod}`);
    s.say(`${caso}: ${JSON.stringify(r)}`);
    s.j.vendido[idProd] -= +d.cantidad;
    return r;
  };
  const res = {};
  const stockIni = s.stockActual();

  // ================= TURNO 1 - LUNES: tarifa promo, descuento producto, pausas, transferencias, mixto =================
  await s.at('2026-11-16 15:50:00');
  await s.cargarPortal();
  const cargasPrevias = { [P.Macanuda]: 100, [P.Corona]: 100, [P.Palito]: 100, [P.SodaPop]: 50, [P.AmstelBot]: 50, [P.CigBohem]: 50, [P.Galleta]: 30, [P.Gordita]: 30, [P.Soda1L]: 30 };
  await s.carga(Object.entries(cargasPrevias).map(([id, c]) => [+id, c]));
  await s.at('2026-11-16 16:00:00'); await s.abrirJornada(200);
  await s.at('2026-11-16 16:10:20'); await s.abrirMesa('Billar #1');
  await s.at('2026-11-16 16:20:00'); const vSoda = await barra([[P.SodaPop, 3]], { caso: 'T1 barra Soda Popular promo' });
  await s.at('2026-11-16 16:30:00'); await s.abrirMesa('Cachos #1');
  await s.at('2026-11-16 16:40:00'); await s.consumo('Cachos #1', P.Galleta, 2);
  await s.at('2026-11-16 17:00:00'); await s.abrirMesa('Privada #1'); await s.egreso('Hielo', 30);
  await s.at('2026-11-16 17:15:50'); await s.cobrarMesa('Billar #1', { caso: 'T1 Billar 65m30s tarifa promo 10' });
  await s.at('2026-11-16 17:30:00'); await s.cobrarMesa('Cachos #1', { metodo: 'qr', caso: 'T1 Cachos 60m exactos QR + galletas' });
  await s.at('2026-11-16 18:00:00'); await s.cobrarMixto('Privada #1', { caso: 'T1 Privada 60m exactos pago mixto' });
  await s.at('2026-11-16 18:05:00'); const vCig = await barra([[P.CigBohem, 5]], { metodo: 'qr', caso: 'T1 barra cigarros QR' });
  await s.at('2026-11-16 18:40:05'); await s.abrirMesa('Billar #2');
  await s.at('2026-11-16 18:50:00'); await s.consumo('Billar #2', P.SodaPop, 2);
  await s.at('2026-11-16 19:00:00'); await s.carga([[P.SodaPop, 24]]);
  await s.at('2026-11-16 19:05:00'); await barra([[P.Galleta, 2], [P.SodaPop, 2]], { mixto: true, caso: 'T1 barra pago mixto' });
  await s.at('2026-11-16 19:30:00'); await s.abrirMesa('Billar #3');
  await s.at('2026-11-16 20:00:00'); await s.abrirMesa('Billar #4');
  await s.at('2026-11-16 20:02:11'); await s.cobrarMesa('Billar #2', { caso: 'T1 Billar abierta en promo (18:40) cobrada tras fin de promo (19:00)' });
  await s.at('2026-11-16 20:10:00'); await s.abrirMesa('Billar #5');
  await s.at('2026-11-16 20:15:00'); await s.abrirMesa('Consumo #1'); await s.consumo('Consumo #1', P.Corona, 2); await s.consumo('Consumo #1', P.Soda1L, 1);
  await s.at('2026-11-16 20:30:00'); await s.pausar('Billar #4');
  await s.at('2026-11-16 20:35:00'); await s.cobrarMixto('Billar #3', { caso: 'T1 Billar 65m a 15 pago mixto' });
  await s.at('2026-11-16 20:40:00'); await s.pausar('Billar #5');
  await s.at('2026-11-16 21:00:00'); await s.reanudar('Billar #4'); await s.abrirMesa('Billar #6'); await s.egreso('Limpieza', 15);
  await s.at('2026-11-16 21:05:00'); await s.consumo('Consumo #1', P.Gordita, 1); await s.quitarConsumo('Consumo #1', P.Gordita);
  await s.at('2026-11-16 21:10:00'); await s.cobrarMesa('Billar #5', { caso: 'T1 Billar cobrada estando en PAUSA manual (30m jugados + 30m pausa)' }); await s.abrirMesa('Billar #7');
  await s.at('2026-11-16 21:20:00'); await s.cobrarMesa('Consumo #1', { caso: 'T1 mesa Consumo solo productos' });
  await s.at('2026-11-16 21:30:00'); await s.cobrarMesa('Billar #4', { caso: 'T1 Billar pausa+reanuda 30+30m' }); await s.transferir('Billar #6', 'Privada #1');
  await s.at('2026-11-16 22:00:00'); await s.cobrarMesa('Privada #1', { caso: 'T1 transferencia Billar 30m -> Privada 30m' }); await s.abrirMesa('Billar #1');
  await s.at('2026-11-16 22:14:50'); await s.cobrarMesa('Billar #7', { demora: 50, caso: 'T1 Billar 64m50 con 50s en modal de cobro' });
  await s.at('2026-11-16 22:30:00'); await s.sel('Billar #1'); await p.evaluate(() => gestorUI.prepararCobroMesa()); await p.waitForTimeout(60);
  await s.at('2026-11-16 22:31:00'); await p.evaluate(() => gestorUI.cerrarModal('modalConfirmarCobro')); await p.waitForTimeout(80); s.say('cobro cancelado -> reanuda');
  await s.at('2026-11-16 23:00:00'); await s.cobrarMesa('Billar #1', { caso: 'T1 Billar cobro cancelado y retomado, 60m' });
  await s.at('2026-11-16 23:30:00'); await s.abrirMesa('Cachos #1');
  res.bloqueoCierre = await s.api('POST', 'jornada.php?action=cerrar');
  s.say(`intento de cierre con mesa ocupada: ${JSON.stringify(res.bloqueoCierre)}`);
  await s.at('2026-11-16 23:35:00'); await s.cobrarMesa('Cachos #1', { caso: 'T1 Cachos 5m' });
  await s.at('2026-11-16 23:40:00'); res.edicion = await editar(vSoda.id_venta, P.SodaPop, 2, 'T1 corrige venta barra pagada: Soda 3->2'); s.j.ajusteEfectivo = (s.j.ajusteEfectivo || 0) - 6;
  await s.at('2026-11-16 23:45:00'); res.borrado = await borrarDet(vCig.id_venta, P.CigBohem, 'T1 borra detalle de venta QR ya pagada'); s.j.ajusteQR = (s.j.ajusteQR || 0) - 7.5;
  await s.at('2026-11-17 00:00:00'); await s.cerrarJornada();

  // ================= TURNO 2 - MARTES: 2x1, incentivo cruzado, promo que cruza medianoche =================
  await s.at('2026-11-17 15:58:00'); await s.cargarPortal();
  await s.at('2026-11-17 16:00:00'); await s.abrirJornada(300);
  await s.at('2026-11-17 16:30:00'); await s.abrirMesa('Billar #1');
  await s.at('2026-11-17 17:10:00'); await barra([[P.Macanuda, 4, 'par']], { caso: 'T2 barra 2x1 Macanuda x4' });
  await s.at('2026-11-17 17:30:00'); await s.consumo('Billar #1', P.Macanuda, 2, { par: true });
  await s.at('2026-11-17 17:40:00'); await s.consumo('Billar #1', P.Macanuda, 1);
  await s.at('2026-11-17 17:50:00'); await s.consumo('Billar #1', P.Macanuda, 1);
  await s.at('2026-11-17 18:00:00'); await s.abrirMesa('Billar #2');
  await s.at('2026-11-17 18:05:00'); await s.consumo('Billar #2', P.AmstelBot, 2);
  await s.at('2026-11-17 18:10:00'); await s.cobrarMesa('Billar #1', { caso: 'T2 2x1 en mesa: 1 par + 2 sueltas' });
  await s.at('2026-11-17 18:30:00'); await s.abrirMesa('Billar #3'); await s.consumo('Billar #3', P.AmstelBot, 2);
  await s.at('2026-11-17 18:40:00'); await s.abrirMesa('Cachos #1'); await s.consumo('Cachos #1', P.AmstelBot, 1);
  await s.at('2026-11-17 19:05:00'); await s.cobrarMesa('Billar #2', { caso: 'T2 incentivo cruzado >1h efectivo' });
  await s.at('2026-11-17 19:30:00'); await s.cobrarMesa('Cachos #1', { caso: 'T2 incentivo cruzado NO alcanza 1h (50m)' });
  await s.at('2026-11-17 19:35:00'); await s.cobrarMixto('Billar #3', { caso: 'T2 incentivo cruzado >1h pago mixto' });
  await s.at('2026-11-17 20:00:00'); await s.abrirMesa('Privada #1');
  await s.at('2026-11-17 20:05:00'); await s.consumo('Privada #1', P.Macanuda, 2, { par: true });
  await s.at('2026-11-17 21:50:00'); await s.abrirMesa('Billar #4'); await s.consumo('Billar #4', P.Macanuda, 2, { par: true });
  await s.at('2026-11-17 22:10:00'); await s.cobrarMesa('Billar #4', { caso: 'T2 2x1 pedido 21:50 en promo, cobrado 22:10 fuera de horario' });
  await s.at('2026-11-17 22:20:00'); await s.cobrarMesa('Privada #1', { caso: 'T2 Privada 2h20 con 2x1 pedido en promo, cobrado fuera de horario' });
  await s.at('2026-11-17 22:30:00'); await barra([[P.Palito, 2]], { caso: 'T2 barra Palito promo nocturna' });
  await s.at('2026-11-17 23:30:00'); await s.abrirMesa('Cachos #1');
  await s.at('2026-11-17 23:50:00'); await barra([[P.Palito, 1]], { metodo: 'qr', caso: 'T2 barra Palito 23:50' });
  await s.at('2026-11-18 00:10:00'); await barra([[P.Palito, 1]], { caso: 'T2 barra Palito 00:10 (cruzó medianoche)' });
  await s.at('2026-11-18 00:20:00'); await s.cobrarMesa('Cachos #1', { caso: 'T2 Cachos 50m cruzando medianoche' });
  await s.at('2026-11-18 00:30:00'); await s.cerrarJornada();

  // ================= TURNO 3 - SABADO: incentivo mesa, incentivo producto (hora con descuento), doble ocupacion =================
  await s.at('2026-11-21 13:58:00'); await s.cargarPortal();
  await s.at('2026-11-21 14:00:00'); await s.abrirJornada(150);
  await s.at('2026-11-21 14:10:00'); await s.abrirMesa('Privada #1');
  await s.at('2026-11-21 14:20:00'); await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #1', caso: 'T3 barra 4 Corona + hora con descuento Billar #1' });
  await s.at('2026-11-21 14:30:00'); await s.abrirMesa('Billar #2');
  await s.at('2026-11-21 14:35:00'); await s.consumo('Billar #2', P.Corona, 4, { incentivo: 'si' });
  await s.at('2026-11-21 15:40:00'); await s.cobrarMesa('Billar #1', { caso: 'T3 hora con descuento 80m: paga 20m' });
  await s.at('2026-11-21 16:05:00'); await s.cobrarMesa('Billar #2', { metodo: 'qr', caso: 'T3 hora con descuento por consumo en mesa 95m QR' });
  await s.at('2026-11-21 16:10:00'); await s.cobrarMesa('Privada #1', { caso: 'T3 incentivo mesa 2h exactas' });
  await s.at('2026-11-21 16:15:00'); await s.abrirMesa('Privada #1');
  await s.at('2026-11-21 16:20:00'); await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #3', caso: 'T3 barra 4 Corona + hora con descuento Billar #3' });
  await s.at('2026-11-21 16:50:00'); await s.transferir('Billar #3', 'Cachos #1');
  await s.at('2026-11-21 17:20:00'); await s.cobrarMesa('Cachos #1', { caso: 'T3 hora con descuento Billar transferida a Cachos' });
  await s.at('2026-11-21 17:45:00'); await s.cobrarMesa('Privada #1', { caso: 'T3 incentivo mesa NO alcanza 2h (90m)' });
  await s.at('2026-11-21 18:00:00'); await s.abrirMesa('Privada #1');
  await s.at('2026-11-21 18:05:00'); await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #5', caso: 'T3 barra 4 Corona + hora con descuento Billar #5' });
  await s.at('2026-11-21 18:35:00'); await s.cobrarMesa('Billar #5', { caso: 'T3 hora con descuento jugó solo 30m: paga 0' });
  await s.at('2026-11-21 19:00:00'); await s.abrirMesa('Billar #6'); await s.consumo('Billar #6', P.Corona, 4, { incentivo: 'no' });
  await s.at('2026-11-21 19:10:00'); await s.abrirMesa('Billar #7');
  res.dobleOcupacion = await s.api('POST', 'atencion_barra.php', { accion: 'ocupar_mesa', id_mesa: await s.mesaAttr('Billar #7', 'data-id'), id_usuario: 4 });
  s.say(`DOBLE ocupar_mesa sobre Billar #7 (2 cajas / doble clic): ${JSON.stringify(res.dobleOcupacion)}`);
  await p.evaluate(async () => {
    await gestorUI.cargarGrillaMesas();
    gestorUI.actualizarRelojes();
  });
  await s.at('2026-11-21 20:00:00'); await s.cobrarMesa('Billar #6', { caso: 'T3 rechaza incentivo: 60m + 4 Corona' });
  await s.at('2026-11-21 20:10:00'); await s.cobrarMesa('Billar #7', { caso: 'T3 Billar tras intento de doble ocupación, 60m' });
  res.huerfanas = q(`SELECT s.id_sesion,s.estado,t.id_mesa,t.fecha_hora_inicio,t.fecha_hora_fin FROM sesiones_juego s JOIN tramos_mesas t USING(id_sesion) WHERE s.estado='activa'`);
  await s.at('2026-11-21 20:30:00'); await s.cobrarMixto('Privada #1', { caso: 'T3 incentivo mesa 2h30 pago mixto' });
  await s.at('2026-11-21 20:40:00'); await s.abrirMesa('Billar #1'); await s.consumo('Billar #1', P.Corona, 4, { incentivo: 'si' });
  await s.at('2026-11-21 20:50:00'); await s.quitarHoraGratis('Billar #1');
  await s.at('2026-11-21 21:10:00'); await s.cobrarMesa('Billar #1', { caso: 'T3 quita Hora Promo: se revierte la hora con descuento' });
  await s.at('2026-11-21 22:00:00'); await s.cerrarJornada();

  // ================= TURNO 4 - DOMINGO: aleatorio con semilla, sin promociones, mide frecuencia =================
  let seed = 20261122;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[ri(0, a.length - 1)];
  const MESAS = ['Billar #1', 'Billar #2', 'Billar #3', 'Billar #4', 'Billar #5', 'Billar #6', 'Billar #7', 'Privada #1', 'Cachos #1', 'Consumo #1', 'Consumo #2'];
  const PR = [P.SodaPop, P.AmstelBot, P.Palito, P.Corona, P.CigBohem, P.Galleta, P.Soda1L, P.Gordita];
  const t0 = ts('2026-11-22 16:00:00');
  const ev = [];
  for (const m of MESAS) {
    let cur = t0 + ri(1, 40) * 60000 + ri(0, 59) * 1000;
    while (cur < t0 + 7.2 * 3600e3) {
      const dur = ri(18, 110) * 60000 + ri(0, 59) * 1000;
      const fin = cur + dur;
      if (fin > t0 + 7.8 * 3600e3) break;
      ev.push({ t: cur, k: 'abre', m });
      const n = ri(0, 3);
      for (let i = 0; i < n; i++) ev.push({ t: cur + ri(1, dur / 60000 - 2) * 60000 + ri(0, 59) * 1000, k: 'cons', m, id: pick(PR), q: ri(1, 3) });
      if (m[0] !== 'C' && rnd() < 0.15) {
        const pa = cur + Math.floor(dur * 0.4);
        ev.push({ t: pa, k: 'pausa', m });
        ev.push({ t: pa + ri(3, 12) * 60000, k: 'rean', m });
      }
      ev.push({ t: fin, k: 'cobra', m, met: pick(['efectivo', 'efectivo', 'efectivo', 'qr', 'mixto']), dem: ri(5, 45) });
      cur = fin + ri(2, 20) * 60000 + ri(0, 59) * 1000;
    }
  }
  for (let i = 0; i < 14; i++) ev.push({ t: t0 + ri(5, 470) * 60000 + ri(0, 59) * 1000, k: 'barra', lin: [[pick(PR), ri(1, 4)]], met: pick(['efectivo', 'qr', 'mixto']) });
  ev.sort((a, x) => a.t - x.t);
  await s.at('2026-11-22 15:58:00');
  await s.cargarPortal();
  const cargasT4 = Object.fromEntries(PR.map((i) => [i, 100]));
  await s.carga(PR.map((i) => [i, 100]));
  await s.at(t0);
  await s.abrirJornada(250);
  for (const e of ev) {
    if (e.t <= s.now) e.t = s.now + 1000;
    await s.at(e.t);
    const v = s.ses[e.m];
    try {
      if (e.k === 'abre') await s.abrirMesa(e.m);
      else if (e.k === 'cons') await s.consumo(e.m, e.id, e.q);
      else if (e.k === 'pausa' && v && !v.pausa) await s.pausar(e.m);
      else if (e.k === 'rean' && v && v.pausa) await s.reanudar(e.m);
      else if (e.k === 'barra') await barra(e.lin, e.met === 'mixto' ? { mixto: true, caso: 'T4 barra mixto' } : { metodo: e.met, caso: 'T4 barra ' + e.met });
      else if (e.k === 'cobra') {
        if (e.met === 'mixto') await s.cobrarMixto(e.m, { caso: `T4 ${e.m} mixto` });
        else await s.cobrarMesa(e.m, { metodo: e.met, demora: e.dem, caso: `T4 ${e.m} ${e.met}` });
      }
    } catch (err) {
      s.say(`ERROR evento ${e.k} ${e.m}: ${err.message.slice(0, 200)}`);
      errs.push(`EVENTO ${e.k} ${e.m} ${err.message.slice(0, 200)}`);
    }
  }
  await s.at('2026-11-23 00:00:00');
  await s.cerrarJornada();

  const stockFin = s.stockActual();
  fs.writeFileSync(
    path.join(DIR_RESULTADOS, 'turnos.json'),
    JSON.stringify({ sales: s.sales, notes: s.notes, jornadas: s.jornadas, res, errs, stockIni, stockFin, cargasPrevias, cargasT4 }, null, 1),
  );
  console.log('FIN. ventas:', s.sales.length, 'notas:', s.notes.length, 'errs:', errs.length);
  await navegador.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
