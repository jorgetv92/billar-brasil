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
-- Combos específicos: el cajero los elige en el buscador. El 110 solo vale los viernes de 20:00 a 23:00.
INSERT INTO promociones (id_promocion,nombre_promo,tipo_promo,hora_inicio,hora_fin,dias_semana,valor_descuento) VALUES
(109,'SIM Combo 2 Amstel','combo_especifico',NULL,NULL,NULL,30),
(110,'SIM Combo nocturno','combo_especifico','20:00:00','23:00:00','viernes',40);
INSERT INTO promocion_items (id_promocion,id_producto,cantidad) VALUES (109,46,2),(110,1,1),(110,6,1);
-- Cargos y catálogo de prueba: un preparado sin stock, un producto retirado y uno con "promo" en el nombre.
INSERT INTO conceptos_cargo (nombre,monto_sugerido) VALUES ('SIM Vaso roto',8.00);
INSERT INTO productos (nombre_producto,precio_venta,stock_actual,tipo,activo) VALUES
('SIM Vaso de Fernet',30.00,0,'preparado',1),
('SIM Producto retirado',5.00,10,'inventario',0),
('Promoras',3.00,50,'inventario',1);
-- Insumos de prueba: SIM Hielo tiene poco stock para probar gastos simultáneos.
INSERT INTO insumos (nombre_insumo,unidad_medida,stock_actual) VALUES
('SIM Detergente','Kilos',4.00),
('SIM Papel','Rollos',20.00),
('SIM Hielo','Bolsas',5.00);
