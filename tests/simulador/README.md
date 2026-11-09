# Simulador de turnos

Juega turnos completos del billar en minutos: abre jornadas, ocupa mesas, vende, aplica promociones y cierra caja con el reloj adelantado. Luego compara cada cobro con las reglas del negocio y revisa caja, inventario y reportes.

Es solo para desarrollo. No se despliega al hosting, y `tests/.htaccess` bloquea el acceso web a esta carpeta.

## Qué toca

- **Lee** la base configurada en `backend/config/database.php` con `mysqldump`.
- **Escribe** solo en la base clon `billar_sim`, que se recrea en cada grupo y recibe las migraciones de `backend/config` que el código necesita.
- **Copia** el sitio a una carpeta temporal (`%TEMP%\billar-sim`). Allí cambia el reloj de PHP y la conexión al clon. Si no puede apuntar la copia al clon, se detiene sin escribir nada.

## Requisitos

- XAMPP con MySQL encendido. Se usan `C:/xampp/php/php.exe` y `C:/xampp/mysql/bin`; las variables `PHP_BIN`, `MYSQL_BIN` y `MYSQLDUMP_BIN` permiten cambiarlos.
- Node 18 o superior y Google Chrome instalado.
- Una vez: `npm install` en esta carpeta.

## Uso

```
npm run unidad     # reglas del negocio sin navegador (segundos)
npm run reglas     # los ejemplos del negocio jugados en pantalla
npm run doble      # doble ocupación de mesas, incluidas dos cajas a la vez
npm run motor      # el backend fija precios, valida pagos y no cobra dos veces la misma mesa
npm run ajustes    # corregir ventas ya cobradas ajusta pagos, stock y bitácora
npm run reportes   # mesas + productos = cobrado en pre-cierre, cierre, admin y dashboard
npm run limpieza   # el script de sesiones huérfanas sobre el clon
npm run turnos     # 4 turnos completos y el análisis de caja, inventario y reportes (~5 min)
npm run todo
```

Los resultados detallados quedan en `%TEMP%\billar-sim\resultados`.

## Archivos

| Archivo | Para qué |
|---|---|
| `oraculo.js` | Calcula lo que debe cobrarse según las reglas del negocio, sin compartir código con el sistema. |
| `oraculo.test.js` | Un caso por regla o ejemplo dado por el negocio. Si cambia una regla, se cambia aquí primero. |
| `lib.js` | Maneja la pantalla real y anota lo que correspondería cobrar. |
| `reglas_negocio.js` | Ejemplos del negocio con montos escritos a mano. |
| `motor.js` | Validaciones del cobro en el backend y carreras entre dos cajas. |
| `ajustes.js` | Correcciones de ventas ya cobradas: total, pagos, stock y bitácora. |
| `reportes.js` | Cifras de pre-cierre, cierre, reporte del admin y dashboard. |
| `doble_ocupacion.js`, `limpieza.js` | Doble ocupación de mesas y el script de sesiones huérfanas. |
| `turnos.js`, `dirigidas.js`, `analizar.js` | Turnos completos, casos aislados y el análisis. |
| `reset.sql` | Promociones de prueba. Debe coincidir con `PROMOS` en `lib.js`. |
