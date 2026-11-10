// Fechas para mostrar en todo el sistema: siempre dd/mm/aaaa (y hh:mm cuando hace falta la hora),
// sin depender del idioma configurado en el equipo. La base guarda 'aaaa-mm-dd hh:mm:ss'.
(function (global) {
    const dos = (n) => String(n).padStart(2, '0');

    // Acepta 'aaaa-mm-dd', 'aaaa-mm-dd hh:mm[:ss]', un Date o milisegundos. Las fechas de la base
    // se leen como hora local (new Date('aaaa-mm-dd') las tomaría como UTC y podría cambiar el día).
    function aFecha(valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        if (valor instanceof Date) return isNaN(valor) ? null : valor;
        if (typeof valor === 'number') return new Date(valor);
        const m = String(valor).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        const d = new Date(valor);
        return isNaN(d) ? null : d;
    }

    // 'dd/mm/aaaa'. Si el valor no es una fecha, lo devuelve tal cual.
    function fechaDMA(valor) {
        const d = aFecha(valor);
        return d ? `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}` : (valor || '');
    }

    // 'dd/mm/aaaa hh:mm' (con segundos si se pide).
    function fechaHoraDMA(valor, conSegundos) {
        const d = aFecha(valor);
        if (!d) return valor || '';
        return `${fechaDMA(d)} ${dos(d.getHours())}:${dos(d.getMinutes())}${conSegundos ? ':' + dos(d.getSeconds()) : ''}`;
    }

    // Campo de texto 'dd/mm/aaaa' -> 'aaaa-mm-dd' para la base. '' si está vacío, null si no es una fecha válida.
    function isoDesdeDMA(texto) {
        const t = String(texto || '').trim();
        if (!t) return '';
        const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1]);
        if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return null;
        return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
    }

    // Campos <input data-fecha-dma>: al escribir 25122026 queda 25/12/2026.
    document.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || !el.matches || !el.matches('input[data-fecha-dma]')) return;
        const d = el.value.replace(/\D/g, '').slice(0, 8);
        el.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    });

    global.fechaDMA = fechaDMA;
    global.fechaHoraDMA = fechaHoraDMA;
    global.isoDesdeDMA = isoDesdeDMA;
})(window);
