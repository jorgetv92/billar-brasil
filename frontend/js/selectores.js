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
.sh-fondo { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.sh-caja { background: var(--crema, #fff); border: 1px solid var(--beige-borde, transparent); border-radius: 14px; width: 100%; max-width: 340px; box-shadow: 0 20px 50px rgba(0,0,0,0.25); overflow: hidden; font-family: inherit; }
.sh-titulo { padding: 14px 18px 4px; font-weight: 700; color: var(--verde-800, #0f172a); font-size: 1.05rem; }
.sh-subtitulo { padding: 0 18px 8px; color: var(--texto-suave, #64748b); font-size: 0.8rem; }
.sh-encabezados { display: flex; justify-content: center; gap: 6px; padding: 0 18px 4px; }
.sh-encabezados span { text-align: center; font-size: 0.75rem; font-weight: 600; color: var(--texto-suave, #64748b); text-transform: uppercase; letter-spacing: 0.04em; }
.sh-ruedas { position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 18px; height: ${ALTO * VISIBLES}px; }
.sh-banda { position: absolute; left: 18px; right: 18px; top: ${ALTO * Math.floor(VISIBLES / 2)}px; height: ${ALTO}px; background: var(--crema-2, #eff6ff); border-top: 1px solid var(--dorado, #bfdbfe); border-bottom: 1px solid var(--dorado, #bfdbfe); border-radius: 8px; pointer-events: none; }
.sh-columna { position: relative; height: 100%; overflow-y: auto; scroll-snap-type: y mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; outline: none; overscroll-behavior: contain;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent); mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent); }
.sh-columna::-webkit-scrollbar { display: none; }
.sh-relleno { height: ${ALTO * Math.floor(VISIBLES / 2)}px; }
.sh-item { height: ${ALTO}px; line-height: ${ALTO}px; text-align: center; font-size: 1.35rem; color: #94a3b8; scroll-snap-align: center; cursor: pointer; user-select: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sh-item.activo { color: var(--verde-800, #0f172a); font-weight: 700; font-size: 1.6rem; }
.sh-item.invalido { color: #e2e8f0; }
.sh-separador { font-size: 1.6rem; font-weight: 700; color: var(--verde-800, #0f172a); position: relative; }
.sh-botones { display: flex; gap: 8px; padding: 14px 18px 16px; }
.sh-botones button { flex: 1; padding: 11px 0; border-radius: 9px; border: none; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
.sh-borrar { background: var(--crema-2, #f1f5f9); color: var(--texto-suave, #64748b); }
.sh-cancelar { background: var(--crema-2, #f1f5f9); color: var(--texto, #0f172a); }
.sh-aceptar { background: linear-gradient(180deg, var(--verde-500, #3b82f6) 0%, var(--verde-700, #2563eb) 100%); color: #fff; border: 1px solid var(--dorado, transparent) !important; }
.sh-campo { position: relative; display: flex; align-items: stretch; }
.sh-campo input { flex: 1; min-width: 0; }
.sh-boton-campo { margin-left: 6px; border: 1px solid var(--beige-borde, #cbd5e1); background: var(--crema, #fff); border-radius: 8px; padding: 0 10px; cursor: pointer; color: var(--verde-600, #3b82f6); display: flex; align-items: center; }
@media (max-width: 480px) { .sh-fondo { align-items: flex-end; padding: 0; } .sh-caja { max-width: none; border-radius: 16px 16px 0 0; } }`;
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
