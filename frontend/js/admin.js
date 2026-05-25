document.addEventListener("DOMContentLoaded", () => {
    const outlet = document.getElementById("router-outlet");
    const menuToggle = document.getElementById("menuToggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const navItems = document.querySelectorAll(".nav-item[data-page]");

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
            });
        }

        // 2. MEJORA UX: Cerrar el modal si el usuario hace clic afuera de la caja blanca (en el fondo oscuro)
        if (e.target.classList.contains("modal")) {
            e.target.classList.remove("show");
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

        // Delegación de eventos (Editar / Eliminar)
        document.getElementById("router-outlet").addEventListener("click", (e) => {
            if (e.target.closest(".btn-editar-mesa")) {
                const id = e.target.closest(".btn-editar-mesa").dataset.id;
                configurarModalMesa("Editar Mesa", true, id);
            }
            if (e.target.closest(".btn-eliminar-mesa")) {
                const id = e.target.closest(".btn-eliminar-mesa").dataset.id;
                abrirModalEliminarMesa(id);
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

                    tbody.innerHTML += `
                    <tr>
                        <td style="font-size: 1.1rem; font-weight: bold; color: var(--primary);">${m.numero_mesa}</td>
                        <td>${m.nombre_tipo} <span style="color:#64748b; font-size:0.85rem;">(${parseFloat(m.precio_hora).toFixed(2)} Bs)</span></td>
                        <td>${badgeEstado}</td>
                        <td>
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
            selectMesa.innerHTML = selectCruzMesa.innerHTML = "";

            mData.data.forEach(m => {
                let opt = `<option value="${m.id_tipo_mesa}">${m.nombre_tipo} (${m.precio_hora} Bs/h)</option>`;
                selectMesa.innerHTML += opt;
                selectCruzMesa.innerHTML += opt;
            });

            // Llenamos selectores de Productos
            const selectProd = document.getElementById("id_item_condicion_prod");
            const select2x1 = document.getElementById("id_item_condicion_2x1");
            const selectCruzProd = document.getElementById("id_item_condicion_cruz_prod");
            selectProd.innerHTML = select2x1.innerHTML = selectCruzProd.innerHTML = "";

            pData.data.forEach(p => {
                let opt = `<option value="${p.id_producto}">${p.nombre_producto} (${p.precio_venta} Bs)</option>`;
                selectProd.innerHTML += opt;
                select2x1.innerHTML += opt;
                selectCruzProd.innerHTML += opt;
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
                    document.getElementById("id_item_condicion_cruz_prod").value = promo.id_item_condicion;
                    document.getElementById("valor_descuento_cruz").value = promo.valor_descuento;
                    document.getElementById("cantidad_condicion_cruz").value = promo.cantidad_condicion;
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

    // --- 6. LOGOUT ---
    document.getElementById("btnLogout").addEventListener("click", () => {
        localStorage.removeItem("usuario_nombre"); // Limpiar el almacenamiento
        window.location.href = "index.html";
    });

    // Carga automática inicial del Dashboard
    navegarA("dashboard.html");
});