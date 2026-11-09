# Despliegue al hosting: cobros, caja, reportes, combos y cargos

Pasos para llevar al hosting todo lo de la rama `fix/motor-cobro` en una sola migración. Este archivo no se sube al servidor.

## Antes de empezar

- Respaldar la base de datos y los archivos del hosting.
- Cerrar la jornada. No debe quedar ninguna mesa abierta.
- El hosting necesita PHP 7.0 o superior y MySQL o MariaDB con tablas InnoDB, igual que ahora.

## 1. Base de datos

Ejecutar en la base del hosting, en este orden y una sola vez:

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `backend/config/db_migration.sql` | Migración anterior que producción todavía no tiene: tipo de promo `incentivo_producto`, `promociones.id_item_secundario` y `sesiones_juego.primera_hora_gratis`. Ya no crea el producto "Hora Promo". |
| 2 | `backend/config/migracion_motor_cobro.sql` | Agrega `ventas.redondeo`, `ventas.id_operacion` (evita registrar dos veces la misma venta) y `detalle_venta_productos.fecha_hora`. |
| 3 | `backend/config/migracion_ajustes_venta.sql` | Crea la tabla `ajustes_venta`, la bitácora de correcciones. |
| 4 | `backend/config/migracion_productos_cargos_combos.sql` | Tipo y estado de los productos, tablas de cargos y de conceptos de cargo, combos específicos. |
| 5 | `backend/config/correccion_datos_produccion.sql` | Corrige datos que dejaron errores del sistema anterior y ordena el catálogo (ver abajo). |
| 6 | `backend/config/limpieza_sesiones_huerfanas.sql` | Cierra las partidas que quedaron abiertas en jornadas ya cerradas. |

Los 6 scripts se probaron sobre la copia de producción del 2026-11-09 (`billarbrasil_produccion`). Corrieron sin errores, una segunda pasada no cambia nada, y después todas las pruebas del simulador pasaron sobre esa copia.

Sobre `correccion_datos_produccion.sql` (cada paso busca los casos por regla, no por número de venta):

- Cada paso muestra antes lo que va a corregir.
- **Cobros de mesa duplicados**: misma partida cobrada varias veces en el mismo segundo. Se conserva el primer cobro y se borran las copias, que no tienen productos. En la copia hubo 5, con Bs 140,00 de pagos de más.
- **Ventas de barra duplicadas**: mismos productos y pagos en el mismo segundo. En la copia hubo 5, con Bs 35,50 de pagos de más. El stock actual no se toca; conviene contar los productos afectados.
- **Partidas olvidadas**: partidas de más de 24 horas cobradas por poco. El total queda en lo que se pagó y la duración se ajusta a ese monto. En la copia hubo 4, que sumaban Bs 49.954 y 3.040 horas que nunca existieron.
- **Fechas al revés** en 6 tramos ya cerrados: horas de pausa o de fin anteriores al inicio.
- **Catálogo**:
  - "Vaso de Fernet" y "Vaso de flor de caña" pasan a preparados, sin stock.
  - "Vaso o botella rota" pasa a ser un concepto de cargo de Bs 8, y el producto se retira.
  - "Promo 2x30 amstel" se retira. No se puede borrar porque tiene 138 unidades vendidas.
  - "Cuba libre" no se toca.
- No corrige las ventas donde lo pagado no coincide con el total registrado (2.769 en la copia, casi todas por los errores 6 y 8). Los reportes nuevos usan lo que realmente se pagó.

Sobre `limpieza_sesiones_huerfanas.sql`:

- La primera consulta lista lo que va a cerrar; conviene revisarla antes. En la copia eran 11 partidas sin consumo ni venta.
- No toca dinero, inventario ni la jornada abierta, y puede ejecutarse más de una vez.
- Si la consulta final devuelve filas, esas sesiones tienen consumo y requieren revisión manual.

Si al migrar la base del hosting tiene datos más nuevos que la copia, los mismos scripts encuentran los casos nuevos.

## 2. Archivos

Subir estos archivos, reemplazando los actuales:

| Carpeta | Nuevos | Modificados |
|---|---|---|
| `backend/models/` | `Mesa.php`, `Liquidacion.php`, `ResumenJornada.php` | — |
| `backend/api/` | `conceptos_cargo.php` | `atencion_barra.php`, `jornada.php`, `mesas.php`, `productos.php`, `promociones.php`, `reportes.php` |
| `frontend/js/` | — | `atencion_barra.js`, `atencion.js`, `admin.js`, `impresion.js` |
| `frontend/` | — | `portal_atencion.html`, `portal_admin.html` |
| `frontend/vistas/` | `cargos.html` | `atencion.html`, `productos.html`, `promociones.html` |

No subir ni reemplazar:

- `backend/config/database.php`: el hosting tiene sus propias credenciales.
- `tests/`, `DESPLIEGUE.md`, `billarproject.zip` y los `.sql` de `backend/config/`, que solo se ejecutan.

`backend/api/reportes_pdf.php` tiene un cambio local que no está en ningún commit: fija la zona horaria del nombre de los PDF. Súbelo si lo quieres en el hosting.

Los scripts de las páginas llevan un número de versión (`?v=...`), así que las cajas descargan el JS nuevo sin borrar la caché.

## 3. Comprobar

1. Entrar a los dos portales con Ctrl+F5.
2. En el admin:
   - Revisar en "Inventario" los tipos y el estado de los productos.
   - En "Conceptos de Cargo", ajustar los montos sugeridos.
   - Crear las promociones que se quieran usar; la copia de producción no tenía ninguna. Por ejemplo, el combo que reemplaza a "Promo 2x30 amstel": Combo Específico con 2 Amstel Botella por Bs 30.
3. Abrir la jornada. En la primera mesa cobrada, revisar en "Mis ventas" que el total coincida con lo cobrado.

## Qué cambia en los reportes de jornadas anteriores

Los reportes reparten lo que realmente se cobró entre mesas, productos y otros cargos, así que la suma da lo que entró a caja. En jornadas antiguas los montos de mesas y productos cambian respecto a lo que mostraban, pero el total cobrado es el mismo. De las ventas antiguas solo cambian las que corrige `correccion_datos_produccion.sql`; en esas jornadas el total cobrado baja en lo que se había registrado de más.

## Si hay que volver atrás

Basta con restaurar los archivos anteriores. Las columnas y tablas nuevas no afectan al código anterior: los valores nuevos tienen valores por defecto o aceptan vacío, y las tablas nuevas simplemente no se usan. El código anterior volvería a crear el producto "Hora Promo" la primera vez que lo necesite. Las correcciones de datos no se deshacen sin el respaldo, pero el código anterior funciona igual con ellas.
