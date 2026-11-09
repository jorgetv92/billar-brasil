// Prueba backend/config/limpieza_sesiones_huerfanas.sql sobre el clon, nunca sobre la BD real.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BD_SIM, DIR_RESULTADOS, MYSQL, RAIZ_REPO } = require('./config');
const { q } = require('./lib');

const SCRIPT = path.join(RAIZ_REPO, 'backend', 'config', 'limpieza_sesiones_huerfanas.sql');
const resultados = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` | ${detalle}` : ''}`);
}

const ejecutarScript = () =>
  execFileSync(MYSQL, ['-uroot', '--default-character-set=utf8mb4', BD_SIM], { input: fs.readFileSync(SCRIPT), encoding: 'utf8' });

const activas = (estadoJornada) =>
  q(`SELECT s.id_sesion FROM sesiones_juego s JOIN jornadas j USING(id_jornada)
     WHERE s.estado='activa' AND j.estado='${estadoJornada}' ORDER BY s.id_sesion`).map((x) => +x.id_sesion);

// Todo lo que el script no debe cambiar: dinero, inventario y estado de las mesas.
const huella = () =>
  JSON.stringify(
    q(`SELECT (SELECT COUNT(*) FROM ventas) ventas,
        (SELECT SUM(total_pagar) FROM ventas) total,
        (SELECT SUM(monto_pagado) FROM pagos_venta) pagos,
        (SELECT COUNT(*) FROM detalle_venta_productos) detalle,
        (SELECT SUM(stock_actual) FROM productos) stock,
        (SELECT GROUP_CONCAT(id_mesa,':',estado_actual ORDER BY id_mesa) FROM mesas) mesas,
        (SELECT COUNT(*) FROM sesiones_juego) sesiones,
        (SELECT COUNT(*) FROM tramos_mesas) tramos,
        (SELECT SUM(importe_tramo) FROM tramos_mesas) importes`)[0],
  );

const tramosDe = (ids) =>
  ids.length ? q(`SELECT id_sesion,id_tramo,fecha_hora_inicio,fecha_hora_fin,fecha_hora_pausa FROM tramos_mesas WHERE id_sesion IN (${ids.join(',')})`) : [];

const huerfanas = activas('cerrada');
const legitimas = activas('abierta');
console.log(`Sesiones activas en jornadas cerradas: ${huerfanas.join(', ')}`);
console.log(`Sesiones activas en la jornada abierta: ${legitimas.join(', ')}`);

// Una sesión vieja con consumo sin cobrar no debe cerrarse sola: requiere revisión manual.
const idJornadaCerrada = q(`SELECT id_jornada FROM jornadas WHERE estado='cerrada' ORDER BY id_jornada LIMIT 1`)[0].id_jornada;
const idConConsumo = +q(`SELECT MAX(id_sesion)+1000 id FROM sesiones_juego`)[0].id;
q(`INSERT INTO sesiones_juego (id_sesion,id_jornada,estado) VALUES (${idConConsumo},${idJornadaCerrada},'activa');
   INSERT INTO tramos_mesas (id_sesion,id_mesa,fecha_hora_inicio,tarifa_hora_aplicada) VALUES (${idConConsumo},4,'2026-06-01 10:00:00',10);
   INSERT INTO detalle_venta_productos (id_venta,id_sesion,id_producto,cantidad,precio_unitario_aplicado) VALUES (NULL,${idConConsumo},6,1,24);`);

const legitimasAntes = JSON.stringify(tramosDe(legitimas));
const huellaAntes = huella();
const salida = ejecutarScript();
console.log(salida);

comprobar('Hay sesiones huérfanas que limpiar', huerfanas.length > 0, `${huerfanas.length} sesiones`);
comprobar('Solo queda abierta la que tiene consumo', JSON.stringify(activas('cerrada')) === JSON.stringify([idConConsumo]), `quedan: ${activas('cerrada').join(', ')}`);

const cerrados = tramosDe(huerfanas);
comprobar(
  'Cada tramo huérfano queda con 0 horas y sin pausa',
  cerrados.length > 0 && cerrados.every((t) => t.fecha_hora_fin === t.fecha_hora_inicio && t.fecha_hora_pausa === null),
  `${cerrados.length} tramos`,
);
comprobar('Las sesiones de la jornada abierta no cambian', JSON.stringify(activas('abierta')) === JSON.stringify(legitimas) && JSON.stringify(tramosDe(legitimas)) === legitimasAntes);
comprobar('No cambian dinero, inventario ni estado de mesas', huella() === huellaAntes, huella());

const despues = JSON.stringify(tramosDe(huerfanas));
const huellaDespues = huella();
ejecutarScript();
comprobar('Ejecutarlo de nuevo no cambia nada', JSON.stringify(tramosDe(huerfanas)) === despues && huella() === huellaDespues);

const fallas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - fallas} de ${resultados.length} correctos`);
fs.writeFileSync(path.join(DIR_RESULTADOS, 'limpieza.json'), JSON.stringify(resultados, null, 1));
process.exit(fallas ? 1 : 0);
