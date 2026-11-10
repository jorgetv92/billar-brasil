// Apariencia clara / oscura.
// Se carga en <head>, antes de las hojas de estilo y sin defer, para aplicar el tema antes del
// primer pintado (sin destello blanco en modo oscuro).
//
// Preferencia guardada en este dispositivo (localStorage "tema"):
//   "auto"   (por defecto) sigue al sistema, como recomiendan las HIG de Apple
//   "claro"  / "oscuro"  fijan la apariencia
// En <html> quedan data-tema="claro|oscuro" (el tema que se ve) y data-tema-preferido.
// Cualquier botón con data-tema-opcion="claro|oscuro|auto" cambia la preferencia,
// también los que llegan después en vistas cargadas por el router.
(function () {
    const CLAVE = 'tema';
    const raiz = document.documentElement;
    const sistemaOscuro = window.matchMedia('(prefers-color-scheme: dark)');
    const COLOR_BARRA = { claro: '#f2f2f7', oscuro: '#000000' };

    function leer() {
        try {
            const v = localStorage.getItem(CLAVE);
            return v === 'claro' || v === 'oscuro' ? v : 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    const resolver = (pref) => pref === 'auto' ? (sistemaOscuro.matches ? 'oscuro' : 'claro') : pref;

    function marcarControles() {
        const pref = leer();
        document.querySelectorAll('[data-tema-opcion]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.temaOpcion === pref));
        });
    }

    function aplicar(pref) {
        const tema = resolver(pref);
        raiz.dataset.tema = tema;
        raiz.dataset.temaPreferido = pref;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', COLOR_BARRA[tema]);
        marcarControles();
    }

    function establecer(pref) {
        if (pref !== 'claro' && pref !== 'oscuro') pref = 'auto';
        try { localStorage.setItem(CLAVE, pref); } catch (e) {}
        const cambiaLaVista = resolver(pref) !== raiz.dataset.tema;
        const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (cambiaLaVista && !reducir && document.startViewTransition) {
            document.startViewTransition(() => aplicar(pref));
        } else {
            aplicar(pref);
        }
    }

    aplicar(leer());

    // "Automático": acompaña el cambio del sistema aunque la página esté abierta
    sistemaOscuro.addEventListener('change', () => {
        if (leer() === 'auto') aplicar('auto');
    });

    // Otra pestaña cambió la preferencia
    window.addEventListener('storage', (e) => {
        if (e.key === CLAVE) aplicar(leer());
    });

    document.addEventListener('click', (e) => {
        const boton = e.target.closest('[data-tema-opcion]');
        if (boton) establecer(boton.dataset.temaOpcion);
    });

    document.addEventListener('DOMContentLoaded', () => {
        marcarControles();
        // Las vistas del router llegan después: se marcan al insertarse
        const outlet = document.getElementById('router-outlet');
        if (outlet) new MutationObserver(marcarControles).observe(outlet, { childList: true });
    });

    window.Tema = { preferido: leer, actual: () => raiz.dataset.tema, establecer };
})();
