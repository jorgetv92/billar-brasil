// Recordatorios en el portal de atención.
// Consulta al servidor cada pocos segundos. Cuando un recordatorio llega a su hora (y hay turno abierto),
// el servidor lo marca como mostrado y lo devuelve; aquí aparece un modal a pantalla completa que no se
// cierra con un clic afuera ni con Escape: hay que elegir "Aceptar", "Realicé lo indicado" o la X.
// Si hay varios, se muestran uno tras otro. Si otro dispositivo responde primero, el modal se cierra solo.
(function () {
    const API = "../backend/api/recordatorios.php";
    const INTERVALO_MS = 20000;
    const REPETIR_SONIDO_MS = 30000;

    let cola = [];          // avisos sin responder que devolvió el servidor
    let actual = null;      // aviso en pantalla
    let respondiendo = false;
    let detenido = false;
    let temporizador = null;
    let sonidoIntervalo = null;
    let tituloIntervalo = null;
    const tituloOriginal = document.title;

    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const hora = (valor) => String(valor || "").substring(11, 16);
    const toast = (m, t) => { if (window.mostrarToast) window.mostrarToast(m, t); };

    function crearModal() {
        const el = document.createElement("div");
        el.id = "recAlerta";
        el.className = "rec-alerta";
        el.setAttribute("role", "alertdialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-labelledby", "recAlertaTitulo");
        el.setAttribute("aria-describedby", "recAlertaDescripcion");
        el.hidden = true;
        el.innerHTML = `
            <div class="rec-alerta-caja">
                <div class="rec-alerta-banda">
                    <div class="rec-alerta-campana"><i class="material-icons">notifications_active</i></div>
                    <div class="rec-alerta-etiqueta">
                        <span class="rec-alerta-kicker">Recordatorio · No lo olvides</span>
                        <span class="rec-alerta-hora" id="recAlertaHora"></span>
                    </div>
                    <button type="button" class="rec-alerta-x" id="recAlertaCerrar" title="Cerrar sin aceptar" aria-label="Cerrar sin aceptar"><i class="material-icons">close</i></button>
                </div>
                <div class="rec-alerta-cuerpo">
                    <span class="rec-alerta-contador" id="recAlertaContador" hidden></span>
                    <h2 id="recAlertaTitulo"></h2>
                    <p id="recAlertaDescripcion"></p>
                </div>
                <div class="rec-alerta-botones">
                    <button type="button" class="rec-alerta-btn aceptar" id="recAlertaAceptar"><i class="material-icons">visibility</i>Aceptar</button>
                    <button type="button" class="rec-alerta-btn realizado" id="recAlertaRealizado"><i class="material-icons">task_alt</i>Realicé lo indicado</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        el.querySelector("#recAlertaCerrar").addEventListener("click", () => responder("cerrar"));
        el.querySelector("#recAlertaAceptar").addEventListener("click", () => responder("aceptar"));
        el.querySelector("#recAlertaRealizado").addEventListener("click", () => responder("realizado"));
        // Mientras está abierto, Escape no lo cierra y el foco no sale del modal.
        el.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
            if (e.key === "Tab") {
                const botones = [...el.querySelectorAll("button:not([disabled])")];
                const i = botones.indexOf(document.activeElement);
                if (e.shiftKey && i <= 0) { e.preventDefault(); botones[botones.length - 1].focus(); }
                else if (!e.shiftKey && i === botones.length - 1) { e.preventDefault(); botones[0].focus(); }
            }
        });
        return el;
    }

    const modal = () => document.getElementById("recAlerta") || crearModal();

    // Campanilla corta con el audio del navegador (sin archivos). Si el navegador la bloquea, no pasa nada.
    let ctxAudio = null;
    function sonar() {
        try {
            ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
            if (ctxAudio.state === "suspended") ctxAudio.resume();
            const t0 = ctxAudio.currentTime;
            [[880, 0], [1175, 0.18], [880, 0.36], [1175, 0.54]].forEach(([f, d]) => {
                const osc = ctxAudio.createOscillator();
                const vol = ctxAudio.createGain();
                osc.type = "sine";
                osc.frequency.value = f;
                vol.gain.setValueAtTime(0.0001, t0 + d);
                vol.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
                vol.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
                osc.connect(vol).connect(ctxAudio.destination);
                osc.start(t0 + d);
                osc.stop(t0 + d + 0.18);
            });
        } catch (e) { /* sin audio */ }
    }

    function llamarAtencion(activo) {
        clearInterval(sonidoIntervalo);
        clearInterval(tituloIntervalo);
        document.title = tituloOriginal;
        if (!activo) return;
        sonar();
        sonidoIntervalo = setInterval(sonar, REPETIR_SONIDO_MS);
        let alterna = false;
        tituloIntervalo = setInterval(() => {
            alterna = !alterna;
            document.title = alterna ? "🔔 RECORDATORIO" : tituloOriginal;
        }, 1000);
    }

    function pintar() {
        const el = modal();
        if (!cola.length) {
            if (!el.hidden) {
                el.classList.remove("visible");
                el.hidden = true;
            }
            actual = null;
            llamarAtencion(false);
            return;
        }
        const siguiente = cola[0];
        const esNuevo = !actual || actual.id_aviso !== siguiente.id_aviso;
        actual = siguiente;
        el.querySelector("#recAlertaHora").textContent = `Programado para las ${hora(actual.programado_para)}`;
        el.querySelector("#recAlertaTitulo").textContent = actual.titulo;
        const desc = el.querySelector("#recAlertaDescripcion");
        desc.innerHTML = esc(actual.descripcion || "").replace(/\n/g, "<br>");
        desc.hidden = !actual.descripcion;
        const contador = el.querySelector("#recAlertaContador");
        contador.hidden = cola.length < 2;
        contador.textContent = `1 de ${cola.length} recordatorios`;
        el.querySelectorAll("button").forEach(b => b.disabled = false);
        if (esNuevo) {
            el.hidden = false;
            el.classList.remove("visible", "sacudir");
            void el.offsetWidth; // reinicia la animación de entrada
            el.classList.add("visible", "sacudir");
            llamarAtencion(true);
            setTimeout(() => el.querySelector("#recAlertaAceptar").focus(), 50);
        }
    }

    async function consultar() {
        if (detenido) return;
        try {
            const resp = await fetch(`${API}?vista=atencion`, { cache: "no-store" });
            if (resp.status === 401 || resp.status === 403) { detenido = true; return; }
            const result = await resp.json();
            if (result.status !== "success") return;
            if (respondiendo) return; // la respuesta en curso decide qué sigue
            const anterior = actual;
            cola = result.data;
            if (anterior && !cola.some(a => a.id_aviso === anterior.id_aviso)) {
                toast("El recordatorio fue respondido en otro dispositivo.", "info");
            }
            pintar();
        } catch (e) { /* sin conexión: se reintenta en la próxima vuelta */ }
    }

    async function responder(respuesta) {
        if (!actual || respondiendo) return;
        respondiendo = true;
        const aviso = actual;
        modal().querySelectorAll("button").forEach(b => b.disabled = true);
        try {
            const resp = await fetch(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accion: "responder", id_aviso: aviso.id_aviso, respuesta })
            });
            const result = await resp.json();
            if (result.status === "success") {
                if (respuesta === "realizado") toast("¡Bien! Se registró que realizó lo indicado.", "success");
                else if (respuesta === "aceptar") toast("Recordatorio aceptado. No olvide realizarlo.", "info");
            } else if (result.status === "respondido") {
                toast(result.message, "info");
            } else {
                throw new Error(result.message);
            }
            cola = cola.filter(a => a.id_aviso !== aviso.id_aviso);
        } catch (e) {
            toast("No se pudo registrar la respuesta. Revise la conexión e intente de nuevo.", "error");
            modal().querySelectorAll("button").forEach(b => b.disabled = false);
            respondiendo = false;
            return;
        }
        respondiendo = false;
        actual = null;
        pintar();
    }

    function programar() {
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => { await consultar(); programar(); }, INTERVALO_MS);
    }

    // Al volver a la pestaña o recuperar la conexión, consulta enseguida.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) consultar(); });
    window.addEventListener("online", consultar);
    // Cualquier toque habilita el audio (los navegadores lo bloquean hasta que el usuario interactúa).
    document.addEventListener("pointerdown", () => {
        try {
            ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)();
            if (ctxAudio.state === "suspended") ctxAudio.resume();
        } catch (e) { /* sin audio */ }
    }, { once: true });

    document.addEventListener("DOMContentLoaded", () => {
        consultar();
        programar();
    });
})();
