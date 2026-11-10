// Historial de una carga (mercadería o insumos): una tarjeta por cambio con fecha, usuario y acción,
// y debajo la tabla de lo que tenía la carga antes y cómo quedó. Los datos ya vienen armados del backend.
function htmlHistorialCarga(entradas, etiqueta, enteros) {
    const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = (n) => enteros ? String(Math.round(n)) : Number(n).toFixed(2).replace(/\.?0+$/, "");
    const dif = (n) => n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : "0";
    return entradas.map(h => {
        const anulacion = h.accion === "anulacion";
        const lineas = h.lineas || [];
        const cambiadas = lineas.filter(l => l.diferencia !== 0).length;
        const resumen = anulacion
            ? `Se devolvió el stock de ${lineas.length} ${lineas.length === 1 ? etiqueta.toLowerCase() : etiqueta.toLowerCase() + 's'}`
            : `${cambiadas} de ${lineas.length} ${lineas.length === 1 ? 'línea cambió' : 'líneas cambiaron'}`;
        const tabla = lineas.length === 0
            ? `<div class="historial-vacio">${anulacion ? 'Esta anulación es anterior al registro del detalle: no se guardó qué se devolvió.' : 'No se guardó el detalle de este cambio.'}</div>`
            : `<div class="table-responsive"><table class="data-table historial-tabla">
                <colgroup><col class="col-nombre"><col><col><col></colgroup>
                <thead><tr>
                    <th>${etiqueta}</th>
                    <th class="text-right">Antes</th>
                    <th class="text-right">Después</th>
                    <th class="text-right"><span class="historial-largo">Diferencia</span><span class="historial-corto">Dif.</span></th>
                </tr></thead>
                <tbody>${lineas.map(l => {
                    const clase = l.diferencia > 0 ? 'sube' : l.diferencia < 0 ? 'baja' : 'igual';
                    const nota = l.antes === 0 ? ' <span class="historial-nota">agregado</span>' : (l.ahora === 0 && !anulacion ? ' <span class="historial-nota">quitado</span>' : '');
                    return `<tr class="historial-${clase}">
                        <td>${esc(l.nombre)}${nota}</td>
                        <td class="text-right">${num(l.antes)}</td>
                        <td class="text-right">${num(l.ahora)}</td>
                        <td class="text-right historial-dif">${dif(l.diferencia)}</td>
                    </tr>`;
                }).join("")}</tbody>
            </table></div>`;
        return `<article class="historial-item ${anulacion ? 'anulacion' : 'modificacion'}">
            <header class="historial-cabecera">
                <span class="historial-accion"><i class="material-icons">${anulacion ? 'block' : 'edit_note'}</i>${anulacion ? 'Anulación' : 'Modificación'}</span>
                <span class="historial-dato"><i class="material-icons">event</i>${fechaHoraDMA(h.fecha_modificacion)}</span>
                <span class="historial-dato"><i class="material-icons">person</i>${esc(h.usuario)}</span>
                <span class="historial-resumen">${resumen}</span>
            </header>
            ${tabla}
        </article>`;
    }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
            const outlet = document.getElementById("router-outlet");
            const menuToggle = document.getElementById("menuToggle");
            const sidebar = document.getElementById("sidebar");
            const overlay = document.getElementById("sidebarOverlay");
            const navItems = document.querySelectorAll(".nav-item[data-page]");

            function setBtnLoading(btn, isLoading, originalHTML) {
                if (!btn) return "";
                if (isLoading) {
                    const currentHTML = btn.innerHTML;
                    btn.disabled = true;
                    btn.classList.add('btn-loading');
                    btn.innerHTML = `<span class="spinner-loader"></span>` + currentHTML;
                    return currentHTML;
                } else {
                    btn.disabled = false;
                    btn.classList.remove('btn-loading');
                    if (originalHTML) {
                        btn.innerHTML = originalHTML;
                    }
                    return "";
                }
            }

            // --- UI: Bola de billar numerada (CSS puro, ver .bola-billar en app.css) ---
            function bolaBillar(valor) {
                const txt = String(valor ?? "").trim();
                const tam = txt.length >= 4 ? " bola-xl" : (txt.length === 3 ? " bola-lg" : "");
                return `<span class="bola-billar${tam}" title="${txt}"><span>${txt}</span></span>`;
            }

            // --- UI: Ordenamiento de tablas por click en el encabezado ---
            // Primer click en una columna: ascendente. Segundo click: descendente (y así alternando).
            function ordenarLista(lista, estado, tipos) {
                const factor = estado.dir === "desc" ? -1 : 1;
                const esNum = tipos[estado.campo] === "num";
                const valor = (item) => esNum
                    ? (parseFloat(item[estado.campo]) || 0)
                    : String(item[estado.campo] ?? "");
                return [...lista].sort((a, b) => {
                    const va = valor(a), vb = valor(b);
                    const cmp = esNum ? va - vb : va.localeCompare(vb, "es", { numeric: true, sensitivity: "base" });
                    return cmp * factor;
                });
            }

            function marcarOrdenEnEncabezados(thead, estado) {
                thead.querySelectorAll("th[data-sort]").forEach(th => {
                    if (th.dataset.sort === estado.campo) {
                        th.setAttribute("aria-sort", estado.dir === "asc" ? "ascending" : "descending");
                    } else {
                        th.removeAttribute("aria-sort");
                    }
                });
            }

            function activarOrdenEnEncabezados(tbodyId, estado, alCambiar) {
                const tbody = document.getElementById(tbodyId);
                const thead = tbody && tbody.closest("table") ? tbody.closest("table").tHead : null;
                if (!thead) return;
                thead.querySelectorAll("th[data-sort]").forEach(th => {
                    th.addEventListener("click", () => {
                        if (estado.campo === th.dataset.sort) {
                            estado.dir = estado.dir === "asc" ? "desc" : "asc";
                        } else {
                            estado.campo = th.dataset.sort;
                            estado.dir = "asc";
                        }
                        marcarOrdenEnEncabezados(thead, estado);
                        alCambiar();
                    });
                });
                marcarOrdenEnEncabezados(thead, estado);
            }

            // Reaplica el texto del buscador sobre las filas recién dibujadas
            function reaplicarFiltroBusqueda(inputId, tbodyId) {
                const input = document.getElementById(inputId);
                if (!input || !input.value) return;
                const termino = input.value.toLowerCase();
                document.querySelectorAll("#" + tbodyId + " tr").forEach(fila => {
                    fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                });
            }

            // Lista global en memoria para almacenar los usuarios traídos por AJAX (Ayuda a la edición rápida sin re-consultar)
            let listaUsuariosGlobal = [];
            let listaTiposGlobal = [];

            // --- 1. MOSTRAR NOMBRE EN EL SIDEBAR (UX Personalizado) ---
            const txtSidebarName = document.getElementById("sidebarUserName");
            const nombreGuardado = localStorage.getItem("usuario_nombre");
            txtSidebarName.innerText = nombreGuardado ? nombreGuardado : "Usuario Activo";

            // --- 2. MOTOR DE ENRUTAMIENTO (ROUTER-OUTLET) ---
            async function navegarA(nombreArchivo) {
                try {
                    const response = await fetch(`vistas/${nombreArchivo}`);
                    if (!response.ok) throw new Error("No se pudo cargar la vista.");

                    const html = await response.text();
                    outlet.innerHTML = html;
                    if (nombreArchivo === "dashboard.html") {
                        inicializarDashboard();
                    }
                    if (nombreArchivo === "tipos_mesa.html") {
                        inicializarModuloTiposMesa();
                    }
                    if (nombreArchivo === "mesas.html") {
                        inicializarModuloMesas();
                    }
                    if (nombreArchivo === "productos.html") {
                        inicializarModuloProductos();
                    }
                    if (nombreArchivo === "insumos.html") {
                        inicializarModuloInsumos();
                    }
                    if (nombreArchivo === "promociones.html") {
                        inicializarModuloPromociones();
                    }
                    if (nombreArchivo === "combos.html") {
                        inicializarModuloCombos();
                    }
                    if (nombreArchivo === "cargos.html") {
                        inicializarModuloCargos();
                    }
                    if (nombreArchivo === "usuarios.html") {
                        inicializarModuloUsuarios();
                    }
                    if (nombreArchivo === "cargas_mercaderia.html") {
                        inicializarModuloCargaMercaderia();
                    }
                    if (nombreArchivo === "cargas_insumos.html") {
                        inicializarModuloCargaInsumos();
                    }
                    if (nombreArchivo === "reportes.html") {
                        inicializarModuloReportes();
                    }
                    if (nombreArchivo === "ultimos_cierres.html") {
                        inicializarModuloUltimosCierres();
                    }
                    // Vista compartida con el portal de atención: trae su propio script, que innerHTML no ejecuta.
                    if (nombreArchivo === "gastos_productos.html") {
                        outlet.querySelectorAll("script").forEach(viejo => {
                            const nuevo = document.createElement("script");
                            nuevo.textContent = viejo.textContent;
                            viejo.replaceWith(nuevo);
                        });
                    }
                } catch (error) {
                    console.error(error);
                    outlet.innerHTML = `<div class="empty-state"><i class="material-icons">error</i><p>Error al cargar la sección.</p></div>`;
                }
            }

            navItems.forEach(item => {
                item.addEventListener("click", () => {
                    navItems.forEach(btn => btn.classList.remove("active"));
                    item.classList.add("active");
                    navegarA(item.dataset.page);
                    if (window.innerWidth <= 768) toggleMenu();
                });
            });

            // Escritorio (> 768px): colapsa/expande el sidebar para ganar espacio.
            // Móvil/tablet (<= 768px): sidebar deslizable con overlay.
            const SIDEBAR_KEY = "admin_sidebar_collapsed";
            try {
                if (localStorage.getItem(SIDEBAR_KEY) === "1") document.body.classList.add("sidebar-collapsed");
            } catch (e) {}

            function toggleMenu() {
                if (window.innerWidth > 768) {
                    const colapsado = document.body.classList.toggle("sidebar-collapsed");
                    try { localStorage.setItem(SIDEBAR_KEY, colapsado ? "1" : "0"); } catch (e) {}
                    return;
                }
                sidebar.classList.toggle("open");
                overlay.classList.toggle("show");
            }
            menuToggle.addEventListener("click", toggleMenu);
            overlay.addEventListener("click", toggleMenu);

            // --- 3. SISTEMA GLOBAL DE TOASTS ---
            window.mostrarToast = function(mensaje, tipo = "success") {
                const container = document.getElementById("toastContainer");
                const toast = document.createElement("div");
                toast.className = `toast ${tipo}`;

                let icono = { success: "check_circle", error: "cancel", warning: "warning", info: "info" }[tipo] || "info";
                toast.innerHTML = `<i class="material-icons">${icono}</i> <span>${mensaje}</span>`;

                container.appendChild(toast);
                setTimeout(() => toast.classList.add("show"), 10);
                setTimeout(() => {
                    toast.classList.remove("show");
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            };

            function inicializarModuloTiposMesa() {
                consultarTiposAPI();

                // Buscador interactivo
                document.getElementById("buscarTipoMesa").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaTiposMesaBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Nuevo Tipo
                document.getElementById("btnNuevoTipoMesa").addEventListener("click", () => {
                    configurarModalTipoMesa("Crear Tipo de Mesa", false);
                });

                // Eventos en botones dinámicos (Delegación)
                document.getElementById("router-outlet").addEventListener("click", (e) => {
                    if (e.target.closest(".btn-editar-tipo")) {
                        const id = e.target.closest(".btn-editar-tipo").dataset.id;
                        configurarModalTipoMesa("Editar Tarifa", true, id);
                    }
                    if (e.target.closest(".btn-eliminar-tipo")) {
                        const id = e.target.closest(".btn-eliminar-tipo").dataset.id;
                        abrirModalEliminarTipo(id);
                    }
                });

                // Guardar Formulario
                document.getElementById("formTipoMesa").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idTipo = document.getElementById("tipoMesaId").value;
                    const datos = {
                        nombre_tipo: document.getElementById("nombre_tipo").value,
                        precio_hora: document.getElementById("precio_hora").value
                    };

                    let metodoHTTP = idTipo ? "PUT" : "POST";
                    if (idTipo) datos.id_tipo_mesa = idTipo;

                    try {
                        const response = await fetch("../backend/api/tipos_mesa.php", {
                            method: metodoHTTP,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalTipoMesa").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarTiposAPI();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
            }

            // Funciones Auxiliares de Tipos de Mesa
            async function consultarTiposAPI() {
                const tbody = document.getElementById("tablaTiposMesaBody");
                if (!tbody) return;

                try {
                    const response = await fetch("../backend/api/tipos_mesa.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaTiposGlobal = result.data;
                        tbody.innerHTML = "";

                        if (listaTiposGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="4" class="text-center">No hay tipos registrados</td></tr>`;
                            return;
                        }

                        listaTiposGlobal.forEach(t => {
                            // Formateo de dinero UX
                            const precioFormat = parseFloat(t.precio_hora).toFixed(2);
                            tbody.innerHTML += `
                    <tr>
                        <td>${bolaBillar(t.id_tipo_mesa)}</td>
                        <td>${t.nombre_tipo}</td>
                        <td style="color: var(--primary); font-weight: bold;">${precioFormat} Bs.</td>
                        <td>
                            <button class="icon-btn text-primary btn-editar-tipo" data-id="${t.id_tipo_mesa}"><i class="material-icons">edit</i></button>
                            <button class="icon-btn text-danger btn-eliminar-tipo" data-id="${t.id_tipo_mesa}"><i class="material-icons">delete</i></button>
                        </td>
                    </tr>
                `;
                        });
                    }
                } catch (error) {
                    mostrarToast("No se pudieron cargar los datos", "error");
                }
            }

            function configurarModalTipoMesa(titulo, esEdicion, id = null) {
                const form = document.getElementById("formTipoMesa");
                form.reset();
                document.getElementById("tipoMesaId").value = id || "";
                document.getElementById("modalTipoMesaTitulo").innerText = titulo;

                if (esEdicion) {
                    const tipo = listaTiposGlobal.find(t => t.id_tipo_mesa == id);
                    if (tipo) {
                        document.getElementById("nombre_tipo").value = tipo.nombre_tipo;
                        document.getElementById("precio_hora").value = parseFloat(tipo.precio_hora).toFixed(2);
                    }
                }
                document.getElementById("modalTipoMesa").classList.add("show");
            }

            function abrirModalEliminarTipo(id) {
                document.getElementById("modalConfirmacionTipo").classList.add("show");
                document.getElementById("btnConfirmarEliminarTipo").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/tipos_mesa.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_tipo_mesa: id })
                        });
                        const result = await response.json();
                        document.getElementById("modalConfirmacionTipo").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarTiposAPI();
                        } else {
                            mostrarToast(result.message || "Error al eliminar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de conexión", "error");
                    }
                };
            }

            // --- GESTIÓN GLOBAL DE MODALES (Aplica para todas las vistas inyectadas) ---
            document.addEventListener("click", (e) => {
                // 1. Cerrar al presionar cualquier botón con la clase "btn-cerrar-modal" (La 'X' o 'Cancelar')
                if (e.target.closest(".btn-cerrar-modal")) {
                    e.preventDefault(); // Evita comportamientos por defecto como recargar la página
                    document.querySelectorAll(".modal.show").forEach(modal => {
                        modal.classList.remove("show");
                        if (modal.id === "modalMesaDetalles" && window.intervaloDetalleMesaAdmin) {
                            clearInterval(window.intervaloDetalleMesaAdmin);
                            window.intervaloDetalleMesaAdmin = null;
                        }
                    });
                }

                // 2. MEJORA UX: Cerrar el modal si el usuario hace clic afuera de la caja blanca (en el fondo oscuro)
                if (e.target.classList.contains("modal")) {
                    e.target.classList.remove("show");
                    if (e.target.id === "modalMesaDetalles" && window.intervaloDetalleMesaAdmin) {
                        clearInterval(window.intervaloDetalleMesaAdmin);
                        window.intervaloDetalleMesaAdmin = null;
                    }
                }
            });

            // -------------------------------------------------------------------
            // MÓDULO 1.2: GESTIÓN DE MESAS FÍSICAS
            // -------------------------------------------------------------------
            let listaMesasGlobal = [];

            function inicializarModuloMesas() {
                consultarMesasAPI();

                // Buscador interactivo
                document.getElementById("buscarMesa").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaMesasBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Nueva Mesa
                document.getElementById("btnNuevaMesa").addEventListener("click", () => {
                    configurarModalMesa("Registrar Nueva Mesa", false);
                });

                // Delegación de eventos (Editar / Eliminar / Ver Detalles)
                document.getElementById("router-outlet").addEventListener("click", (e) => {
                    if (e.target.closest(".btn-editar-mesa")) {
                        const id = e.target.closest(".btn-editar-mesa").dataset.id;
                        configurarModalMesa("Editar Mesa", true, id);
                    }
                    if (e.target.closest(".btn-eliminar-mesa")) {
                        const id = e.target.closest(".btn-eliminar-mesa").dataset.id;
                        abrirModalEliminarMesa(id);
                    }
                    if (e.target.closest(".btn-ver-detalle-mesa")) {
                        const id = e.target.closest(".btn-ver-detalle-mesa").dataset.id;
                        const nombre = e.target.closest(".btn-ver-detalle-mesa").dataset.nombre;
                        abrirModalDetallesMesa(id, nombre);
                    }
                });

                // Guardar Formulario
                document.getElementById("formMesa").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idMesa = document.getElementById("mesaId").value;
                    const datos = {
                        numero_mesa: document.getElementById("numero_mesa").value,
                        id_tipo_mesa: document.getElementById("id_tipo_mesa").value,
                        estado_actual: document.getElementById("estado_actual").value
                    };

                    let metodoHTTP = idMesa ? "PUT" : "POST";
                    if (idMesa) datos.id_mesa = idMesa;

                    try {
                        const response = await fetch("../backend/api/mesas.php", {
                            method: metodoHTTP,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalMesa").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarMesasAPI();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
            }

            // ---- Funciones Auxiliares Mesas ----

            async function consultarMesasAPI() {
                const tbody = document.getElementById("tablaMesasBody");
                if (!tbody) return;

                try {
                    // Catálogo de mesas + datos de sesión activa (tiempo / consumo) en paralelo
                    const [response, sesiones] = await Promise.all([
                        fetch("../backend/api/mesas.php"),
                        obtenerSesionesActivasMesas()
                    ]);
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaMesasGlobal = result.data;
                        sesionesMesasAdmin = sesiones;
                        tbody.innerHTML = "";

                        if (listaMesasGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="6" class="text-center">No hay mesas físicas registradas</td></tr>`;
                            return;
                        }

                        const etiquetasEstado = { libre: "Libre", ocupada: "Ocupada", mantenimiento: "Mantenimiento" };

                        listaMesasGlobal.forEach((m, idx) => {
                            const estado = etiquetasEstado[m.estado_actual] ? m.estado_actual : "libre";
                            const badgeEstado = `<span class="estado-badge ${estado}">${etiquetasEstado[estado]}</span>`;

                            // Número de la bola: dígitos del identificador (ej. "Billar #3" -> 3) o posición en la lista
                            const numMatch = String(m.numero_mesa).match(/\d+/);
                            const numeroBola = numMatch ? parseInt(numMatch[0], 10) : idx + 1;

                            const botonDetalle = m.estado_actual === 'ocupada'
                                ? `<button class="icon-btn text-info btn-ver-detalle-mesa" data-id="${m.id_mesa}" data-nombre="${m.numero_mesa}" title="Ver detalle"><i class="material-icons">visibility</i></button>`
                                : `<button class="icon-btn is-placeholder" tabindex="-1" aria-hidden="true"><i class="material-icons">visibility</i></button>`;

                            tbody.innerHTML += `
                    <tr>
                        <td>
                            <div class="celda-identificador">
                                ${bolaBillar(numeroBola)}
                                <span class="nombre">${m.numero_mesa}</span>
                            </div>
                        </td>
                        <td class="celda-tipo">
                            <span class="tipo">${m.nombre_tipo}</span>
                            <span class="tarifa">(${parseFloat(m.precio_hora).toFixed(2)} Bs)</span>
                        </td>
                        <td><span class="celda-dato" data-tiempo-mesa="${m.id_mesa}"><i class="material-icons">schedule</i><span class="valor">--:--:--</span></span></td>
                        <td><span class="celda-dato" data-consumo-mesa="${m.id_mesa}"><i class="material-icons">receipt_long</i><span class="valor">0.00 Bs</span></span></td>
                        <td>${badgeEstado}</td>
                        <td class="celda-acciones">
                            ${botonDetalle}
                            <button class="icon-btn text-primary btn-editar-mesa" data-id="${m.id_mesa}" title="Editar"><i class="material-icons">edit</i></button>
                            <button class="icon-btn text-danger btn-eliminar-mesa" data-id="${m.id_mesa}" title="Eliminar"><i class="material-icons">delete</i></button>
                        </td>
                    </tr>
                `;
                        });

                        // Reloj en vivo de "Tiempo Transcurrido"
                        actualizarTiemposMesasAdmin();
                        if (window.intervaloTiemposMesasAdmin) clearInterval(window.intervaloTiemposMesasAdmin);
                        window.intervaloTiemposMesasAdmin = setInterval(actualizarTiemposMesasAdmin, 1000);
                    }
                } catch (error) {
                    mostrarToast("No se pudieron cargar las mesas", "error");
                }
            }

            // ---- Tiempo / consumo en vivo de la tabla de mesas ----
            let sesionesMesasAdmin = {};

            async function obtenerSesionesActivasMesas() {
                const mapa = {};
                try {
                    const resp = await fetch("../backend/api/atencion_barra.php?accion=get_datos_iniciales");
                    const data = await resp.json();
                    if (Array.isArray(data)) {
                        // precio_hora: tarifa efectiva del tipo (ya incluye promociones de tarifa activas)
                        data.forEach(tipo => (tipo.mesas || []).forEach(ms => {
                            mapa[ms.id_mesa] = { ...ms, precio_hora: parseFloat(tipo.precio_hora) || 0 };
                        }));
                    }
                } catch (e) {
                    console.warn("No se pudo obtener el tiempo/consumo de las mesas:", e);
                }
                return mapa;
            }

            function formatearSegundos(total) {
                const h = Math.floor(total / 3600).toString().padStart(2, '0');
                const mi = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
                const s = (total % 60).toString().padStart(2, '0');
                return `${h}:${mi}:${s}`;
            }

            function actualizarTiemposMesasAdmin() {
                const celdas = document.querySelectorAll("[data-tiempo-mesa]");
                if (celdas.length === 0) {
                    // La vista de mesas ya no está en pantalla: detener el reloj
                    clearInterval(window.intervaloTiemposMesasAdmin);
                    window.intervaloTiemposMesasAdmin = null;
                    return;
                }
                const ahora = new Date();

                celdas.forEach(celda => {
                    const id = celda.dataset.tiempoMesa;
                    const info = sesionesMesasAdmin[id];
                    const valor = celda.querySelector(".valor");
                    const icono = celda.querySelector(".material-icons");
                    const celdaConsumo = document.querySelector(`[data-consumo-mesa="${id}"]`);

                    const activa = info && info.fecha_hora_inicio && info.fecha_hora_inicio !== "null";
                    celda.classList.toggle("is-muted", !activa);
                    if (celdaConsumo) celdaConsumo.classList.toggle("is-muted", !activa);

                    if (!activa) {
                        valor.textContent = "00:00:00";
                        icono.textContent = "schedule";
                        celda.classList.remove("is-pausa");
                        if (celdaConsumo) celdaConsumo.querySelector(".valor").textContent = "0.00 Bs";
                        return;
                    }

                    const inicio = new Date(info.fecha_hora_inicio.replace(/-/g, '/'));
                    const pausada = info.hora_pausa && info.hora_pausa !== "null";
                    const fin = pausada ? new Date(info.hora_pausa.replace(/-/g, '/')) : ahora;
                    const segundos = Math.max(0, Math.floor((fin - inicio) / 1000)) + (parseInt(info.segundos_acumulados) || 0);

                    valor.textContent = formatearSegundos(segundos);
                    icono.textContent = pausada ? "pause_circle" : "schedule";
                    celda.classList.toggle("is-pausa", !!pausada);
                    celda.title = pausada ? "Tiempo en pausa" : "";

                    if (celdaConsumo) {
                        celdaConsumo.querySelector(".valor").textContent = `${(parseFloat(info.total_consumo) || 0).toFixed(2)} Bs`;
                    }
                });
            }

            async function cargarSelectTiposMesa() {
                const select = document.getElementById("id_tipo_mesa");
                select.innerHTML = '<option value="">Cargando tipos...</option>';

                try {
                    const response = await fetch("../backend/api/tipos_mesa.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        select.innerHTML = '<option value="">-- Seleccione el Tipo --</option>';
                        result.data.forEach(tipo => {
                            select.innerHTML += `<option value="${tipo.id_tipo_mesa}">${tipo.nombre_tipo} (${tipo.precio_hora} Bs/h)</option>`;
                        });
                    }
                } catch (error) {
                    select.innerHTML = '<option value="">Error al cargar</option>';
                }
            }

            async function configurarModalMesa(titulo, esEdicion, id = null) {
                const form = document.getElementById("formMesa");
                form.reset();
                document.getElementById("mesaId").value = id || "";
                document.getElementById("modalMesaTitulo").innerText = titulo;

                // 1. Cargamos dinámicamente el <select> consultando a la otra API
                await cargarSelectTiposMesa();

                // 2. Si es edición, llenamos los campos con los datos locales
                if (esEdicion) {
                    const mesa = listaMesasGlobal.find(m => m.id_mesa == id);
                    if (mesa) {
                        document.getElementById("numero_mesa").value = mesa.numero_mesa;
                        document.getElementById("id_tipo_mesa").value = mesa.id_tipo_mesa;
                        document.getElementById("estado_actual").value = mesa.estado_actual;
                    }
                } else {
                    // Al crear, forzamos por defecto el estado a Libre
                    document.getElementById("estado_actual").value = "libre";
                }
                document.getElementById("modalMesa").classList.add("show");
            }

            function abrirModalEliminarMesa(id) {
                document.getElementById("modalConfirmacionMesa").classList.add("show");
                document.getElementById("btnConfirmarEliminarMesa").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/mesas.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_mesa: id })
                        });
                        const result = await response.json();
                        document.getElementById("modalConfirmacionMesa").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarMesasAPI();
                        } else {
                            mostrarToast(result.message || "Error al eliminar la mesa", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de conexión", "error");
                    }
                };
            }

            // ---- Helpers compartidos: detalle de sesión de una mesa (modal de Mesas y Dashboard) ----
            const tieneValorSQL = (v) => v !== null && v !== undefined && v !== "" && v !== "null";
            const fechaSQL = (s) => new Date(String(s).replace(/-/g, '/'));
            const horaMinuto = (d) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            const escaparHTML = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

            // Calcula hora de inicio, tiempo visual e importe en vivo de la sesión activa de una mesa.
            // Misma regla de cobro que atención: bloques de 5 minutos sobre la tarifa efectiva.
            function calcularSesionMesa(info, precioHora, ahora = new Date()) {
                const r = {
                    tarifaFija: precioHora === 0,
                    horaInicio: null,
                    segundos: 0,
                    importe: 0,
                    consumo: parseFloat(info.total_consumo) || 0,
                    pausada: tieneValorSQL(info.hora_pausa)
                };
                const acumulado = parseFloat(info.importe_acumulado_tiempo) || 0;

                if (r.tarifaFija) {
                    r.importe = acumulado;
                    r.pausada = false;
                    return r;
                }
                if (!tieneValorSQL(info.fecha_hora_inicio)) return r;

                const inicio = fechaSQL(info.fecha_hora_inicio);
                r.horaInicio = inicio;
                const fin = r.pausada ? fechaSQL(info.hora_pausa) : ahora;
                const difSegundos = Math.floor((fin - inicio) / 1000);
                if (difSegundos >= 0) {
                    const minutosCobrables = Math.ceil(Math.floor(difSegundos / 60) / 5) * 5;
                    r.importe = acumulado + (minutosCobrables * (precioHora / 60));
                    r.segundos = difSegundos + (parseInt(info.segundos_acumulados) || 0);
                }
                return r;
            }

            function filasHistorialTramos(tramos) {
                if (!Array.isArray(tramos) || tramos.length === 0) {
                    return '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Sin historial de tiempo</td></tr>';
                }
                return tramos.map(tramo => {
                    const strInicio = tramo.fecha_hora_inicio ? horaMinuto(fechaSQL(tramo.fecha_hora_inicio)) : '--:--';
                    let strFin;
                    if (tramo.fecha_hora_fin) {
                        strFin = horaMinuto(fechaSQL(tramo.fecha_hora_fin));
                    } else if (tramo.fecha_hora_pausa) {
                        strFin = `<span class="text-warning">Pausa ${horaMinuto(fechaSQL(tramo.fecha_hora_pausa))}</span>`;
                    } else {
                        strFin = '<span class="text-success">En curso</span>';
                    }
                    const importeTramo = parseFloat(tramo.importe_tramo) || 0;
                    return `
                        <tr>
                            <td style="padding: 8px;">${escaparHTML(tramo.numero_mesa)}</td>
                            <td style="padding: 8px;">${strInicio}</td>
                            <td style="padding: 8px;">${strFin}</td>
                            <td style="text-align: right; padding: 8px;">${importeTramo.toFixed(2)}</td>
                        </tr>`;
                }).join("");
            }

            async function obtenerHistorialTramos(idMesa) {
                const resp = await fetch(`../backend/api/atencion_barra.php?accion=get_historial_tramos&id_mesa=${encodeURIComponent(idMesa)}`);
                const res = await resp.json();
                return res.status === 'success' ? res.data : [];
            }

            async function abrirModalDetallesMesa(idMesa, nombreMesa) {
                const modal = document.getElementById("modalMesaDetalles");
                if (!modal) return;

                document.getElementById("modalMesaDetallesTitulo").innerText = `Detalles de Mesa: ${nombreMesa}`;
                document.getElementById("detMesaEstado").innerText = "Cargando...";
                document.getElementById("detMesaEstado").className = "";
                document.getElementById("detMesaHoraInicio").innerText = "--:--";
                document.getElementById("detMesaTiempo").innerText = "--:--:--";
                document.getElementById("detMesaImporte").innerText = "0.00 Bs";
                document.getElementById("detMesaConsumo").innerText = "0.00 Bs";

                const tbodyTramos = document.querySelector('#tablaHistorialTramosAdmin tbody');
                if (tbodyTramos) {
                    tbodyTramos.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Cargando historial...</td></tr>';
                }

                modal.classList.add("show");

                try {
                    // 1. Sesión activa de la mesa (tiempo, consumo y tarifa efectiva)
                    const sesiones = await obtenerSesionesActivasMesas();
                    const mesaData = sesiones[idMesa];

                    if (!mesaData) {
                        mostrarToast("No se encontró información de la sesión activa de la mesa.", "error");
                        modal.classList.remove("show");
                        return;
                    }

                    // 2. Iniciar reloj de tiempo real
                    if (window.intervaloDetalleMesaAdmin) clearInterval(window.intervaloDetalleMesaAdmin);

                    function actualizarRelojLocal() {
                        const s = calcularSesionMesa(mesaData, mesaData.precio_hora);
                        const badgeEstado = document.getElementById("detMesaEstado");

                        document.getElementById("detMesaConsumo").innerText = `${s.consumo.toFixed(2)} Bs`;
                        document.getElementById("detMesaHoraInicio").innerText = s.horaInicio ? horaMinuto(s.horaInicio) : "--:--";
                        document.getElementById("detMesaTiempo").innerText = formatearSegundos(s.segundos);
                        document.getElementById("detMesaImporte").innerText = `${s.importe.toFixed(2)} Bs`;
                        badgeEstado.innerText = s.pausada ? "Pausada" : "Ocupada";
                        badgeEstado.className = s.pausada ? "text-warning" : "text-danger";
                    }

                    actualizarRelojLocal();
                    window.intervaloDetalleMesaAdmin = setInterval(actualizarRelojLocal, 1000);

                    // 3. Consultar historial de tramos de tiempo
                    const tramos = await obtenerHistorialTramos(idMesa);
                    if (tbodyTramos) tbodyTramos.innerHTML = filasHistorialTramos(tramos);

                } catch (error) {
                    console.error("Error al obtener los detalles de la mesa:", error);
                    mostrarToast("Error de comunicación", "error");
                    modal.classList.remove("show");
                }
            }

            // -------------------------------------------------------------------
            // MÓDULO 0: DASHBOARD (turno actual + mesas + KPIs)
            // -------------------------------------------------------------------
            const DASH_REFRESCO_MS = 20000;
            let dash = null;

            function inicializarDashboard() {
                const root = document.getElementById("dashboard");
                if (!root) return;

                dash = {
                    mesas: [],
                    sesiones: {},
                    firmaGrid: "",
                    seleccion: null,
                    tokenTramos: 0,
                    aperturaTurno: null,
                    primeraCarga: true
                };

                root.addEventListener("click", (e) => {
                    if (e.target.closest("[data-dash-cerrar]")) {
                        cerrarDetalleDashboard();
                        return;
                    }
                    const card = e.target.closest(".dash-mesa");
                    if (card) seleccionarMesaDashboard(card.dataset.id);
                });

                if (!window.dashEscapeRegistrado) {
                    document.addEventListener("keydown", (e) => {
                        if (e.key === "Escape" && document.getElementById("dashboard")) cerrarDetalleDashboard();
                    });
                    window.dashEscapeRegistrado = true;
                }

                detenerDashboard();
                refrescarDashboard();
                window.intervaloDashboardReloj = setInterval(tickDashboard, 1000);
                window.intervaloDashboardDatos = setInterval(refrescarDashboard, DASH_REFRESCO_MS);
            }

            function detenerDashboard() {
                clearInterval(window.intervaloDashboardReloj);
                clearInterval(window.intervaloDashboardDatos);
                window.intervaloDashboardReloj = null;
                window.intervaloDashboardDatos = null;
            }

            async function refrescarDashboard() {
                if (!document.getElementById("dashboard")) return detenerDashboard();

                const [turno, mesasRes, sesiones] = await Promise.all([
                    fetch("../backend/api/jornada.php?action=dashboard_admin").then(r => r.json()).catch(() => null),
                    fetch("../backend/api/mesas.php").then(r => r.json()).catch(() => null),
                    obtenerSesionesActivasMesas()
                ]);

                // El usuario pudo navegar a otra vista mientras esperábamos
                if (!document.getElementById("dashboard")) return detenerDashboard();

                pintarTurnoDashboard(turno);

                if (mesasRes && mesasRes.status === "success") {
                    dash.mesas = mesasRes.data.slice().sort((a, b) =>
                        String(a.numero_mesa).localeCompare(String(b.numero_mesa), 'es', { numeric: true }));
                    dash.sesiones = sesiones;
                    pintarMesasDashboard();
                } else if (dash.primeraCarga) {
                    document.getElementById("dashMesasGrid").innerHTML =
                        `<div class="empty-state"><i class="material-icons">error</i><p>No se pudieron cargar las mesas.</p></div>`;
                }

                if (dash.seleccion) {
                    const sigue = dash.mesas.some(m => String(m.id_mesa) === dash.seleccion);
                    if (sigue) pintarDetalleDashboard(false);
                    else cerrarDetalleDashboard();
                }

                dash.primeraCarga = false;
                tickDashboard();
            }

            // ---- Franja del turno + footer ----
            function pintarTurnoDashboard(turno) {
                const cont = document.getElementById("dashTurno");
                const kpi = {
                    horas: document.getElementById("dashKpiHoras"),
                    productos: document.getElementById("dashKpiProductos"),
                    bsMesas: document.getElementById("dashKpiBsMesas"),
                    bsProductos: document.getElementById("dashKpiBsProductos")
                };

                if (!turno || turno.status !== "success") {
                    dash.aperturaTurno = null;
                    const sinConexion = !turno || turno.status === "error";
                    cont.innerHTML = `
                        <span class="dash-turno-pill ${sinConexion ? 'is-error' : 'is-cerrado'}">
                            <i class="material-icons">${sinConexion ? 'cloud_off' : 'lock_clock'}</i>
                            ${sinConexion ? 'Sin conexión con el turno' : 'Sin turno abierto'}
                        </span>
                        <p class="dash-turno-nota">${sinConexion
                            ? 'No se pudo consultar el estado del turno. Se reintentará automáticamente.'
                            : 'No hay una jornada abierta. Los indicadores aparecerán cuando se abra el turno desde el portal de atención.'}</p>`;
                    Object.values(kpi).forEach(el => { el.textContent = "—"; });
                    return;
                }

                const j = turno.jornada;
                const k = turno.kpis;
                dash.aperturaTurno = fechaSQL(j.fecha_hora_apertura);
                const apertura = dash.aperturaTurno;
                const fechaApertura = fechaDMA(apertura);

                cont.innerHTML = `
                    <span class="dash-turno-pill is-abierto"><i class="material-icons">radio_button_checked</i> Turno abierto</span>
                    <div class="dash-turno-dato"><span>Jornada</span><strong>#${j.id_jornada}</strong></div>
                    <div class="dash-turno-dato"><span>Encargado</span><strong>${escaparHTML(j.encargado)}</strong></div>
                    <div class="dash-turno-dato"><span>Apertura</span><strong>${fechaApertura} · ${horaMinuto(apertura)}</strong></div>
                    <div class="dash-turno-dato"><span>Duración</span><strong id="dashTurnoDuracion">--:--:--</strong></div>
                    <div class="dash-turno-dato"><span>Caja inicial</span><strong>${j.monto_inicial_caja.toFixed(2)} Bs</strong></div>`;

                const seg = parseInt(k.segundos_jugados) || 0;
                const h = Math.floor(seg / 3600);
                const m = Math.floor((seg % 3600) / 60);
                kpi.horas.innerHTML = `${h}<small>h</small> ${m.toString().padStart(2, '0')}<small>min</small>`;
                kpi.productos.innerHTML = `${parseInt(k.productos_vendidos) || 0}<small>uds</small>`;
                kpi.bsMesas.innerHTML = `${(parseFloat(k.ingresos_mesas) || 0).toFixed(2)}<small>Bs</small>`;
                // Los otros cargos (roturas, daños) se muestran junto a productos para que todo sume lo cobrado.
                const cargos = parseFloat(k.ingresos_cargos) || 0;
                kpi.bsProductos.innerHTML = `${(parseFloat(k.ingresos_productos) || 0).toFixed(2)}<small>Bs</small>`
                    + (cargos > 0 ? ` <small title="Otros cargos: roturas, daños">+ ${cargos.toFixed(2)} cargos</small>` : '');
            }

            // ---- Grilla de tarjetas ----
            function estadoVisualMesa(mesa) {
                if (mesa.estado_actual === "mantenimiento") return "mantenimiento";
                if (mesa.estado_actual !== "ocupada") return "libre";
                const info = dash.sesiones[mesa.id_mesa];
                return info && tieneValorSQL(info.hora_pausa) && info.precio_hora !== 0 ? "pausada" : "ocupada";
            }

            const ETIQUETAS_ESTADO_DASH = { libre: "Libre", ocupada: "Ocupada", pausada: "Pausada", mantenimiento: "Mantenimiento" };

            const textoTarifa = (precio) => (parseFloat(precio) || 0) > 0 ? `${parseFloat(precio).toFixed(2)} Bs/h` : "Sin cobro por hora";

            function numeroBolaMesa(mesa, idx) {
                const num = String(mesa.numero_mesa).match(/\d+/);
                return num ? parseInt(num[0], 10) : idx + 1;
            }

            function pintarMesasDashboard() {
                const grid = document.getElementById("dashMesasGrid");
                const conteo = { libre: 0, ocupada: 0, pausada: 0, mantenimiento: 0 };
                const estados = dash.mesas.map(m => estadoVisualMesa(m));
                estados.forEach(e => conteo[e]++);

                document.getElementById("dashResumenMesas").innerHTML = `
                    <span class="dash-chip ocupada">${conteo.ocupada + conteo.pausada} ocupadas</span>
                    <span class="dash-chip libre">${conteo.libre} libres</span>
                    ${conteo.mantenimiento ? `<span class="dash-chip mantenimiento">${conteo.mantenimiento} en mantenimiento</span>` : ""}`;

                // Solo se reconstruye el HTML si cambió la estructura (mesas / nombres / estados),
                // así no se pierden el foco ni las transiciones en cada refresco.
                const firma = dash.mesas.map((m, i) => `${m.id_mesa}|${m.numero_mesa}|${m.nombre_tipo}|${m.precio_hora}|${estados[i]}`).join(";");
                if (firma === dash.firmaGrid) return;
                dash.firmaGrid = firma;

                if (dash.mesas.length === 0) {
                    grid.innerHTML = `<div class="empty-state"><i class="material-icons">table_restaurant</i><p>No hay mesas físicas registradas.</p></div>`;
                    return;
                }

                grid.innerHTML = dash.mesas.map((m, idx) => {
                    const estado = estados[idx];
                    const enUso = estado === "ocupada" || estado === "pausada";
                    const seleccionada = dash.seleccion === String(m.id_mesa);
                    const pie = enUso
                        ? `<span class="celda-dato" data-dash-tiempo="${m.id_mesa}"><i class="material-icons">${estado === "pausada" ? "pause_circle" : "schedule"}</i><span class="valor">--:--:--</span></span>
                           <span class="celda-dato" data-dash-consumo="${m.id_mesa}"><i class="material-icons">receipt_long</i><span class="valor">0.00 Bs</span></span>`
                        : `<span class="celda-dato is-muted"><i class="material-icons">${estado === "mantenimiento" ? "build" : "check_circle"}</i>${estado === "mantenimiento" ? "Fuera de servicio" : "Disponible"}</span>`;

                    return `
                        <button type="button" class="dash-mesa is-${estado}${seleccionada ? " is-selected" : ""}" data-id="${m.id_mesa}" aria-pressed="${seleccionada}">
                            <span class="dash-mesa-pano">
                                ${bolaBillar(numeroBolaMesa(m, idx))}
                                <span class="estado-badge ${estado}">${ETIQUETAS_ESTADO_DASH[estado]}</span>
                            </span>
                            <span class="dash-mesa-cuerpo">
                                <span class="dash-mesa-nombre">${escaparHTML(m.numero_mesa)}</span>
                                <span class="dash-mesa-tipo">${escaparHTML(m.nombre_tipo)} · ${textoTarifa(m.precio_hora)}</span>
                                <span class="dash-mesa-pie">${pie}</span>
                            </span>
                        </button>`;
                }).join("");
            }

            // ---- Reloj de 1s: duración del turno, tarjetas y panel ----
            function tickDashboard() {
                if (!document.getElementById("dashboard")) return detenerDashboard();
                const ahora = new Date();

                const dur = document.getElementById("dashTurnoDuracion");
                if (dur && dash.aperturaTurno) {
                    dur.textContent = formatearSegundos(Math.max(0, Math.floor((ahora - dash.aperturaTurno) / 1000)));
                }

                document.querySelectorAll("[data-dash-tiempo]").forEach(celda => {
                    const id = celda.dataset.dashTiempo;
                    const info = dash.sesiones[id];
                    const consumo = document.querySelector(`[data-dash-consumo="${id}"] .valor`);
                    if (!info) {
                        celda.querySelector(".valor").textContent = "--:--:--";
                        return;
                    }
                    const s = calcularSesionMesa(info, info.precio_hora, ahora);
                    celda.querySelector(".valor").textContent = s.tarifaFija ? "Solo consumo" : formatearSegundos(s.segundos);
                    if (consumo) consumo.textContent = `${s.consumo.toFixed(2)} Bs`;
                });

                if (dash.seleccion) pintarRelojDetalle(ahora);
            }

            // ---- Panel de detalle ----
            function seleccionarMesaDashboard(idMesa) {
                const id = String(idMesa);
                const root = document.getElementById("dashboard");
                if (dash.seleccion === id) {
                    cerrarDetalleDashboard();
                    return;
                }
                const yaAbierto = root.classList.contains("con-detalle");
                dash.seleccion = id;

                document.querySelectorAll(".dash-mesa").forEach(c => {
                    const activa = c.dataset.id === id;
                    c.classList.toggle("is-selected", activa);
                    c.setAttribute("aria-pressed", activa);
                });

                pintarDetalleDashboard(true);
                root.classList.add("con-detalle");
                document.getElementById("dashDetalle").setAttribute("aria-hidden", "false");

                // Al cambiar de una mesa a otra con el panel ya abierto, animar el cambio de contenido
                if (yaAbierto) {
                    const inner = document.getElementById("dashDetalleInner");
                    inner.classList.remove("is-cambio");
                    void inner.offsetWidth;
                    inner.classList.add("is-cambio");
                }
            }

            function cerrarDetalleDashboard() {
                const root = document.getElementById("dashboard");
                if (!root || !dash) return;
                dash.seleccion = null;
                dash.tokenTramos++;
                root.classList.remove("con-detalle");
                document.getElementById("dashDetalle").setAttribute("aria-hidden", "true");
                document.querySelectorAll(".dash-mesa.is-selected").forEach(c => {
                    c.classList.remove("is-selected");
                    c.setAttribute("aria-pressed", "false");
                });
            }

            async function pintarDetalleDashboard(esNuevaSeleccion) {
                const idx = dash.mesas.findIndex(m => String(m.id_mesa) === dash.seleccion);
                if (idx < 0) return;
                const mesa = dash.mesas[idx];
                const estado = estadoVisualMesa(mesa);
                const info = dash.sesiones[mesa.id_mesa];
                const enUso = estado === "ocupada" || estado === "pausada";

                document.getElementById("dashDetBola").innerHTML = bolaBillar(numeroBolaMesa(mesa, idx));
                document.getElementById("dashDetNombre").textContent = mesa.numero_mesa;
                const tarifa = info ? info.precio_hora : parseFloat(mesa.precio_hora) || 0;
                document.getElementById("dashDetTipo").textContent = `${mesa.nombre_tipo} · ${textoTarifa(tarifa)}`;

                const badge = document.getElementById("dashDetEstado");
                badge.className = `estado-badge ${estado}`;
                badge.textContent = ETIQUETAS_ESTADO_DASH[estado];

                document.getElementById("dashDetSesion").hidden = !enUso;
                document.getElementById("dashDetVacio").hidden = enUso;

                if (!enUso) {
                    const enMantenimiento = estado === "mantenimiento";
                    document.getElementById("dashDetVacioIcono").textContent = enMantenimiento ? "build" : "event_available";
                    document.getElementById("dashDetVacioTexto").textContent = enMantenimiento
                        ? "Mesa en mantenimiento, fuera de servicio."
                        : "Mesa disponible, sin sesión activa.";
                    return;
                }

                pintarRelojDetalle(new Date());

                const tbody = document.getElementById("dashDetTramos");
                if (esNuevaSeleccion) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Cargando historial...</td></tr>';
                }
                const token = ++dash.tokenTramos;
                try {
                    const tramos = await obtenerHistorialTramos(mesa.id_mesa);
                    if (token !== dash.tokenTramos || !document.getElementById("dashboard")) return;
                    tbody.innerHTML = filasHistorialTramos(tramos);
                } catch (e) {
                    if (token !== dash.tokenTramos) return;
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger" style="padding: 10px;">No se pudo cargar el historial</td></tr>';
                }
            }

            function pintarRelojDetalle(ahora) {
                const info = dash.sesiones[dash.seleccion];
                const sesionVisible = !document.getElementById("dashDetSesion").hidden;
                if (!sesionVisible) return;
                if (!info) {
                    document.getElementById("dashDetHoraInicio").textContent = "--:--";
                    document.getElementById("dashDetTiempo").textContent = "--:--:--";
                    document.getElementById("dashDetImporte").textContent = "0.00 Bs";
                    document.getElementById("dashDetConsumo").textContent = "0.00 Bs";
                    return;
                }
                const s = calcularSesionMesa(info, info.precio_hora, ahora);
                document.getElementById("dashDetHoraInicio").textContent = s.horaInicio ? horaMinuto(s.horaInicio) : "--:--";
                document.getElementById("dashDetTiempo").textContent = formatearSegundos(s.segundos);
                document.getElementById("dashDetImporte").textContent = `${s.importe.toFixed(2)} Bs`;
                document.getElementById("dashDetConsumo").textContent = `${s.consumo.toFixed(2)} Bs`;
            }

            // -------------------------------------------------------------------
            // MÓDULO 1.3: GESTIÓN DE INVENTARIO (PRODUCTOS)
            // -------------------------------------------------------------------
            let listaProductosGlobal = [];

            // Por defecto: orden de registro (id ascendente)
            let ordenProductos = { campo: "id_producto", dir: "asc" };
            const tiposOrdenProductos = { id_producto: "num", nombre_producto: "texto", precio_venta: "num", stock_actual: "num" };

            function inicializarModuloProductos() {
                ordenProductos = { campo: "id_producto", dir: "asc" };
                activarOrdenEnEncabezados("tablaProductosBody", ordenProductos, renderizarProductos);
                consultarProductosAPI();

                // Buscador interactivo
                document.getElementById("buscarProducto").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaProductosBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Nuevo Producto
                document.getElementById("btnNuevoProducto").addEventListener("click", () => {
                    configurarModalProducto("Registrar Nuevo Producto", false);
                });
                document.getElementById("no_vendible_producto").addEventListener("change", sincronizarPropiedadesProducto);
                document.getElementById("receta_producto").addEventListener("change", sincronizarPropiedadesProducto);

                // Delegación de eventos (Editar / Eliminar)
                document.getElementById("router-outlet").addEventListener("click", (e) => {
                    if (e.target.closest(".btn-editar-producto")) {
                        const id = e.target.closest(".btn-editar-producto").dataset.id;
                        configurarModalProducto("Editar Producto", true, id);
                    }
                    if (e.target.closest(".btn-eliminar-producto")) {
                        const id = e.target.closest(".btn-eliminar-producto").dataset.id;
                        abrirModalEliminarProducto(id);
                    }
                });

                // Guardar Formulario
                document.getElementById("formProducto").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idProducto = document.getElementById("productoId").value;
                    const noVendible = document.getElementById("no_vendible_producto").checked;
                    const datos = {
                        nombre_producto: document.getElementById("nombre_producto").value,
                        precio_venta: noVendible ? 0 : document.getElementById("precio_venta").value,
                        tipo: document.getElementById("tipo_producto").value,
                        activo: document.getElementById("activo_producto").value === "1",
                        no_vendible: noVendible,
                        receta: document.getElementById("receta_producto").checked
                    };

                    let metodoHTTP = idProducto ? "PUT" : "POST";
                    if (idProducto) datos.id_producto = idProducto;

                    try {
                        const response = await fetch("../backend/api/productos.php", {
                            method: metodoHTTP,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalProducto").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarProductosAPI();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
            }

            // ---- Funciones Auxiliares Productos ----

            async function consultarProductosAPI() {
                const tbody = document.getElementById("tablaProductosBody");
                if (!tbody) return;

                try {
                    const response = await fetch("../backend/api/productos.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaProductosGlobal = result.data;
                        renderizarProductos();
                    }
                } catch (error) {
                    mostrarToast("No se pudo cargar el inventario", "error");
                }
            }

            function renderizarProductos() {
                const tbody = document.getElementById("tablaProductosBody");
                if (!tbody) return;
                tbody.innerHTML = "";

                if (listaProductosGlobal.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center">No hay productos en el inventario</td></tr>`;
                    return;
                }

                let filasHTML = "";
                ordenarLista(listaProductosGlobal, ordenProductos, tiposOrdenProductos).forEach(p => {
                    // UX: Lógica de colores para el Stock
                    const esPreparado = p.tipo === "preparado";
                    const retirado = String(p.activo) === "0";
                    const noVendible = String(p.no_vendible) === "1";
                    const receta = String(p.receta) === "1";
                    let stockUI = `<b>${p.stock_actual}</b>`;
                    if (esPreparado) {
                        stockUI = `<span style="color:#64748b;">Sin stock</span>`;
                    } else if (parseInt(p.stock_actual) === 0) {
                        stockUI = `<span class="role-badge" style="background: var(--danger);">Agotado</span>`;
                    } else if (parseInt(p.stock_actual) <= 5) {
                        stockUI = `<span style="color: var(--warning); font-weight: bold;">${p.stock_actual} (Bajo)</span>`;
                    }

                    filasHTML += `
            <tr style="${retirado ? 'opacity:0.55;' : ''}">
                <td>${bolaBillar(p.id_producto)}</td>
                <td style="font-weight: 500;">${p.nombre_producto}</td>
                <td style="color: var(--primary); font-weight: bold;">${noVendible ? '<span style="color:#64748b; font-weight:normal;">No vendible</span>' : parseFloat(p.precio_venta).toFixed(2) + ' Bs.'}</td>
                <td>${stockUI}</td>
                <td style="font-size:0.85rem;">${esPreparado ? 'Preparado' : 'Con stock'}${noVendible ? ' · No vendible' : ''}${receta ? ' · Receta' : ''}${retirado ? ' · <b>Retirado</b>' : ''}</td>
                <td>
                    <button class="icon-btn text-primary btn-editar-producto" data-id="${p.id_producto}"><i class="material-icons">edit</i></button>
                    <button class="icon-btn text-danger btn-eliminar-producto" data-id="${p.id_producto}"><i class="material-icons">delete</i></button>
                </td>
            </tr>
        `;
                });
                tbody.innerHTML = filasHTML;
                reaplicarFiltroBusqueda("buscarProducto", "tablaProductosBody");
            }

            function configurarModalProducto(titulo, esEdicion, id = null) {
                const form = document.getElementById("formProducto");
                form.reset();
                document.getElementById("productoId").value = id || "";
                document.getElementById("modalProductoTitulo").innerText = titulo;

                if (esEdicion) {
                    const producto = listaProductosGlobal.find(p => p.id_producto == id);
                    if (producto) {
                        document.getElementById("nombre_producto").value = producto.nombre_producto;
                        document.getElementById("precio_venta").value = parseFloat(producto.precio_venta).toFixed(2);
                        document.getElementById("tipo_producto").value = producto.tipo || "inventario";
                        document.getElementById("activo_producto").value = String(producto.activo) === "0" ? "0" : "1";
                        document.getElementById("no_vendible_producto").checked = String(producto.no_vendible) === "1";
                        document.getElementById("receta_producto").checked = String(producto.receta) === "1";
                    }
                }
                sincronizarPropiedadesProducto();
                document.getElementById("modalProducto").classList.add("show");
            }

            // "No vendible" no lleva precio; "no vendible" y "receta" necesitan stock, así que fijan el tipo "Con stock".
            function sincronizarPropiedadesProducto() {
                const noVendible = document.getElementById("no_vendible_producto").checked;
                const receta = document.getElementById("receta_producto").checked;
                const precio = document.getElementById("precio_venta");
                const tipo = document.getElementById("tipo_producto");
                precio.disabled = noVendible;
                precio.required = !noVendible;
                if (noVendible) precio.value = "";
                precio.placeholder = noVendible ? "No se vende suelto" : "Ej: 18.00";
                if (noVendible || receta) tipo.value = "inventario";
                tipo.disabled = noVendible || receta;
            }

            function abrirModalEliminarProducto(id) {
                document.getElementById("modalConfirmacionProducto").classList.add("show");
                document.getElementById("btnConfirmarEliminarProducto").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/productos.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_producto: id })
                        });
                        const result = await response.json();
                        document.getElementById("modalConfirmacionProducto").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarProductosAPI();
                        } else {
                            mostrarToast(result.message || "Error al eliminar el producto", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de conexión", "error");
                    }
                };
            }

            // -------------------------------------------------------------------
            // MÓDULO 1.4: GESTIÓN DE INSUMOS
            // -------------------------------------------------------------------
            let listaInsumosGlobal = [];

            // Por defecto: orden de registro (id ascendente)
            let ordenInsumos = { campo: "id_insumo", dir: "asc" };
            const tiposOrdenInsumos = { id_insumo: "num", nombre_insumo: "texto", unidad_medida: "texto", stock_actual: "num" };

            function inicializarModuloInsumos() {
                ordenInsumos = { campo: "id_insumo", dir: "asc" };
                activarOrdenEnEncabezados("tablaInsumosBody", ordenInsumos, renderizarInsumos);
                consultarInsumosAPI();

                // Buscador interactivo
                document.getElementById("buscarInsumo").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaInsumosBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Nuevo Insumo
                document.getElementById("btnNuevoInsumo").addEventListener("click", () => {
                    configurarModalInsumo("Registrar Nuevo Insumo", false);
                });

                // Delegación de eventos (Editar / Eliminar)
                document.getElementById("router-outlet").addEventListener("click", (e) => {
                    if (e.target.closest(".btn-editar-insumo")) {
                        const id = e.target.closest(".btn-editar-insumo").dataset.id;
                        configurarModalInsumo("Editar Insumo", true, id);
                    }
                    if (e.target.closest(".btn-eliminar-insumo")) {
                        const id = e.target.closest(".btn-eliminar-insumo").dataset.id;
                        abrirModalEliminarInsumo(id);
                    }
                });

                // Guardar Formulario
                document.getElementById("formInsumo").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idInsumo = document.getElementById("insumoId").value;
                    const datos = {
                        nombre_insumo: document.getElementById("nombre_insumo").value,
                        unidad_medida: document.getElementById("unidad_medida").value
                    };

                    let metodoHTTP = idInsumo ? "PUT" : "POST";
                    if (idInsumo) datos.id_insumo = idInsumo;

                    try {
                        const response = await fetch("../backend/api/insumos.php", {
                            method: metodoHTTP,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalInsumo").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarInsumosAPI();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
            }

            // ---- Funciones Auxiliares Insumos ----

            async function consultarInsumosAPI() {
                const tbody = document.getElementById("tablaInsumosBody");
                if (!tbody) return;

                try {
                    const response = await fetch("../backend/api/insumos.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaInsumosGlobal = result.data;
                        renderizarInsumos();
                    }
                } catch (error) {
                    mostrarToast("No se pudieron cargar los insumos", "error");
                }
            }

            function renderizarInsumos() {
                const tbody = document.getElementById("tablaInsumosBody");
                if (!tbody) return;
                tbody.innerHTML = "";

                if (listaInsumosGlobal.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay insumos registrados</td></tr>`;
                    return;
                }

                let filasHTML = "";
                ordenarLista(listaInsumosGlobal, ordenInsumos, tiposOrdenInsumos).forEach(i => {
                    // Formateo para decimales (si es entero, no muestra .00 por limpieza visual)
                    let stockNum = parseFloat(i.stock_actual);
                    let stockFormateado = stockNum % 1 === 0 ? stockNum : stockNum.toFixed(2);

                    let stockUI = `<b>${stockFormateado}</b>`;
                    if (stockNum <= 0) {
                        stockUI = `<span class="role-badge" style="background: var(--danger);">Agotado</span>`;
                    } else if (stockNum <= 5) {
                        stockUI = `<span style="color: var(--warning); font-weight: bold;">${stockFormateado} (Bajo)</span>`;
                    }

                    filasHTML += `
            <tr>
                <td>${bolaBillar(i.id_insumo)}</td>
                <td style="font-weight: 500;">${i.nombre_insumo}</td>
                <td><span style="background: #e2e8f0; color: #475569; padding: 3px 8px; border-radius: 4px; font-size: 0.85rem;">${i.unidad_medida}</span></td>
                <td>${stockUI}</td>
                <td>
                    <button class="icon-btn text-primary btn-editar-insumo" data-id="${i.id_insumo}"><i class="material-icons">edit</i></button>
                    <button class="icon-btn text-danger btn-eliminar-insumo" data-id="${i.id_insumo}"><i class="material-icons">delete</i></button>
                </td>
            </tr>
        `;
                });
                tbody.innerHTML = filasHTML;
                reaplicarFiltroBusqueda("buscarInsumo", "tablaInsumosBody");
            }

            function configurarModalInsumo(titulo, esEdicion, id = null) {
                const form = document.getElementById("formInsumo");
                form.reset();
                document.getElementById("insumoId").value = id || "";
                document.getElementById("modalInsumoTitulo").innerText = titulo;

                if (esEdicion) {
                    const insumo = listaInsumosGlobal.find(i => i.id_insumo == id);
                    if (insumo) {
                        document.getElementById("nombre_insumo").value = insumo.nombre_insumo;
                        document.getElementById("unidad_medida").value = insumo.unidad_medida;
                    }
                }
                document.getElementById("modalInsumo").classList.add("show");
            }

            function abrirModalEliminarInsumo(id) {
                document.getElementById("modalConfirmacionInsumo").classList.add("show");
                document.getElementById("btnConfirmarEliminarInsumo").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/insumos.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_insumo: id })
                        });
                        const result = await response.json();
                        document.getElementById("modalConfirmacionInsumo").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarInsumosAPI();
                        } else {
                            mostrarToast(result.message || "Error al eliminar el insumo", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de conexión", "error");
                    }
                };
            }

            // -------------------------------------------------------------------
            // MÓDULO 1.5: GESTIÓN DE PROMOCIONES (CONSTRUCTOR VISUAL ASISTENTE)
            // -------------------------------------------------------------------
            let listaPromosGlobal = [];
            let productosAsistente = [];

            // Normaliza "HH:MM:SS" (BD) a "HH:MM" (formato 24 h del formulario)
            function horaCorta(valor) {
                return valor ? String(valor).substring(0, 5) : "";
            }

            // Inputs de hora en formato 24 h (HH:MM) sin depender del idioma del navegador.
            // El carrusel táctil (selector_hora.js) reemplaza al selector nativo, que en muchos celulares es AM/PM.
            function activarInputsHora24() {
                // Fechas dd/mm/aaaa: mismo carrusel táctil (día, mes, año).
                if (typeof SelectorFecha !== "undefined") {
                    document.querySelectorAll("input[data-fecha-dma]").forEach(inp => SelectorFecha.activar(inp));
                }
                document.querySelectorAll(".input-hora24").forEach(inp => {
                    if (typeof SelectorHora !== "undefined") SelectorHora.activar(inp);
                    inp.addEventListener("input", () => {
                        let d = inp.value.replace(/\D/g, "").substring(0, 4);
                        inp.value = d.length > 2 ? d.substring(0, 2) + ":" + d.substring(2) : d;
                    });
                    inp.addEventListener("blur", () => {
                        const d = inp.value.replace(/\D/g, "");
                        if (!d) { inp.value = ""; return; }
                        let h, m;
                        if (d.length <= 2) { h = d; m = "00"; }
                        else if (d.length === 3) { h = "0" + d[0]; m = d.substring(1); }
                        else { h = d.substring(0, 2); m = d.substring(2); }
                        inp.value = h.padStart(2, "0") + ":" + m.padStart(2, "0");
                    });
                });
            }

            // -------------------------------------------------------------------
            // COMBOS: productos compuestos sin stock propio (descuentan el de sus productos)
            // -------------------------------------------------------------------
            function inicializarModuloCombos() {
                const tbody = document.getElementById("tablaCombosBody");
                let combos = [];
                let productos = [];
                const dinero = (v) => parseFloat(v || 0).toFixed(2);

                // Cuántos combos alcanza el stock actual (los preparados no limitan)
                const alcanza = (items) => {
                    const conStock = items.filter(i => i.tipo === "inventario");
                    if (!conStock.length) return "Sin límite";
                    return Math.min(...conStock.map(i => Math.floor(Math.max(0, parseInt(i.stock_actual)) / Math.max(1, parseInt(i.cantidad))))) + " combos";
                };
                const resumen = () => {
                    const filas = Array.from(document.querySelectorAll(".fila-item-combo"));
                    const elegidos = filas.map(f => productos.find(x => String(x.id_producto) === f.querySelector(".item-combo-producto").value));
                    const lista = filas.reduce((t, f, k) => {
                        const p = elegidos[k];
                        return t + (p ? parseFloat(p.precio_venta) * (parseInt(f.querySelector(".item-combo-cantidad").value) || 0) : 0);
                    }, 0);
                    const conNoVendibles = elegidos.some(p => p && String(p.no_vendible) === "1");
                    document.getElementById("resumenCombo").innerText = filas.length
                        ? `Por separado costarían ${dinero(lista)} Bs.${conNoVendibles ? " (sin contar los productos no vendibles)" : ""}` : "";
                };
                const agregarFila = (idProducto = "", cantidad = 1) => {
                    const fila = document.createElement("div");
                    fila.className = "form-grid fila-item-combo";
                    fila.style.cssText = "align-items:end; margin-bottom:6px;";
                    fila.innerHTML = `
                        <div class="input-group">
                            <label>Producto</label>
                            <select class="item-combo-producto">${productos.map(p => `<option value="${p.id_producto}">${escaparHTML(p.nombre_producto)} (${String(p.no_vendible) === "1" ? "no vendible" : dinero(p.precio_venta) + " Bs"}${p.tipo === "preparado" ? ", preparado" : ""})</option>`).join("")}</select>
                        </div>
                        <div class="input-group" style="display:flex; gap:6px; align-items:end;">
                            <div style="flex:1;"><label>Cantidad</label><input type="number" class="item-combo-cantidad" min="1" step="1" value="${cantidad}"></div>
                            <button type="button" class="icon-btn text-danger btn-quitar-item-combo" title="Quitar"><i class="material-icons">delete</i></button>
                        </div>`;
                    if (idProducto) fila.querySelector(".item-combo-producto").value = idProducto;
                    fila.querySelector(".btn-quitar-item-combo").addEventListener("click", () => { fila.remove(); resumen(); });
                    fila.addEventListener("change", resumen);
                    fila.addEventListener("input", resumen);
                    document.getElementById("itemsCombo").appendChild(fila);
                    resumen();
                };
                const cargarProductos = async () => {
                    const result = await (await fetch("../backend/api/productos.php")).json();
                    // Un combo solo lleva productos que se siguen vendiendo
                    productos = (result.status === "success" ? result.data : []).filter(p => String(p.activo) !== "0");
                };
                const abrir = async (combo) => {
                    await cargarProductos();
                    document.getElementById("formCombo").reset();
                    document.getElementById("itemsCombo").innerHTML = "";
                    document.getElementById("modalComboTitulo").innerText = combo ? "Editar Combo" : "Registrar Combo";
                    document.getElementById("comboId").value = combo ? combo.id_combo : "";
                    if (combo) {
                        document.getElementById("nombre_combo").value = combo.nombre;
                        document.getElementById("precio_combo").value = dinero(combo.precio);
                        document.getElementById("activo_combo").value = String(combo.activo) === "0" ? "0" : "1";
                        combo.items.forEach(i => agregarFila(i.id_producto, i.cantidad));
                    } else {
                        agregarFila();
                    }
                    document.getElementById("modalCombo").classList.add("show");
                };
                const consultar = async () => {
                    try {
                        const result = await (await fetch("../backend/api/combos.php")).json();
                        combos = result.status === "success" ? result.data : [];
                    } catch (e) {
                        mostrarToast("No se pudieron cargar los combos", "error");
                        return;
                    }
                    tbody.innerHTML = combos.length ? combos.map(c => `
                        <tr style="${String(c.activo) === "0" ? "opacity:0.55;" : ""}">
                            <td style="font-weight:600;">${escaparHTML(c.nombre)}</td>
                            <td>${c.items.map(i => `${i.cantidad} ${escaparHTML(i.nombre_producto)}`).join(" + ")}</td>
                            <td style="color: var(--primary); font-weight: bold;">${dinero(c.precio)} Bs.</td>
                            <td>${alcanza(c.items)}</td>
                            <td>${String(c.activo) === "0" ? "Retirado" : "Activo"}</td>
                            <td>
                                <button class="icon-btn text-primary btn-editar-combo" data-id="${c.id_combo}" title="Editar"><i class="material-icons">edit</i></button>
                                <button class="icon-btn text-danger btn-eliminar-combo" data-id="${c.id_combo}" title="${c.vendido ? "Retirar" : "Eliminar"}"><i class="material-icons">delete</i></button>
                            </td>
                        </tr>`).join("") : `<tr><td colspan="6" class="text-center">No hay combos registrados</td></tr>`;
                };

                document.getElementById("btnNuevoCombo").addEventListener("click", () => abrir(null));
                document.getElementById("btnAgregarItemCombo").addEventListener("click", () => agregarFila());
                tbody.addEventListener("click", async (e) => {
                    const editarBtn = e.target.closest(".btn-editar-combo");
                    if (editarBtn) abrir(combos.find(c => String(c.id_combo) === editarBtn.dataset.id));
                    const borrarBtn = e.target.closest(".btn-eliminar-combo");
                    if (borrarBtn) {
                        const combo = combos.find(c => String(c.id_combo) === borrarBtn.dataset.id);
                        const pregunta = combo.vendido
                            ? `"${combo.nombre}" tiene ventas: se retirará y ya no aparecerá en caja. ¿Continuar?`
                            : `¿Eliminar el combo "${combo.nombre}"?`;
                        if (!confirm(pregunta)) return;
                        const result = await (await fetch("../backend/api/combos.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_combo: combo.id_combo })
                        })).json();
                        mostrarToast(result.message, result.status === "success" ? "success" : "error");
                        consultar();
                    }
                });
                document.getElementById("formCombo").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const id = document.getElementById("comboId").value;
                    const datos = {
                        nombre: document.getElementById("nombre_combo").value,
                        precio: document.getElementById("precio_combo").value,
                        activo: document.getElementById("activo_combo").value,
                        items: Array.from(document.querySelectorAll(".fila-item-combo")).map(f => ({
                            id_producto: f.querySelector(".item-combo-producto").value,
                            cantidad: f.querySelector(".item-combo-cantidad").value
                        }))
                    };
                    if (id) datos.id_combo = id;
                    try {
                        const response = await fetch("../backend/api/combos.php", {
                            method: id ? "PUT" : "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();
                        if (response.ok && result.status === "success") {
                            document.getElementById("modalCombo").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultar();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
                consultar();
            }

            // -------------------------------------------------------------------
            // CONCEPTOS DE CARGO (rotura de vaso o botella, daños)
            // -------------------------------------------------------------------
            let listaConceptosCargo = [];

            function inicializarModuloCargos() {
                const tbody = document.getElementById("tablaConceptosBody");
                const abrir = (concepto) => {
                    document.getElementById("formConcepto").reset();
                    document.getElementById("modalConceptoTitulo").innerText = concepto ? "Editar Concepto" : "Registrar Concepto";
                    document.getElementById("conceptoId").value = concepto ? concepto.id_concepto : "";
                    if (concepto) {
                        document.getElementById("nombre_concepto").value = concepto.nombre;
                        document.getElementById("monto_concepto").value = parseFloat(concepto.monto_sugerido).toFixed(2);
                        document.getElementById("activo_concepto").value = String(concepto.activo) === "0" ? "0" : "1";
                    }
                    document.getElementById("modalConcepto").classList.add("show");
                };
                const consultar = async () => {
                    try {
                        const result = await (await fetch("../backend/api/conceptos_cargo.php")).json();
                        listaConceptosCargo = result.status === "success" ? result.data : [];
                    } catch (e) {
                        mostrarToast("No se pudieron cargar los conceptos", "error");
                        return;
                    }
                    tbody.innerHTML = listaConceptosCargo.length ? listaConceptosCargo.map(c => `
                        <tr style="${String(c.activo) === "0" ? "opacity:0.55;" : ""}">
                            <td style="font-weight:500;">${escaparHTML(c.nombre)}</td>
                            <td style="color: var(--primary); font-weight: bold;">${parseFloat(c.monto_sugerido).toFixed(2)} Bs.</td>
                            <td>${String(c.activo) === "0" ? "Retirado" : "Activo"}</td>
                            <td><button class="icon-btn text-primary btn-editar-concepto" data-id="${c.id_concepto}"><i class="material-icons">edit</i></button></td>
                        </tr>`).join("") : `<tr><td colspan="4" class="text-center">No hay conceptos registrados</td></tr>`;
                };

                document.getElementById("btnNuevoConcepto").addEventListener("click", () => abrir(null));
                tbody.addEventListener("click", (e) => {
                    const btn = e.target.closest(".btn-editar-concepto");
                    if (btn) abrir(listaConceptosCargo.find(c => String(c.id_concepto) === btn.dataset.id));
                });
                document.getElementById("formConcepto").addEventListener("submit", async (e) => {
                    e.preventDefault();
                    const id = document.getElementById("conceptoId").value;
                    const datos = {
                        nombre: document.getElementById("nombre_concepto").value,
                        monto_sugerido: document.getElementById("monto_concepto").value,
                        activo: document.getElementById("activo_concepto").value === "1"
                    };
                    if (id) datos.id_concepto = id;
                    try {
                        const response = await fetch("../backend/api/conceptos_cargo.php", {
                            method: id ? "PUT" : "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();
                        if (response.ok && result.status === "success") {
                            document.getElementById("modalConcepto").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultar();
                        } else {
                            mostrarToast(result.message || "Error al guardar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
                consultar();
            }

            async function inicializarModuloPromociones() {
                activarInputsHora24();
                consultarPromocionesAPI();

                // Listener de búsqueda interactiva
                document.getElementById("buscarPromocion").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaPromocionesBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Evento del botón Nueva Promoción
                document.getElementById("btnNuevaPromo").addEventListener("click", async() => {
                    await prepararDesplegablesAsistente();
                    configurarModalPromocion("Crear Nueva Promoción", false);
                });

                // --- ENCADENAMIENTO DE SELECTORES (UX CRUCIAL) ---
                // Escucha el cambio del tipo de promoción y altera las secciones visibles
                document.getElementById("tipo_promo").addEventListener("change", (e) => {
                    const tipoSeleccionado = e.target.value;

                    // Ocultamos todos los bloques dinámicos primero
                    document.querySelectorAll(".step-block").forEach(block => block.style.display = "none");

                    // Mostramos únicamente el bloque encadenado correspondiente
                    if (tipoSeleccionado) {
                        const blockActivo = document.getElementById(`block-${tipoSeleccionado}`);
                        if (blockActivo) blockActivo.style.display = "block";
                    }
                });

                // Delegación de clics (Editar / Eliminar)
                document.getElementById("router-outlet").addEventListener("click", async(e) => {
                    if (e.target.closest(".btn-editar-promo")) {
                        const id = e.target.closest(".btn-editar-promo").dataset.id;
                        await prepararDesplegablesAsistente();
                        configurarModalPromocion("Modificar Regla de Promoción", true, id);
                    }
                    if (e.target.closest(".btn-eliminar-promo")) {
                        const id = e.target.closest(".btn-eliminar-promo").dataset.id;
                        abrirModalEliminarPromo(id);
                    }
                });

                // Envío de Formulario unificado (Lee el bloque encadenado activo)
                document.getElementById("formPromocion").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idPromo = document.getElementById("promoId").value;
                    const tipo = document.getElementById("tipo_promo").value;

                    // Las fechas se escriben dd/mm/aaaa y se guardan aaaa-mm-dd.
                    const fechaInicio = isoDesdeDMA(document.getElementById("fecha_inicio").value);
                    const fechaFin = isoDesdeDMA(document.getElementById("fecha_fin").value);
                    if (fechaInicio === null || fechaFin === null) {
                        mostrarToast("Escriba las fechas como dd/mm/aaaa, por ejemplo 25/12/2026.", "warning");
                        return;
                    }
                    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
                        mostrarToast("La fecha de fin no puede ser anterior a la de inicio.", "warning");
                        return;
                    }

                    // Construcción del objeto base común
                    const datos = {
                        nombre_promo: document.getElementById("nombre_promo").value,
                        tipo_promo: tipo,
                        fecha_inicio: fechaInicio,
                        fecha_fin: fechaFin,
                        hora_inicio: document.getElementById("hora_inicio").value,
                        hora_fin: document.getElementById("hora_fin").value,
                        dias_semana: document.getElementById("dias_semana").value
                    };

                    if (idPromo) datos.id_promocion = idPromo;

                    // Mapeo dinámico leyendo el selector que está actualmente visible en pantalla
                    if (tipo === "tarifa_mesa") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_mesa").value;
                        datos.valor_descuento = document.getElementById("valor_descuento_mesa").value;
                    } else if (tipo === "descuento_producto") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_prod").value;
                        datos.valor_descuento = document.getElementById("valor_descuento_prod").value;
                    } else if (tipo === "combo_2x1") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_2x1").value;
                    } else if (tipo === "incentivo_cruzado") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_cruz_prod").value;
                        datos.id_item_secundario = document.getElementById("id_item_condicion_cruz_mesa").value;
                        datos.valor_descuento = document.getElementById("valor_descuento_cruz").value;
                        datos.cantidad_condicion = document.getElementById("cantidad_condicion_cruz").value;
                    } else if (tipo === "incentivo_mesa") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_inc_mesa").value;
                        datos.valor_descuento = document.getElementById("valor_descuento_inc_mesa").value;
                        datos.cantidad_condicion = document.getElementById("cantidad_condicion_inc_mesa").value;
                    } else if (tipo === "incentivo_producto") {
                        datos.id_item_condicion = document.getElementById("id_item_condicion_inc_prod").value;
                        datos.id_item_secundario = document.getElementById("id_item_secundario_inc_prod").value;
                        datos.valor_descuento = document.getElementById("valor_descuento_inc_prod").value;
                        datos.cantidad_condicion = document.getElementById("cantidad_condicion_inc_prod").value;
                    }

                    try {
                        const response = await fetch("../backend/api/promociones.php", {
                            method: idPromo ? "PUT" : "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });
                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalPromocion").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarPromocionesAPI();
                        } else {
                            mostrarToast(result.message || "Error al procesar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de comunicación", "error");
                    }
                });
            }

            // ---- Funciones de Soporte ----

            async function consultarPromocionesAPI() {
                const tbody = document.getElementById("tablaPromocionesBody");
                if (!tbody) return;

                try {
                    const response = await fetch("../backend/api/promociones.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaPromosGlobal = result.data;
                        tbody.innerHTML = "";

                        if (listaPromosGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay promociones activas registradas</td></tr>`;
                            return;
                        }

                        listaPromosGlobal.forEach(p => {
                            // Formateo visual amigable del tipo de promoción (UX)
                            const NOMBRES_TIPO = { tarifa_mesa: 'TARIFA MESA', descuento_producto: 'DESCUENTO PRODUCTO', combo_2x1: 'PRODUCTO 2X1', incentivo_cruzado: 'INCENTIVO CRUZADO', incentivo_mesa: 'INCENTIVO MESA', incentivo_producto: 'INCENTIVO PRODUCTO' };
                            let tipoLabel = NOMBRES_TIPO[p.tipo_promo] || p.tipo_promo.replace('_', ' ').toUpperCase();
                            let vigencia = (p.fecha_inicio && p.fecha_fin) ? `${fechaDMA(p.fecha_inicio)} a ${fechaDMA(p.fecha_fin)}` : 'Vigencia Permanente';
                            let horario = (p.hora_inicio && p.hora_fin) ? `${horaCorta(p.hora_inicio)} - ${horaCorta(p.hora_fin)}` : 'Todo el día';
                            if (p.dias_semana) horario += ` (${p.dias_semana})`;

                            tbody.innerHTML += `
                    <tr>
                        <td><b style="color:var(--primary);">${p.nombre_promo}</b></td>
                        <td><span class="role-badge" style="background:#475569;">${tipoLabel}</span></td>
                        <td style="font-size:0.85rem;">${vigencia}</td>
                        <td style="font-size:0.85rem; color:#475569;">${horario}</td>
                        <td>
                            <button class="icon-btn text-primary btn-editar-promo" data-id="${p.id_promocion}"><i class="material-icons">edit</i></button>
                            <button class="icon-btn text-danger btn-eliminar-promo" data-id="${p.id_promocion}"><i class="material-icons">delete</i></button>
                        </td>
                    </tr>
                `;
                        });
                    }
                } catch (error) {
                    mostrarToast("Error al listar promociones", "error");
                }
            }

            // Alimenta todos los desplegables internos consultando en paralelo los catálogos previos
            async function prepararDesplegablesAsistente() {
                try {
                    // Consultamos productos y tipos de mesas al mismo tiempo
                    const [resMesas, resProds] = await Promise.all([
                        fetch("../backend/api/tipos_mesa.php"),
                        fetch("../backend/api/productos.php")
                    ]);

                    const mData = await resMesas.json();
                    const pData = await resProds.json();

                    // Llenamos selectores de Mesas
                    const selectMesa = document.getElementById("id_item_condicion_mesa");
                    const selectCruzMesa = document.getElementById("id_item_condicion_cruz_mesa");
                    const selectIncMesa = document.getElementById("id_item_condicion_inc_mesa");
                    const selectIncProdMesa = document.getElementById("id_item_secundario_inc_prod");
                    selectMesa.innerHTML = selectCruzMesa.innerHTML = selectIncMesa.innerHTML = selectIncProdMesa.innerHTML = "";
                    // Las promos cruzadas guardadas antes de este campo cuentan el tiempo en cualquier mesa.
                    selectCruzMesa.innerHTML = `<option value="">Cualquier mesa</option>`;

                    mData.data.forEach(m => {
                        let opt = `<option value="${m.id_tipo_mesa}">${m.nombre_tipo} (${m.precio_hora} Bs/h)</option>`;
                        selectMesa.innerHTML += opt;
                        selectCruzMesa.innerHTML += opt;
                        selectIncMesa.innerHTML += opt;
                        selectIncProdMesa.innerHTML += opt;
                    });

                    // Llenamos selectores de Productos
                    const selectProd = document.getElementById("id_item_condicion_prod");
                    const select2x1 = document.getElementById("id_item_condicion_2x1");
                    const selectCruzProd = document.getElementById("id_item_condicion_cruz_prod");
                    const selectIncProd = document.getElementById("id_item_condicion_inc_prod");
                    selectProd.innerHTML = select2x1.innerHTML = selectCruzProd.innerHTML = selectIncProd.innerHTML = "";

                    // Solo productos que se venden: ni los retirados ni los "no vendibles" (solo salen en combos).
                    productosAsistente = pData.data.filter(p => String(p.activo) !== "0" && String(p.no_vendible) !== "1");
                    productosAsistente.forEach(p => {
                        let opt = `<option value="${p.id_producto}">${p.nombre_producto} (${p.precio_venta} Bs)</option>`;
                        selectProd.innerHTML += opt;
                        select2x1.innerHTML += opt;
                        selectCruzProd.innerHTML += opt;
                        selectIncProd.innerHTML += opt;
                    });

                } catch (err) {
                    console.error("Error cargando catálogos para el asistente", err);
                }
            }

            function configurarModalPromocion(titulo, esEdicion, id = null) {
                const form = document.getElementById("formPromocion");
                form.reset();
                document.getElementById("promoId").value = id || "";
                document.getElementById("modalPromocionTitulo").innerText = titulo;

                // Forzamos la ocultación de bloques dinámicos por defecto
                document.querySelectorAll(".step-block").forEach(block => block.style.display = "none");

                if (esEdicion) {
                    const promo = listaPromosGlobal.find(p => p.id_promocion == id);
                    if (promo) {
                        // Llenado de campos comunes
                        document.getElementById("nombre_promo").value = promo.nombre_promo;
                        document.getElementById("tipo_promo").value = promo.tipo_promo;
                        document.getElementById("fecha_inicio").value = promo.fecha_inicio ? fechaDMA(promo.fecha_inicio) : "";
                        document.getElementById("fecha_fin").value = promo.fecha_fin ? fechaDMA(promo.fecha_fin) : "";
                        document.getElementById("hora_inicio").value = horaCorta(promo.hora_inicio);
                        document.getElementById("hora_fin").value = horaCorta(promo.hora_fin);
                        document.getElementById("dias_semana").value = promo.dias_semana || "";

                        // Llenado pre-seleccionado condicional (Re-armando el estado previo)
                        const tipo = promo.tipo_promo;
                        document.getElementById(`block-${tipo}`).style.display = "block"; // Activamos su bloque

                        if (tipo === "tarifa_mesa") {
                            document.getElementById("id_item_condicion_mesa").value = promo.id_item_condicion;
                            document.getElementById("valor_descuento_mesa").value = promo.valor_descuento;
                        } else if (tipo === "descuento_producto") {
                            document.getElementById("id_item_condicion_prod").value = promo.id_item_condicion;
                            document.getElementById("valor_descuento_prod").value = promo.valor_descuento;
                        } else if (tipo === "combo_2x1") {
                            document.getElementById("id_item_condicion_2x1").value = promo.id_item_condicion;
                        } else if (tipo === "incentivo_cruzado") {
                            // Producto beneficiado en id_item_condicion; tipo de mesa requerido en id_item_secundario
                            document.getElementById("id_item_condicion_cruz_prod").value = promo.id_item_condicion;
                            document.getElementById("id_item_condicion_cruz_mesa").value = promo.id_item_secundario || "";
                            document.getElementById("valor_descuento_cruz").value = promo.valor_descuento;
                            document.getElementById("cantidad_condicion_cruz").value = promo.cantidad_condicion;
                        } else if (tipo === "incentivo_mesa") {
                            document.getElementById("id_item_condicion_inc_mesa").value = promo.id_item_condicion;
                            document.getElementById("valor_descuento_inc_mesa").value = promo.valor_descuento;
                            document.getElementById("cantidad_condicion_inc_mesa").value = promo.cantidad_condicion;
                        } else if (tipo === "incentivo_producto") {
                            document.getElementById("id_item_condicion_inc_prod").value = promo.id_item_condicion;
                            document.getElementById("id_item_secundario_inc_prod").value = promo.id_item_secundario;
                            document.getElementById("valor_descuento_inc_prod").value = promo.valor_descuento;
                            document.getElementById("cantidad_condicion_inc_prod").value = promo.cantidad_condicion;
                        }
                    }
                }
                document.getElementById("modalPromocion").classList.add("show");
            }

            function abrirModalEliminarPromo(id) {
                document.getElementById("modalConfirmacionPromo").classList.add("show");
                document.getElementById("btnConfirmarEliminarPromo").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/promociones.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_promocion: id })
                        });
                        const result = await response.json();
                        document.getElementById("modalConfirmacionPromo").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarPromocionesAPI();
                        } else {
                            mostrarToast(result.message || "Error al eliminar", "error");
                        }
                    } catch (err) {
                        mostrarToast("Error de conexión", "error");
                    }
                };
            }

            // --- 4. LÓGICA CONECTADA DEL MÓDULO USUARIOS ---
            function inicializarModuloUsuarios() {
                // Carga inicial y real desde MariaDB
                consultarUsuariosAPI();

                // Buscador interactivo local en tiempo real
                document.getElementById("buscarUsuario").addEventListener("input", (e) => {
                    const termino = e.target.value.toLowerCase();
                    const filas = document.querySelectorAll("#tablaUsuariosBody tr");
                    filas.forEach(fila => {
                        fila.style.display = fila.innerText.toLowerCase().includes(termino) ? "" : "none";
                    });
                });

                // Botón Nuevo Usuario
                document.getElementById("btnNuevoUsuario").addEventListener("click", () => {
                    configurarModalUsuario("Crear Usuario", false);
                });

                // Delegación de eventos (Clicks sobre elementos inyectados)
                outlet.addEventListener("click", (e) => {
                    if (e.target.closest(".btn-cerrar-modal")) {
                        e.preventDefault();
                        document.querySelectorAll(".modal").forEach(m => m.classList.remove("show"));
                    }

                    if (e.target.closest(".btn-editar-user")) {
                        const id = e.target.closest(".btn-editar-user").dataset.id;
                        configurarModalUsuario("Editar Usuario", true, id);
                    }

                    if (e.target.closest(".btn-eliminar-user")) {
                        const id = e.target.closest(".btn-eliminar-user").dataset.id;
                        abrirModalEliminar(id);
                    }
                });

                // Evento Enviar Formulario (Crear o Editar según el ID oculto)
                document.getElementById("formUsuario").addEventListener("submit", async(e) => {
                    e.preventDefault();

                    const idUsuario = document.getElementById("userId").value;
                    const datos = {
                        nombres: document.getElementById("nombres").value,
                        apellidos: document.getElementById("apellidos").value,
                        usuario: document.getElementById("username").value,
                        rol: document.getElementById("rol").value,
                        password: document.getElementById("password").value
                    };

                    let metodoHTTP = "POST"; // Por defecto creación
                    if (idUsuario) {
                        metodoHTTP = "PUT"; // Si hay ID, es actualización
                        datos.id_usuario = idUsuario;
                    }

                    try {
                        const response = await fetch("../backend/api/usuarios.php", {
                            method: metodoHTTP,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(datos)
                        });

                        const result = await response.json();

                        if (response.ok && result.status === "success") {
                            document.getElementById("modalUsuario").classList.remove("show");
                            mostrarToast(result.message, "success");
                            consultarUsuariosAPI(); // Refrescar la tabla automáticamente
                        } else {
                            mostrarToast(result.message || "Error en la operación", "error");
                        }
                    } catch (err) {
                        console.error(err);
                        mostrarToast("Error de comunicación con el servidor", "error");
                    }
                });
            }

            // --- 5. FUNCIONES ASÍNCRONAS FETCH (AJAX) ---
            async function consultarUsuariosAPI() {
                const tbody = document.getElementById("tablaUsuariosBody");
                if (!tbody) return;

                try {
                    const response = await fetch("../backend/api/usuarios.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaUsuariosGlobal = result.data; // Guardamos en caché local para lectura rápida
                        tbody.innerHTML = "";

                        if (listaUsuariosGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay usuarios registrados</td></tr>`;
                            return;
                        }

                        listaUsuariosGlobal.forEach(u => {
                            const badgeColor = { administrador: 'var(--primary)', supervisor: '#7c3aed' }[u.rol] || '#2196f3';
                            tbody.innerHTML += `
                        <tr>
                            <td>${u.nombres}</td>
                            <td>${u.apellidos}</td>
                            <td><b>${u.usuario}</b></td>
                            <td><span class="role-badge" style="background: ${badgeColor}">${u.rol}</span></td>
                            <td>
                                <button class="icon-btn text-primary btn-editar-user" data-id="${u.id_usuario}"><i class="material-icons">edit</i></button>
                                <button class="icon-btn text-danger btn-eliminar-user" data-id="${u.id_usuario}"><i class="material-icons">delete</i></button>
                            </td>
                        </tr>
                    `;
                        });
                    }
                } catch (error) {
                    console.error(error);
                    mostrarToast("No se pudieron cargar los usuarios de la base de datos", "error");
                }
            }

            function configurarModalUsuario(titulo, esEdicion, id = null) {
                const form = document.getElementById("formUsuario");
                form.reset();
                document.getElementById("userId").value = id || "";
                document.getElementById("modalUsuarioTitulo").innerText = titulo;

                const passInput = document.getElementById("password");
                const passHint = document.getElementById("passHint");

                if (esEdicion) {
                    passHint.style.display = "inline";
                    passInput.required = false;

                    // Buscamos los datos en nuestro arreglo en memoria para no saturar al servidor de peticiones redundantes (UX veloz)
                    const usuarioSeleccionado = listaUsuariosGlobal.find(u => u.id_usuario == id);
                    if (usuarioSeleccionado) {
                        document.getElementById("nombres").value = usuarioSeleccionado.nombres;
                        document.getElementById("apellidos").value = usuarioSeleccionado.apellidos;
                        document.getElementById("username").value = usuarioSeleccionado.usuario;
                        document.getElementById("rol").value = usuarioSeleccionado.rol;
                    }
                } else {
                    passHint.style.display = "none";
                    passInput.required = true;
                }
                document.getElementById("modalUsuario").classList.add("show");
            }

            function abrirModalEliminar(id) {
                document.getElementById("modalConfirmacion").classList.add("show");

                document.getElementById("btnConfirmarEliminar").onclick = async function() {
                    try {
                        const response = await fetch("../backend/api/usuarios.php", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id_usuario: id })
                        });

                        const result = await response.json();
                        document.getElementById("modalConfirmacion").classList.remove("show");

                        if (response.ok && result.status === "success") {
                            mostrarToast(result.message, "success");
                            consultarUsuariosAPI(); // Refrescar la tabla
                        } else {
                            mostrarToast(result.message || "No se pudo eliminar al usuario", "error");
                        }
                    } catch (err) {
                        console.error(err);
                        mostrarToast("Error en la petición de borrado", "error");
                    }
                };
            }
            // -------------------------------------------------------------------
            // MÓDULO 6: CARGA DE MERCADERÍA
            // -------------------------------------------------------------------
            function inicializarModuloCargaMercaderia() {
                const modal = document.getElementById('modalNuevaCarga');
                const modalHistorial = document.getElementById('modalHistorial');
                const modalAnular = document.getElementById('modalConfirmacionAnular');
                if (!modal) return;

                let itemsCargaTemporal = [];
                let listaProductosGlobal = []; // Guardará los productos traídos de la BD
                let cargaIdSeleccionada = null;
                // Elementos del DOM
                const btnNuevaCarga = document.getElementById('btnNuevaCarga');
                const tbodyItems = document.getElementById('tbodyItemsCarga');
                const inputProducto = document.getElementById('productoInput');
                const datalistProductos = document.getElementById('listaProductos');
                const inputCantidad = document.getElementById('cantidadInput');
                const btnAgregarItem = document.getElementById('btnAgregarItem');
                const btnLimpiarTodo = document.getElementById('btnLimpiarTodo');
                const btnGuardarCarga = document.getElementById('btnGuardarCarga');
                const inputIdCarga = document.getElementById('idCargaOculto');

                // 1. Cargar productos en el Datalist al iniciar el módulo
                cargarProductosDatalist();
                consultarCargasAPI();
                // Abrir Modal
                if (btnNuevaCarga) {
                    btnNuevaCarga.addEventListener('click', () => {
                        inputIdCarga.value = ""; // Limpiar ID (Modo Creación)
                        limpiarFormularioCarga();
                        modal.classList.add("show");
                    });
                }

                // Cerrar Modal
                document.querySelectorAll('.btn-cerrar-modal').forEach(btn => {
                    btn.addEventListener('click', () => {
                        modal.classList.remove("show");
                        limpiarFormularioCarga();
                    });
                });

                // Agregar ítem a la tabla temporal
                if (btnAgregarItem) {
                    btnAgregarItem.addEventListener('click', () => {
                        const productoNombre = inputProducto.value.trim();
                        const cantidad = parseInt(inputCantidad.value);

                        if (productoNombre === "" || isNaN(cantidad) || cantidad <= 0) {
                            if (typeof mostrarToast !== 'undefined') mostrarToast("Ingrese un producto y cantidad válidos.", "warning");
                            return;
                        }

                        // Validar que el texto ingresado corresponda a un producto real de la BD
                        const productoValido = listaProductosGlobal.find(p => p.nombre_producto === productoNombre);
                        if (!productoValido) {
                            if (typeof mostrarToast !== 'undefined') mostrarToast("El producto seleccionado no está registrado.", "error");
                            return;
                        }

                        const indexExistente = itemsCargaTemporal.findIndex(item => String(item.id_producto) === String(productoValido.id_producto));
                        if (indexExistente > -1) {
                            itemsCargaTemporal[indexExistente].cantidad = Number(itemsCargaTemporal[indexExistente].cantidad) + cantidad;
                        } else {
                            // Guardamos también el id_producto para enviarlo limpio a PHP luego
                            itemsCargaTemporal.push({
                                id_producto: productoValido.id_producto,
                                producto: productoNombre,
                                cantidad: cantidad
                            });
                        }

                        actualizarTablaItemsTemporales();
                        inputProducto.value = '';
                        inputCantidad.value = 1;
                        inputProducto.focus();
                    });
                }

                // Limpiar tabla y formulario
                if (btnLimpiarTodo) {
                    btnLimpiarTodo.addEventListener('click', limpiarFormularioCarga);
                }

                function limpiarFormularioCarga() {
                    itemsCargaTemporal = [];
                    if (inputProducto) inputProducto.value = '';
                    if (inputCantidad) inputCantidad.value = 1;
                    actualizarTablaItemsTemporales();
                }

                // Actualizar renderizado de la tabla temporal
                function actualizarTablaItemsTemporales() {
                    if (!tbodyItems) return;
                    tbodyItems.innerHTML = '';
                    itemsCargaTemporal.forEach((item, index) => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                    <td>${item.producto}</td>
                    <td>${item.cantidad}</td>
                    <td>
                        <button data-index="${index}" class="icon-btn text-danger btn-eliminar-item">
                            <i class="material-icons">delete</i>
                        </button>
                    </td>
                `;
                        tbodyItems.appendChild(tr);
                    });

                    document.querySelectorAll('.btn-eliminar-item').forEach(btn => {
                        btn.addEventListener('click', function() {
                            const idx = parseInt(this.getAttribute('data-index'));
                            itemsCargaTemporal.splice(idx, 1);
                            actualizarTablaItemsTemporales();
                        });
                    });
                }

                // Botón Guardar Carga (Crear o Editar)
                if (btnGuardarCarga) {
                    btnGuardarCarga.addEventListener('click', async() => {
                        if (itemsCargaTemporal.length === 0) {
                            mostrarToast("No hay ítems para guardar", "warning");
                            return;
                        }

                        const originalHTML = setBtnLoading(btnGuardarCarga, true);

                        const payload = {
                            id_carga: inputIdCarga.value, // Si tiene ID, el backend sabrá que es edición
                            tipo_carga: 'producto',
                            items: itemsCargaTemporal
                        };

                        const metodoHTTP = inputIdCarga.value ? "PUT" : "POST";

                        try {
                            const response = await fetch("../backend/api/cargas.php", {
                                method: metodoHTTP,
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload)
                            });
                            const result = await response.json();

                            if (response.ok && result.status === "success") {
                                mostrarToast(result.message, "success");
                                modal.classList.remove("show");
                                consultarCargasAPI();
                            } else {
                                mostrarToast(result.message || "Error al guardar", "error");
                            }
                        } catch (e) {
                            console.error(e);
                            mostrarToast("Error de servidor", "error");
                        } finally {
                            setBtnLoading(btnGuardarCarga, false, originalHTML);
                        }
                    });
                }

                // Eventos Generales en el Outlet (Delegación)
                if (typeof outlet !== 'undefined') {
                    outlet.addEventListener("click", async(e) => {

                        // Cerrar modales
                        if (e.target.closest(".btn-cerrar-modal")) {
                            e.preventDefault();
                            document.querySelectorAll(".modal").forEach(m => m.classList.remove("show"));
                        }

                        // Botón Ojo (Ver Historial)
                        const btnOjo = e.target.closest(".btn-ver-historial");
                        if (btnOjo) {
                            const idCarga = btnOjo.dataset.id;
                            const response = await fetch(`../backend/api/cargas.php?action=historial&id_carga=${idCarga}`);
                            const result = await response.json();

                            if (result.data && result.data.length > 0) {
                                document.getElementById('historialIdCarga').innerText = idCarga;
                                document.getElementById('listaHistorial').innerHTML = htmlHistorialCarga(result.data, 'Producto', true);
                                modalHistorial.classList.add("show");
                            } else {
                                mostrarToast("No se han realizado cambios ni anulaciones en esta carga.", "info");
                            }
                        }

                        // Botón Lápiz (Editar)
                        const btnEditar = e.target.closest(".btn-editar-carga");
                        if (btnEditar) {
                            const idCarga = btnEditar.dataset.id;
                            // Llamar a la API para obtener el detalle de la carga
                            const response = await fetch(`../backend/api/cargas.php?id_carga=${idCarga}`);
                            const result = await response.json();

                            if (result.status === "success") {
                                inputIdCarga.value = idCarga;
                                itemsCargaTemporal = result.data.detalle; // {id_producto, producto, cantidad}
                                actualizarTablaItemsTemporales();
                                modal.classList.add("show");
                            }
                        }

                        // Botón Basurero (Anular)
                        const btnAnular = e.target.closest(".btn-anular-carga");
                        if (btnAnular) {
                            cargaIdSeleccionada = btnAnular.dataset.id;
                            modalAnular.classList.add("show");
                        }
                    });
                }
                // Confirmar Anulación
                if (btnConfirmarAnular) {
                    btnConfirmarAnular.addEventListener('click', async() => {
                        try {
                            const response = await fetch("../backend/api/cargas.php", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id_carga: cargaIdSeleccionada })
                            });
                            const result = await response.json();

                            if (response.ok && result.status === "success") {
                                mostrarToast("Carga anulada correctamente", "success");
                                modalAnular.classList.remove("show");
                                consultarCargasAPI();
                            } else {
                                mostrarToast(result.message || "Error al anular", "error");
                            }
                        } catch (e) { mostrarToast("Error de red", "error"); }
                    });
                }

                async function consultarCargasAPI() {
                    const tbody = document.getElementById('tbodyCargas');
                    if (!tbody) return;
                    try {
                        const response = await fetch("../backend/api/cargas.php");
                        const result = await response.json();
                        if (result.status === "success") {
                            tbody.innerHTML = result.data.map(c => `
                        <tr>
                            <td>${fechaHoraDMA(c.fecha_hora)}</td>
                            <td>${c.total_items} ítems</td>
                            <td><span class="badge ${c.estado === 'activo' ? 'bg-success' : 'bg-danger'}">${c.estado}</span></td>
                            <td>
                                <button class="icon-btn text-info btn-ver-historial" data-id="${c.id_carga}"><i class="material-icons">visibility</i></button>
                                ${c.estado === 'activo' ? `
                                    <button class="icon-btn text-primary btn-editar-carga" data-id="${c.id_carga}"><i class="material-icons">edit</i></button>
                                    <button class="icon-btn text-danger btn-anular-carga" data-id="${c.id_carga}"><i class="material-icons">delete</i></button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join("");
                }
            } catch (e) { console.error(e); }
        }

        // --- FUNCIONES ASÍNCRONAS DEL MÓDULO ---
        async function cargarProductosDatalist() {
            try {
                // Suponiendo un endpoint que lista el inventario actual
                const response = await fetch("../backend/api/productos.php");
                const result = await response.json();

                if (response.ok && result.status === "success") {
                    listaProductosGlobal = result.data;
                    if (datalistProductos) {
                        datalistProductos.innerHTML = '';
                        // Solo se cargan productos con stock que se siguen vendiendo (no preparados ni retirados).
                        listaProductosGlobal.filter(p => p.tipo !== 'preparado' && String(p.activo) !== '0').forEach(prod => {
                            const option = document.createElement('option');
                            option.value = prod.nombre_producto; // Lo que ve y filtra el usuario
                            datalistProductos.appendChild(option);
                        });
                    }
                }
            } catch (error) {
                console.error("Error al cargar productos:", error);
            }
        }
    }
    // -------------------------------------------------------------------
    // MÓDULO 7: CARGA DE INSUMOS
    // -------------------------------------------------------------------
    function inicializarModuloCargaInsumos() {
        const modal = document.getElementById('modalNuevaCargaInsumo');
        const modalHistorial = document.getElementById('modalHistorialInsumo');
        const modalAnular = document.getElementById('modalConfirmacionAnularInsumo');
        if (!modal) return;

        let itemsCargaTemporal = [];
        let listaInsumosGlobal = [];
        let cargaIdSeleccionada = null;

        const btnNuevaCarga = document.getElementById('btnNuevaCargaInsumo');
        const tbodyItems = document.getElementById('tbodyItemsCargaInsumo');
        const inputInsumo = document.getElementById('insumoInput');
        const datalistInsumos = document.getElementById('listaInsumos');
        const inputCantidad = document.getElementById('cantidadInsumoInput');
        const btnAgregarItem = document.getElementById('btnAgregarItemInsumo');
        const btnLimpiarTodo = document.getElementById('btnLimpiarTodoInsumo');
        const btnGuardarCarga = document.getElementById('btnGuardarCargaInsumo');
        const inputIdCarga = document.getElementById('idCargaInsumoOculto');
        const btnConfirmarAnular = document.getElementById('btnConfirmarAnularInsumo');

        cargarInsumosDatalist();
        consultarCargasInsumosAPI();

        if (btnNuevaCarga) {
            btnNuevaCarga.addEventListener('click', () => {
                inputIdCarga.value = ""; 
                limpiarFormularioCarga();
                modal.classList.add("show");
            });
        }

        if (btnAgregarItem) {
            btnAgregarItem.addEventListener('click', () => {
                const insumoNombre = inputInsumo.value.trim();
                const cantidad = parseFloat(inputCantidad.value); // Insumos pueden usar decimales

                if (insumoNombre === "" || isNaN(cantidad) || cantidad <= 0) {
                    if (typeof mostrarToast !== 'undefined') mostrarToast("Ingrese un insumo y cantidad válidos.", "warning");
                    return;
                }

                const insumoValido = listaInsumosGlobal.find(i => i.nombre_insumo === insumoNombre);
                if (!insumoValido) {
                    if (typeof mostrarToast !== 'undefined') mostrarToast("El insumo seleccionado no está registrado.", "error");
                    return;
                }

                const indexExistente = itemsCargaTemporal.findIndex(item => String(item.id_insumo) === String(insumoValido.id_insumo));
                if (indexExistente > -1) {
                    itemsCargaTemporal[indexExistente].cantidad = Math.round((Number(itemsCargaTemporal[indexExistente].cantidad) + cantidad) * 100) / 100;
                } else {
                    itemsCargaTemporal.push({
                        id_insumo: insumoValido.id_insumo,
                        insumo: insumoNombre,
                        cantidad: cantidad
                    });
                }

                actualizarTablaItemsTemporales();
                inputInsumo.value = '';
                inputCantidad.value = 1;
                inputInsumo.focus();
            });
        }

        if (btnLimpiarTodo) {
            btnLimpiarTodo.addEventListener('click', limpiarFormularioCarga);
        }

        function limpiarFormularioCarga() {
            itemsCargaTemporal = [];
            if (inputInsumo) inputInsumo.value = '';
            if (inputCantidad) inputCantidad.value = 1;
            actualizarTablaItemsTemporales();
        }

        function actualizarTablaItemsTemporales() {
            if (!tbodyItems) return;
            tbodyItems.innerHTML = '';
            itemsCargaTemporal.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.insumo}</td>
                    <td style="text-align: center;">${item.cantidad}</td>
                    <td style="text-align: center;">
                        <button data-index="${index}" class="icon-btn text-danger btn-eliminar-item-insumo">
                            <i class="material-icons">delete</i>
                        </button>
                    </td>
                `;
                tbodyItems.appendChild(tr);
            });

            document.querySelectorAll('.btn-eliminar-item-insumo').forEach(btn => {
                btn.addEventListener('click', function() {
                    const idx = parseInt(this.getAttribute('data-index'));
                    itemsCargaTemporal.splice(idx, 1);
                    actualizarTablaItemsTemporales();
                });
            });
        }

        if (btnGuardarCarga) {
            btnGuardarCarga.addEventListener('click', async() => {
                if (itemsCargaTemporal.length === 0) {
                    mostrarToast("No hay ítems para guardar", "warning");
                    return;
                }

                const originalHTML = setBtnLoading(btnGuardarCarga, true);

                const payload = {
                    id_carga: inputIdCarga.value,
                    tipo_carga: 'insumo',
                    items: itemsCargaTemporal
                };

                const metodoHTTP = inputIdCarga.value ? "PUT" : "POST";

                try {
                    const response = await fetch("../backend/api/cargas_insumos.php", {
                        method: metodoHTTP,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        mostrarToast(result.message, "success");
                        modal.classList.remove("show");
                        consultarCargasInsumosAPI();
                    } else {
                        mostrarToast(result.message || "Error al guardar", "error");
                    }
                } catch (e) { 
                    mostrarToast("Error de servidor", "error"); 
                } finally {
                    setBtnLoading(btnGuardarCarga, false, originalHTML);
                }
            });
        }

        if (typeof outlet !== 'undefined') {
            // Usamos un event listener específico para no cruzar con Mercadería
            outlet.addEventListener("click", async(e) => {
                // Historial
                const btnOjo = e.target.closest(".btn-ver-historial-insumo");
                if (btnOjo) {
                    const idCarga = btnOjo.dataset.id;
                    const response = await fetch(`../backend/api/cargas_insumos.php?action=historial&id_carga=${idCarga}`);
                    const result = await response.json();

                    if (result.data && result.data.length > 0) {
                        document.getElementById('historialIdCargaInsumo').innerText = idCarga;
                        document.getElementById('listaHistorialInsumo').innerHTML = htmlHistorialCarga(result.data, 'Insumo', false);
                        modalHistorial.classList.add("show");
                    } else {
                        mostrarToast("No hay historial para esta carga.", "info");
                    }
                }

                // Editar
                const btnEditar = e.target.closest(".btn-editar-carga-insumo");
                if (btnEditar) {
                    const idCarga = btnEditar.dataset.id;
                    const response = await fetch(`../backend/api/cargas_insumos.php?id_carga=${idCarga}`);
                    const result = await response.json();

                    if (result.status === "success") {
                        inputIdCarga.value = idCarga;
                        itemsCargaTemporal = result.data.detalle; 
                        actualizarTablaItemsTemporales();
                        modal.classList.add("show");
                    }
                }

                // Anular
                const btnAnular = e.target.closest(".btn-anular-carga-insumo");
                if (btnAnular) {
                    cargaIdSeleccionada = btnAnular.dataset.id;
                    modalAnular.classList.add("show");
                }
            });
        }

        if (btnConfirmarAnular) {
            btnConfirmarAnular.addEventListener('click', async() => {
                try {
                    const response = await fetch("../backend/api/cargas_insumos.php", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id_carga: cargaIdSeleccionada })
                    });
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        mostrarToast("Carga anulada", "success");
                        modalAnular.classList.remove("show");
                        consultarCargasInsumosAPI();
                    } else {
                        mostrarToast(result.message || "Error al anular", "error");
                    }
                } catch (e) { mostrarToast("Error de red", "error"); }
            });
        }

        async function consultarCargasInsumosAPI() {
            const tbody = document.getElementById('tbodyCargasInsumos');
            if (!tbody) return;
            try {
                const response = await fetch("../backend/api/cargas_insumos.php");
                const result = await response.json();
                if (result.status === "success") {
                    tbody.innerHTML = result.data.map(c => `
                        <tr>
                            <td>${fechaHoraDMA(c.fecha_hora)}</td>
                            <td>${c.total_items} ítems</td>
                            <td><span class="badge ${c.estado === 'activo' ? 'bg-success' : 'bg-danger'}">${c.estado}</span></td>
                            <td>
                                <button class="icon-btn text-info btn-ver-historial-insumo" data-id="${c.id_carga}"><i class="material-icons">visibility</i></button>
                                ${c.estado === 'activo' ? `
                                    <button class="icon-btn text-primary btn-editar-carga-insumo" data-id="${c.id_carga}"><i class="material-icons">edit</i></button>
                                    <button class="icon-btn text-danger btn-anular-carga-insumo" data-id="${c.id_carga}"><i class="material-icons">delete</i></button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join("");
                }
            } catch (e) { console.error(e); }
        }

        async function cargarInsumosDatalist() {
            try {
                const response = await fetch("../backend/api/insumos.php"); // Asegúrate de tener este endpoint
                const result = await response.json();

                if (response.ok && result.status === "success") {
                    listaInsumosGlobal = result.data;
                    if (datalistInsumos) {
                        datalistInsumos.innerHTML = '';
                        listaInsumosGlobal.forEach(ins => {
                            const option = document.createElement('option');
                            option.value = ins.nombre_insumo; 
                            datalistInsumos.appendChild(option);
                        });
                    }
                }
            } catch (error) { console.error("Error cargando insumos:", error); }
        }
    }
    // -------------------------------------------------------------------
    // MÓDULO 8: REPORTES
    // -------------------------------------------------------------------
    function inicializarModuloReportes() {
        const modalForm = document.getElementById('modalFormReporte');
        const modalVisor = document.getElementById('modalVisorReporte');
        const bodyForm = document.getElementById('bodyFormReporte');
        const tituloForm = document.getElementById('tituloFormReporte');
        let reporteActivo = '';

        // Período elegido en semana/mes: fecha de inicio (lunes o día 1)
        let inicioPeriodo = null;
        const dos = (n) => String(n).padStart(2, '0');
        const isoLocal = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
        const lunesDe = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
        const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

        // Cada tarjeta abre su formulario (las tarjetas se crean de nuevo cada vez que se entra a la vista).
        document.querySelectorAll('.btn-reporte-card').forEach(card => {
            card.addEventListener('mouseenter', () => card.style.transform = 'translateY(-4px)');
            card.addEventListener('mouseleave', () => card.style.transform = 'translateY(0)');
            card.addEventListener('click', () => {
                reporteActivo = card.dataset.reporte;
                if (reporteActivo === 'ultimos_cierres') {
                    abrirModalListadoCierres();
                    return;
                }
                prepararFiltros(reporteActivo);
                modalForm.classList.add('show');
            });
        });

        // Campos del formulario según el reporte elegido
        function prepararFiltros(tipo) {
            bodyForm.innerHTML = '';
            if (tipo === 'jornada') {
                tituloForm.innerText = 'Reporte de Jornada';
                bodyForm.innerHTML = `
                    <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                        <div class="input-group">
                            <label>Día</label>
                            <select id="cmbDia" class="form-control"></select>
                        </div>
                        <div class="input-group">
                            <label>Mes</label>
                            <select id="cmbMes" class="form-control"></select>
                        </div>
                        <div class="input-group">
                            <label>Año</label>
                            <select id="cmbAnio" class="form-control"></select>
                        </div>
                    </div>

                    <div class="input-group" id="divComboJornadas" style="display: none; margin-top: 10px;">
                        <label class="text-danger">Seleccione la jornada (Múltiples aperturas detectadas)</label>
                        <select id="cmbJornadaId" class="form-control"></select>
                    </div>

                    <div class="filtros-reporte" style="margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                        <h4 style="margin-bottom: 10px; font-size: 14px;">Filtros a incluir:</h4>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkAperturaCierre"> Información de apertura y cierre</label>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkMesas" checked> Horas de uso de mesas (> $0)</label>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkProductos" checked> Venta de productos</label>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkEgresos"> Egresos</label>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkInsumos"> Gasto de insumos</label>
                        <label style="display:block; margin-bottom: 5px;"><input type="checkbox" id="chkGastosProductos"> Gasto de productos</label>
                    </div>
                `;
                inicializarCombosFecha();
            } else if (tipo === 'ingresos_semana') {
                tituloForm.innerText = 'Ingresos por Semana';
                bodyForm.innerHTML = `
                    <div class="periodo-nav">
                        <button type="button" class="icon-btn" id="btnPeriodoAnterior" title="Semana anterior"><i class="material-icons">chevron_left</i></button>
                        <div class="periodo-texto"><strong id="lblPeriodo"></strong><small id="lblPeriodoNota"></small></div>
                        <button type="button" class="icon-btn" id="btnPeriodoSiguiente" title="Semana siguiente"><i class="material-icons">chevron_right</i></button>
                    </div>
                    <div class="input-group" style="margin-top: 14px;">
                        <label for="filtroDiaSemana">O elija cualquier día de la semana</label>
                        <input type="text" id="filtroDiaSemana" class="form-control" data-fecha-dma placeholder="dd/mm/aaaa" inputmode="numeric" autocomplete="off">
                    </div>
                    <p class="periodo-ayuda">La semana va de lunes a domingo. Cada jornada cuenta en el día en que abrió.</p>
                `;
                inicioPeriodo = lunesDe(new Date());
                const campo = document.getElementById('filtroDiaSemana');
                if (typeof SelectorFecha !== 'undefined') SelectorFecha.activar(campo);
                campo.addEventListener('change', () => {
                    const iso = isoDesdeDMA(campo.value);
                    if (iso) { const [a, m, d] = iso.split('-').map(Number); inicioPeriodo = lunesDe(new Date(a, m - 1, d)); pintarPeriodo(); }
                });
                document.getElementById('btnPeriodoAnterior').addEventListener('click', () => moverPeriodo(-1));
                document.getElementById('btnPeriodoSiguiente').addEventListener('click', () => moverPeriodo(1));
                pintarPeriodo();
            } else if (tipo === 'ingresos_mes') {
                tituloForm.innerText = 'Ingresos Mensuales';
                const hoy = new Date();
                bodyForm.innerHTML = `
                    <div class="periodo-nav">
                        <button type="button" class="icon-btn" id="btnPeriodoAnterior" title="Mes anterior"><i class="material-icons">chevron_left</i></button>
                        <div class="periodo-texto"><strong id="lblPeriodo"></strong><small id="lblPeriodoNota"></small></div>
                        <button type="button" class="icon-btn" id="btnPeriodoSiguiente" title="Mes siguiente"><i class="material-icons">chevron_right</i></button>
                    </div>
                    <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px;">
                        <div class="input-group">
                            <label for="cmbMesReporte">Mes</label>
                            <select id="cmbMesReporte" class="form-control">${MESES.map((m, i) => `<option value="${i}">${m}</option>`).join('')}</select>
                        </div>
                        <div class="input-group">
                            <label for="cmbAnioReporte">Año</label>
                            <select id="cmbAnioReporte" class="form-control">${Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i).map(a => `<option value="${a}">${a}</option>`).join('')}</select>
                        </div>
                    </div>
                    <p class="periodo-ayuda">Cada jornada cuenta en el mes del día en que abrió.</p>
                `;
                inicioPeriodo = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                const alElegir = () => {
                    inicioPeriodo = new Date(+document.getElementById('cmbAnioReporte').value, +document.getElementById('cmbMesReporte').value, 1);
                    pintarPeriodo();
                };
                document.getElementById('cmbMesReporte').addEventListener('change', alElegir);
                document.getElementById('cmbAnioReporte').addEventListener('change', alElegir);
                document.getElementById('btnPeriodoAnterior').addEventListener('click', () => moverPeriodo(-1));
                document.getElementById('btnPeriodoSiguiente').addEventListener('click', () => moverPeriodo(1));
                pintarPeriodo();
            }
        }

        function moverPeriodo(paso) {
            const d = new Date(inicioPeriodo);
            if (reporteActivo === 'ingresos_semana') d.setDate(d.getDate() + 7 * paso);
            else d.setMonth(d.getMonth() + paso);
            inicioPeriodo = d;
            pintarPeriodo();
        }

        // Texto del período elegido y botones: no se avanza más allá del período actual.
        function pintarPeriodo() {
            const hoy = new Date();
            const lbl = document.getElementById('lblPeriodo');
            const nota = document.getElementById('lblPeriodoNota');
            let actual, distancia;
            if (reporteActivo === 'ingresos_semana') {
                const fin = new Date(inicioPeriodo); fin.setDate(fin.getDate() + 6);
                lbl.textContent = `Lunes ${fechaDMA(inicioPeriodo)} al domingo ${fechaDMA(fin)}`;
                actual = lunesDe(hoy);
                distancia = Math.round((actual - inicioPeriodo) / (7 * 86400000));
                nota.textContent = distancia === 0 ? 'Esta semana' : distancia === 1 ? 'Semana pasada' : distancia > 1 ? `Hace ${distancia} semanas` : 'Semana futura';
                const campo = document.getElementById('filtroDiaSemana');
                if (campo && isoDesdeDMA(campo.value) && lunesDe(new Date(isoDesdeDMA(campo.value) + 'T00:00:00')).getTime() !== inicioPeriodo.getTime()) campo.value = '';
            } else {
                lbl.textContent = `${MESES[inicioPeriodo.getMonth()]} ${inicioPeriodo.getFullYear()}`;
                actual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                distancia = (actual.getFullYear() - inicioPeriodo.getFullYear()) * 12 + actual.getMonth() - inicioPeriodo.getMonth();
                nota.textContent = distancia === 0 ? 'Este mes' : distancia === 1 ? 'Mes pasado' : distancia > 1 ? `Hace ${distancia} meses` : 'Mes futuro';
                const cmbMes = document.getElementById('cmbMesReporte');
                const cmbAnio = document.getElementById('cmbAnioReporte');
                if (!Array.from(cmbAnio.options).some(o => +o.value === inicioPeriodo.getFullYear())) {
                    cmbAnio.insertAdjacentHTML('beforeend', `<option value="${inicioPeriodo.getFullYear()}">${inicioPeriodo.getFullYear()}</option>`);
                }
                cmbMes.value = String(inicioPeriodo.getMonth());
                cmbAnio.value = String(inicioPeriodo.getFullYear());
            }
            document.getElementById('btnPeriodoSiguiente').disabled = inicioPeriodo >= actual;
        }

    // Lógica para poblar combos y buscar jornadas
    function inicializarCombosFecha() {
        const cmbAnio = document.getElementById('cmbAnio');
        const cmbMes = document.getElementById('cmbMes');
        const cmbDia = document.getElementById('cmbDia');
        
        const fechaActual = new Date();
        const anioActual = fechaActual.getFullYear();
        
        // Poblar Año (5 años atrás hasta el actual)
        for(let i = anioActual; i >= anioActual - 5; i--) {
            cmbAnio.innerHTML += `<option value="${i}">${i}</option>`;
        }
        
        // Poblar Mes
        const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        meses.forEach((m, index) => {
            let val = (index + 1).toString().padStart(2, '0');
            cmbMes.innerHTML += `<option value="${val}">${m}</option>`;
        });
        cmbMes.value = (fechaActual.getMonth() + 1).toString().padStart(2, '0');

        // Función para actualizar días según mes y año
        const actualizarDias = () => {
            const diasEnMes = new Date(cmbAnio.value, cmbMes.value, 0).getDate();
            cmbDia.innerHTML = '';
            for(let i = 1; i <= diasEnMes; i++) {
                let val = i.toString().padStart(2, '0');
                cmbDia.innerHTML += `<option value="${val}">${val}</option>`;
            }
        };

        // Eventos de cambio
        cmbAnio.addEventListener('change', () => { actualizarDias(); buscarJornadas(); });
        cmbMes.addEventListener('change', () => { actualizarDias(); buscarJornadas(); });
        cmbDia.addEventListener('change', buscarJornadas);

        actualizarDias();
        cmbDia.value = fechaActual.getDate().toString().padStart(2, '0');
        buscarJornadas(); // Búsqueda inicial
    }

    // Busca en BD cuántas jornadas hubieron ese día
    async function buscarJornadas() {
        const fecha = `${document.getElementById('cmbAnio').value}-${document.getElementById('cmbMes').value}-${document.getElementById('cmbDia').value}`;
        const divCombo = document.getElementById('divComboJornadas');
        const cmbJornada = document.getElementById('cmbJornadaId');
        
        try {
            const response = await fetch(`../backend/api/reportes.php?tipo=buscar_jornadas&fecha=${fecha}`);
            const result = await response.json();
            
            cmbJornada.innerHTML = '';
            if(result.data.length === 0) {
                cmbJornada.innerHTML = '<option value="">No hay jornadas en esta fecha</option>';
                divCombo.style.display = 'block';
            } else if (result.data.length === 1) {
                cmbJornada.innerHTML = `<option value="${result.data[0].id_jornada}">Jornada #${result.data[0].id_jornada}</option>`;
                divCombo.style.display = 'none'; // Oculto si solo hay 1
            } else {
                result.data.forEach(j => {
                    cmbJornada.innerHTML += `<option value="${j.id_jornada}">Jornada #${j.id_jornada} (${j.hora_apertura})</option>`;
                });
                divCombo.style.display = 'block'; // Mostrar si hay más de 1
            }
        } catch (e) { console.error(e); }
    }

        // Botón "Generar" del formulario
        document.getElementById('btnProcesarReporte').addEventListener('click', async () => {
            if (reporteActivo === 'jornada') await generarReporteJornada();
            else if (reporteActivo === 'ingresos_semana' || reporteActivo === 'ingresos_mes') await generarReportePeriodo();
        });

        async function generarReporteJornada() {
            const idJornada = document.getElementById('cmbJornadaId')?.value;
            const chkApertura = document.getElementById('chkAperturaCierre').checked;
            const chkMesas = document.getElementById('chkMesas').checked;
            const chkProductos = document.getElementById('chkProductos').checked;
            const chkEgresos = document.getElementById('chkEgresos').checked;
            const chkInsumos = document.getElementById('chkInsumos').checked;
            const chkGastosProductos = document.getElementById('chkGastosProductos').checked;

            if (!idJornada) {
                mostrarToast("Debe seleccionar una jornada válida", "warning");
                return;
            }
            if (!chkApertura && !chkMesas && !chkProductos && !chkEgresos && !chkInsumos && !chkGastosProductos) {
                mostrarToast("Debe seleccionar al menos un filtro", "warning");
                return;
            }

            const bodyContenido = abrirVisor('Reporte de Jornada');
            try {
                const queryParams = `tipo=jornada&id_jornada=${idJornada}&apertura=${chkApertura}&mesas=${chkMesas}&productos=${chkProductos}&egresos=${chkEgresos}&insumos=${chkInsumos}&gastos_productos=${chkGastosProductos}`;
                const response = await fetch(`../backend/api/reportes.php?${queryParams}`);
                const r = await response.json();
                if (r.status === 'success') {
                    renderizarReporteJornada(r.data, bodyContenido);
                } else {
                    bodyContenido.innerHTML = `<div class="text-danger">Error: ${r.message}</div>`;
                }
            } catch (e) {
                bodyContenido.innerHTML = '<div class="text-danger">Error de red al generar el reporte.</div>';
            }
        }

        async function generarReportePeriodo() {
            const semana = reporteActivo === 'ingresos_semana';
            const query = semana
                ? `tipo=ingresos_semana&fecha=${isoLocal(inicioPeriodo)}`
                : `tipo=ingresos_mes&mes=${inicioPeriodo.getFullYear()}-${dos(inicioPeriodo.getMonth() + 1)}`;
            const bodyContenido = abrirVisor(semana ? 'Ingresos por Semana' : 'Ingresos Mensuales');
            try {
                const response = await fetch(`../backend/api/reportes.php?${query}`);
                const r = await response.json();
                if (r.status === 'success') {
                    renderizarReportePeriodo(r.data, bodyContenido);
                } else {
                    bodyContenido.innerHTML = `<div class="text-danger">Error: ${r.message}</div>`;
                }
            } catch (e) {
                bodyContenido.innerHTML = '<div class="text-danger">Error de red al generar el reporte.</div>';
            }
        }

        function abrirVisor(titulo) {
            modalForm.classList.remove('show');
            modalVisor.classList.add('show');
            document.getElementById('tituloVisorReporte').innerText = titulo;
            const bodyContenido = document.getElementById('bodyContenidoReporte');
            bodyContenido.innerHTML = '<div style="text-align:center; padding:3rem;"><i class="material-icons" style="animation: spin 1s linear infinite;">autorenew</i> Generando datos...</div>';
            return bodyContenido;
        }

    // Creador dinámico del HTML del reporte
    function renderizarReporteJornada(d, contenedor) {
        let html = `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h1 style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 5px;">Reporte de Jornada</h1>
                <p style="text-align: center; font-size: 12px; color: #666; margin-top: 0;">La información de esta jornada corresponde a:</p>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #fff; padding: 15px; border: 1px solid #ddd; margin-bottom: 20px;">
                    <div><strong>N° Jornada:</strong> ${d.encabezado.id_jornada}</div>
                    <div><strong>Encargado:</strong> ${d.encabezado.encargado}</div>
                    <div><strong>Fecha y Hora de apertura:</strong> ${fechaHoraDMA(d.encabezado.apertura)}</div>
                    <div><strong>Fecha y Hora de Cierre:</strong> ${d.encabezado.cierre ? fechaHoraDMA(d.encabezado.cierre) : 'En curso'}</div>
                </div>
        `;

        if (d.filtros.apertura) {
            const totalCaja = parseFloat(d.apertura.monto_inicial) + parseFloat(d.apertura.ingreso_efectivo) + parseFloat(d.apertura.ingreso_qr) - parseFloat(d.apertura.total_egresos);
            html += `
                <h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #3b82f6;">Información de Caja</h3>
                <table class="data-table" style="width: 100%; margin-bottom: 20px;">
                    <thead style="background: #e2e8f0;"><tr><th>Monto Apertura</th><th>Ingresos Efectivo</th><th>Ingresos QR</th><th>Egresos</th><th>Total Estimado</th></tr></thead>
                    <tbody><tr>
                        <td class="text-center">${d.apertura.monto_inicial}</td>
                        <td class="text-center text-success">${d.apertura.ingreso_efectivo}</td>
                        <td class="text-center text-info">${d.apertura.ingreso_qr}</td>
                        <td class="text-center text-danger">${d.apertura.total_egresos}</td>
                        <td class="text-center"><strong>${totalCaja.toFixed(2)}</strong></td>
                    </tr></tbody>
                </table>
            `;
        }

       // Tabla de Resumen de Horas de Mesas (JS)
        if (d.filtros.mesas) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #10b981;">Horas de Uso de Mesas</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 10px;">
                        <thead style="background: #e2e8f0;"><tr><th>Mesa</th><th>Ocupación</th><th>Tiempo</th><th>Método</th><th>Total</th></tr></thead><tbody>`;
            d.mesas.filas.forEach(f => {
                html += `<tr><td>${f.mesa}</td><td>${fechaHoraDMA(f.fecha_hora)}</td><td>${f.tiempo_uso}</td><td>${f.metodo}</td><td class="text-right">${f.total}</td></tr>`;
            });
            html += `</tbody></table>`;
            
            // CORRECCIÓN AQUÍ: Suma automatizada en base a la data real calculada en el backend
            const totalMs = parseFloat(d.mesas.resumen.efectivo) + parseFloat(d.mesas.resumen.qr);
            html += `<table class="data-table" style="width: 100%; margin-bottom: 20px; border: 2px solid #10b981;">
                        <thead style="background: #d1fae5;"><tr><th>Total Horas Jugadas</th><th>Ingresado Efectivo</th><th>Ingresado QR</th><th>TOTAL MESAS</th></tr></thead>
                        <tbody><tr>
                            <td class="text-center"><strong>${d.mesas.resumen.horas}</strong></td>
                            <td class="text-center text-success">${d.mesas.resumen.efectivo}</td>
                            <td class="text-center text-info">${d.mesas.resumen.qr}</td>
                            <td class="text-center"><strong>${totalMs.toFixed(2)}</strong></td>
                        </tr></tbody>
                     </table>`;
        }

        // Tabla de Resumen de Productos Vendidos (JS)
        if (d.filtros.productos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #f59e0b;">Venta de Productos</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 10px;">
                        <thead style="background: #e2e8f0;"><tr><th>Modo</th><th>Fecha Hora</th><th>Cant. Prod.</th><th>Método</th><th>Total</th></tr></thead><tbody>`;
            d.productos.filas.forEach(f => {
                html += `<tr><td>${f.modo}</td><td>${fechaHoraDMA(f.fecha_hora)}</td><td class="text-center">${f.cantidad}</td><td>${f.metodo}</td><td class="text-right">${f.total}</td></tr>`;
            });
            html += `</tbody></table>`;
            
            // CORRECCIÓN AQUÍ: Lectura directa de la cantidad total de unidades e ingresos segregados
            const totalPd = parseFloat(d.productos.resumen.efectivo) + parseFloat(d.productos.resumen.qr);
            html += `<table class="data-table" style="width: 100%; margin-bottom: 20px; border: 2px solid #f59e0b;">
                        <thead style="background: #fef3c7;"><tr><th>Total Prod. Vendidos</th><th>Ingresado Efectivo</th><th>Ingresado QR</th><th>TOTAL PROD.</th></tr></thead>
                        <tbody><tr>
                            <td class="text-center"><strong>${d.productos.resumen.cantidad} uds.</strong></td>
                            <td class="text-center text-success">${d.productos.resumen.efectivo}</td>
                            <td class="text-center text-info">${d.productos.resumen.qr}</td>
                            <td class="text-center"><strong>${totalPd.toFixed(2)}</strong></td>
                        </tr></tbody>
                     </table>`;

            // Otros cargos (rotura de vaso, daños). La hora con descuento se cuenta en mesas.
            if (d.cargos && d.cargos.filas.length) {
                const totalCg = parseFloat(d.cargos.resumen.efectivo) + parseFloat(d.cargos.resumen.qr);
                html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #8b5cf6;">Otros Cargos</h3>`;
                html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 10px;">
                            <thead style="background: #e2e8f0;"><tr><th>Modo</th><th>Fecha Hora</th><th>Concepto</th><th>Monto</th></tr></thead><tbody>`;
                d.cargos.filas.forEach(f => {
                    html += `<tr><td>${f.modo}</td><td>${fechaHoraDMA(f.fecha_hora)}</td><td>${f.descripcion}</td><td class="text-right">${parseFloat(f.monto).toFixed(2)}</td></tr>`;
                });
                html += `</tbody></table>
                         <table class="data-table" style="width: 100%; margin-bottom: 20px; border: 2px solid #8b5cf6;">
                            <thead style="background: #ede9fe;"><tr><th>Ingresado Efectivo</th><th>Ingresado QR</th><th>TOTAL CARGOS</th></tr></thead>
                            <tbody><tr>
                                <td class="text-center text-success">${d.cargos.resumen.efectivo}</td>
                                <td class="text-center text-info">${d.cargos.resumen.qr}</td>
                                <td class="text-center"><strong>${totalCg.toFixed(2)}</strong></td>
                            </tr></tbody>
                         </table>`;
            }
        }

        if (d.filtros.egresos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #ef4444;">Egresos de Caja</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 5px;">
                        <thead style="background: #e2e8f0;"><tr><th>Fecha Hora</th><th>Concepto</th><th>Monto</th></tr></thead><tbody>`;
            let tEg = 0;
            d.egresos.forEach(f => { tEg += parseFloat(f.monto); html += `<tr><td>${fechaHoraDMA(f.fecha)}</td><td>${f.concepto}</td><td class="text-right text-danger">${f.monto}</td></tr>`; });
            html += `</tbody></table><div class="text-right" style="margin-bottom: 20px; font-weight:bold;">Total Egresos: <span class="text-danger">${tEg.toFixed(2)}</span></div>`;
        }

        if (d.filtros.insumos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #64748b;">Gasto de Insumos</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 5px;">
                        <thead style="background: #e2e8f0;"><tr><th>Fecha Hora</th><th>Insumo</th><th>Cantidad</th></tr></thead><tbody>`;
            let tIns = 0;
            d.insumos.forEach(f => { tIns += parseFloat(f.cantidad); html += `<tr><td>${fechaHoraDMA(f.fecha)}</td><td>${f.insumo}</td><td class="text-center">${f.cantidad}</td></tr>`; });
            html += `</tbody></table><div class="text-right" style="margin-bottom: 20px; font-weight:bold;">Suma total cantidades: ${tIns.toFixed(2)}</div>`;
        }

        if (d.filtros.gastos_productos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #0d9488;">Gasto de Productos</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 5px;">
                        <thead style="background: #e2e8f0;"><tr><th>Fecha Hora</th><th>Producto</th><th>Cantidad</th><th>Registrado por</th></tr></thead><tbody>`;
            let tGp = 0;
            (d.gastos_productos || []).forEach(f => {
                tGp += parseInt(f.cantidad) || 0;
                html += `<tr><td>${fechaHoraDMA(f.fecha)}</td><td>${escaparHTML(f.producto)}</td><td class="text-center">${parseInt(f.cantidad)}</td><td>${escaparHTML(f.usuario)}</td></tr>`;
            });
            if (!(d.gastos_productos || []).length) html += `<tr><td colspan="4" class="text-center">Sin gastos de productos en esta jornada</td></tr>`;
            html += `</tbody></table><div class="text-right" style="margin-bottom: 20px; font-weight:bold;">Total unidades: ${tGp}</div>`;
        }

        html += `</div>`;
        contenedor.innerHTML = html;
    }

        // Reporte de semana o mes: totales, cobrado por día (barras), detalle por día y productos más vendidos.
        function renderizarReportePeriodo(d, contenedor) {
            const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
            const bs = (n) => `${Number(n).toFixed(2)} Bs`;
            const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
            const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
            const semana = d.periodo.tipo === 'semana';
            const t = d.totales;
            const desde = new Date(d.periodo.desde + 'T00:00:00');
            const titulo = semana ? 'Ingresos de la semana' : `Ingresos de ${MESES[desde.getMonth()]} ${desde.getFullYear()}`;
            const subtitulo = semana
                ? `Del lunes ${fechaDMA(d.periodo.desde)} al domingo ${fechaDMA(d.periodo.hasta)}`
                : `Del ${fechaDMA(d.periodo.desde)} al ${fechaDMA(d.periodo.hasta)}`;

            let html = `<div class="rp">
                <div class="rp-encabezado">
                    <h1>${titulo}</h1>
                    <p>${subtitulo} · ${t.jornadas} ${t.jornadas === 1 ? 'jornada' : 'jornadas'} · ${t.ventas} ${t.ventas === 1 ? 'venta' : 'ventas'}</p>
                </div>`;

            if (t.jornadas === 0) {
                contenedor.innerHTML = html + `<div class="rp-vacio"><i class="material-icons">event_busy</i>No hubo jornadas en este período.</div></div>`;
                return;
            }

            html += `
                <div class="rp-kpis">
                    <div class="rp-kpi rp-kpi-principal"><span>Total cobrado</span><strong>${bs(t.total)}</strong></div>
                    <div class="rp-kpi"><span>Efectivo</span><strong>${bs(t.efectivo)}</strong></div>
                    <div class="rp-kpi"><span>QR</span><strong>${bs(t.qr)}</strong></div>
                    <div class="rp-kpi"><span>Egresos de caja</span><strong>${bs(t.egresos)}</strong></div>
                    <div class="rp-kpi"><span>Cobrado − egresos</span><strong>${bs(t.neto)}</strong></div>
                </div>
                <div class="rp-kpis rp-kpis-secundarios">
                    <div class="rp-kpi"><span>Mesas</span><strong>${bs(t.mesas)}</strong></div>
                    <div class="rp-kpi"><span>Productos</span><strong>${bs(t.productos)}</strong></div>
                    <div class="rp-kpi"><span>Otros cargos</span><strong>${bs(t.cargos)}</strong></div>
                    <div class="rp-kpi"><span>Horas jugadas</span><strong>${Number(t.horas).toFixed(1)} h</strong></div>
                    <div class="rp-kpi"><span>Productos vendidos</span><strong>${t.unidades} uds.</strong></div>
                </div>`;

            // Cobrado por día: una barra por día; el mejor día lleva su monto.
            const maximo = Math.max(...d.dias.map(x => x.total));
            const escala = maximo > 0 ? maximo : 1;
            const mejor = d.dias.find(x => x.total === maximo && maximo > 0);
            const guias = [1, 0.5, 0].map(f => `<div class="rp-guia" style="bottom:${f * 100}%"><span>${(escala * f).toFixed(0)}</span></div>`).join('');
            const columnas = d.dias.map(x => {
                const alto = x.total > 0 ? Math.max(2, (x.total / escala) * 100) : 0;
                const etiqueta = semana ? `${DIAS_CORTOS[x.dia_semana]} ${x.fecha.slice(8, 10)}` : String(+x.fecha.slice(8, 10));
                const detalle = `${DIAS[x.dia_semana]} ${fechaDMA(x.fecha)}: ${bs(x.total)} (mesas ${bs(x.mesas)}, productos ${bs(x.productos)}, cargos ${bs(x.cargos)})`;
                return `<div class="rp-col${x === mejor ? ' rp-col-mejor' : ''}${x.jornadas === 0 ? ' rp-col-sin' : ''}" tabindex="0" title="${esc(detalle)}" aria-label="${esc(detalle)}"
                            data-dia="${esc(DIAS[x.dia_semana] + ' ' + fechaDMA(x.fecha))}" data-total="${bs(x.total)}"
                            data-desglose="${esc(x.jornadas === 0 ? 'Sin jornada' : `Mesas ${bs(x.mesas)} · Productos ${bs(x.productos)} · Cargos ${bs(x.cargos)}`)}">
                    <div class="rp-barra-zona">${x === mejor ? `<span class="rp-valor" style="bottom:${alto}%">${Number(x.total).toFixed(0)}</span>` : ''}<div class="rp-barra" style="height:${alto}%"></div></div>
                    <span class="rp-eje">${etiqueta}</span>
                </div>`;
            }).join('');
            html += `
                <h3 class="rp-seccion">Cobrado por día (Bs)</h3>
                <div class="rp-grafico${semana ? '' : ' rp-grafico-mes'}">
                    <div class="rp-plano">${guias}<div class="rp-columnas">${columnas}</div></div>
                    <div class="rp-tooltip" role="status" aria-live="polite"></div>
                </div>
                ${mejor ? `<p class="rp-nota">Mejor día: <strong>${DIAS[mejor.dia_semana]} ${fechaDMA(mejor.fecha)}</strong> con ${bs(mejor.total)}.</p>` : ''}`;

            // En el mes: qué días de la semana rinden más (suma y promedio por jornada)
            if (!semana) {
                const porDia = [1, 2, 3, 4, 5, 6, 7].map(n => {
                    const dias = d.dias.filter(x => x.dia_semana === n);
                    const total = dias.reduce((s, x) => s + x.total, 0);
                    const jornadas = dias.reduce((s, x) => s + x.jornadas, 0);
                    return { n, total, jornadas, promedio: jornadas ? total / jornadas : 0 };
                });
                const mejorDia = porDia.reduce((a, b) => (b.promedio > a.promedio ? b : a));
                html += `
                    <h3 class="rp-seccion">Por día de la semana</h3>
                    <div class="table-responsive"><table class="data-table rp-tabla">
                        <thead><tr><th>Día</th><th class="text-right">Jornadas</th><th class="text-right">Cobrado</th><th class="text-right">Promedio por jornada</th></tr></thead>
                        <tbody>${porDia.map(p => `<tr class="${p.jornadas === 0 ? 'rp-fila-sin' : ''}${p === mejorDia && p.promedio > 0 ? ' rp-fila-mejor' : ''}">
                            <td>${DIAS[p.n]}</td><td class="text-right">${p.jornadas}</td><td class="text-right">${bs(p.total)}</td><td class="text-right">${p.jornadas ? bs(p.promedio) : '—'}</td></tr>`).join('')}
                        </tbody>
                    </table></div>`;
            }

            // Detalle por día (para contabilidad): todos los días del período, con totales
            html += `
                <h3 class="rp-seccion">Detalle por día</h3>
                <div class="table-responsive"><table class="data-table rp-tabla">
                    <thead><tr>
                        <th>Día</th><th class="text-right">Jorn.</th><th class="text-right">Mesas</th><th class="text-right">Productos</th><th class="text-right">Cargos</th>
                        <th class="text-right">Efectivo</th><th class="text-right">QR</th><th class="text-right">Total</th><th class="text-right">Egresos</th>
                    </tr></thead>
                    <tbody>${d.dias.map(x => `<tr class="${x.jornadas === 0 ? 'rp-fila-sin' : ''}">
                        <td>${DIAS_CORTOS[x.dia_semana]} ${fechaDMA(x.fecha)}</td>
                        <td class="text-right">${x.jornadas}</td>
                        <td class="text-right">${x.mesas.toFixed(2)}</td>
                        <td class="text-right">${x.productos.toFixed(2)}</td>
                        <td class="text-right">${x.cargos.toFixed(2)}</td>
                        <td class="text-right">${x.efectivo.toFixed(2)}</td>
                        <td class="text-right">${x.qr.toFixed(2)}</td>
                        <td class="text-right"><strong>${x.total.toFixed(2)}</strong></td>
                        <td class="text-right">${x.egresos.toFixed(2)}</td>
                    </tr>`).join('')}</tbody>
                    <tfoot><tr>
                        <td>Total</td><td class="text-right">${t.jornadas}</td><td class="text-right">${t.mesas.toFixed(2)}</td><td class="text-right">${t.productos.toFixed(2)}</td>
                        <td class="text-right">${t.cargos.toFixed(2)}</td><td class="text-right">${t.efectivo.toFixed(2)}</td><td class="text-right">${t.qr.toFixed(2)}</td>
                        <td class="text-right">${t.total.toFixed(2)}</td><td class="text-right">${t.egresos.toFixed(2)}</td>
                    </tr></tfoot>
                </table></div>`;

            if (d.productos_top.length) {
                html += `
                    <h3 class="rp-seccion">Productos más vendidos</h3>
                    <div class="table-responsive"><table class="data-table rp-tabla">
                        <thead><tr><th>#</th><th>Producto</th><th class="text-right">Unidades</th><th class="text-right">A precio de venta</th></tr></thead>
                        <tbody>${d.productos_top.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.producto)}</td><td class="text-right">${p.unidades}</td><td class="text-right">${bs(p.importe)}</td></tr>`).join('')}</tbody>
                    </table></div>`;
            }

            html += `<p class="rp-pie">Montos en Bs. Lo cobrado se reparte entre mesas, productos y cargos igual que en el reporte de cada jornada. "A precio de venta" no descuenta las promociones. Cada jornada cuenta en el día en que abrió.</p></div>`;
            contenedor.innerHTML = html;

            // Tooltip de cada barra (con mouse o teclado)
            const grafico = contenedor.querySelector('.rp-grafico');
            const tooltip = grafico.querySelector('.rp-tooltip');
            const mostrar = (col) => {
                tooltip.replaceChildren();
                const valor = document.createElement('strong'); valor.textContent = col.dataset.total;
                const dia = document.createElement('span'); dia.textContent = col.dataset.dia;
                const desglose = document.createElement('small'); desglose.textContent = col.dataset.desglose;
                tooltip.append(valor, dia, desglose);
                const caja = grafico.getBoundingClientRect();
                const r = col.getBoundingClientRect();
                tooltip.style.left = `${Math.min(Math.max(r.left - caja.left + r.width / 2, 90), caja.width - 90)}px`;
                tooltip.classList.add('visible');
            };
            grafico.querySelectorAll('.rp-col').forEach(col => {
                col.removeAttribute('title');
                col.addEventListener('mouseenter', () => mostrar(col));
                col.addEventListener('focus', () => mostrar(col));
                col.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
                col.addEventListener('blur', () => tooltip.classList.remove('visible'));
            });
        }

        // Impresión: abre el reporte en una ventana aparte con los estilos del sistema
        document.getElementById('btnImprimirReporte').addEventListener('click', () => {
            const contenidoDiv = document.getElementById('bodyContenidoReporte').innerHTML;
            const ventana = window.open('', '', 'height=700,width=900');
            ventana.document.write('<html><head><title>Imprimir Reporte</title>');
            ventana.document.write('<link rel="stylesheet" href="css/app.css">');
            ventana.document.write('<style>body { background: white; padding: 20px; }</style>');
            ventana.document.write('</head><body>');
            ventana.document.write(contenidoDiv);
            ventana.document.write('</body></html>');
            ventana.document.close();
            setTimeout(() => {
                ventana.print();
            }, 500); // Damos medio segundo para que carguen los estilos
        });
    }
    // -------------------------------------------------------------------
    // MÓDULO: ÚLTIMOS CIERRES - MODAL LISTADO + VISOR FULLSCREEN
    // -------------------------------------------------------------------
    async function abrirModalListadoCierres() {
        const modal = document.getElementById('modalListadoCierres');
        const listadoContainer = document.getElementById('listadoPdfsAdmin');
        if (!modal || !listadoContainer) return;

        modal.style.display = 'flex';
        listadoContainer.innerHTML = '<p style="color:#64748b; text-align:center; padding:20px 0;">Cargando reportes...</p>';

        try {
            const res = await fetch('../backend/api/reportes_pdf.php?action=list_pdfs');
            const json = await res.json();

            if (json.status === 'success') {
                const archivos = json.data;

                if (archivos.length === 0) {
                    listadoContainer.innerHTML = `
                        <div style="text-align:center; padding:30px 0; color:#64748b;">
                            <i class="material-icons" style="font-size:3rem; opacity:0.3;">folder_open</i>
                            <p style="margin:8px 0 0 0;">No hay reportes guardados todavía.</p>
                        </div>`;
                    return;
                }

                listadoContainer.innerHTML = '';
                archivos.forEach(archivo => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:12px 15px; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; transition:background 0.15s;';
                    item.innerHTML = `
                        <div style="display:flex; align-items:center; gap:12px;">
                            <i class="material-icons" style="color:#ef4444; font-size:1.8rem;">picture_as_pdf</i>
                            <div>
                                <div style="font-weight:600; color:#0f172a; font-size:0.95rem;">${archivo.name}</div>
                                <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">${fechaHoraDMA(archivo.date)}</div>
                            </div>
                        </div>
                        <i class="material-icons" style="color:#3b82f6;">chevron_right</i>
                    `;
                    item.addEventListener('mouseenter', () => item.style.background = '#eff6ff');
                    item.addEventListener('mouseleave', () => item.style.background = '#f8fafc');
                    item.addEventListener('click', () => window.abrirVisorPdfAdmin(archivo.name));
                    listadoContainer.appendChild(item);
                });
            } else {
                listadoContainer.innerHTML = `<p style="color:#ef4444; text-align:center;">Error: ${json.message}</p>`;
            }
        } catch (err) {
            console.error('Error al cargar PDFs:', err);
            listadoContainer.innerHTML = '<p style="color:#ef4444; text-align:center;">Error de conexión al servidor.</p>';
        }
    }

    window.abrirVisorPdfAdmin = function(filename) {
        // Ocultar modal listado
        const modalListado = document.getElementById('modalListadoCierres');
        if (modalListado) modalListado.style.display = 'none';

        // Abrir visor fullscreen
        const modalPdf = document.getElementById('modalPdfFullscreen');
        const iframe = document.getElementById('iframePdfAdmin');
        const titulo = document.getElementById('tituloModalPdfAdmin');
        const btnExterno = document.getElementById('btnAbrirExternoPdfAdmin');
        if (!modalPdf || !iframe) return;

        const pdfUrl = `../backend/api/reportes_pdf.php?action=view_pdf&file=${encodeURIComponent(filename)}`;
        
        titulo.innerText = filename;
        iframe.src = pdfUrl;
        if (btnExterno) {
            btnExterno.href = pdfUrl;
        }
        modalPdf.style.display = 'flex';
    };

    window.cerrarVisorPdfAdmin = function() {
        // Cerrar visor fullscreen
        const modalPdf = document.getElementById('modalPdfFullscreen');
        const iframe = document.getElementById('iframePdfAdmin');
        if (modalPdf) modalPdf.style.display = 'none';
        if (iframe) iframe.src = '';

        // Volver a abrir el modal listado
        abrirModalListadoCierres();
    };

    // --- 9. LOGOUT ---
    document.getElementById("btnLogout").addEventListener("click", () => {
        localStorage.removeItem("usuario_nombre"); // Limpiar el almacenamiento
        window.location.href = "../index.html";
    });

    // Carga automática inicial del Dashboard
    navegarA("dashboard.html");
});