# Instalación de producción desde cero

Producción arranca con una base **nueva y vacía** en el hosting. No se migra la base anterior: `script.sql` crea las tablas y carga el catálogo, con los mismos ids que la base de producción anterior:

- todos los tipos de mesa (4), las mesas (13) y los insumos (2), de la copia local de producción (`billarbrasil_produccion`);
- los usuarios (8, con sus contraseñas actuales). Los 2 administradores siguen como administradores; los otros 6 pasan a **supervisor**;
- 58 de los 65 productos, con nombre, precio y stock de producción al 10/11/2026 10:26 (archivo `StockActualProductos.sql`). No pasan: Cuba libre, Vaso de Fernet, Combo de flor de caña, Fernet combo, Vaso de flor de caña, Promo 2x30 amstel y Vaso o botella rota;
- una **carga de mercadería** inicial (carga #1: 56 productos, 3542 unidades) que explica ese stock. Se ve en "Carga de Mercadería";
- el combo "Combo de Fernet" (Bs 245: 1 Soda 2Lts + 1 Urbano Botella) y los conceptos de cargo activos "Vaso Roto" (Bs 8) y "Botella Quebrada" (Bs 10), tal como se configuraron en la versión nueva.

Jornadas, ventas e historial empiezan vacíos. Las mesas quedan libres, salvo Privada #2, que sigue en mantenimiento.

Si producción vende algo entre la toma del stock (10/11/2026 10:26) y la instalación, corregir esa diferencia con una carga o editando la carga #1.

Este archivo no se sube al servidor.

## 1. Preparar el paquete (en local)

1. Copiar `backend/config/entornos/produccion.ejemplo.php` como `backend/config/entornos/produccion.php` (ya existe una copia con los datos por completar) y completar:
   - el nombre de la base;
   - el usuario;
   - la contraseña.

   Son los que da el panel del hosting. `db_host` casi siempre es `localhost`. Este archivo no va a git.
2. Generar el paquete:

   ```
   node herramientas/empaquetar.js produccion
   ```

   Deja en `dist/`:
   - `billar_produccion_<fecha>.zip`, que se sube al sitio;
   - `script.sql`, que se importa en la base y **no** se sube al sitio, porque tiene los hashes de las contraseñas.

   Si los datos de conexión no están completos, el script avisa. Se pueden completar después, en el servidor, en `backend/config/entornos/produccion.php`.

## 2. Base de datos

En phpMyAdmin:

1. Seleccionar la base nueva, que debe estar vacía.
2. En "Importar", subir `dist/script.sql` con el formato SQL y la codificación utf-8.

Debe terminar sin errores y dejar 23 tablas. Si alguna tabla ya existía, se detiene con error en lugar de duplicar datos.

## 3. Archivos

1. Subir `billar_produccion_<fecha>.zip` a la carpeta pública del sitio y descomprimirlo ahí.
2. Si la carpeta tenía una versión anterior, borrar primero lo viejo, o al menos:
   - los `.sql` de `backend/config/`;
   - `backend/controllers/`;
   - los PDF viejos de `backend/reportes_pdf/`, que son de la base anterior.

## 4. Comprobar

1. Abrir el sitio con Ctrl+F5 e iniciar sesión con un usuario administrador. Las contraseñas son las mismas de antes.
   - Si aparece "Falta configurar la conexión", completar `backend/config/entornos/produccion.php` en el servidor.
   - Si aparece "No se pudo conectar a la base de datos", revisar ahí el nombre de la base, el usuario y la contraseña.
2. En el admin:
   - Revisar mesas, productos y precios.
   - Revisar en "Carga de Mercadería" la carga #1 y el stock de los productos.
   - Revisar los insumos.
   - Crear los productos preparados (vasos y tragos), los combos que falten (sección "Combos", debajo de Inventario) y las promociones que se vayan a usar.
   - Las promociones "Producto 2x1" y la hora con descuento no se aplican solas: el cajero las elige en el buscador escribiendo "promo".
   - En "Usuarios", revisar los roles: todos los que no son administradores quedaron como "Supervisor". El supervisor atiende igual que atención y además ve "Mis ventas" sin pedir autorización; a un usuario de atención, "Mis ventas" le pide primero los datos de un supervisor.
3. En atención:
   - Abrir la jornada, ocupar una mesa, agregar un producto y cobrar.
   - Registrar un egreso y un gasto de insumo.
   - Cerrar la jornada y revisar que el efectivo final sea la apertura más el efectivo cobrado menos los egresos.
