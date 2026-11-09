-- SOLO corre sobre el clon billar_sim. Deja un punto de partida limpio conservando catálogo e historial.
UPDATE jornadas SET estado='cerrada', fecha_hora_cierre=fecha_hora_apertura WHERE estado='abierta';
UPDATE tramos_mesas SET fecha_hora_fin=fecha_hora_inicio WHERE fecha_hora_fin IS NULL;
UPDATE sesiones_juego SET estado='finalizada' WHERE estado='activa';
UPDATE mesas SET estado_actual='libre' WHERE estado_actual='ocupada';
DELETE FROM jornada_inventario_apertura;
DELETE FROM promociones;
-- Deben coincidir con la lista PROMOS de lib.js.
INSERT INTO promociones (id_promocion,nombre_promo,tipo_promo,hora_inicio,hora_fin,dias_semana,valor_descuento,id_item_condicion,id_item_secundario,cantidad_condicion) VALUES
(101,'SIM Billar a 10','tarifa_mesa','16:00:00','19:00:00','lunes',10,2,NULL,NULL),
(102,'SIM Soda Popular a 6','descuento_producto',NULL,NULL,'lunes',6,12,NULL,NULL),
(103,'SIM 2x1 Macanuda','combo_2x1','17:00:00','22:00:00','martes',NULL,1,NULL,NULL),
(104,'SIM Amstel Bot a 12 tras 1h','incentivo_cruzado',NULL,NULL,'martes',12,46,NULL,1),
(105,'SIM Palito nocturno a 7','descuento_producto','22:00:00','02:00:00','martes',7,9,NULL,NULL),
(106,'SIM Privada a 25 tras 2h','incentivo_mesa',NULL,NULL,'sábado',25,1,NULL,2),
(107,'SIM 4 Corona: 1a hora gratis','incentivo_producto',NULL,NULL,'sábado',5,6,2,4),
(108,'SIM Cachos a 5','tarifa_mesa','15:00:00','21:00:00','jueves',5,3,NULL,NULL);
