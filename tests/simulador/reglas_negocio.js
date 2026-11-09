// Los ejemplos del dueño del negocio, jugados en pantalla. Los montos esperados están escritos a mano
// a propósito: no salen del oráculo ni del sistema. Pantalla, total registrado y pagos deben dar lo mismo.
const fs = require('fs');
const path = require('path');
const { DIR_RESULTADOS } = require('./config');
const { Sim, abrirNavegador, difieren } = require('./lib');

const P = { Macanuda: 1, Corona: 6, SodaPop: 12 };
const casos = [];

function verificar(nombre, venta, esperado) {
  if (!venta) {
    casos.push({ nombre, esperado, ok: false, detalle: 'el sistema rechazó el cobro' });
    return;
  }
  const { pantalla } = venta;
  const { total, pagos } = venta.bd;
  const ok = !difieren(pantalla, esperado) && !difieren(total, esperado) && !difieren(pagos, esperado);
  casos.push({ nombre, esperado, ok, detalle: `pantalla ${pantalla} | total ${total} | pagos ${pagos}` });
}

(async () => {
  const { navegador, page } = await abrirNavegador();
  const s = new Sim(page);
  const barra = async (lineas, opciones) => {
    await page.evaluate(() => {
      if (modoActual === 'mesa') gestorUI.deseleccionarMesa();
    });
    return s.ventaBarra(lineas, opciones);
  };

  // ---------- MARTES: 2x1 de Paceña Macanuda (Bs 22) de 17:00 a 22:00 ----------
  await s.at('2026-12-01 16:00:00');
  await s.cargarPortal();
  await s.carga([[P.Macanuda, 100], [P.Corona, 100], [P.SodaPop, 50]]);
  await s.abrirJornada(100);

  await s.at('2026-12-01 17:05:00');
  verificar('2x1 con la pantalla abierta desde antes de la promo: 2 uds pagan 1', await barra([[P.Macanuda, 2]], { caso: '2x1 vista vieja' }), 22);

  await s.at('2026-12-01 17:10:00');
  await s.refrescarAtencion();
  verificar('2x1 en barra: 5 uds pagan 3', await barra([[P.Macanuda, 5]], { caso: '2x1 barra x5' }), 66);

  await s.at('2026-12-01 17:12:00');
  verificar('2x1 en barra con pago mixto: 2 uds pagan 1', await barra([[P.Macanuda, 2]], { mixto: true, caso: '2x1 barra mixto' }), 22);

  await s.at('2026-12-01 17:15:00');
  await s.abrirMesa('Consumo #1');
  await s.consumo('Consumo #1', P.Macanuda, 2);
  await s.consumo('Consumo #1', P.Macanuda, 2);
  await s.consumo('Consumo #1', P.Macanuda, 1);
  await s.at('2026-12-01 17:20:00');
  verificar('2x1 en mesa pedido en 3 líneas (2+2+1): pagan 3', await s.cobrarMesa('Consumo #1', { caso: '2x1 mesa 3 lineas' }), 66);

  await s.at('2026-12-01 21:50:00');
  await s.abrirMesa('Consumo #2');
  await s.consumo('Consumo #2', P.Macanuda, 2);
  await s.at('2026-12-01 22:10:00');
  verificar('2x1 pedido en promo y pagado después: lo conserva', await s.cobrarMesa('Consumo #2', { caso: '2x1 conserva' }), 22);

  await s.at('2026-12-01 22:12:00');
  await s.abrirMesa('Consumo #3');
  await s.consumo('Consumo #3', P.Macanuda, 2);
  await s.at('2026-12-01 22:14:00');
  verificar('Pedido después de terminar la promo: precio completo', await s.cobrarMesa('Consumo #3', { caso: '2x1 fuera de promo' }), 44);
  await s.at('2026-12-01 22:20:00');
  await s.cerrarJornada();

  // ---------- JUEVES: Cachos (Bs 10) a Bs 5 de 15:00 a 21:00. Billar (Bs 15) sin promo ----------
  await s.at('2026-12-03 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);

  await s.at('2026-12-03 14:30:00');
  await s.abrirMesa('Cachos #1');
  await s.at('2026-12-03 16:00:00');
  verificar('Mesa abierta 14:30 con promo desde 15:00, cierra 16:00: 5 + 5', await s.cobrarMesa('Cachos #1', { caso: 'ejemplo 10' }), 10);

  await s.at('2026-12-03 18:00:00');
  await s.abrirMesa('Cachos #1');
  await s.at('2026-12-03 22:00:00');
  verificar('Mesa abierta 18:00 con promo hasta 21:00, cierra 22:00: 15 + 10', await s.cobrarMesa('Cachos #1', { caso: 'ejemplo 25' }), 25);

  const bloque = async (mesa, abre, cierra, nombre, esperado) => {
    await s.at(abre);
    await s.abrirMesa(mesa);
    await s.at(cierra);
    verificar(nombre, await s.cobrarMesa(mesa, { caso: nombre }), esperado);
  };
  await bloque('Billar #1', '2026-12-03 22:10:00', '2026-12-03 22:10:01', 'Bloque: 00:01 cobra el primero (1,25 → 1,50)', 1.5);
  await bloque('Billar #2', '2026-12-03 22:20:00', '2026-12-03 22:25:00', 'Bloque: 05:00 sigue en el primero (1,25 → 1,50)', 1.5);
  await bloque('Billar #3', '2026-12-03 22:30:00', '2026-12-03 22:35:01', 'Bloque: 05:01 cobra el segundo (2,50)', 2.5);
  await bloque('Billar #4', '2026-12-03 22:40:00', '2026-12-03 22:50:01', 'Bloque: 10:01 cobra el tercero (3,75 → 4,00)', 4);

  await s.at('2026-12-03 23:00:00');
  await s.abrirMesa('Billar #5');
  await s.at('2026-12-04 00:05:00');
  const mixto = await s.cobrarMixto('Billar #5', { caso: 'mixto 65 min' });
  verificar('Pago mixto de 65 min en Billar: aceptado y redondeado (16,25 → 16,50)', mixto && mixto.tipo === 'mesa_mixto' ? mixto : null, 16.5);

  await s.at('2026-12-04 00:10:00');
  await s.abrirMesa('Billar #6');
  await s.at('2026-12-04 00:40:00');
  await s.pausar('Billar #6');
  await s.at('2026-12-04 01:10:00');
  verificar('Cobrar una mesa en pausa no cobra el tiempo pausado', await s.cobrarMesa('Billar #6', { caso: 'cobro en pausa' }), 7.5);
  await s.at('2026-12-04 01:15:00');
  await s.cerrarJornada();

  // ---------- SÁBADO: Privada (Bs 30) a Bs 25 tras 2 h. 4 Corona + Bs 5 = una hora gratis ----------
  await s.at('2026-12-05 14:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);

  await s.at('2026-12-05 14:10:00');
  await s.abrirMesa('Privada #1');
  await s.at('2026-12-05 16:10:00');
  verificar('Incentivo en mesa: 2 h exactas aún a tarifa normal', await s.cobrarMesa('Privada #1', { caso: 'incentivo 2h' }), 60);

  await s.at('2026-12-05 16:15:00');
  await s.abrirMesa('Privada #1');
  await s.at('2026-12-05 19:15:00');
  verificar('Incentivo en mesa: 3 h = 2 h a 30 + 1 h a 25', await s.cobrarMesa('Privada #1', { caso: 'incentivo 3h' }), 85);

  await s.at('2026-12-05 19:20:00');
  verificar(
    'Incentivo en producto: 4 Corona + aumento de Bs 5',
    await barra([[P.Corona, 4]], { incentivo: 'si', mesaIncentivo: 'Billar #1', caso: 'hora gratis barra' }),
    101,
  );
  await s.at('2026-12-05 20:40:00');
  verificar('Hora gratis: 80 min en Billar pagan 20 min', await s.cobrarMesa('Billar #1', { caso: 'hora gratis 80m' }), 5);
  await s.at('2026-12-05 20:45:00');
  await s.cerrarJornada();

  // ---------- LUNES: Billar a Bs 10 de 16:00 a 19:00. Soda Popular a Bs 6 ----------
  await s.at('2026-12-07 16:00:00');
  await s.cargarPortal();
  await s.abrirJornada(100);

  await s.at('2026-12-07 16:10:00');
  await s.abrirMesa('Billar #1');
  await s.at('2026-12-07 16:40:00');
  await s.transferir('Billar #1', 'Billar #2');
  await s.at('2026-12-07 17:10:00');
  verificar('Transferencia entre billares durante la promo: conserva la tarifa', await s.cobrarMesa('Billar #2', { caso: 'transferencia en promo' }), 10);

  await s.at('2026-12-07 18:40:05');
  await s.abrirMesa('Billar #2');
  await s.at('2026-12-07 18:50:00');
  await s.consumo('Billar #2', P.SodaPop, 2);
  await s.at('2026-12-07 20:02:11');
  verificar('Mesa abierta en promo y cobrada después, con 2 sodas (31,58 → 32,00)', await s.cobrarMesa('Billar #2', { caso: 'fila 2' }), 32);
  await s.at('2026-12-07 20:10:00');
  await s.cerrarJornada();

  await navegador.close();

  console.log('\n===== REGLAS DEL NEGOCIO');
  for (const c of casos) console.log(`${c.ok ? '✓' : '✗'} ${c.nombre}\n    esperado ${c.esperado} | ${c.detalle}`);
  const fallas = casos.filter((c) => !c.ok).length;
  console.log(`\n${casos.length - fallas} de ${casos.length} correctos`);
  fs.writeFileSync(path.join(DIR_RESULTADOS, 'reglas.json'), JSON.stringify(casos, null, 1));
  process.exit(fallas ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
