document.addEventListener("DOMContentLoaded", () => {
    const outlet = document.getElementById("router-outlet");
    const menuToggle = document.getElementById("menuToggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const navItems = document.querySelectorAll(".nav-item[data-page]");

    // Variable global de ámbito superior de módulo para retener la data de precierre
    let dataPrecierreCache = null;

    // --- 1. MOSTRAR NOMBRE DEL TRABAJADOR ---
    const txtSidebarName = document.getElementById("sidebarUserName");
    const nombreGuardado = localStorage.getItem("usuario_nombre");
    txtSidebarName.innerText = nombreGuardado ? nombreGuardado : "Trabajador Activo";

    // --- 2. ENRUTAMIENTO (MÉTODO SPA ACTUALIZADO CON COUPLING) ---
    async function navegarA(nombreArchivo) {
        try {
            const response = await fetch(`vistas/${nombreArchivo}?_=${Date.now()}`);
            if (!response.ok) throw new Error(`Vista en construcción (HTTP ${response.status}). Asegúrate de recargar la página sin caché (Ctrl+F5).`);

            const html = await response.text();
            outlet.innerHTML = html;

            // RE-INYECCIÓN DE SCRIPTS: Los navegadores no ejecutan <script> insertados vía innerHTML.
            // Extraemos y recreamos los scripts para que el navegador los evalúe correctamente.
            const scripts = outlet.querySelectorAll('script');
            scripts.forEach(oldScript => {
                const newScript = document.createElement('script');
                Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });

            // CASO A: INYECCIÓN DEL PORTAL DE MESA Y BARRA
            if (nombreArchivo === "atencion.html") {
                if (window.gestorUI && typeof window.gestorUI.inicializar === "function") {
                    await window.gestorUI.inicializar();
                }
            }
            
            if (nombreArchivo === "configuracion_atencion.html") {
                const toggle = document.getElementById("toggleImpresion");
                if (toggle) {
                    toggle.checked = localStorage.getItem('imprimirTermicaHabilitado') !== 'false';
                    toggle.addEventListener('change', (e) => {
                        localStorage.setItem('imprimirTermicaHabilitado', e.target.checked);
                        if(window.mostrarToast) window.mostrarToast("Configuración guardada en este dispositivo", "success");
                    });
                }
            }

            // CASO B: LÓGICA INTEGRADA PARA EL DASHBOARD DE JORNADAS
            if (nombreArchivo === "dashboard_atencion.html") {
                await verificarEstadoJornada();

                const container = document.getElementById("jornadaContainer");

                // Corrección Crítica: Añadido async al callback del click del contenedor
                container.addEventListener("click", async(e) => {
                    // 1. Botón de Apertura (Jornada Cerrada)
                    const btnAbrir = e.target.closest("#btnAbrirJornadaTemp");
                    if (btnAbrir) {
                        if (btnAbrir.hasAttribute("disabled")) {
                            window.mostrarToast("Acción bloqueada. Ya existe una jornada activa en el sistema.", "error");
                            return;
                        }
                        document.getElementById("modalApertura").style.display = "flex";
                        document.getElementById("montoInicial").focus();
                    }

                    // 2. Botón de Pre-Cierre (Jornada Activa)
                    const btnPreCierre = e.target.closest("#btnAbrirPreCierre");
                    if (btnPreCierre) {
                        document.getElementById("modalPreCierre").style.display = "flex";
                        const infoContainer = document.getElementById("infoPreCierre");
                        infoContainer.innerHTML = `<p class="text-center" style="color: #94a3b8;">Calculando balances...</p>`;

                        try {
                            const res = await fetch("../backend/api/jornada.php?action=precierre");
                            const data = await res.json();

                            if (data.status === "success") {
                                // Almacenamos en caché la data contable para heredarla en el reporte final
                                dataPrecierreCache = data;

                                const c = data.caja;
                                const efectivo_en_caja = c.monto_apertura + c.ingresos_efectivo - c.egresos;
                                const ingresos_totales = c.ingresos_efectivo + c.ingresos_qr;

                                let htmlTablas = `
                                    <h4 style="color:#1e293b; margin-bottom:10px; border-left:3px solid var(--primary, #2196f3); padding-left:8px;">1. Cuadre de Caja (Efectivo y QR)</h4>
                                    <div style="overflow-x:auto; margin-bottom:25px;">
                                        <table style="width:100%; border-collapse:collapse; text-align:right; font-size:0.9rem;">
                                            <thead>
                                                <tr style="background:#f1f5f9; color:#475569;">
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Monto de apertura</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Ingresos efectivo</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Egresos</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; background:#fef2f2; color:#ef4444; text-align:right;">Efectivo en caja</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Ingresos qr</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; background:#f0fdf4; color:#16a34a; text-align:right;">Ingresos totales</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr style="font-weight:bold; color:#1e293b;">
                                                    <td style="padding:10px; border:1px solid #cbd5e1;">${c.monto_apertura.toFixed(2)} Bs</td>
                                                    <td style="padding:10px; border:1px solid #cbd5e1;">${c.ingresos_efectivo.toFixed(2)} Bs</td>
                                                    <td style="padding:10px; border:1px solid #cbd5e1; color:#ef4444;">-${c.egresos.toFixed(2)} Bs</td>
                                                    <td style="padding:10px; border:1px solid #cbd5e1; background:#f9fafb;">${efectivo_en_caja.toFixed(2)} Bs</td>
                                                    <td style="padding:10px; border:1px solid #cbd5e1;">${c.ingresos_qr.toFixed(2)} Bs</td>
                                                    <td style="padding:10px; border:1px solid #cbd5e1; background:#f9fafb;">${ingresos_totales.toFixed(2)} Bs</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <h4 style="color:#1e293b; margin-bottom:10px; border-left:3px solid #ef4444; padding-left:8px; margin-top:20px;">2. Detalle de Egresos</h4>
                                    <div style="overflow-x:auto; margin-bottom:25px;">
                                        <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                                            <thead>
                                                <tr style="background:#f1f5f9; color:#475569; text-align:left;">
                                                    <th style="padding:10px; border:1px solid #cbd5e1;">Fecha/Hora</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1;">Concepto</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Monto</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                `;

                                if (data.egresos_detalle && data.egresos_detalle.length > 0) {
                                    data.egresos_detalle.forEach(e => {
                                        let fd = new Date(e.fecha_hora.replace(/-/g, '/'));
                                        let hh = fd.getHours().toString().padStart(2, '0');
                                        let mm = fd.getMinutes().toString().padStart(2, '0');
                                        let fechaFmt = `${fd.getDate().toString().padStart(2,'0')}/${(fd.getMonth()+1).toString().padStart(2,'0')} ${hh}:${mm}`;
                                        
                                        htmlTablas += `
                                            <tr style="color:#334155;">
                                                <td style="padding:10px; border:1px solid #cbd5e1;">${fechaFmt}</td>
                                                <td style="padding:10px; border:1px solid #cbd5e1;">${e.concepto}</td>
                                                <td style="padding:10px; border:1px solid #cbd5e1; text-align:right; font-weight:bold; color:#ef4444;">${parseFloat(e.monto).toFixed(2)} Bs</td>
                                            </tr>
                                        `;
                                    });
                                } else {
                                    htmlTablas += `<tr><td colspan="3" style="padding:10px; border:1px solid #cbd5e1; text-align:center; color:#94a3b8;">No hay egresos registrados</td></tr>`;
                                }
                                htmlTablas += `</tbody></table></div>`;

                                htmlTablas += `
                                    <h4 style="color:#1e293b; margin-bottom:10px; border-left:3px solid var(--success, #10b981); padding-left:8px;">3. Cuadre de Inventario (Bebidas y Snacks)</h4>
                                    <div style="overflow-x:auto;">
                                        <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                                            <thead>
                                                <tr style="background:#f1f5f9; color:#475569; text-align:center;">
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:left;">Producto</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1;">Stock inicial</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1;">Vendido</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Precio unitario</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; text-align:right;">Sub total</th>
                                                    <th style="padding:10px; border:1px solid #cbd5e1; background:#f8fafc;">Stock final</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                `;

                                data.inventario.forEach(p => {
                                    const subtotal = p.vendido * p.precio_unitario;
                                    htmlTablas += `
                                        <tr style="color:#334155; text-align:center;">
                                            <td style="padding:10px; border:1px solid #cbd5e1; text-align:left; font-weight:500;">${p.nombre_producto}</td>
                                            <td style="padding:10px; border:1px solid #cbd5e1;">${p.stock_inicial}</td>
                                            <td style="padding:10px; border:1px solid #cbd5e1; font-weight:bold; color:var(--success, #10b981);">${p.vendido}</td>
                                            <td style="padding:10px; border:1px solid #cbd5e1; text-align:right;">${parseFloat(p.precio_unitario).toFixed(2)} Bs</td>
                                            <td style="padding:10px; border:1px solid #cbd5e1; text-align:right; font-weight:bold;">${subtotal.toFixed(2)} Bs</td>
                                            <td style="padding:10px; border:1px solid #cbd5e1; font-weight:bold; background:#f8fafc;">${p.stock_final}</td>
                                        </tr>
                                    `;
                                });

                                htmlTablas += `</tbody></table></div>`;
                                infoContainer.innerHTML = htmlTablas;
                            } else {
                                window.mostrarToast("No se pudo compilar el reporte de precierre.", "error");
                            }
                        } catch (err) {
                            window.mostrarToast("Error de conexión al calcular balances.", "error");
                        }
                    }
                    // 3. Botón de Mis Ventas
                    const btnMisVentas = e.target.closest("#btnAbrirMisVentas");
                    if (btnMisVentas) {
                        abrirModalMisVentas();
                        return;
                    }
                });

                // Controladores de cierre de modales
                document.getElementById("btnCancelarApertura").addEventListener("click", () => {
                    document.getElementById("modalApertura").style.display = "none";
                    document.getElementById("formAperturaCaja").reset();
                });

                document.getElementById("btnCancelarCierre").addEventListener("click", () => {
                    document.getElementById("modalPreCierre").style.display = "none";
                });

                // Listener para confirmar el cierre definitivo de caja
                /*document.getElementById("btnConfirmarCierre").addEventListener("click", async() => {
                    try {
                        // Consumimos el endpoint unificado pasándole ?action=cerrar
                        const res = await fetch("../backend/api/jornada.php?action=cerrar", { method: "POST" });
                        const data = await res.json();

                        if (data.status === "success") {
                            // 1. Ocultar el modal intermedio de pre-cierre
                            document.getElementById("modalPreCierre").style.display = "none";

                            // 2. Extraer los contadores acumulados de las tablas (horas, ventas, etc.)
                            const resKpis = await fetch("../backend/api/jornada.php");
                            const dataKpis = await resKpis.json();

                            // 3. Renderizar e inyectar el reporte monospace estructurado
                            abrirReporteFinal(dataPrecierreCache, dataKpis);

                            // 4. Actualizar la vista base del dashboard (se pintará cerrada)
                            await verificarEstadoJornada();
                        } else {
                            // Si existen mesas ocupadas u otra restricción, se muestra el mensaje de error del backend
                            window.mostrarToast(data.message, "error");
                        }
                    } catch (err) {
                        window.mostrarToast("Error crítico al procesar el cierre definitivo.", "error");
                    }
                });*/
                // Listener para confirmar el cierre definitivo de caja (CON DEPURACIÓN E INYECCIÓN DE CONTROL)
                document.getElementById("btnConfirmarCierre").addEventListener("click", async() => {
                    console.log("%c[DEBUG PRECIE RE] 1. Click detectado en el botón Confirmar Cierre.", "color: #2196f3; font-weight: bold;");

                    try {
                        console.log("[DEBUG PRECIERRE] 2. Enviando petición POST para cerrar jornada...");
                        const res = await fetch("../backend/api/jornada.php?action=cerrar", { method: "POST" });
                        const data = await res.json();
                        console.log("[DEBUG PRECIERRE] 3. Respuesta recibida del backend (?action=cerrar):", data);

                        if (data.status === "success") {
                            console.log("[DEBUG PRECIERRE] 4. Estado Exitoso. Ocultando modalPreCierre.");
                            document.getElementById("modalPreCierre").style.display = "none";

                            console.log("[DEBUG PRECIERRE] 5. Validando caché de datos contables previos...");
                            console.log("-> Contenido de dataPrecierreCache:", dataPrecierreCache);

                            if (!dataPrecierreCache) {
                                console.warn("[DEBUG PRECIERRE] Alerta: dataPrecierreCache está vacío. Intentando recuperar datos de contingencia en caliente.");
                                // Contingencia en caso de que se haya perdido el puntero de memoria
                                const resPre = await fetch("../backend/api/jornada.php?action=precierre");
                                dataPrecierreCache = await resPre.json();
                            }

                            // --- CORRECCIÓN CRÍTICA ---
                            // Como la jornada ya está cerrada en la Base de Datos, el GET simple responderá {"status":"cerrada"}.
                            // Por lo tanto, emulamos la estructura de KPIs usando la última fotografía válida del pre-cierre.
                            console.log("[DEBUG PRECIERRE] 6. Estructurando Objeto de KPIs sintético para el reporte...");

                            // Reutilizamos los datos contables del pre-cierre para poblar el reporte final sin romper el renderizado
                            const dataKpisSintetico = {
                                status: "success",
                                jornada: {
                                    id_jornada: dataPrecierreCache.jornada_id || "Activa",
                                    fecha_hora_apertura: dataPrecierreCache.fecha_apertura || "Turno Reciente"
                                },
                                kpis: {
                                    horas_jugadas: dataPrecierreCache.horas_totales || 0,
                                    productos_vendidos: dataPrecierreCache.inventario ? dataPrecierreCache.inventario.reduce((acc, curr) => acc + parseInt(curr.vendido || 0), 0) : 0,
                                    total_egresos: dataPrecierreCache.caja ? dataPrecierreCache.caja.egresos : 0
                                }
                            };

                            console.log("[DEBUG PRECIERRE] 7. Objeto contable listo para impresión:", dataKpisSintetico);

                            console.log("[DEBUG PRECIERRE] 8. Invocando función abrirReporteFinal().");
                            abrirReporteFinal(dataPrecierreCache, dataKpisSintetico);
                            console.log("[DEBUG PRECIERRE] 9. abrirReporteFinal ejecutado sin interrupciones. Abriendo modalReporteFinal.");

                            console.log("[DEBUG PRECIERRE] 10. Actualizando vista de fondo del Dashboard...");
                            await verificarEstadoJornada();
                            console.log("[DEBUG PRECIERRE] 11. Flujo de cierre completado al 100%.");

                        } else {
                            console.error("[DEBUG PRECIERRE] El backend rechazó el cierre:", data.message);
                            window.mostrarToast(data.message, "error");
                        }
                    } catch (err) {
                        console.error("%c[DEBUG PRECIERRE CRÍTICO] Capturado en el bloque catch. Detalles del error:", "color: #ef4444; font-weight: bold;", err);
                        console.error("Stack trace del error:", err.stack);
                        window.mostrarToast("Error crítico al procesar el cierre definitivo.", "error");
                    }
                });

                // Listener para ocultar el reporte final
                document.getElementById("btnCerrarReporteFinal").addEventListener("click", () => {
                    document.getElementById("modalReporteFinal").style.display = "none";
                });

                // Evitar notación científica en monto inicial
                const txtMontoInicial = document.getElementById("montoInicial");
                txtMontoInicial.addEventListener("keydown", (e) => {
                    if (["e", "E", "+", "-"].includes(e.key)) {
                        e.preventDefault();
                    }
                });

                // Formulario de Apertura de caja
                document.getElementById("formAperturaCaja").addEventListener("submit", async(e) => {
                    e.preventDefault();
                    const valorInput = txtMontoInicial.value.trim();
                    const regexMoneda = /^\d+(\.\d{1,2})?$/;

                    if (!regexMoneda.test(valorInput)) {
                        window.mostrarToast("Formato de monto inválido. Use solo números positivos (Ej: 150 o 100.50)", "error");
                        return;
                    }

                    const monto = parseFloat(valorInput);
                    const idUsuario = localStorage.getItem("id_usuario") || 1;

                    try {
                        const res = await fetch("../backend/api/jornada.php", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ monto_inicial: monto, id_usuario: idUsuario })
                        });
                        const data = await res.json();

                        if (data.status === "success") {
                            // 1. Ocultar el modal de monto
                            document.getElementById("modalApertura").style.display = "none";
                            document.getElementById("formAperturaCaja").reset();

                            // 2. Obtener inventario de apertura del backend
                            try {
                                const resInv = await fetch("../backend/api/jornada.php?action=inventario_apertura");
                                const dataInv = await resInv.json();

                                if (dataInv.status === "success") {
                                    // Parsear fecha y hora
                                    const fechaHoraRaw = dataInv.fecha_apertura || "";
                                    let fechaStr = "—",
                                        horaStr = "—";
                                    if (fechaHoraRaw.includes(" ")) {
                                        const [fp, hp] = fechaHoraRaw.split(" ");
                                        const [yyyy, mm, dd] = fp.split("-");
                                        fechaStr = `${dd}/${mm}/${yyyy}`;
                                        horaStr = hp;
                                    }

                                    // Rellenar campos del modal
                                    document.getElementById("raIdJornada").innerText = `Jornada #${dataInv.id_jornada}`;
                                    document.getElementById("raEncargado").innerText = dataInv.encargado || localStorage.getItem("usuario_nombre") || "—";
                                    document.getElementById("raFecha").innerText = fechaStr;
                                    document.getElementById("raHora").innerText = horaStr;
                                    document.getElementById("raMontoApertura").innerText = `${parseFloat(monto).toFixed(2)} Bs`;

                                    // Rellenar tabla de inventario
                                    const tbody = document.getElementById("raInventarioBody");
                                    if (dataInv.inventario && dataInv.inventario.length > 0) {
                                        tbody.innerHTML = dataInv.inventario.map(p => `
                                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                                <td style="padding: 4px 8px; color:#334155;">${p.nombre_producto}</td>
                                                <td style="padding: 4px 8px; text-align:right; font-weight:600; color:#1e293b;">${p.stock_apertura}</td>
                                            </tr>
                                        `).join('');
                                    } else {
                                        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding:10px;">Sin productos registrados</td></tr>`;
                                    }
                                }
                            } catch (errInv) {
                                console.error("Error al obtener inventario de apertura:", errInv);
                            }

                            // 3. Mostrar el modal de reporte de apertura
                            document.getElementById("modalReporteApertura").style.display = "flex";

                            // 4. Al cerrar el modal de reporte, refrescar el dashboard
                            document.getElementById("btnCerrarReporteApertura").onclick = async() => {
                                document.getElementById("modalReporteApertura").style.display = "none";
                                await verificarEstadoJornada();
                            };

                        } else {
                            window.mostrarToast(data.message, "error");
                            if (data.status === "bloqueado") await verificarEstadoJornada();
                        }
                    } catch (err) {
                        window.mostrarToast("Error de conexión al procesar la apertura.", "error");
                    }
                });
            }

        } catch (error) {
            outlet.innerHTML = `<div class="card text-center" style="padding: 40px;"><h3 class="text-danger">Error</h3><p>${error.message}</p></div>`;
        }
    }

    // Nivelación de los clicks de la barra de navegación del Sidebar
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            navItems.forEach(btn => btn.classList.remove("active"));
            item.classList.add("active");
            navegarA(item.dataset.page);
            if (window.innerWidth <= 768) toggleMenu();
        });
    });

    // --- 3. RESPONSIVO Y MENU ---
    function toggleMenu() {
        sidebar.classList.toggle("open");
        overlay.classList.toggle("show");
    }
    menuToggle.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", toggleMenu);

    // --- 4. TOASTS NOTIFICACIONES ---
    window.mostrarToast = function(mensaje, tipo = "success") {
        const container = document.getElementById("toastContainer");
        if (!container) return;
        const toast = document.createElement("div");
        toast.className = `toast ${tipo}`;

        let icono = tipo === "success" ? "check_circle" : (tipo === "error" ? "cancel" : "warning");
        toast.innerHTML = `<i class="material-icons">${icono}</i> <span>${mensaje}</span>`;

        container.appendChild(toast);
        setTimeout(() => toast.classList.add("show"), 10);
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    // --- 5. LOGOUT ---
    document.getElementById("btnLogout").addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "index.html";
    });

    // Inicializar SPA apuntando al Dashboard por defecto
    navegarA("dashboard_atencion.html");
});

