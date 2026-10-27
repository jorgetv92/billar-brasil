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

            function toggleMenu() {
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

                let icono = tipo === "success" ? "check_circle" : (tipo === "error" ? "cancel" : "warning");
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
                        <td><b>#${t.id_tipo_mesa}</b></td>
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
                    const response = await fetch("../backend/api/mesas.php");
                    const result = await response.json();

                    if (response.ok && result.status === "success") {
                        listaMesasGlobal = result.data;
                        tbody.innerHTML = "";

                        if (listaMesasGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="4" class="text-center">No hay mesas físicas registradas</td></tr>`;
                            return;
                        }

                        listaMesasGlobal.forEach(m => {
                            // Diseño de Badges para el Estado
                            let badgeEstado = '';
                            if (m.estado_actual === 'libre') badgeEstado = `<span class="role-badge" style="background: var(--success);"><i class="material-icons" style="font-size:12px; vertical-align:middle;">check_circle</i> Libre</span>`;
                            if (m.estado_actual === 'ocupada') badgeEstado = `<span class="role-badge" style="background: var(--danger);"><i class="material-icons" style="font-size:12px; vertical-align:middle;">play_circle</i> Ocupada</span>`;
                            if (m.estado_actual === 'mantenimiento') badgeEstado = `<span class="role-badge" style="background: var(--warning); color:#000;"><i class="material-icons" style="font-size:12px; vertical-align:middle;">build</i> Mantenimiento</span>`;

                            let botonDetalle = '';
                            if (m.estado_actual === 'ocupada') {
                                botonDetalle = `<button class="icon-btn text-info btn-ver-detalle-mesa" data-id="${m.id_mesa}" data-nombre="${m.numero_mesa}"><i class="material-icons">visibility</i></button>`;
                            }

                            tbody.innerHTML += `
                    <tr>
                        <td style="font-size: 1.1rem; font-weight: bold; color: var(--primary);">${m.numero_mesa}</td>
                        <td>${m.nombre_tipo} <span style="color:#64748b; font-size:0.85rem;">(${parseFloat(m.precio_hora).toFixed(2)} Bs)</span></td>
                        <td>${badgeEstado}</td>
                        <td>
                            ${botonDetalle}
                            <button class="icon-btn text-primary btn-editar-mesa" data-id="${m.id_mesa}"><i class="material-icons">edit</i></button>
                            <button class="icon-btn text-danger btn-eliminar-mesa" data-id="${m.id_mesa}"><i class="material-icons">delete</i></button>
                        </td>
                    </tr>
                `;
                        });
                    }
                } catch (error) {
                    mostrarToast("No se pudieron cargar las mesas", "error");
                }
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
                    // 1. Obtener la grilla inicial de mesas desde atención barra API
                    const response = await fetch("../backend/api/atencion_barra.php?accion=get_datos_iniciales");
                    const data = await response.json();

                    let mesaData = null;
                    let precioHora = 0;

                    for (const tipo of data) {
                        const found = tipo.mesas.find(m => m.id_mesa == idMesa);
                        if (found) {
                            mesaData = found;
                            precioHora = parseFloat(tipo.precio_hora) || 0;
                            break;
                        }
                    }

                    if (!mesaData) {
                        mostrarToast("No se encontró información de la sesión activa de la mesa.", "error");
                        modal.classList.remove("show");
                        return;
                    }

                    // 2. Iniciar reloj de tiempo real
                    if (window.intervaloDetalleMesaAdmin) clearInterval(window.intervaloDetalleMesaAdmin);

                    function actualizarRelojLocal() {
                        const ahora = new Date();
                        const inicioStr = mesaData.fecha_hora_inicio;
                        const pausaStr = mesaData.hora_pausa;
                        const total_consumo = parseFloat(mesaData.total_consumo) || 0;

                        document.getElementById("detMesaConsumo").innerText = `${total_consumo.toFixed(2)} Bs`;

                        if (precioHora === 0) {
                            const importeActual = parseFloat(mesaData.importe_acumulado_tiempo) || 0;
                            document.getElementById("detMesaTiempo").innerText = "00:00:00";
                            document.getElementById("detMesaImporte").innerText = `${importeActual.toFixed(2)} Bs`;
                            document.getElementById("detMesaEstado").className = "text-danger";
                            document.getElementById("detMesaEstado").innerText = "Ocupada";
                            document.getElementById("detMesaHoraInicio").innerText = "--:--";
                            return;
                        }

                        if (inicioStr && inicioStr !== "null" && inicioStr !== "") {
                            const horaInicio = new Date(inicioStr.replace(/-/g, '/'));
                            let f = new Date(inicioStr.replace(/-/g, '/'));
                            let hh = f.getHours().toString().padStart(2, '0');
                            let mm = f.getMinutes().toString().padStart(2, '0');
                            document.getElementById("detMesaHoraInicio").innerText = `${hh}:${mm}`;

                            let horaFinCalculo = ahora;
                            if (pausaStr && pausaStr !== "null" && pausaStr !== "") {
                                horaFinCalculo = new Date(pausaStr.replace(/-/g, '/'));
                            }

                            const difTotalSegundos = Math.floor((horaFinCalculo - horaInicio) / 1000);
                            if (difTotalSegundos >= 0) {
                                const difMinutos = Math.floor(difTotalSegundos / 60);
                                const bloques = Math.ceil(difMinutos / 5);
                                const minutesCobrables = bloques * 5;

                                const acumulado = parseFloat(mesaData.importe_acumulado_tiempo) || 0;
                                const importe = (acumulado + (minutesCobrables * (precioHora / 60))).toFixed(2);

                                const segundosAcumuladosAnteriores = parseInt(mesaData.segundos_acumulados) || 0;
                                const segundosVisuales = difTotalSegundos + segundosAcumuladosAnteriores;

                                const horasV = Math.floor(segundosVisuales / 3600).toString().padStart(2, '0');
                                const minV = Math.floor((segundosVisuales % 3600) / 60).toString().padStart(2, '0');
                                const segV = (segundosVisuales % 60).toString().padStart(2, '0');

                                document.getElementById("detMesaTiempo").innerText = `${horasV}:${minV}:${segV}`;
                                document.getElementById("detMesaImporte").innerText = `${importe} Bs`;
                            }
                        } else {
                            document.getElementById("detMesaHoraInicio").innerText = "--:--";
                            document.getElementById("detMesaTiempo").innerText = "00:00:00";
                            document.getElementById("detMesaImporte").innerText = "0.00 Bs";
                        }

                        const esPausada = pausaStr && pausaStr !== "null" && pausaStr !== "";
                        const badgeEstado = document.getElementById("detMesaEstado");
                        if (esPausada) {
                            badgeEstado.innerText = "Pausada";
                            badgeEstado.className = "text-warning";
                        } else {
                            badgeEstado.innerText = "Ocupada";
                            badgeEstado.className = "text-danger";
                        }
                    }

                    actualizarRelojLocal();
                    window.intervaloDetalleMesaAdmin = setInterval(actualizarRelojLocal, 1000);

                    // 3. Consultar historial de tramos de tiempo
                    const responseTramos = await fetch(`../backend/api/atencion_barra.php?accion=get_historial_tramos&id_mesa=${idMesa}`);
                    const resTramos = await responseTramos.json();

                    if (tbodyTramos) {
                        if (resTramos.status === 'success' && resTramos.data.length > 0) {
                            let htmlTramos = '';
                            resTramos.data.forEach(tramo => {
                                const horaInicio = tramo.fecha_hora_inicio ? new Date(tramo.fecha_hora_inicio.replace(/-/g, '/')) : null;
                                const horaFin = tramo.fecha_hora_fin ? new Date(tramo.fecha_hora_fin.replace(/-/g, '/')) : null;
                                const horaPausa = tramo.fecha_hora_pausa ? new Date(tramo.fecha_hora_pausa.replace(/-/g, '/')) : null;
                                
                                const strInicio = horaInicio ? `${horaInicio.getHours().toString().padStart(2, '0')}:${horaInicio.getMinutes().toString().padStart(2, '0')}` : '--:--';
                                let strFin = '--:--';
                                if (horaFin) {
                                    strFin = `${horaFin.getHours().toString().padStart(2, '0')}:${horaFin.getMinutes().toString().padStart(2, '0')}`;
                                } else if (horaPausa) {
                                    strFin = `<span class="text-warning">Pausa ${horaPausa.getHours().toString().padStart(2, '0')}:${horaPausa.getMinutes().toString().padStart(2, '0')}</span>`;
                                } else {
                                    strFin = '<span class="text-success">En curso</span>';
                                }
                                const importeTramo = parseFloat(tramo.importe_tramo) || 0;
                                htmlTramos += `
                                    <tr>
                                        <td style="padding: 8px;">Mesa ${tramo.numero_mesa}</td>
                                        <td style="padding: 8px;">${strInicio}</td>
                                        <td style="padding: 8px;">${strFin}</td>
                                        <td style="text-align: right; padding: 8px;">${importeTramo.toFixed(2)}</td>
                                    </tr>
                                `;
                            });
                            tbodyTramos.innerHTML = htmlTramos;
                        } else {
                            tbodyTramos.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Sin historial de tiempo</td></tr>';
                        }
                    }

                } catch (error) {
                    console.error("Error al obtener los detalles de la mesa:", error);
                    mostrarToast("Error de comunicación", "error");
                    modal.classList.remove("show");
                }
            }

            // -------------------------------------------------------------------
            // MÓDULO 1.3: GESTIÓN DE INVENTARIO (PRODUCTOS)
            // -------------------------------------------------------------------
            let listaProductosGlobal = [];

            function inicializarModuloProductos() {
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
                    const datos = {
                        nombre_producto: document.getElementById("nombre_producto").value,
                        precio_venta: document.getElementById("precio_venta").value
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
                        tbody.innerHTML = "";

                        if (listaProductosGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay productos en el inventario</td></tr>`;
                            return;
                        }

                        listaProductosGlobal.forEach(p => {
                            // UX: Lógica de colores para el Stock
                            let stockUI = `<b>${p.stock_actual}</b>`;
                            if (parseInt(p.stock_actual) === 0) {
                                stockUI = `<span class="role-badge" style="background: var(--danger);">Agotado</span>`;
                            } else if (parseInt(p.stock_actual) <= 5) {
                                stockUI = `<span style="color: var(--warning); font-weight: bold;">${p.stock_actual} (Bajo)</span>`;
                            }

                            tbody.innerHTML += `
                    <tr>
                        <td style="color: #64748b;">#${p.id_producto}</td>
                        <td style="font-weight: 500;">${p.nombre_producto}</td>
                        <td style="color: var(--primary); font-weight: bold;">${parseFloat(p.precio_venta).toFixed(2)} Bs.</td>
                        <td>${stockUI}</td>
                        <td>
                            <button class="icon-btn text-primary btn-editar-producto" data-id="${p.id_producto}"><i class="material-icons">edit</i></button>
                            <button class="icon-btn text-danger btn-eliminar-producto" data-id="${p.id_producto}"><i class="material-icons">delete</i></button>
                        </td>
                    </tr>
                `;
                        });
                    }
                } catch (error) {
                    mostrarToast("No se pudo cargar el inventario", "error");
                }
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
                    }
                }
                document.getElementById("modalProducto").classList.add("show");
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

            function inicializarModuloInsumos() {
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
                        tbody.innerHTML = "";

                        if (listaInsumosGlobal.length === 0) {
                            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay insumos registrados</td></tr>`;
                            return;
                        }

                        listaInsumosGlobal.forEach(i => {
                            // Formateo para decimales (si es entero, no muestra .00 por limpieza visual)
                            let stockNum = parseFloat(i.stock_actual);
                            let stockFormateado = stockNum % 1 === 0 ? stockNum : stockNum.toFixed(2);

                            let stockUI = `<b>${stockFormateado}</b>`;
                            if (stockNum <= 0) {
                                stockUI = `<span class="role-badge" style="background: var(--danger);">Agotado</span>`;
                            } else if (stockNum <= 5) {
                                stockUI = `<span style="color: var(--warning); font-weight: bold;">${stockFormateado} (Bajo)</span>`;
                            }

                            tbody.innerHTML += `
                    <tr>
                        <td style="color: #64748b;">#${i.id_insumo}</td>
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
                    }
                } catch (error) {
                    mostrarToast("No se pudieron cargar los insumos", "error");
                }
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

            async function inicializarModuloPromociones() {
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

                    // Construcción del objeto base común
                    const datos = {
                        nombre_promo: document.getElementById("nombre_promo").value,
                        tipo_promo: tipo,
                        fecha_inicio: document.getElementById("fecha_inicio").value,
                        fecha_fin: document.getElementById("fecha_fin").value,
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
                            let tipoLabel = p.tipo_promo.replace('_', ' ').toUpperCase();
                            let vigencia = (p.fecha_inicio && p.fecha_fin) ? `${p.fecha_inicio} a ${p.fecha_fin}` : 'Vigencia Permanente';
                            let horario = (p.hora_inicio && p.hora_fin) ? `${p.hora_inicio} - ${p.hora_fin}` : 'Todo el día';
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

                    pData.data.forEach(p => {
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
                        document.getElementById("fecha_inicio").value = promo.fecha_inicio || "";
                        document.getElementById("fecha_fin").value = promo.fecha_fin || "";
                        document.getElementById("hora_inicio").value = promo.hora_inicio || "";
                        document.getElementById("hora_fin").value = promo.hora_fin || "";
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
                            // En esta versión, el backend guarda el producto beneficiado en id_item_condicion
                            document.getElementById("id_item_condicion_cruz_prod").value = promo.id_item_condicion;
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
                            const badgeColor = u.role === 'administrador' ? 'var(--primary)' : '#2196f3';
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

                        const indexExistente = itemsCargaTemporal.findIndex(item => item.id_producto === productoValido.id_producto);
                        if (indexExistente > -1) {
                            itemsCargaTemporal[indexExistente].cantidad += cantidad;
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
                                const tbodyHistorial = document.getElementById('tbodyHistorial');
                                tbodyHistorial.innerHTML = result.data.map(h => `
                            <tr>
                                <td>${h.fecha_modificacion}</td>
                                <td>Usuario #${h.id_usuario}</td>
                                <td><span class="badge ${h.accion === 'anulacion' ? 'bg-danger' : 'bg-warning'}">${h.accion}</span></td>
                                <td style="font-size: 12px;">${JSON.stringify(h.detalle_cambios)}</td>
                            </tr>
                        `).join("");
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
                            <td>${c.fecha_hora}</td>
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
                        listaProductosGlobal.forEach(prod => {
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

                const indexExistente = itemsCargaTemporal.findIndex(item => item.id_insumo === insumoValido.id_insumo);
                if (indexExistente > -1) {
                    itemsCargaTemporal[indexExistente].cantidad += cantidad;
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
                        const tbodyHistorial = document.getElementById('tbodyHistorialInsumo');
                        tbodyHistorial.innerHTML = result.data.map(h => `
                            <tr>
                                <td>${h.fecha_modificacion}</td>
                                <td>Usuario #${h.id_usuario}</td>
                                <td><span class="badge ${h.accion === 'anulacion' ? 'bg-danger' : 'bg-warning'}">${h.accion}</span></td>
                                <td style="font-size: 12px;">${JSON.stringify(h.detalle_cambios)}</td>
                            </tr>
                        `).join("");
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
                            <td>${c.fecha_hora}</td>
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
        const cardsReportes = document.querySelectorAll('.btn-reporte-card');
        const modalForm = document.getElementById('modalFormReporte');
        const modalVisor = document.getElementById('modalVisorReporte');
        const bodyForm = document.getElementById('bodyFormReporte');
        const tituloForm = document.getElementById('tituloFormReporte');
        const outlet = document.getElementById('router-outlet');
        let reporteActivo = '';
        outlet.addEventListener('click', function(e) {
        // Buscamos si el elemento clickeado o su padre tiene la clase .btn-reporte-card
        const card = e.target.closest('.btn-reporte-card');
        
        if (card) {
            const reporteActivo = card.dataset.reporte;

            if (reporteActivo === 'ultimos_cierres') {
                abrirModalListadoCierres();
                return;
            }

            prepararFiltros(reporteActivo);
            
            // Aseguramos que la clase 'show' se añada
            if (modalForm) {
                modalForm.classList.add('show');
            } else {
                console.error("No se encontró el modalFormReporte en el DOM");
            }
        }
    });
        // Efecto Hover simple con JS para no tocar CSS global
        cardsReportes.forEach(card => {
            card.addEventListener('mouseenter', () => card.style.transform = 'translateY(-4px)');
            card.addEventListener('mouseleave', () => card.style.transform = 'translateY(0)');
            
            // Al hacer click, prepara y abre el modal 1 (Filtros)
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

        // Inyectar dinámicamente los campos según el reporte clickeado
        function prepararFiltros(tipo) {
            bodyForm.innerHTML = ''; 
            if (tipo === 'jornada') {
                tituloForm.innerText = 'Reporte de Jornada';
                bodyForm.innerHTML = `
                    <div class="input-group">
                        <label>Seleccione la fecha de la jornada</label>
                        <input type="date" id="filtroFechaJornada" class="form-control" required>
                    </div>
                `;
                // Autocompletar con fecha de hoy
                document.getElementById('filtroFechaJornada').valueAsDate = new Date();
            } 
            else if (tipo === 'ingresos_semana') {
                tituloForm.innerText = 'Ingresos Semanales';
                bodyForm.innerHTML = `
                    <div class="input-group">
                        <label>Seleccione la semana</label>
                        <input type="week" id="filtroSemana" class="form-control" required>
                    </div>
                `;
            } 
            else if (tipo === 'ingresos_mes') {
                tituloForm.innerText = 'Ingresos Mensuales';
                bodyForm.innerHTML = `
                    <div class="input-group">
                        <label>Seleccione el mes</label>
                        <input type="month" id="filtroMes" class="form-control" required>
                    </div>
                `;
            }
        }
        // Inyectar dinámicamente los campos según el reporte clickeado
    function prepararFiltros(tipo) {
        bodyForm.innerHTML = ''; 
        if (tipo === 'jornada') {
            tituloForm.innerText = 'Reporte de Jornada';
            bodyForm.innerHTML = `
                <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                    <div class="input-group">
                        <label>Año</label>
                        <select id="cmbAnio" class="form-control"></select>
                    </div>
                    <div class="input-group">
                        <label>Mes</label>
                        <select id="cmbMes" class="form-control"></select>
                    </div>
                    <div class="input-group">
                        <label>Día</label>
                        <select id="cmbDia" class="form-control"></select>
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
                </div>
            `;
            inicializarCombosFecha();
        } 
        // ... (Aquí mantienes los ifs de ingresos_semana y ingresos_mes que ya tenías)
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

    // Botón procesar modificado con la Validación requerida
    document.getElementById('btnProcesarReporte').addEventListener('click', async () => {
        if (reporteActivo === 'jornada') {
            const idJornada = document.getElementById('cmbJornadaId')?.value;
            const chkApertura = document.getElementById('chkAperturaCierre').checked;
            const chkMesas = document.getElementById('chkMesas').checked;
            const chkProductos = document.getElementById('chkProductos').checked;
            const chkEgresos = document.getElementById('chkEgresos').checked;
            const chkInsumos = document.getElementById('chkInsumos').checked;

            if (!idJornada) {
                if(typeof mostrarToast !== 'undefined') mostrarToast("Debe seleccionar una jornada válida", "warning");
                return;
            }
            if (!chkApertura && !chkMesas && !chkProductos && !chkEgresos && !chkInsumos) {
                if(typeof mostrarToast !== 'undefined') mostrarToast("Debe seleccionar al menos un filtro", "warning");
                return;
            }

            modalForm.classList.remove('show');
            modalVisor.classList.add('show');
            
            const bodyContenido = document.getElementById('bodyContenidoReporte');
            document.getElementById('tituloVisorReporte').innerText = 'Reporte de Jornada';
            bodyContenido.innerHTML = '<div style="text-align:center; padding:3rem;"><i class="material-icons" style="animation: spin 1s linear infinite;">autorenew</i> Generando datos...</div>';

            try {
                // Fetch al backend pasando los filtros
                const queryParams = `tipo=jornada&id_jornada=${idJornada}&apertura=${chkApertura}&mesas=${chkMesas}&productos=${chkProductos}&egresos=${chkEgresos}&insumos=${chkInsumos}`;
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
    });

    // Creador dinámico del HTML del reporte
    function renderizarReporteJornada(d, contenedor) {
        let html = `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h1 style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 5px;">Reporte de Jornada</h1>
                <p style="text-align: center; font-size: 12px; color: #666; margin-top: 0;">La información de esta jornada corresponde a:</p>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #fff; padding: 15px; border: 1px solid #ddd; margin-bottom: 20px;">
                    <div><strong>N° Jornada:</strong> ${d.encabezado.id_jornada}</div>
                    <div><strong>Encargado:</strong> ${d.encabezado.encargado}</div>
                    <div><strong>Fecha y Hora de apertura:</strong> ${d.encabezado.apertura}</div>
                    <div><strong>Fecha y Hora de Cierre:</strong> ${d.encabezado.cierre || 'En curso'}</div>
                </div>
        `;

        if (d.filtros.apertura) {
            const totalCaja = parseFloat(d.apertura.monto_inicial) + parseFloat(d.apertura.ingreso_efectivo) + parseFloat(d.apertura.ingreso_qr) - parseFloat(d.apertura.total_egresos);
            html += `
                <h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #3b82f6;">Información de Caja</h3>
                <table class="data-table" style="width: 100%; margin-bottom: 20px;">
                    <thead style="background: #e2e8f0;"><tr><th>Monto Apertura</th><th>Ingresos Efectivo</th><th>Ingresos QR</th><th>Egresos</th><th>Total Estimado</th></tr></thead>
                    <tbody><tr>
                        <td class="text-center">$${d.apertura.monto_inicial}</td>
                        <td class="text-center text-success">$${d.apertura.ingreso_efectivo}</td>
                        <td class="text-center text-info">$${d.apertura.ingreso_qr}</td>
                        <td class="text-center text-danger">$${d.apertura.total_egresos}</td>
                        <td class="text-center"><strong>$${totalCaja.toFixed(2)}</strong></td>
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
                html += `<tr><td>${f.mesa}</td><td>${f.fecha_hora}</td><td>${f.tiempo_uso}</td><td>${f.metodo}</td><td class="text-right">$${f.total}</td></tr>`;
            });
            html += `</tbody></table>`;
            
            // CORRECCIÓN AQUÍ: Suma automatizada en base a la data real calculada en el backend
            const totalMs = parseFloat(d.mesas.resumen.efectivo) + parseFloat(d.mesas.resumen.qr);
            html += `<table class="data-table" style="width: 100%; margin-bottom: 20px; border: 2px solid #10b981;">
                        <thead style="background: #d1fae5;"><tr><th>Total Horas Jugadas</th><th>Ingresado Efectivo</th><th>Ingresado QR</th><th>TOTAL MESAS</th></tr></thead>
                        <tbody><tr>
                            <td class="text-center"><strong>${d.mesas.resumen.horas}</strong></td>
                            <td class="text-center text-success">$${d.mesas.resumen.efectivo}</td>
                            <td class="text-center text-info">$${d.mesas.resumen.qr}</td>
                            <td class="text-center"><strong>$${totalMs.toFixed(2)}</strong></td>
                        </tr></tbody>
                     </table>`;
        }

        // Tabla de Resumen de Productos Vendidos (JS)
        if (d.filtros.productos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #f59e0b;">Venta de Productos</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 10px;">
                        <thead style="background: #e2e8f0;"><tr><th>Modo</th><th>Fecha Hora</th><th>Cant. Prod.</th><th>Método</th><th>Total</th></tr></thead><tbody>`;
            d.productos.filas.forEach(f => {
                html += `<tr><td>${f.modo}</td><td>${f.fecha_hora}</td><td class="text-center">${f.cantidad}</td><td>${f.metodo}</td><td class="text-right">$${f.total}</td></tr>`;
            });
            html += `</tbody></table>`;
            
            // CORRECCIÓN AQUÍ: Lectura directa de la cantidad total de unidades e ingresos segregados
            const totalPd = parseFloat(d.productos.resumen.efectivo) + parseFloat(d.productos.resumen.qr);
            html += `<table class="data-table" style="width: 100%; margin-bottom: 20px; border: 2px solid #f59e0b;">
                        <thead style="background: #fef3c7;"><tr><th>Total Prod. Vendidos</th><th>Ingresado Efectivo</th><th>Ingresado QR</th><th>TOTAL PROD.</th></tr></thead>
                        <tbody><tr>
                            <td class="text-center"><strong>${d.productos.resumen.cantidad} uds.</strong></td>
                            <td class="text-center text-success">$${d.productos.resumen.efectivo}</td>
                            <td class="text-center text-info">$${d.productos.resumen.qr}</td>
                            <td class="text-center"><strong>$${totalPd.toFixed(2)}</strong></td>
                        </tr></tbody>
                     </table>`;
        }

        if (d.filtros.egresos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #ef4444;">Egresos de Caja</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 5px;">
                        <thead style="background: #e2e8f0;"><tr><th>Fecha Hora</th><th>Concepto</th><th>Monto</th></tr></thead><tbody>`;
            let tEg = 0;
            d.egresos.forEach(f => { tEg += parseFloat(f.monto); html += `<tr><td>${f.fecha}</td><td>${f.concepto}</td><td class="text-right text-danger">$${f.monto}</td></tr>`; });
            html += `</tbody></table><div class="text-right" style="margin-bottom: 20px; font-weight:bold;">Total Egresos: <span class="text-danger">$${tEg.toFixed(2)}</span></div>`;
        }

        if (d.filtros.insumos) {
            html += `<h3 style="background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #64748b;">Gasto de Insumos</h3>`;
            html += `<table class="data-table" style="width: 100%; font-size: 12px; margin-bottom: 5px;">
                        <thead style="background: #e2e8f0;"><tr><th>Fecha Hora</th><th>Insumo</th><th>Cantidad</th></tr></thead><tbody>`;
            let tIns = 0;
            d.insumos.forEach(f => { tIns += parseFloat(f.cantidad); html += `<tr><td>${f.fecha}</td><td>${f.insumo}</td><td class="text-center">${f.cantidad}</td></tr>`; });
            html += `</tbody></table><div class="text-right" style="margin-bottom: 20px; font-weight:bold;">Suma total cantidades: ${tIns.toFixed(2)}</div>`;
        }

        html += `</div>`;
        contenedor.innerHTML = html;
    }

        // Botón que gatilla el backend y pasa al Modal 2
        document.getElementById('btnProcesarReporte').addEventListener('click', async () => {
            modalForm.classList.remove('show');
            modalVisor.classList.add('show');
            
            const bodyContenido = document.getElementById('bodyContenidoReporte');
            document.getElementById('tituloVisorReporte').innerText = tituloForm.innerText;
            bodyContenido.innerHTML = '<div style="text-align:center; padding:3rem;"><i class="material-icons" style="animation: spin 1s linear infinite;">autorenew</i> Generando datos...</div>';

            // AQUÍ INICIAREMOS LA LÓGICA AJAX INDIVIDUAL LUEGO
            // const response = await fetch(`../backend/api/reportes.php?tipo=${reporteActivo}&filtro=...`);
            // ...
        });

        // Funcionalidad base para impresión
        document.getElementById('btnImprimirReporte').addEventListener('click', () => {
            const contenidoDiv = document.getElementById('bodyContenidoReporte').innerHTML;
            const ventana = window.open('', '', 'height=700,width=900');
            ventana.document.write('<html><head><title>Imprimir Reporte</title>');
            // Incluimos tu CSS para que el PDF se vea igual que el sistema
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
                                <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">${new Date(archivo.date).toLocaleString('es-ES')}</div>
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
        window.location.href = "index.html";
    });

    // Carga automática inicial del Dashboard
    navegarA("dashboard.html");
});