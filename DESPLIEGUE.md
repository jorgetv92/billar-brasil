# Despliegue al hosting: corrección de cobros, caja y reportes

Pasos para llevar al hosting las 5 entregas de la rama `fix/motor-cobro` en una sola migración. Este archivo no se sube al servidor.

## Antes de empezar

- Respaldar la base de datos y los archivos del hosting.
- Cerrar la jornada. No debe quedar ninguna mesa abierta.
- El hosting necesita PHP 7.0 o superior y MySQL o MariaDB con tablas InnoDB, igual que ahora.

## 1. Base de datos

Ejecutar en la base del hosting, en este orden y una sola vez:

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `backend/config/migracion_motor_cobro.sql` | Agrega `ventas.redondeo` y `detalle_venta_productos.fecha_hora`. |
| 2 | `backend/config/migracion_ajustes_venta.sql` | Crea la tabla `ajustes_venta`, la bitácora de correcciones. |
| 3 | `backend/config/limpieza_sesiones_huerfanas.sql` | Cierra las partidas que quedaron abiertas en jornadas ya cerradas. |

Sobre el tercer script:

- La primera consulta lista lo que va a cerrar; conviene revisarla antes. En el hosting pueden ser otras sesiones que en la copia local.
- No toca dinero, inventario ni la jornada abierta, y puede ejecutarse más de una vez.
- Si la consulta final devuelve filas, esas sesiones tienen consumo y requieren revisión manual.

## 2. Archivos

Subir estos archivos, reemplazando los actuales:

| Carpeta | Nuevos | Modificados |
|---|---|---|
| `backend/models/` | `Mesa.php`, `Liquidacion.php`, `ResumenJornada.php` | — |
| `backend/api/` | — | `atencion_barra.php`, `jornada.php`, `mesas.php`, `promociones.php`, `reportes.php` |
| `frontend/js/` | — | `atencion_barra.js`, `atencion.js`, `admin.js`, `impresion.js` |
| `frontend/` | — | `portal_atencion.html`, `portal_admin.html` |
| `frontend/vistas/` | — | `atencion.html`, `promociones.html` |

No subir ni reemplazar:

- `backend/config/database.php`: el hosting tiene sus propias credenciales.
- `tests/`, `DESPLIEGUE.md`, `billarproject.zip` y los `.sql` de `backend/config/`, que solo se ejecutan.

`backend/api/reportes_pdf.php` tiene un cambio local que no está en ningún commit: fija la zona horaria del nombre de los PDF. Súbelo si lo quieres en el hosting.

Los scripts de las páginas llevan un número de versión (`?v=...`), así que las cajas descargan el JS nuevo sin borrar la caché.

## 3. Comprobar

1. Entrar a los dos portales con Ctrl+F5.
2. En el admin, abrir las promociones de tipo incentivo cruzado. Las que ya existían quedan como "Cualquier mesa". Si debían exigir un tipo de mesa, elegirlo y guardar.
3. Abrir la jornada. En la primera mesa cobrada, revisar en "Mis ventas" que el total coincida con lo cobrado.

## Qué cambia en los reportes de jornadas anteriores

Los reportes reparten lo que realmente se cobró entre mesas y productos, así que Mesas + Productos ahora suma lo que entró a caja. En jornadas antiguas los montos de mesas y productos cambian respecto a lo que mostraban, pero el total cobrado es el mismo. Las ventas antiguas no se modifican.

## Si hay que volver atrás

Basta con restaurar los archivos anteriores. Las columnas y la tabla nuevas no afectan al código anterior: `redondeo` vale 0 por defecto, `fecha_hora` acepta vacío y `ajustes_venta` simplemente no se usa.