// ==========================================================================
// FUNCIONES DE APOYO OPERATIVO (KPIs Y REPORTES MONOSPACE)
// ==========================================================================

async function verificarEstadoJornada() {
    try {
        const res = await fetch("../backend/api/jornada.php");
        const data = await res.json();

        if (data.status === "activa") {
            renderizarJornadaAbierta(data.jornada);
            pintarKpisDashboard(data.kpis);
        } else {
            renderizarJornadaCerrada(false);
            pintarKpisDashboard({
                mesas_disponibles: [],
                horas_jugadas: 0,
                productos_vendidos: 0,
                total_egresos: 0
            });
        }
    } catch (err) {
        window.mostrarToast("Error crítico al validar estado de caja.", "error");
    }
}

function renderizarJornadaAbierta(jornada) {
    const container = document.getElementById("jornadaContainer");
    const idUsuarioActual = localStorage.getItem("id_usuario") || 1;

    const nombreEncargado = (jornada.nombres && jornada.apellidos) ?
        `${jornada.nombres} ${jornada.apellidos}` :
        'Usuario Operador';

    let fechaFormateada = jornada.fecha_hora_apertura;
    if (fechaFormateada && fechaFormateada.includes("-")) {
        const [fechaParte, horaParte] = fechaFormateada.split(" ");
        const [yyyy, mm, dd] = fechaParte.split("-");
        fechaFormateada = `${dd}-${mm}-${yyyy} ${horaParte}`;
    }

    const esOtroUsuario = (jornada.id_usuario_apertura != idUsuarioActual);
    const avisoBloqueo = esOtroUsuario ?
        `<div style="color: #ef4444; font-weight: bold; margin-top: 10px; font-size: 0.9rem;">
            <i class="material-icons" style="vertical-align: bottom; font-size:1.2rem;">warning</i> Operación restringida. Jornada activa por: ${nombreEncargado}
         </div>` : '';

    container.innerHTML = `
        <div class="card text-center" style="padding: 30px 20px; border-left: 5px solid var(--success, #10b981); height: 100%; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box;">
            <i class="material-icons text-success" style="font-size: 3rem; margin-bottom: 10px;">check_circle</i>
            <h3 style="margin-bottom: 5px;">Jornada de Caja Activa</h3>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; background: #f8fafc; padding: 15px; border-radius: 6px; text-align: left; margin: 15px auto; width: 100%; box-sizing: border-box;">
                <div><strong>Encargado:</strong> ${nombreEncargado}</div>
                <div><strong>Apertura:</strong> ${fechaFormateada}</div>
                <div><strong>Monto de apertura:</strong> ${parseFloat(jornada.monto_inicial_caja).toFixed(2)} Bs.</div>
                <div><strong>Estado:</strong> <span class="badge" style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">Abierta</span></div>
            </div>

            ${!esOtroUsuario ? `
            <div style="margin-top: 5px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <button class="btn-primary" id="btnAbrirMisVentas" style="background-color: #6366f1; border: none; padding: 10px 25px; font-size: 1rem; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; display: inline-flex; align-items: center; gap: 8px;">
                    <i class="material-icons">point_of_sale</i> Mis Ventas
                </button>
                <button class="btn-primary" id="btnAbrirPreCierre" style="background-color: var(--danger, #ef4444); border: none; padding: 10px 25px; font-size: 1rem; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; display: inline-flex; align-items: center; gap: 8px;">
                    <i class="material-icons">lock</i> Cierre de Jornada
                </button>
            </div>` : ''}
            
            ${avisoBloqueo}
        </div>
    `;
}

