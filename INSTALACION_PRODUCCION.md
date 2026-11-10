# Instalación de producción desde cero

Producción arranca con una base **nueva y vacía** en el hosting. No se migra la base anterior: `script.sql` crea las tablas y carga el catálogo copiado de la base de producción anterior (`billarbrasil_produccion`), con los mismos ids:

- todos los tipos de mesa (4), las mesas (13), los usuarios (8, con sus contraseñas actuales) y los insumos (2);
- 59 de los 65 productos. No se copian Fernet combo, Promo 2x30 amstel, Vaso de Fernet, Vaso de flor de caña, Vaso o botella rota y Cuba libre;
- el concepto de cargo "Vaso o botella rota" (Bs 8), que reemplaza al producto.

Jornadas, ventas, cargas e historial empiezan vacíos. Las mesas quedan libres.

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
   - Ajustar el stock con una carga si hace falta: el stock copiado es el de la base anterior al 2026-11-09.
   - Revisar los insumos.
   - Crear los productos preparados (vasos y tragos), los combos (sección "Combos", debajo de Inventario; ej. "Fernet combo" = 1 Fernet + 2 Coca Cola) y las promociones que se vayan a usar.
   - Las promociones "Producto 2x1" y la hora con descuento no se aplican solas: el cajero las elige en el buscador escribiendo "promo".
   - En "Usuarios", dar el rol "Supervisor" a quienes autorizan las correcciones de ventas. El supervisor atiende igual que atención y además ve "Mis ventas" sin pedir autorización; a un usuario de atención, "Mis ventas" le pide primero los datos de un supervisor.
3. En atención:
   - Abrir la jornada, ocupar una mesa, agregar un producto y cobrar.
   - Registrar un egreso y un gasto de insumo.
   - Cerrar la jornada y revisar que el efectivo final sea la apertura más el efectivo cobrado menos los egresos.
