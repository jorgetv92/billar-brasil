# Despliegue en el sitio demo

Pasos para llevar al sitio **demo** todo lo de la rama `fix/motor-cobro`: cobros, caja, reportes, combos, cargos, cargas e insumos. La demo conserva su base y su historial, así que se **migra**. La copia local de esa base es `demo_billar`.

Producción no usa esta guía: arranca con una base nueva. Ver [INSTALACION_PRODUCCION.md](INSTALACION_PRODUCCION.md).

Este archivo no se sube al servidor.

## Antes de empezar

- Respaldar la base de datos y los archivos de la demo.
- Cerrar la jornada desde el portal de atención; no debe quedar ninguna mesa abierta. En la copia local hay una jornada abierta (#49) con 4 partidas.
- Anotar los datos de conexión que hoy tiene `backend/config/database.php` en el servidor de la demo: base, usuario y contraseña. El archivo nuevo los lee de otro lado (paso 2).
- El hosting necesita PHP 7.0 o superior y MySQL o MariaDB con tablas InnoDB.

## 1. Base de datos

En phpMyAdmin, con la base de la demo seleccionada, ejecutar estos scripts de `backend/config/` en este orden y una sola vez:

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `migracion_motor_cobro.sql` | Agrega `ventas.redondeo`, `ventas.id_operacion` (evita registrar dos veces la misma venta) y `detalle_venta_productos.fecha_hora`. |
| 2 | `migracion_ajustes_venta.sql` | Crea la tabla `ajustes_venta`, la bitácora de correcciones de ventas cobradas. |
| 3 | `migracion_productos_cargos_combos.sql` | Tipo y estado de los productos, tablas de cargos y de conceptos de cargo, y combos específicos. Retira el producto "Hora Promo (Incentivo)". |
| 4 | `migracion_cargas_jornada.sql` | Cada carga guarda la jornada en la que se hizo, para que el inventario del turno no cuente dos veces una carga hecha en el mismo momento de la apertura. A las cargas pasadas les asigna la jornada que estaba abierta a esa hora. |
| 5 | `migracion_combos.sql` | Los combos pasan a su propia sección (tablas `combos` y `combo_items`): ya no son promociones. Si hubiera combos creados como promoción, los pasa con sus productos. |
| 6 | `migracion_rol_supervisor.sql` | Agrega el rol "supervisor" y guarda en cada corrección de venta qué supervisor la autorizó. |
| 7 | `correccion_datos_produccion.sql` | Corrige datos que dejaron errores del sistema anterior y ordena el catálogo (ver abajo). |
| 8 | `limpieza_sesiones_huerfanas.sql` | Cierra las partidas que quedaron abiertas en jornadas ya cerradas. |

`db_migration.sql` **no** se ejecuta: la demo ya lo tiene.

Si un script se ejecuta dos veces por error, se detiene en su primera instrucción sin cambiar nada. Los pasos 7 y 8 directamente no encuentran nada que corregir.

### Lo que hacen los pasos 4 a 8 en la demo

- **Cargas**: 6 de las 10 cargas quedan en la jornada en que se hicieron. Las otras 4 se hicieron entre jornadas.
- **Combos**: la demo no tiene combos creados como promoción; el paso 5 solo crea las tablas nuevas.

Resultado del ensayo sobre la copia local `demo_billar` del 2026-11-09:

- **Cobros de mesa duplicados** (misma partida cobrada dos veces en el mismo segundo): 2, ventas 412 y 413. Se conserva el primer cobro.
- **Ventas de barra duplicadas** (doble clic): 3, ventas 163, 523 y 581. Se conserva la primera. El stock actual no se toca; conviene contar esos productos.
- **Partidas olvidadas**: 2 partidas de días, cobradas por poco.
  - Venta 414: registrada en Bs 1.850, se pagaron Bs 14.
  - Venta 719: registrada en Bs 3.597,50, se pagaron Bs 25.
  - El total queda en lo pagado y la duración se ajusta a ese monto.
- **Catálogo**:
  - "Vaso de Fernet" pasa a preparado, sin stock.
  - Se crea el concepto de cargo "Vaso o botella rota" de Bs 8.
  - "Hora Promo (Incentivo)" queda retirado.
- **Partidas huérfanas**: cierra 11, ninguna con consumo ni venta. No toca dinero ni inventario.

Cada paso muestra antes lo que va a corregir. Si la base del servidor tiene datos más nuevos que la copia local, los scripts encuentran también los casos nuevos.

No se corrigen las ventas donde lo pagado no coincide con el total registrado. Los reportes nuevos usan lo que realmente se pagó.

## 2. Archivos

1. En local, copiar `backend/config/entornos/demo.ejemplo.php` como `backend/config/entornos/demo.php` y completar los datos de conexión anotados antes. `demo.php` no va a git.
2. Generar el paquete:

   ```
   node herramientas/empaquetar.js demo
   ```

   Deja `dist/billar_demo_<fecha>.zip`. El zip trae `backend/config/entorno.php` apuntando a la demo, y el script revisa que todo el PHP compile.
3. Subir el zip a la carpeta del sitio demo y descomprimirlo **encima** de lo que hay: reemplaza los archivos actuales, incluido `backend/config/database.php`.
4. Borrar del servidor lo que ya no se usa:
   - Los `.sql` de `backend/config/`. Desde el navegador se podían descargar, con los hashes de las contraseñas. El paquete trae además un `.htaccess` que bloquea esa carpeta.
   - `backend/controllers/`: son archivos vacíos.
   - `backend/api/error_log`, si se quiere empezar un log limpio.

El paquete incluye el cambio de `backend/api/reportes_pdf.php` que fija la zona horaria del nombre de los PDF.

Los scripts de las páginas llevan un número de versión (`?v=...`), así que las cajas descargan el JS nuevo sin borrar la caché.

## 3. Comprobar

1. Entrar a los dos portales con Ctrl+F5. Si aparece "Falta configurar la conexión", revisar `backend/config/entornos/demo.php` en el servidor.
2. En el admin:
   - Revisar en "Inventario" los tipos y el estado de los productos.
   - En "Conceptos de Cargo", ajustar los montos sugeridos.
   - Hacer una carga de mercadería y otra de insumos. Editar la de mercadería y anularla: el stock vuelve a quedar como estaba.
   - En "Combos" (debajo de Inventario), crear los combos que se vendan (ej. 1 Fernet + 2 Coca Cola).
   - En "Usuarios", crear o pasar a rol "Supervisor" a quienes autorizan las correcciones de ventas.
3. Abrir la jornada:
   - En el buscador, "promo" muestra las promociones que rigen en ese momento (Producto 2x1, hora con descuento) y "combo" los combos. El 2x1 ya no se aplica solo: el cajero lo elige.
   - Cobrar una mesa y revisar en "Mis ventas" que el total coincida con lo cobrado. Con un usuario de atención, "Mis ventas" pide primero el usuario y la contraseña de un supervisor; un supervisor las ve directo.
   - Registrar un egreso y un gasto de insumo.
   - En el pre-cierre, el efectivo esperado debe ser la apertura más el efectivo cobrado menos los egresos.

## Qué cambia en los reportes de jornadas anteriores

Los reportes reparten lo que realmente se cobró entre mesas, productos y otros cargos, así que la suma da lo que entró a caja. En jornadas antiguas los montos de mesas y productos cambian respecto a lo que mostraban, pero el total cobrado es el mismo. Solo cambian las jornadas con ventas que corrige el paso 7: en ellas el total baja en lo que se había registrado de más.

## Si hay que volver atrás

Restaurar los archivos del respaldo, incluido el `database.php` anterior.

Las columnas y tablas nuevas no afectan al código anterior: tienen valores por defecto o aceptan vacío, y las tablas nuevas simplemente no se usan. El código anterior volvería a crear el producto "Hora Promo" la primera vez que lo necesite.

Las correcciones de datos no se deshacen sin el respaldo de la base, pero el código anterior funciona igual con ellas.
