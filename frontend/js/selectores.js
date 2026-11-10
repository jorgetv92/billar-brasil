// Selectores táctiles con ruedas verticales para hora (24 h) y fecha (dd/mm/aaaa).
// Los campos nativos del navegador siguen el formato del equipo (en muchos celulares, AM/PM y mm/dd/aaaa),
// por eso los formularios usan campos de texto; estos selectores devuelven el carrusel táctil sin cambiar el formato.
//
//   SelectorHora.activar(input)   campo de texto "HH:MM" o vacío
//   SelectorFecha.activar(input)  campo de texto "dd/mm/aaaa" o vacío
//
// En pantalla táctil, tocar el campo abre las ruedas y no aparece el teclado.
// En computadora se puede escribir, y un botón al lado del campo abre el mismo selector.
(function (global) {
    const ALTO = 44; // alto de cada fila (px)
    const VISIBLES = 5; // filas visibles: la del medio es la elegida
    const dos = (n) => String(n).padStart(2, '0');
    const esTactil = () => window.matchMedia('(pointer: coarse)').matches;

    let estilos = false;
    function instalarEstilos() {
        if (estilos) return;
        estilos = true;
        const css = document.createElement('style');
        css.textContent = `
.sh-fondo { position: fixed; inset: 0; background: var(--overlay, rgba(0, 0, 0, 0.32)); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.sh-caja { background: var(--bg-elevated, #fff); border-radius: 22px; width: 100%; max-width: 340px; box-shadow: var(--shadow-modal, 0 32px 80px -16px rgba(0,0,0,0.35)); overflow: hidden; font-family: inherit; }
.sh-titulo { padding: 18px 20px 2px; font-weight: 600; color: var(--label, #1d1d1f); font-size: 17px; text-align: center; }
.sh-subtitulo { padding: 0 20px 10px; color: var(--label-2, #6e6e73); font-size: 13px; text-align: center; }
.sh-encabezados { display: flex; justify-content: center; gap: 6px; padding: 0 18px 4px; }
.sh-encabezados span { text-align: center; font-size: 12px; font-weight: 500; color: var(--label-2, #6e6e73); }
.sh-ruedas { position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 18px; height: ${ALTO * VISIBLES}px; }
.sh-banda { position: absolute; left: 14px; right: 14px; top: ${ALTO * Math.floor(VISIBLES / 2)}px; height: ${ALTO}px; background: var(--fill-3, rgba(118, 118, 128, 0.12)); border-radius: 10px; pointer-events: none; }
.sh-columna { position: relative; height: 100%; overflow-y: auto; scroll-snap-type: y mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; outline: none; overscroll-behavior: contain;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent); mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent); }
.sh-columna::-webkit-scrollbar { display: none; }
.sh-relleno { height: ${ALTO * Math.floor(VISIBLES / 2)}px; }
.sh-item { height: ${ALTO}px; line-height: ${ALTO}px; text-align: center; font-size: 20px; color: var(--label-3, #b0b0b5); scroll-snap-align: center; cursor: pointer; user-select: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sh-item.activo { color: var(--label, #1d1d1f); font-weight: 500; font-size: 22px; }
.sh-item.invalido { color: var(--label-4, #e5e5ea); }
.sh-separador { font-size: 22px; font-weight: 500; color: var(--label, #1d1d1f); position: relative; }
.sh-botones { display: flex; gap: 8px; padding: 16px 18px 18px; }
.sh-botones button { flex: 1; min-height: 44px; padding: 0; border-radius: 999px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.15s, transform 0.15s; }
.sh-botones button:active { transform: scale(0.97); }
.sh-borrar { background: var(--fill-3, rgba(118, 118, 128, 0.12)); color: var(--red-text, #e9152d); }
.sh-cancelar { background: var(--fill-3, rgba(118, 118, 128, 0.12)); color: var(--tint-text, #1e6ef4); }
.sh-aceptar { background: var(--tint, #0088ff); color: #fff; }
.sh-campo { position: relative; display: flex; align-items: stretch; }
.sh-campo input { flex: 1; min-width: 0; }
.sh-boton-campo { margin-left: 6px; border: none; background: var(--fill-3, rgba(118, 118, 128, 0.12)); border-radius: 12px; padding: 0 10px; cursor: pointer; color: var(--tint-text, #1e6ef4); display: flex; align-items: center; }
.sh-boton-campo:hover { background: var(--fill-2, rgba(120, 120, 128, 0.16)); }
@media (max-width: 480px) { .sh-fondo { align-items: flex-end; padding: 0; } .sh-caja { max-width: none; border-radius: 28px 28px 0 0; padding-bottom: env(safe-area-inset-bottom); } }`;
        document.head.appendChild(css);
    }

    // Una rueda con las etiquetas dadas. Devuelve el elemento, el índice elegido y cómo moverla.
    function crearColumna(etiquetas, nombre, ancho, alAsentar) {
        const col = document.createElement('div');
        col.className = 'sh-columna';
        col.style.width = ancho + 'px';
        col.tabIndex = 0;
        col.setAttribute('role', 'listbox');
        col.setAttribute('aria-label', nombre);
        col.innerHTML = '<div class="sh-relleno"></div>'
            + etiquetas.map((t, i) => `<div class="sh-item" data-indice="${i}">${t}</div>`).join('')
            + '<div class="sh-relleno"></div>';
        const items = col.querySelectorAll('.sh-item');
        const total = etiquetas.length;
        const indice = () => Math.max(0, Math.min(total - 1, Math.round(col.scrollTop / ALTO)));
        const marcar = () => {
            const i = indice();
            items.forEach((el, k) => el.classList.toggle('activo', k === i));
        };
        let pendiente = false;
        let espera = null;
        col.addEventListener('scroll', () => {
            if (!pendiente) {
                pendiente = true;
                requestAnimationFrame(() => { pendiente = false; marcar(); });
            }
            // Cuando la rueda se detiene, avisa (la fecha ajusta los días del mes).
            clearTimeout(espera);
            espera = setTimeout(() => alAsentar && alAsentar(), 140);
        });
        const ir = (i, suave) => col.scrollTo({ top: Math.max(0, Math.min(total - 1, i)) * ALTO, behavior: suave ? 'smooth' : 'auto' });
        col.addEventListener('click', (e) => {
            const item = e.target.closest('.sh-item');
            if (item) ir(+item.dataset.indice, true);
        });
        col.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); ir(indice() + 1, true); }
            if (e.key === 'ArrowUp') { e.preventDefault(); ir(indice() - 1, true); }
        });
        return { col, items, valor: indice, ir, fijar: (i) => { ir(i, false); marcar(); } };
    }

    // Ventana con ruedas. config: { titulo, subtitulo, columnas: [{etiquetas, nombre, ancho, inicial}],
    // separador, encabezados, alAsentar(ruedas), alAceptar(indices) -> valor del campo }
    function abrirRuedas(input, config) {
        instalarEstilos();
        const fondo = document.createElement('div');
        fondo.className = 'sh-fondo';
        fondo.innerHTML = `
            <div class="sh-caja" role="dialog" aria-modal="true">
                <div class="sh-titulo">${config.titulo}</div>
                <div class="sh-subtitulo">${config.subtitulo}</div>
                ${config.encabezados ? '<div class="sh-encabezados"></div>' : ''}
                <div class="sh-ruedas"><div class="sh-banda"></div></div>
                <div class="sh-botones">
                    <button type="button" class="sh-borrar">Borrar</button>
                    <button type="button" class="sh-cancelar">Cancelar</button>
                    <button type="button" class="sh-aceptar">Aceptar</button>
                </div>
            </div>`;
        const contenedor = fondo.querySelector('.sh-ruedas');
        const ruedas = [];
        const asentar = () => config.alAsentar && config.alAsentar(ruedas);
        config.columnas.forEach((c, i) => {
            if (i > 0) {
                const sep = document.createElement('div');
                sep.className = 'sh-separador';
                sep.textContent = config.separador;
                contenedor.appendChild(sep);
            }
            const rueda = crearColumna(c.etiquetas, c.nombre, c.ancho, asentar);
            ruedas.push(rueda);
            contenedor.appendChild(rueda.col);
        });
        if (config.encabezados) {
            const cab = fondo.querySelector('.sh-encabezados');
            const sepAncho = config.separador ? 14 : 0;
            cab.innerHTML = config.columnas.map((c, i) =>
                `${i > 0 ? `<span style="width:${sepAncho}px"></span>` : ''}<span style="width:${c.ancho}px">${c.nombre}</span>`).join('');
        }
        document.body.appendChild(fondo);
        requestAnimationFrame(() => {
            ruedas.forEach((r, i) => r.fijar(config.columnas[i].inicial));
            asentar();
            ruedas[0].col.focus({ preventScroll: true });
        });

        const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', teclas); };
        const devolver = (valor) => {
            input.value = valor;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            cerrar();
        };
        const aceptar = () => devolver(config.alAceptar(ruedas.map((r) => r.valor())));
        const teclas = (e) => {
            if (e.key === 'Escape') cerrar();
            if (e.key === 'Enter') { e.preventDefault(); aceptar(); }
        };
        document.addEventListener('keydown', teclas);
        fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
        fondo.querySelector('.sh-cancelar').addEventListener('click', cerrar);
        fondo.querySelector('.sh-borrar').addEventListener('click', () => devolver(''));
        fondo.querySelector('.sh-aceptar').addEventListener('click', aceptar);
    }

    const tituloDe = (input, porDefecto) => {
        const etiqueta = input.id && document.querySelector(`label[for="${input.id}"]`);
        return etiqueta ? etiqueta.textContent.trim() : porDefecto;
    };

    // Táctil: el campo abre el selector y no muestra teclado. Computadora: se escribe, y el botón abre el selector.
    function conectar(input, abrir, icono, ayuda) {
        if (!input || input.dataset.selectorTactil) return;
        input.dataset.selectorTactil = '1';
        instalarEstilos();
        if (esTactil()) {
            input.readOnly = true;
            input.setAttribute('inputmode', 'none');
            input.addEventListener('click', () => abrir(input));
            return;
        }
        const campo = document.createElement('div');
        campo.className = 'sh-campo';
        input.parentNode.insertBefore(campo, input);
        campo.appendChild(input);
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'sh-boton-campo';
        boton.title = ayuda;
        boton.setAttribute('aria-label', ayuda);
        boton.innerHTML = `<i class="material-icons">${icono}</i>`;
        boton.addEventListener('click', () => abrir(input));
        campo.appendChild(boton);
    }

    // ---------------------------------------------------------------- hora 24 h
    const HORAS = Array.from({ length: 24 }, (_, i) => dos(i));
    const MINUTOS = Array.from({ length: 60 }, (_, i) => dos(i));

    function abrirHora(input) {
        const actual = String(input.value || '').match(/^(\d{1,2}):(\d{2})$/);
        abrirRuedas(input, {
            titulo: tituloDe(input, 'Hora'),
            subtitulo: 'Formato 24 horas. Desliza o toca la hora y los minutos.',
            separador: ':',
            columnas: [
                { etiquetas: HORAS, nombre: 'Hora', ancho: 84, inicial: actual ? Math.min(23, +actual[1]) : new Date().getHours() },
                { etiquetas: MINUTOS, nombre: 'Minutos', ancho: 84, inicial: actual ? Math.min(59, +actual[2]) : 0 },
            ],
            alAceptar: ([h, m]) => `${dos(h)}:${dos(m)}`,
        });
    }

    // ---------------------------------------------------------------- fecha dd/mm/aaaa
    const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const diasDelMes = (mes, anio) => new Date(anio, mes + 1, 0).getDate(); // mes 0-11

    function abrirFecha(input) {
        const actual = String(input.value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        const hoy = new Date();
        const dia = actual ? +actual[1] : hoy.getDate();
        const mes = actual ? Math.min(12, Math.max(1, +actual[2])) - 1 : hoy.getMonth();
        const anio = actual ? +actual[3] : hoy.getFullYear();
        // Desde el año pasado hasta 5 años adelante, más el año del campo si queda fuera.
        const desde = Math.min(hoy.getFullYear() - 1, anio);
        const hasta = Math.max(hoy.getFullYear() + 5, anio);
        const anios = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);

        abrirRuedas(input, {
            titulo: tituloDe(input, 'Fecha'),
            subtitulo: 'Desliza o toca el día, el mes y el año.',
            separador: '/',
            encabezados: true,
            columnas: [
                { etiquetas: Array.from({ length: 31 }, (_, i) => dos(i + 1)), nombre: 'Día', ancho: 64, inicial: dia - 1 },
                { etiquetas: MESES.map((n, i) => `${dos(i + 1)} ${n}`), nombre: 'Mes', ancho: 104, inicial: mes },
                { etiquetas: anios.map(String), nombre: 'Año', ancho: 84, inicial: anios.indexOf(anio) },
            ],
            // Los días que el mes no tiene se ven apagados y, si estaba en uno de ellos, baja al último día.
            alAsentar: ([rDia, rMes, rAnio]) => {
                const max = diasDelMes(rMes.valor(), anios[rAnio.valor()]);
                rDia.items.forEach((el, k) => el.classList.toggle('invalido', k >= max));
                if (rDia.valor() >= max) rDia.ir(max - 1, true);
            },
            alAceptar: ([d, m, a]) => {
                const max = diasDelMes(m, anios[a]);
                return `${dos(Math.min(d + 1, max))}/${dos(m + 1)}/${anios[a]}`;
            },
        });
    }

    global.SelectorHora = { activar: (input) => conectar(input, abrirHora, 'schedule', 'Elegir hora'), abrir: abrirHora };
    global.SelectorFecha = { activar: (input) => conectar(input, abrirFecha, 'calendar_month', 'Elegir fecha'), abrir: abrirFecha };
})(window);