function renderizarJornadaCerrada(bloquearBoton) {
    const container = document.getElementById("jornadaContainer");
    container.innerHTML = `
        <div class="card text-center" style="padding: 40px 20px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box;">
            <i class="material-icons text-warning" style="font-size: 3.5rem; margin-bottom: 10px;">lock_clock</i>
            <h3>Jornada Cerrada</h3>
            <p style="color: #64748b; margin-bottom: 20px; max-width: 400px;">Debes abrir caja para comenzar a atender mesas y vender productos.</p>
            <button class="btn-primary" id="btnAbrirJornadaTemp" style="font-size: 1.1rem; padding: 12px 25px;" ${bloquearBoton ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
                <i class="material-icons" style="vertical-align: middle; margin-right: 5px;">play_circle</i> Abrir Jornada
            </button>
        </div>
    `;
}

function pintarKpisDashboard(kpis) {
    const listContainer = document.getElementById("kpiMesasList");
    if (listContainer) {
        if (!kpis.mesas_disponibles || kpis.mesas_disponibles.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align:center; color:#94a3b8; font-size:0.9rem; padding: 10px 0;">
                    No hay mesas operativas o caja cerrada.
                </div>`;
        } else {
            listContainer.innerHTML = kpis.mesas_disponibles.map(item => `
                <div style="display:flex; justify-content:space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; font-size: 0.95rem;">
                    <span style="color:#64748b; text-transform: capitalize;">${item.tipo}:</span> 
                    <strong style="color:var(--primary, #2196f3); font-size:1.1rem;">${item.disponibles}</strong>
                </div>
            `).join('');
        }
    }

    const tarjetas = document.querySelectorAll(".dash-row-2 .card");
    tarjetas.forEach(tarjeta => {
        const titleEl = tarjeta.querySelector(".kpi-title");
        const valEl = tarjeta.querySelector(".kpi-value");
        if (!titleEl || !valEl) return;

        const titulo = titleEl.innerText.trim().toLowerCase();
        if (titulo === "horas jugadas") {
            const horas = parseFloat(kpis.horas_jugadas || 0).toFixed(2);
            valEl.innerHTML = `${horas} <span style="font-size:1rem;color:#94a3b8;">hrs</span>`;
        } else if (titulo === "productos vendidos") {
            const unidades = parseInt(kpis.productos_vendidos || 0, 10);
            valEl.innerHTML = `${unidades} <span style="font-size:1rem;color:#94a3b8;">uds</span>`;
        } else if (titulo === "total egresos") {
            const egresos = parseFloat(kpis.total_egresos || 0).toFixed(2);
            valEl.innerHTML = `${egresos} <span style="font-size:1rem;color:#94a3b8;">Bs</span>`;
        }
    });
}

function abrirReporteFinal(precierre, kpiBase) {
    const j = kpiBase.jornada;
    const k = kpiBase.kpis;
    const c = precierre.caja;

    document.getElementById("reporteHeaderTitulo").innerText = `Reporte Definitivo de Jornada #${j.id_jornada}`;
    document.getElementById("modalReporteFinal").style.display = "flex";

    const totalHorasDecimal = parseFloat(k.horas_jugadas || 0);
    const hrs = Math.floor(totalHorasDecimal);
    const mins = Math.floor((totalHorasDecimal - hrs) * 60);
    const tiempoFormateado = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;

    const totalCajaEfectivo = c.monto_apertura + c.ingresos_efectivo - c.egresos;
    const ingresosTotales = c.ingresos_efectivo + c.ingresos_qr;

    let totalVendidoProductos = 0;
    let htmlInventarioFilas = "";

    precierre.inventario.forEach(p => {
        const sub = p.vendido * p.precio_unitario;
        totalVendidoProductos += sub;
        htmlInventarioFilas += `
            <tr style="border-bottom: 1px solid #f1f5f9; color: #334155;">
                <td style="padding: 4px 8px; font-weight: 500;">${p.nombre_producto}</td>
                <td style="padding: 4px 8px; text-align: center;">${p.stock_inicial}</td>
                <td style="padding: 4px 8px; text-align: center; font-weight: 600; color: #059669;">${p.vendido}</td>
                <td style="padding: 4px 8px; text-align: right;">${parseFloat(p.precio_unitario).toFixed(2)}</td>
                <td style="padding: 4px 8px; text-align: right; font-weight: 600;">${sub.toFixed(2)}</td>
                <td style="padding: 4px 8px; text-align: center; font-weight: 600; background: #f8fafc;">${p.stock_final}</td>
            </tr>
        `;
    });

    const totalHorasImporte = ingresosTotales - totalVendidoProductos;
    const totalRecaudadoLimpio = ingresosTotales - c.egresos;

    const layoutReporteVisual = `
        <div style="font-family: 'Inter', 'Segoe UI', sans-serif; color: #334155; line-height: 1.3; padding: 15px; max-width: 850px; margin: 0 auto; background: #ffffff; border-radius: 8px;">
            
            <!-- Encabezado del Reporte -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">
                <div>
                    <h2 style="margin: 0; color: #0f172a; font-size: 1.3rem; font-weight: 700; letter-spacing: -0.02em;">Reporte de Cierre de Jornada</h2>
                    <p style="margin: 2px 0 0 0; color: #64748b; font-size: 0.8rem;">ID de Jornada: <strong style="color: #0f172a;">#${j.id_jornada}</strong> &nbsp;|&nbsp; Apertura: <strong style="color: #0f172a;">${j.fecha_hora_apertura}</strong></p>
                </div>
                <div>
                    <span style="background: #ef4444; color: #ffffff; padding: 4px 10px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; box-shadow: 0 2px 4px rgba(239, 68, 68, 0.2);">Jornada Cerrada</span>
                </div>
            </div>

            <!-- Sección: Estado de Caja -->
            <div style="margin-bottom: 12px;">
                <h3 style="margin: 0 0 6px 0; font-size: 0.95rem; color: #0f172a; display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 4px; height: 14px; background: #3b82f6; border-radius: 2px;"></span>
                    Resumen de Caja
                </h3>
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: right;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 6px 8px; font-weight: 600;">Monto Apertura</th>
                                <th style="padding: 6px 8px; font-weight: 600;">Ingresos Efectivo</th>
                                <th style="padding: 6px 8px; font-weight: 600; color: #ef4444;">Egresos</th>
                                <th style="padding: 6px 8px; font-weight: 600;">Caja Real (Efectivo)</th>
                                <th style="padding: 6px 8px; font-weight: 600;">Ingresos QR</th>
                                <th style="padding: 6px 8px; font-weight: 700; color: #0f172a;">Ingresos Totales</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 6px 8px;">${c.monto_apertura.toFixed(2)} Bs</td>
                                <td style="padding: 6px 8px;">${c.ingresos_efectivo.toFixed(2)} Bs</td>
                                <td style="padding: 6px 8px; color: #ef4444;">-${c.egresos.toFixed(2)} Bs</td>
                                <td style="padding: 6px 8px; font-weight: 600; background: #f0fdf4; color: #166534;">${totalCajaEfectivo.toFixed(2)} Bs</td>
                                <td style="padding: 6px 8px;">${c.ingresos_qr.toFixed(2)} Bs</td>
                                <td style="padding: 6px 8px; font-weight: 700; color: #0f172a; background: #f8fafc;">${ingresosTotales.toFixed(2)} Bs</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Sección: Estado de Inventario -->
            <div style="margin-bottom: 12px;">
                <h3 style="margin: 0 0 6px 0; font-size: 0.95rem; color: #0f172a; display: flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 4px; height: 14px; background: #10b981; border-radius: 2px;"></span>
                    Detalle de Inventario y Ventas
                </h3>
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                        <thead>
                            <tr style="background: #f8fafc; color: #475569; border-bottom: 2px solid #e2e8f0; text-align: left;">
                                <th style="padding: 6px 8px; font-weight: 600;">Producto</th>
                                <th style="padding: 6px 8px; font-weight: 600; text-align: center;">Stock Inicial</th>
                                <th style="padding: 6px 8px; font-weight: 600; text-align: center;">Vendido</th>
                                <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Precio Unit.</th>
                                <th style="padding: 6px 8px; font-weight: 600; text-align: right;">Subtotal</th>
                                <th style="padding: 6px 8px; font-weight: 600; text-align: center;">Stock Final</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${htmlInventarioFilas}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Métricas Clave (KPIs) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px; font-weight: 500;">Rendimiento de Mesas</div>
                    <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <span style="font-size: 1.1rem; font-weight: 600; color: #0f172a;">${tiempoFormateado} <span style="font-size: 0.75rem; font-weight: 400; color: #64748b;">hrs jugadas</span></span>
                        <span style="font-size: 1.1rem; font-weight: 600; color: #3b82f6;">${totalHorasImporte.toFixed(2)} Bs</span>
                    </div>
                </div>
                <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 4px; font-weight: 500;">Rendimiento de Productos</div>
                    <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <span style="font-size: 1.1rem; font-weight: 600; color: #0f172a;">${k.productos_vendidos} <span style="font-size: 0.75rem; font-weight: 400; color: #64748b;">uds vendidas</span></span>
                        <span style="font-size: 1.1rem; font-weight: 600; color: #10b981;">${totalVendidoProductos.toFixed(2)} Bs</span>
                    </div>
                </div>
            </div>

            <!-- Total Recaudado (Limpio) -->
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; border-radius: 6px; padding: 15px; text-align: center; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.3);">
                <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">Total Recaudado (Limpio de Egresos)</div>
                <div style="font-size: 1.8rem; font-weight: 700; color: #38bdf8; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                    ${totalRecaudadoLimpio.toFixed(2)} Bs
                </div>
            </div>

        </div>
    `;

    document.getElementById("contenidoReporteFinal").innerHTML = layoutReporteVisual;

    // Disparar Impresión si el gestor está disponible
    if (typeof gestorImpresion !== 'undefined') {
        const encargadoNom = localStorage.getItem("usuario_nombre") || "Operador";
        const datosJornadaImpresion = {
            id_jornada: j.id_jornada,
            encargado: encargadoNom,
            fecha_apertura: j.fecha_hora_apertura,
            fecha_cierre: new Date().toLocaleString(),
            monto_inicial: c.monto_apertura,
            ingresos_efectivo: c.ingresos_efectivo,
            ingresos_qr: c.ingresos_qr,
            total_tiempo_mesas: totalHorasImporte,
            total_productos: totalVendidoProductos,
            total_caja: totalCajaEfectivo
        };
        gestorImpresion.imprimirTicketJornada(datosJornadaImpresion);
    }

    // Generar PDF y subir al servidor
    if (typeof html2pdf !== 'undefined') {
        setTimeout(() => { // Esperar un poco a que el DOM se asiente
            const elemento = document.getElementById("contenidoReporteFinal");
            
            // Extraer fecha de apertura
            let nombrePdf = "Reporte.pdf";
            if (j.fecha_hora_apertura) {
                let diaStr = j.fecha_hora_apertura.split(" ")[0]; // "YYYY-MM-DD"
                let partesDia = diaStr.split("-");
                if (partesDia.length === 3) {
                    nombrePdf = `Reporte_${partesDia[2]}-${partesDia[1]}-${partesDia[0]}.pdf`;
                } else {
                    nombrePdf = `Reporte_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.pdf`;
                }
            } else {
                nombrePdf = `Reporte_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.pdf`;
            }

            const opt = {
                margin:       10,
                filename:     nombrePdf,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            // Generar Blob
            html2pdf().set(opt).from(elemento).output('blob').then(function (pdfBlob) {
                let formData = new FormData();
                formData.append('pdf_file', pdfBlob, nombrePdf);
                formData.append('filename', nombrePdf);
                
                fetch('../backend/api/reportes_pdf.php?action=save_pdf', {
                    method: 'POST',
                    body: formData
                }).then(res => res.json())
                .then(data => {
                    console.log("[PDF] Guardado en el servidor:", data);
                }).catch(err => {
                    console.error("[PDF] Error al guardar PDF:", err);
                });
            });
        }, 500);
    }
}
// --- FUNCIONALIDAD: CONMUTAR EL "MODO PANTALLA COMPLETA Y COLUMNAS INTELIGENTES" ---

// 1. Inyectamos dinámicamente los estilos para el Grid Responsivo (UX Expert Approach)
if (!document.getElementById("estilosTablaExpandida")) {
    const style = document.createElement("style");
    style.id = "estilosTablaExpandida";
    style.innerHTML = `
        /* Magia CSS Grid: Transforma la tabla en tarjetas responsivas sin tocar el HTML original */
        .modal-expandido-grid table,
        .modal-expandido-grid tbody {
            display: block !important;
            width: 100% !important;
        }
        .modal-expandido-grid thead {
            display: none !important; /* Ocultamos la cabecera clásica al usar modo tarjetas */
        }
        .modal-expandido-grid tbody {
            display: grid !important;
            /* AUTO-ADAPTACIÓN MATEMÁTICA (Portrait, Square, Landscape):
               Detecta el espacio y divide: Móvil=1 col, Tablet=2 cols, PC=3+ cols */
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
            gap: 12px !important;
            padding: 10px !important;
        }
        .modal-expandido-grid tr {
            display: grid !important;
            grid-template-columns: 1fr auto auto !important;
            gap: 10px !important;
            background: #fff !important;
            padding: 7px 8px !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05) !important;
        }
        .modal-expandido-grid td {
            display: flex !important;
            align-items: center !important;
            padding: 0 !important;
            border: none !important;
            text-align: left !important;
        }
        /* Celda 1: Producto */
        .modal-expandido-grid td:nth-child(1) {
            font-weight: 600 !important;
            color: #1e293b !important;
            font-size: 0.9rem !important;
        }
        /* Celda 2: Stock (Con etiqueta dinámica) */
        .modal-expandido-grid td:nth-child(2)::before {
            content: "Stock: " !important;
            font-size: 0.7rem !important;
            color: #64748b !important;
            margin-right: 5px !important;
            font-weight: normal !important;
            text-transform: uppercase !important;
            letter-spacing: 0.05em !important;
        }
        .modal-expandido-grid td:nth-child(2) {
            justify-content: flex-end !important;
            color: #059669 !important;
            font-weight: 700 !important;
            background: #edfdf6 !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
        }
        /* Celda 3: Precio (Con etiqueta dinámica) */
        .modal-expandido-grid td:nth-child(3)::before {
            content: "Precio: " !important;
            font-size: 0.7rem !important;
            color: #64748b !important;
            margin-right: 5px !important;
            font-weight: normal !important;
            text-transform: uppercase !important;
            letter-spacing: 0.05em !important;
        }
        .modal-expandido-grid td:nth-child(3) {
            justify-content: flex-end !important;
            color: #0f172a !important;
            font-weight: 700 !important;
        }
        /* Caso especial: Fila de "Cargando..." o "Sin datos" */
        .modal-expandido-grid td[colspan="3"] {
            grid-column: 1 / -1 !important;
            justify-content: center !important;
            background: transparent !important;
        }
    `;
    document.head.appendChild(style);
}

// 2. Lógica de Expansión con Delegación de Eventos
document.addEventListener("click", (e) => {
    const btnToggle = e.target.closest("#btnToggleExpandirInventario");
    if (!btnToggle) return;

    const modalApertura = document.getElementById("modalReporteApertura");
    if (!modalApertura) return;

    const card = modalApertura.querySelector(".card");
    const modalHeader = card.children[0]; 
    const modalBody = card.children[1];   
    const modalFooter = card.children[2]; 
    const datosGrid = modalBody.children[0]; 

    const iconoBtn = document.getElementById("iconoExpandirInventario");
    const txtBtn = document.getElementById("txtToggleExpandir");
    const tituloSeccion = btnToggle.previousElementSibling; 
    const tablaContainer = btnToggle.parentElement.nextElementSibling; 

    const estaEnModoExpandido = modalApertura.dataset.modoExpandido === "true";

    if (!estaEnModoExpandido) {
        console.log("[UI EXPAND] Modo pantalla completa y columnas inteligentes activado.");

        // Ocultamos periféricos
        modalHeader.style.display = "none";
        datosGrid.style.display = "none";
        modalFooter.style.display = "none";

        // Ajustamos textos
        if (tituloSeccion) {
            tituloSeccion.innerText = "Catálogo de Inventario (Vista Inteligente)";
            tituloSeccion.style.color = "#10b981";
        }
        if (txtBtn) txtBtn.innerText = "Volver";
        if (iconoBtn) iconoBtn.innerText = "arrow_back";
        btnToggle.style.background = "#e2e8f0";

        // Fullscreen físico de la tarjeta
        card.style.width = "100vw";
        card.style.maxWidth = "100vw";
        card.style.height = "100vh";
        card.style.maxHeight = "100vh";
        card.style.borderRadius = "0px";
        modalApertura.style.padding = "0px";

        // Aplicamos la magia CSS Grid Multicolumna
        tablaContainer.classList.add("modal-expandido-grid");
        
        // Espaciado y contraste para que las tarjetas resalten
        tablaContainer.style.maxHeight = "calc(100vh - 60px)";
        tablaContainer.style.background = "#f1f5f9";
        tablaContainer.style.padding = "10px";
        tablaContainer.style.border = "none";

        modalApertura.dataset.modoExpandido = "true";
    } else {
        console.log("[UI EXPAND] Restaurando a tabla clásica.");

        // Restauramos componentes periféricos
        modalHeader.style.display = "flex";
        datosGrid.style.display = "grid";
        modalFooter.style.display = "flex";

        // Restauramos textos
        if (tituloSeccion) {
            tituloSeccion.innerText = "Inventario Inicial";
            tituloSeccion.style.color = "#475569";
        }
        if (txtBtn) txtBtn.innerText = "Expandir";
        if (iconoBtn) iconoBtn.innerText = "fullscreen";
        btnToggle.style.background = "#f1f5f9";

        // Restauramos el modal original
        card.style.width = "90%";
        card.style.maxWidth = "600px";
        card.style.height = "";
        card.style.maxHeight = "";
        card.style.borderRadius = "10px";
        modalApertura.style.padding = "20px 0";

        // Quitamos la clase del Grid Multicolumna (devuelve el formato clásico <table>)
        tablaContainer.classList.remove("modal-expandido-grid");
        
        // Restauramos el scroll compacto
        tablaContainer.style.maxHeight = "200px";
        tablaContainer.style.background = "transparent";
        tablaContainer.style.padding = "0";
        tablaContainer.style.border = "1px solid #e2e8f0";

        modalApertura.dataset.modoExpandido = "false";
    }
});

// ==========================================================================
// MÓDULO: MIS VENTAS DE LA JORNADA
// ==========================================================================

/**
 * Abre el modal "Ventas de la Jornada", consulta el backend y renderiza
 * la tabla maestra + subtablas acordeón.
 */
async function abrirModalMisVentas() {
    const modal = document.getElementById("modalMisVentas");
    const loading = document.getElementById("misVentasLoading");
    const contenido = document.getElementById("misVentasContenido");
    const empty = document.getElementById("misVentasEmpty");
    const tbody = document.getElementById("misVentasTbody");

    // Mostrar modal en estado de carga
    modal.style.display = "flex";
    loading.style.display = "block";
    contenido.style.display = "none";
    tbody.innerHTML = "";

    try {
        const res = await fetch("../backend/api/jornada.php?action=ventas_jornada");
        const data = await res.json();

        loading.style.display = "none";
        contenido.style.display = "block";

        if (data.status !== "success" || !data.ventas || data.ventas.length === 0) {
            empty.style.display = "block";
            const tablaWrapper = contenido.querySelector("div");
            if (tablaWrapper) tablaWrapper.style.display = "none";
            return;
        }

        empty.style.display = "none";
        const tablaWrapper = contenido.querySelector("div");
        if (tablaWrapper) tablaWrapper.style.display = "block";

        renderizarVentasModal(data.ventas, tbody);

    } catch (err) {
        loading.style.display = "none";
        contenido.style.display = "block";
        empty.style.display = "block";
        const tablaWrapper = contenido.querySelector("div");
        if (tablaWrapper) tablaWrapper.style.display = "none";
        window.mostrarToast("Error al cargar las ventas de la jornada.", "error");
    }
}

/**
 * Renderiza las filas de la tabla maestra y las subtablas de detalle.
 */
function renderizarVentasModal(ventas, tbody) {
    tbody.innerHTML = "";

    const badgeModo = (modo) => {
        const cfg = modo === 'barra'
            ? { bg: '#dbeafe', color: '#1d4ed8', icon: 'local_bar',        label: 'Barra' }
            : { bg: '#dcfce7', color: '#15803d', icon: 'table_restaurant', label: 'Mesa'  };
        return `<span style="background:${cfg.bg}; color:${cfg.color}; padding:3px 9px; border-radius:20px; font-size:0.78rem; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                    <i class="material-icons" style="font-size:0.85rem;">${cfg.icon}</i>${cfg.label}
                </span>`;
    };

    const badgePago = (metodo) => {
        const mapa = {
            'efectivo': { bg: '#fef9c3', color: '#854d0e', icon: 'payments',      label: 'Efectivo' },
            'qr':       { bg: '#ede9fe', color: '#6d28d9', icon: 'qr_code_2',     label: 'QR'       },
            'mixto':    { bg: '#fce7f3', color: '#9d174d', icon: 'compare_arrows', label: 'Mixto'    },
        };
        const cfg = mapa[metodo] || { bg: '#f1f5f9', color: '#64748b', icon: 'help', label: metodo };
        return `<span style="background:${cfg.bg}; color:${cfg.color}; padding:3px 9px; border-radius:20px; font-size:0.78rem; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                    <i class="material-icons" style="font-size:0.85rem;">${cfg.icon}</i>${cfg.label}
                </span>`;
    };

    const formatFecha = (dt) => {
        if (!dt) return '—';
        const partes = dt.split(' ');
        if (partes.length < 2) return dt;
        const [y, m, d] = partes[0].split('-');
        return `${d}/${m}/${y} ${partes[1]}`;
    };

    ventas.forEach((venta, index) => {
        const idDetalle = `detalle-venta-${venta.id_venta}`;
        const esImpar = index % 2 === 0;

        // ── Fila maestra ──────────────────────────────────────────────────
        const trMaestra = document.createElement("tr");
        trMaestra.setAttribute("data-venta-id", venta.id_venta);
        trMaestra.style.cssText = `background: ${esImpar ? '#ffffff' : '#f8fafc'}; cursor: pointer; transition: background 0.15s;`;
        trMaestra.innerHTML = `
            <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid #f1f5f9;">
                <i class="material-icons icono-toggle-venta" style="font-size: 1.1rem; color: #6366f1; transition: transform 0.2s;">expand_more</i>
            </td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #1e293b;">
                <span style="background: #ede9fe; color: #6d28d9; padding: 2px 8px; border-radius: 4px; font-size: 0.82rem;">#${venta.id_venta}</span>
            </td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; color: #334155; white-space: nowrap;">${formatFecha(venta.fecha_hora)}</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; text-align: center;">${badgeModo(venta.modo_venta)}</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; text-align: center;">${badgePago(venta.metodo_pago)}</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 700; color: #059669;" id="importe-venta-${venta.id_venta}">${parseFloat(venta.importe).toFixed(2)} Bs</td>
        `;

        // ── Fila acordeón con subtabla ─────────────────────────────────────
        const trDetalle = document.createElement("tr");
        trDetalle.setAttribute("id", idDetalle);
        trDetalle.style.display = "none";
        trDetalle.innerHTML = `
            <td colspan="6" style="padding: 0; background: #f8fafc; border-bottom: 2px solid #6366f1;">
                <div style="padding: 12px 20px 16px 44px;">
                    <div style="overflow-x: auto; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
                            <thead>
                                <tr style="background: linear-gradient(to right, #ede9fe, #ddd6fe);">
                                    <th style="padding: 8px 12px; text-align: left; color: #4c1d95; font-weight: 700; border-bottom: 1px solid #c4b5fd;">Producto</th>
                                    <th style="padding: 8px 12px; text-align: right; color: #4c1d95; font-weight: 700; border-bottom: 1px solid #c4b5fd;">Precio Unitario</th>
                                    <th style="padding: 8px 12px; text-align: center; color: #4c1d95; font-weight: 700; border-bottom: 1px solid #c4b5fd;">Cantidad</th>
                                    <th style="padding: 8px 12px; text-align: right; color: #4c1d95; font-weight: 700; border-bottom: 1px solid #c4b5fd;">Subtotal</th>
                                    <th style="padding: 8px 12px; text-align: center; color: #4c1d95; font-weight: 700; border-bottom: 1px solid #c4b5fd;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="tbody-detalle-${venta.id_venta}">
                                ${renderizarFilasDetalle(venta.detalle, venta.id_venta)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </td>
        `;

        // Toggle acordeón al hacer click en la fila maestra
        trMaestra.addEventListener("click", () => {
            const visible = trDetalle.style.display !== "none";
            trDetalle.style.display = visible ? "none" : "table-row";
            const icono = trMaestra.querySelector(".icono-toggle-venta");
            icono.innerText = visible ? "expand_more" : "expand_less";
        });

        tbody.appendChild(trMaestra);
        tbody.appendChild(trDetalle);
    });
}

/**
 * Genera el HTML de las filas de detalle de una venta.
 */
function renderizarFilasDetalle(detalle, idVenta) {
    if (!detalle || detalle.length === 0) {
        return `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:12px;">Sin productos en esta venta.</td></tr>`;
    }

    const btnStyle = (bg, border, color) =>
        `background:${bg}; border:1px solid ${border}; color:${color}; border-radius:6px; padding:5px 8px; cursor:pointer; display:inline-flex; align-items:center; gap:3px; font-size:0.8rem; font-weight:600; transition:background 0.2s;`;

    return detalle.map(item => {
        const subtotal = (parseFloat(item.precio_unitario_aplicado) * parseInt(item.cantidad)).toFixed(2);
        const nombreEsc = item.nombre_producto.replace(/"/g, '&quot;');
        return `
            <tr id="fila-detalle-${item.id_detalle_prod}" style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 12px; color: #334155; font-weight: 500;">${item.nombre_producto}</td>
                <td style="padding: 8px 12px; text-align: right; color: #475569;">${parseFloat(item.precio_unitario_aplicado).toFixed(2)} Bs</td>
                <td style="padding: 8px 12px; text-align: center; color: #1e293b; font-weight: 600;" id="celda-cantidad-${item.id_detalle_prod}">${item.cantidad}</td>
                <td style="padding: 8px 12px; text-align: right; color: #059669; font-weight: 600;" id="celda-subtotal-${item.id_detalle_prod}">${subtotal} Bs</td>
                <td style="padding: 8px 12px; text-align: center;">
                    <div style="display:flex; gap:6px; justify-content:center;" id="acciones-${item.id_detalle_prod}">
                        <button class="btn-accion-editar"
                            data-id="${item.id_detalle_prod}"
                            data-cantidad="${item.cantidad}"
                            data-precio="${item.precio_unitario_aplicado}"
                            data-id-venta="${idVenta}"
                            data-nombre="${nombreEsc}"
                            title="Editar cantidad"
                            style="${btnStyle('#eff6ff','#bfdbfe','#1d4ed8')}">
                            <i class="material-icons" style="font-size:1rem;">edit</i>
                        </button>
                        <button class="btn-accion-eliminar"
                            data-id="${item.id_detalle_prod}"
                            data-nombre="${nombreEsc}"
                            data-cantidad="${item.cantidad}"
                            data-id-venta="${idVenta}"
                            title="Eliminar producto"
                            style="${btnStyle('#fef2f2','#fecaca','#dc2626')}">
                            <i class="material-icons" style="font-size:1rem;">delete</i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ---------------------------------------------------------------------------
// DELEGACIÓN DE EVENTOS: Editar / Confirmar / Cancelar / Eliminar en el modal
// ---------------------------------------------------------------------------
let _idDetalleParaEliminar = null;
let _idVentaParaEliminar   = null;
let _nombreParaEliminar    = null;
let _cantidadParaEliminar  = null;

document.addEventListener("click", async (e) => {

    // ── BOTÓN EDITAR: convierte celda cantidad en input ────────────────────
    const btnEditar = e.target.closest(".btn-accion-editar");
    if (btnEditar) {
        const idDetalle      = btnEditar.dataset.id;
        const cantidadActual = parseInt(btnEditar.dataset.cantidad);
        const precio         = parseFloat(btnEditar.dataset.precio);
        const idVenta        = btnEditar.dataset.idVenta;

        // Si ya hay input activo, ignorar
        if (document.getElementById(`input-cantidad-${idDetalle}`)) return;

        const celdaCantidad = document.getElementById(`celda-cantidad-${idDetalle}`);
        const accionesDiv   = document.getElementById(`acciones-${idDetalle}`);

        // Transformar celda en input texto (inputmode numeric, sin type=number para evitar e/E)
        celdaCantidad.innerHTML = `
            <input type="text" id="input-cantidad-${idDetalle}" value="${cantidadActual}"
                style="width:70px; padding:4px 8px; border:2px solid #6366f1; border-radius:6px;
                       text-align:center; font-size:0.9rem; font-weight:600; outline:none; color:#1e293b;"
                autocomplete="off" inputmode="numeric">
        `;

        // Seleccionar texto para reemplazo inmediato
        setTimeout(() => {
            const inp = document.getElementById(`input-cantidad-${idDetalle}`);
            if (inp) { inp.select(); inp.focus(); }
        }, 30);

        // Validaciones estrictas: solo enteros positivos
        const inp = document.getElementById(`input-cantidad-${idDetalle}`);
        inp.addEventListener("keydown", (ev) => {
            const bloqueados = ['e','E','+','-','.',',' ,' '];
            if (bloqueados.includes(ev.key)) { ev.preventDefault(); return; }
            const permitidos = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','End'];
            if (!permitidos.includes(ev.key) && !/^\d$/.test(ev.key)) ev.preventDefault();
        });
        inp.addEventListener("input", () => { inp.value = inp.value.replace(/[^0-9]/g, ''); });

        // Cambiar botones a check (confirmar) y x (cancelar)
        const bS = (bg, border, col) =>
            `background:${bg}; border:1px solid ${border}; color:${col}; border-radius:6px; padding:5px 8px; cursor:pointer; display:inline-flex; align-items:center; font-size:0.8rem; font-weight:700; transition:background 0.2s;`;

        accionesDiv.innerHTML = `
            <button class="btn-confirmar-edicion"
                data-id="${idDetalle}" data-precio="${precio}" data-id-venta="${idVenta}"
                title="Confirmar" style="${bS('#f0fdf4','#86efac','#16a34a')}">
                <i class="material-icons" style="font-size:1.1rem;">check</i>
            </button>
            <button class="btn-cancelar-edicion"
                data-id="${idDetalle}" data-cantidad-original="${cantidadActual}" data-precio="${precio}" data-id-venta="${idVenta}"
                title="Cancelar" style="${bS('#fef2f2','#fca5a5','#dc2626')}">
                <i class="material-icons" style="font-size:1.1rem;">close</i>
            </button>
        `;
        return;
    }

    // ── BOTÓN CONFIRMAR EDICIÓN ────────────────────────────────────────────
    const btnConfirmar = e.target.closest(".btn-confirmar-edicion");
    if (btnConfirmar) {
        const idDetalle = btnConfirmar.dataset.id;
        const precio    = parseFloat(btnConfirmar.dataset.precio);
        const idVenta   = btnConfirmar.dataset.idVenta;
        const inp       = document.getElementById(`input-cantidad-${idDetalle}`);
        if (!inp) return;

        const nuevaCantidad = parseInt(inp.value.trim(), 10);
        if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
            window.mostrarToast("Ingresa una cantidad válida (entero positivo).", "error");
            inp.select();
            return;
        }

        btnConfirmar.disabled = true;
        const btnCan = document.querySelector(`.btn-cancelar-edicion[data-id="${idDetalle}"]`);
        if (btnCan) btnCan.disabled = true;

        try {
            const res = await fetch("../backend/api/jornada.php?action=editar_detalle_venta", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_detalle: parseInt(idDetalle), nueva_cantidad: nuevaCantidad })
            });
            const data = await res.json();

            if (data.status === "success") {
                window.mostrarToast("Cantidad actualizada correctamente.", "success");

                // Actualizar celda cantidad
                const celdaCantidad = document.getElementById(`celda-cantidad-${idDetalle}`);
                celdaCantidad.innerHTML = `<strong>${nuevaCantidad}</strong>`;

                // Actualizar celda subtotal
                const celdaSubtotal = document.getElementById(`celda-subtotal-${idDetalle}`);
                celdaSubtotal.innerText = `${(nuevaCantidad * precio).toFixed(2)} Bs`;

                // Actualizar importe en fila maestra
                const importeEl = document.getElementById(`importe-venta-${idVenta}`);
                if (importeEl && data.nuevo_subtotal_prod !== undefined) {
                    importeEl.innerText = `${parseFloat(data.nuevo_subtotal_prod).toFixed(2)} Bs`;
                }

                // Restaurar botones con datos actualizados
                const filaEl = document.getElementById(`fila-detalle-${idDetalle}`);
                const nombreEl = filaEl ? filaEl.querySelector("td:first-child").innerText : '';
                const bS2 = (bg, border, col) =>
                    `background:${bg}; border:1px solid ${border}; color:${col}; border-radius:6px; padding:5px 8px; cursor:pointer; display:inline-flex; align-items:center; gap:3px; font-size:0.8rem; font-weight:600; transition:background 0.2s;`;
                document.getElementById(`acciones-${idDetalle}`).innerHTML = `
                    <button class="btn-accion-editar"
                        data-id="${idDetalle}" data-cantidad="${nuevaCantidad}"
                        data-precio="${precio}" data-id-venta="${idVenta}"
                        data-nombre="${nombreEl.replace(/"/g,'&quot;')}"
                        title="Editar" style="${bS2('#eff6ff','#bfdbfe','#1d4ed8')}">
                        <i class="material-icons" style="font-size:1rem;">edit</i>
                    </button>
                    <button class="btn-accion-eliminar"
                        data-id="${idDetalle}" data-nombre="${nombreEl.replace(/"/g,'&quot;')}"
                        data-cantidad="${nuevaCantidad}" data-id-venta="${idVenta}"
                        title="Eliminar" style="${bS2('#fef2f2','#fecaca','#dc2626')}">
                        <i class="material-icons" style="font-size:1rem;">delete</i>
                    </button>
                `;
            } else {
                window.mostrarToast(data.message || "Error al actualizar.", "error");
                btnConfirmar.disabled = false;
                if (btnCan) btnCan.disabled = false;
            }
        } catch (err) {
            window.mostrarToast("Error de conexión al guardar cambios.", "error");
            btnConfirmar.disabled = false;
            if (btnCan) btnCan.disabled = false;
        }
        return;
    }

    // ── BOTÓN CANCELAR EDICIÓN ─────────────────────────────────────────────
    const btnCancelarEdicion = e.target.closest(".btn-cancelar-edicion");
    if (btnCancelarEdicion) {
        const idDetalle       = btnCancelarEdicion.dataset.id;
        const cantidadOriginal = parseInt(btnCancelarEdicion.dataset.cantidadOriginal);
        const precio          = parseFloat(btnCancelarEdicion.dataset.precio);
        const idVenta         = btnCancelarEdicion.dataset.idVenta;

        document.getElementById(`celda-cantidad-${idDetalle}`).innerHTML = cantidadOriginal;

        const filaEl  = document.getElementById(`fila-detalle-${idDetalle}`);
        const nombreEl = filaEl ? filaEl.querySelector("td:first-child").innerText : '';
        const bS3 = (bg, border, col) =>
            `background:${bg}; border:1px solid ${border}; color:${col}; border-radius:6px; padding:5px 8px; cursor:pointer; display:inline-flex; align-items:center; gap:3px; font-size:0.8rem; font-weight:600; transition:background 0.2s;`;
        document.getElementById(`acciones-${idDetalle}`).innerHTML = `
            <button class="btn-accion-editar"
                data-id="${idDetalle}" data-cantidad="${cantidadOriginal}"
                data-precio="${precio}" data-id-venta="${idVenta}"
                data-nombre="${nombreEl.replace(/"/g,'&quot;')}"
                title="Editar" style="${bS3('#eff6ff','#bfdbfe','#1d4ed8')}">
                <i class="material-icons" style="font-size:1rem;">edit</i>
            </button>
            <button class="btn-accion-eliminar"
                data-id="${idDetalle}" data-nombre="${nombreEl.replace(/"/g,'&quot;')}"
                data-cantidad="${cantidadOriginal}" data-id-venta="${idVenta}"
                title="Eliminar" style="${bS3('#fef2f2','#fecaca','#dc2626')}">
                <i class="material-icons" style="font-size:1rem;">delete</i>
            </button>
        `;
        return;
    }

    // ── BOTÓN ELIMINAR: mostrar modal de confirmación ──────────────────────
    const btnEliminar = e.target.closest(".btn-accion-eliminar");
    if (btnEliminar) {
        _idDetalleParaEliminar = btnEliminar.dataset.id;
        _idVentaParaEliminar   = btnEliminar.dataset.idVenta;
        _nombreParaEliminar    = btnEliminar.dataset.nombre;
        _cantidadParaEliminar  = btnEliminar.dataset.cantidad;

        document.getElementById("textoConfirmarEliminar").innerText =
            `${_cantidadParaEliminar} × ${_nombreParaEliminar}`;
        document.getElementById("modalConfirmarEliminarDetalle").style.display = "flex";
        return;
    }

    // ── CANCELAR MODAL ELIMINAR ────────────────────────────────────────────
    if (e.target.closest("#btnCancelarEliminarDetalle")) {
        document.getElementById("modalConfirmarEliminarDetalle").style.display = "none";
        _idDetalleParaEliminar = null;
        return;
    }

    // ── CONFIRMAR ELIMINAR ─────────────────────────────────────────────────
    if (e.target.closest("#btnConfirmarEliminarDetalle")) {
        if (!_idDetalleParaEliminar) return;

        const btnCE = document.getElementById("btnConfirmarEliminarDetalle");
        btnCE.disabled = true;
        btnCE.innerHTML = `<i class="material-icons" style="font-size:1rem;">hourglass_empty</i> Eliminando...`;

        try {
            const res = await fetch(
                `../backend/api/jornada.php?action=eliminar_detalle_venta&id_detalle=${_idDetalleParaEliminar}`,
                { method: "DELETE" }
            );
            const data = await res.json();

            document.getElementById("modalConfirmarEliminarDetalle").style.display = "none";
            btnCE.disabled = false;
            btnCE.innerHTML = `<i class="material-icons" style="font-size:1rem;">delete_forever</i> Eliminar`;

            if (data.status === "success") {
                window.mostrarToast("Producto eliminado y stock restaurado.", "success");

                // Quitar fila del DOM
                const filaEl = document.getElementById(`fila-detalle-${_idDetalleParaEliminar}`);
                if (filaEl) filaEl.remove();

                // Actualizar importe en fila maestra
                const importeEl = document.getElementById(`importe-venta-${_idVentaParaEliminar}`);
                if (importeEl && data.nuevo_subtotal_prod !== undefined) {
                    importeEl.innerText = `${parseFloat(data.nuevo_subtotal_prod).toFixed(2)} Bs`;
                }

                // Si el tbody quedó vacío, mostrar mensaje
                const tbodyDet = document.getElementById(`tbody-detalle-${_idVentaParaEliminar}`);
                if (tbodyDet && tbodyDet.children.length === 0) {
                    tbodyDet.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:12px;">Sin productos en esta venta.</td></tr>`;
                }
            } else {
                window.mostrarToast(data.message || "Error al eliminar.", "error");
            }
        } catch (err) {
            document.getElementById("modalConfirmarEliminarDetalle").style.display = "none";
            btnCE.disabled = false;
            btnCE.innerHTML = `<i class="material-icons" style="font-size:1rem;">delete_forever</i> Eliminar`;
            window.mostrarToast("Error de conexión al eliminar.", "error");
        }

        _idDetalleParaEliminar = null;
        _idVentaParaEliminar   = null;
        _nombreParaEliminar    = null;
        _cantidadParaEliminar  = null;
        return;
    }

    // ── CERRAR MODAL MIS VENTAS ────────────────────────────────────────────
    if (e.target.closest("#btnCerrarMisVentas") || e.target.closest("#btnCerrarMisVentas2")) {
        document.getElementById("modalMisVentas").style.display = "none";
    }
});