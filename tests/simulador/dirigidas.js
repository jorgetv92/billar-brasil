// Pruebas dirigidas que aíslan causas raíz: transferencias, promos con la pantalla abierta, sobreventa y precios.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, q } = require('./lib');

const P = { Macanuda: 1, Corona: 6, Palito: 9, SodaPop: 12, AmstelBot: 46, HoraPromo: 47, Chocosoda: 27 };

(async () => {
  const { navegador, page: p } = await abrirNavegador();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => {
    errs.push('ALERT: ' + d.message());
    d.accept().catch(() => {});
  });
  const s = new Sim(p);
  const out = {};
  const barra = async (l, o) => {
    await p.evaluate(() => {
      if (modoActual === 'mesa') gestorUI.deseleccionarMesa();
    });
    return s.ventaBarra(l, o);
  };
  const stock = (id) => +q(`SELECT stock_actual FROM productos WHERE id_producto=${id}`)[0].stock_actual;

  // ---------- LUNES 23: transferencia durante promo de tarifa ----------
  await s.at('2026-11-23 15:59:00'); await s.cargarPortal(); await s.at('2026-11-23 16:00:00'); await s.abrirJornada(100);
  await s.at('2026-11-23 16:10:00'); await s.abrirMesa('Billar #1');
  await s.at('2026-11-23 16:40:00'); await s.transferir('Billar #1', 'Billar #2');
  await s.at('2026-11-23 17:10:00'); await s.cobrarMesa('Billar #2', { caso: 'R1 transferencia entre billares DURANTE promo a 10/h (30+30m)' });
  await s.at('2026-11-23 17:20:00'); await s.abrirMesa('Consumo #1'); await s.consumo('Consumo #1', P.SodaPop, 2);
  await s.at('2026-11-23 17:30:00'); await s.transferir('Consumo #1', 'Billar #3');
  await s.at('2026-11-23 18:30:00'); await s.cobrarMesa('Billar #3', { caso: 'R2 transferencia Consumo -> Billar: 60m + 2 sodas' });
  await s.at('2026-11-23 18:40:00'); await s.abrirMesa('Cachos #1');
  const antes = stock(P.AmstelBot);
  await s.consumo('Cachos #1', P.AmstelBot, 3);
  const conConsumo = stock(P.AmstelBot);
  await s.api('POST', 'atencion_barra.php', { accion: 'limpiar_consumo_mesa', id_mesa: await s.mesaAttr('Cachos #1', 'data-id') });
  s.ses['Cachos #1'].prods = [];
  out.limpiar = { antes, con_consumo: conConsumo, tras_limpiar: stock(P.AmstelBot) };
  await s.at('2026-11-23 19:40:00'); await s.cobrarMesa('Cachos #1', { caso: 'R3 limpiar consumo: 60m sin productos' });
  const choco = stock(P.Chocosoda);
  const sobreventa = await s.api('POST', 'atencion_barra.php', { accion: 'registrar_venta_barra', total: 8, metodo_pago: 'efectivo', productos: [{ id_producto: P.Chocosoda, cantidad: 2, precio_unitario: 4, nombre: 'x' }] });
  out.sobreventa = { stock_antes: choco, respuesta: sobreventa, stock_despues: stock(P.Chocosoda) };
  const precio = await s.api('POST', 'atencion_barra.php', { accion: 'registrar_venta_barra', total: 1, metodo_pago: 'efectivo', productos: [{ id_producto: P.Macanuda, cantidad: 1, precio_unitario: 1, nombre: 'x' }] });
  out.precioCliente = { respuesta: precio, detalle: q(`SELECT cantidad,precio_unitario_aplicado FROM detalle_venta_productos ORDER BY id_detalle_prod DESC LIMIT 1`)[0] };
  await s.at('2026-11-23 20:30:00'); await s.cerrarJornada();

  // ---------- MARTES 24: portal abierto a distintas horas (caché de promos) ----------
  await s.at('2026-11-24 16:00:00'); await s.cargarPortal(); await s.abrirJornada(100);
  await s.at('2026-11-24 17:05:00'); await barra([[P.Macanuda, 2]], { caso: 'R4 barra 2x1: vista cargada ANTES de la promo (17:00)' });
  await s.at('2026-11-24 17:10:00'); await s.refrescarAtencion(); await barra([[P.Macanuda, 2]], { caso: 'R5 barra 2x1: vista recargada DENTRO de la promo' });
  await s.at('2026-11-24 17:15:00'); await barra([[P.Macanuda, 2]], { mixto: true, caso: 'R6 barra 2x1 pago mixto' });
  await s.at('2026-11-24 17:20:00'); await s.abrirMesa('Billar #1'); await s.consumo('Billar #1', P.Macanuda, 2);
  await s.at('2026-11-24 18:20:00'); await s.cobrarMesa('Billar #1', { caso: 'R7 mesa 2x1 una línea x2' });
  await s.at('2026-11-24 21:50:00'); await s.abrirMesa('Billar #2'); await s.consumo('Billar #2', P.Macanuda, 2); await barra([[P.Corona, 1]], { caso: '(venta intermedia)' });
  await s.at('2026-11-24 22:10:00'); await s.cobrarMesa('Billar #2', { caso: 'R8 mesa 2x1: pedido en promo, cobrada 22:10 fuera de horario' });
  await s.at('2026-11-24 22:11:00'); await s.refrescarAtencion();
  await s.at('2026-11-24 22:12:00'); await barra([[P.Palito, 1]], { caso: 'R9 barra Palito promo nocturna' });
  await s.cerrarJornada();

  // ---------- MIÉRCOLES 25: fin de promo de precio con la pantalla abierta ----------
  await s.at('2026-11-25 01:50:00'); await s.cargarPortal(); await s.abrirJornada(100);
  await s.at('2026-11-25 02:10:00'); await barra([[P.Palito, 2]], { caso: 'R10 barra Palito 02:10: promo terminó a 02:00, vista cargada 01:50' });
  await s.at('2026-11-25 02:20:00'); await barra([[P.Palito, 2]], { caso: 'R11 barra Palito 02:20' });
  await s.cerrarJornada();

  // ---------- SÁBADO 28: hora gratis comprada con pago mixto ----------
  await s.at('2026-11-28 14:00:00'); await s.cargarPortal(); await s.abrirJornada(100);
  await s.at('2026-11-28 14:10:00'); await barra([[P.Corona, 4]], { mixto: true, incentivo: 'si', mesaIncentivo: 'Billar #1', caso: 'R12 barra 4 Corona + hora gratis, pago mixto' });
  await s.at('2026-11-28 15:10:00'); await s.cobrarMesa('Billar #1', { caso: 'R13 hora gratis: 60m exactos = 0' });
  await s.at('2026-11-28 15:20:00'); await s.abrirMesa('Privada #1');
  await s.at('2026-11-28 15:50:00'); await s.pausar('Privada #1');
  await s.at('2026-11-28 16:50:00'); await s.reanudar('Privada #1');
  await s.at('2026-11-28 18:20:00'); await s.cobrarMesa('Privada #1', { caso: 'R14 incentivo mesa con pausa: 2h jugadas + 1h pausa' });
  await s.at('2026-11-28 18:30:00'); await s.cerrarJornada();

  fs.writeFileSync(
    path.join(DIR_RESULTADOS, 'dirigidas.json'),
    JSON.stringify({ sales: s.sales, notes: s.notes, out, errs, jornadas: s.jornadas.map((j) => ({ id: j.id, precierre: j.precierre })) }, null, 1),
  );
  await navegador.close();
  console.log('FIN. ventas:', s.sales.length, 'notas:', s.notes.length, 'errs:', errs.length);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
