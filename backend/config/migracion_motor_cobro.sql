-- Motor de cobro único. Ejecutar una sola vez, antes de subir el código nuevo.
-- Hacerlo con la jornada cerrada, sin mesas abiertas y con un respaldo previo de la base.

-- Diferencia entre lo calculado y lo cobrado al redondear hacia arriba a .00 o .50.
-- Con ella se cumple: total_pagar = subtotal_mesas + subtotal_productos - descuentos + redondeo.
ALTER TABLE ventas
ADD COLUMN redondeo DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER descuentos;

-- Momento en que se pidió cada producto: conserva las promos de ese momento (por ejemplo el 2x1)
-- aunque la mesa se cobre después de que terminó la promo.
ALTER TABLE detalle_venta_productos
ADD COLUMN fecha_hora DATETIME NULL AFTER precio_unitario_aplicado;
