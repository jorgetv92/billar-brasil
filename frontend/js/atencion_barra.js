let mesaSeleccionadaActual = "";
let modoActual = "barra"; // barra | mesa
let mesaPendienteOcupar = "";
window.idMesaPendiente = null;
window.intervaloMesas = null;

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

// Texto libre (descripciones que escribe el cajero) listo para insertar en HTML.
function escaparHTML(texto) {
    return String(texto == null ? "" : texto).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.gestorUI = {
    // === 0. PROPIEDADES DE ESTADO LOCAL ===
    apiURL: '../backend/api/atencion_barra.php',
    productosLocal: [], // Guarda la lista del backend [id, nombre completo, stock, precio]
    itemsCarrito: [], // Elementos actualmente añadidos al carrito de compras
    promocionesActivas: [], // Promociones vigentes obtenidas de la API
    conceptosCargo: [], // Conceptos para cobrar roturas o daños
    mesaIncentivoAsignada: null, // ID de mesa asignada en modal_apply_incentivoproducto en modo barra
    promoHoraBarra: null, // Promoción de hora con descuento elegida en el buscador (modo barra)
    flujoIncentivoPendiente: null, // Configuración activa del modal de incentivo
    cotizacion: null, // Barra: lo que el backend calculó para el carrito actual
    secuenciaCotizacion: 0,
    cotizacionPendiente: null,
    liquidacionMesa: null, // Mesa seleccionada: lo que se cobraría ahora, según el backend
    cobroEnCurso: null, // { modo, id_mesa, nombre, liquidacion } que muestra el modal de cobro abierto
    siguienteRefresco: 0, // Momento (ms) en que hay que volver a pedir importes, promos y precios
    refrescoEnCurso: null,
    INTERVALO_REFRESCO_MS: 60000,
    api: async function (cuerpo) {
        const response = await fetch(this.apiURL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        return response.json();
    },
    tarjetaSeleccionada: function () {
        if (!mesaSeleccionadaActual) return null;
        return Array.from(document.querySelectorAll('.mesa-card')).find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual) || null;
    },
    inicializar: async function () {
        await Promise.all([
            this.cargarGrillaMesas(),
            this.cargarDatalistProductos(),
            this.cargarPromocionesActivas(),
            this.cargarConceptosCargo()
        ]);
        this.limpiarCarrito();
        this.iniciarMotorReloj();
    },
    cargarPromocionesActivas: async function () {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_promociones_activas`);
            const result = await response.json();
            if (result.status === 'success') this.promocionesActivas = result.data || [];
        } catch (error) {
            console.error("Error al cargar promociones activas:", error);
        }
    },
    // Conceptos para cobrar roturas o daños, con su monto sugerido.
    cargarConceptosCargo: async function () {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_conceptos_cargo`);
            const result = await response.json();
            if (result.status === 'success') this.conceptosCargo = result.data || [];
        } catch (error) {
            console.error("Error al cargar conceptos de cargo:", error);
        }
    },
    // === 1. CARGA DE DATOS DESDE BACKEND (API) ===
    cargarGrillaMesas: async function () {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_datos_iniciales`);
            const tiposMesas = await response.json();
            console.log("tiposMesas=> ", tiposMesas);
            let contenedor = document.querySelector('.tipos-mesa-contenedor');
            // SEGURO SPA: Si no se encuentra, esperamos 50ms (da tiempo al router de inyectar el HTML)
            if (!contenedor) {
                await new Promise(resolve => setTimeout(resolve, 50));
                contenedor = document.querySelector('.tipos-mesa-contenedor');
            }
            if (!contenedor) {
                console.warn("Grilla en espera: '.tipos-mesa-contenedor' aún no aparece en el DOM.");
                return;
            }
            contenedor.innerHTML = '';
            tiposMesas.forEach(tipo => {
                let mesasHTML = tipo.mesas.map(m => {
                    const liq = m.liquidacion; // Lo que se cobraría ahora, calculado por el backend
                    let esOcupada = m.estado_actual === 'ocupada';
                    // Detectar pausa por la presencia de hora_pausa
                    let esPausada = esOcupada && m.hora_pausa && m.hora_pausa !== '' && m.hora_pausa !== null && m.hora_pausa !== 'null';
                    let cssClass = esPausada ? 'pausada' : (esOcupada ? 'ocupada' : 'disponible');
                    let displayInfo = '';
                    let tieneGratis = (parseInt(m.primera_hora_gratis) === 1);
                    let badgeGratis = tieneGratis ? `<span class="chip-promo">1ª H. c/ desc.</span>` : '';
                    if (esOcupada || esPausada) {
                        displayInfo = `<div class="mesa-info-resumen">
                            <span class="estado-badge ${esPausada ? 'pausada' : 'ocupada'}">${esPausada ? 'Pausada' : 'Ocupada'}</span>
                            ${badgeGratis}
                        </div>`;
                        // La inyección dinámica de "horasV:minV" e importe total la hace iniciarMotorReloj() en vivo para las mesas ocupadas/pausadas
                    } else {
                        displayInfo = `<span class="estado-badge libre">Disponible</span>`;
                    }
                    const retorno = `
                    <div class="mesa-card ${cssClass}" 
                        data-id="${m.id_mesa}" 
                        data-id-tipo-mesa="${tipo.id_tipo_mesa}"
                        data-nombre="${m.numero_mesa}"
                        data-estado="${m.estado_actual}"
                        data-hora-inicio="${m.fecha_hora_inicio || ''}"
                        data-hora-pausa="${m.hora_pausa || ''}"
                        data-consumo="${liq ? Number(liq.subtotal_productos).toFixed(2) : '0.00'}"
                        data-importe="${liq ? Number(liq.tiempo).toFixed(2) : '0.00'}"
                        data-total="${liq ? Number(liq.total).toFixed(2) : '0.00'}"
                        data-segundos-acumulados="${m.segundos_acumulados || 0}"
                        data-precio-hora="${tipo.precio_hora}"
                        data-primera-hora-gratis="${m.primera_hora_gratis || 0}"
                        onclick="gestorUI.clickMesa(this)">
                        <h4>${m.numero_mesa}</h4>
                        ${displayInfo}
                    </div>`;
                    return retorno
                }).join('');

                const badgePromoHeader = tipo.tiene_promocion ? `<span class="chip-promo" title="${tipo.nombre_promocion}"><i class="material-icons">sell</i>${tipo.nombre_promocion}</span>` : '';

                contenedor.innerHTML += `
                    <h3 class="tipo-mesa-titulo">${tipo.tipo_mesa} <small class="tipo-mesa-tarifa">${tipo.precio_hora} Bs/h</small> ${badgePromoHeader}</h3>
                    <div class="grid-mesas">${mesasHTML}</div>
                `;
            });
            // El próximo refresco toca cuando alguna mesa empiece un bloque nuevo, o al minuto como máximo.
            const esperas = tiposMesas.flatMap(t => t.mesas)
                .map(m => m.liquidacion && m.liquidacion.proximo_cambio)
                .filter(seg => seg > 0)
                .map(seg => seg * 1000);
            this.siguienteRefresco = Date.now() + Math.min(this.INTERVALO_REFRESCO_MS, ...esperas);
        } catch (error) {
            console.error("Error al cargar mesas:", error);
            this.siguienteRefresco = Date.now() + 10000;
        }
    },
    cargarDatalistProductos: async function () {
        try {
            const card = modoActual === "mesa" ? this.tarjetaSeleccionada() : null;
            const deMesa = card ? `&id_mesa=${card.getAttribute("data-id")}` : "";
            const response = await fetch(`${this.apiURL}?accion=get_productos_datalist${deMesa}`);
            const rawText = await response.text();
            try {
                this.productosLocal = JSON.parse(rawText);
            } catch (parseErr) {
                console.error("[Datalist] Respuesta no es JSON válido:", rawText.substring(0, 500));
                return;
            }
            if (!Array.isArray(this.productosLocal)) {
                console.error("[Datalist] La API no devolvió un array:", this.productosLocal);
                return;
            }
            // SEGURO SPA: Reintentar hasta 10 veces con 100ms de espera
            let datalist = null;
            for (let i = 0; i < 10; i++) {
                datalist = document.getElementById('listaProductos');
                if (datalist) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (!datalist) {
                console.warn("[Datalist] '#listaProductos' no encontrado en el DOM tras 1 segundo de espera.");
                return;
            }
            datalist.innerHTML = '';
            this.productosLocal.forEach(p => {
                let opt = document.createElement('option');
                opt.value = p.display_nombre;
                opt.dataset.id = p.id_producto;
                datalist.appendChild(opt);
            });
            console.log(`[Datalist] ${this.productosLocal.length} productos cargados correctamente en #listaProductos.`);
        } catch (error) {
            console.error("[Datalist] Error al cargar productos:", error);
        }
    },

    // === 2. GESTIÓN Y MECÁNICAS DEL CARRITO DE COMPRAS ===
    // El buscador tiene productos y combos (las opciones "Promo: ..."). Cada opción es un texto distinto,
    // así que un producto con "promo" en el nombre no se confunde con un combo.
    agregarProductoAlCarrito: async function () {
        const inputBusqueda = document.querySelector('.formulario-venta input[type="text"]');
        const inputCantidad = document.querySelector('.formulario-venta input[type="number"]');
        if (!inputBusqueda || !inputBusqueda.value.trim()) return;

        const valorTxt = inputBusqueda.value.trim();
        const producto = this.productosLocal.find(p => p.display_nombre === valorTxt);
        if (!producto) {
            alert("Por favor, selecciona un producto válido de la lista.");
            return;
        }

        const cantidad = parseInt(inputCantidad.value) || 1;
        if (cantidad <= 0) return;
        if (producto.es_incentivo) {
            await this.elegirIncentivo(producto, cantidad);
            return;
        }
        // Unidades con stock que pide: un producto suelto, o 2 por cada par 2x1. Un combo usa lo que alcanza el stock.
        const disponible = producto.es_combo ? producto.disponibles
            : producto.es_2x1 ? (producto.tipo_producto === 'preparado' ? null : Math.floor(producto.stock_producto / 2))
            : (producto.tipo === 'preparado' ? null : producto.stock);
        const conStock = disponible !== null && disponible !== undefined;
        if (conStock && cantidad > disponible) {
            alert(producto.es_combo ? `Stock insuficiente: alcanza para ${disponible} combo(s).`
                : producto.es_2x1 ? `Stock insuficiente: alcanza para ${disponible} par(es).`
                : `Stock insuficiente. Solo quedan ${producto.stock} unidades.`);
            return;
        }

        const precioUnitario = parseFloat(producto.precio);
        const nombreLimpio = producto.es_combo ? `Combo: ${producto.nombre_producto}`
            : producto.es_2x1 ? `Promo: ${producto.nombre_producto} (2 ${producto.producto})`
            : producto.display_nombre.split(" - ")[0];

        if (modoActual === "mesa") {
            // == MODO MESA: GUARDAR DIRECTO EN BD ==
            const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
            if (!mesaCard) return;
            const id_mesa_actual = mesaCard.getAttribute("data-id");

            if (producto.es_combo) {
                await this.agregarAMesa(id_mesa_actual, { combos: [{ id_combo: producto.id_combo, cantidad }] }, "Combo agregado a la mesa.");
                return;
            }
            if (producto.es_2x1) {
                await this.agregarAMesa(id_mesa_actual, { pares: [{ id_promocion: producto.id_promocion, cantidad }] }, "Promoción 2x1 agregada a la mesa.");
                return;
            }

            // Las promociones (2x1, hora con descuento) no se detectan solas: el cajero las elige en el buscador.
            await this.agregarAMesa(id_mesa_actual, { productos: [{ id_producto: producto.id_producto, cantidad }] }, "Producto agregado a la mesa.");
        } else {
            // == MODO BARRA: GUARDAR EN MEMORIA LOCAL ==
            const tipo = producto.es_combo ? 'combo' : producto.es_2x1 ? 'par' : 'producto';
            const itemExistente = this.itemsCarrito.find(item => item.tipo === tipo && (producto.es_combo
                ? item.id_combo === producto.id_combo
                : producto.es_2x1 ? item.id_promocion === producto.id_promocion
                : item.id_producto === producto.id_producto));
            if (itemExistente) {
                if (conStock && (itemExistente.cantidad + cantidad) > disponible) {
                    alert(`No puedes añadir esa cantidad. Supera el stock total disponible.`);
                    return;
                }
                itemExistente.cantidad += cantidad;
                itemExistente.total = itemExistente.cantidad * precioUnitario;
            } else {
                this.itemsCarrito.push({
                    tipo,
                    id_producto: producto.id_producto,
                    id_promocion: producto.id_promocion,
                    id_combo: producto.id_combo,
                    nombre: nombreLimpio,
                    precio: precioUnitario,
                    cantidad: cantidad,
                    total: cantidad * precioUnitario
                });
            }
            this.limpiarFormularioVenta();
            await this.cotizarCarrito();
        }
    },
    eliminarDelCarrito: async function (index) {
        if (modoActual === "mesa") {
            const item = this.itemsCarrito[index];
            const mesaCard = this.tarjetaSeleccionada();
            if (!item || !mesaCard) return;
            const idMesa = mesaCard.getAttribute("data-id");
            const cuerpo = item.tipo === 'cargo'
                ? { accion: "eliminar_cargo_mesa", id_mesa: idMesa, id_cargo: item.id_cargo }
                : { accion: "eliminar_producto_mesa", id_mesa: idMesa, id_detalle_prod: item.id_detalle_prod };
            try {
                const data = await this.api(cuerpo);
                if (data.status === "success") {
                    await this.cargarConsumoMesaActual(idMesa);
                    await this.cargarGrillaMesas();
                    await this.cargarDatalistProductos(); // Actualizar stock de buscador
                    this.pintarRelojes();
                } else {
                    window.mostrarToast(data.message, "error");
                }
            } catch (error) {
                console.error(error);
                window.mostrarToast("Error de conexión", "error");
            }
        } else if (index === -1) {
            // La fila de la hora con descuento: se quita la hora y quedan los productos.
            this.quitarHoraPromoDelCarrito();
            await this.cotizarCarrito();
        } else {
            this.itemsCarrito.splice(index, 1);
            await this.cotizarCarrito();
        }
    },
    limpiarFormularioVenta: function () {
        const inputBusqueda = document.querySelector('.formulario-venta input[type="text"]');
        const inputCantidad = document.querySelector('.formulario-venta input[type="number"]');
        if (inputBusqueda) inputBusqueda.value = "";
        if (inputCantidad) inputCantidad.value = "1";
    },
    limpiarCarrito: function () {
        this.itemsCarrito = [];
        this.quitarHoraPromoDelCarrito();
        this.cotizacion = null;
        this.secuenciaCotizacion++; // descarta una cotización que todavía estuviera en camino
        this.renderizarCarrito();
    },
    limpiarFormYCarrito: function () {
        this.limpiarFormularioVenta();
        if (modoActual === "mesa") {
            if (this.itemsCarrito.length > 0) {
                this.abrirModal("modalConfirmarLimpieza");
            }
        } else {
            this.limpiarCarrito();
        }
    },
    ejecutarLimpiarConsumoMesa: async function () {
        if (modoActual !== "mesa") return;
        const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
        if (!mesaCard) return;
        try {
            const id_mesa_actual = mesaCard.getAttribute("data-id");
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accion: "limpiar_consumo_mesa",
                    id_mesa: id_mesa_actual
                })
            });
            const data = await response.json();
            if (data.status === "success") {
                this.cerrarModal("modalConfirmarLimpieza");
                await this.cargarConsumoMesaActual(id_mesa_actual);
                await this.cargarGrillaMesas();
                await this.cargarDatalistProductos();
                window.mostrarToast("Mesa limpiada y stock devuelto", "success");
            } else {
                window.mostrarToast(data.message, "error");
            }
        } catch (error) {
            console.error(error);
            window.mostrarToast("Error de conexión", "error");
        }
    },
    // Consumo y total de la mesa tal como se cobrarían ahora, según el backend.
    // Consumo, cargos y total de la mesa tal como se cobrarían ahora, según el backend.
    cargarConsumoMesaActual: async function (id_mesa) {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_liquidacion_mesa&id_mesa=${id_mesa}`);
            const data = await response.json();
            if (data.status === "success") {
                const liq = data.liquidacion;
                this.liquidacionMesa = liq;
                this.itemsCarrito = liq.productos.map(prod => ({
                    tipo: 'producto',
                    id_detalle_prod: prod.id_detalle_prod,
                    id_producto: prod.id_producto,
                    nombre: prod.grupo ? `${prod.nombre} (${prod.grupo})` : prod.nombre,
                    combo: prod.grupo,
                    precio: Number(prod.precio),
                    cantidad: parseInt(prod.cantidad),
                    total: Number(prod.subtotal)
                })).concat(this.agruparCargos(liq.cargos).map(c => ({
                    // Cargos iguales van en una línea; el tacho quita uno (el último que se agregó).
                    tipo: 'cargo',
                    id_cargo: c.ids[c.ids.length - 1],
                    nombre: c.descripcion,
                    es_hora_gratis: c.tipo === 'hora_gratis',
                    precio: c.monto,
                    cantidad: c.cantidad,
                    total: c.total
                })));
            } else {
                this.liquidacionMesa = null;
                this.itemsCarrito = [];
            }
            this.renderizarCarrito();
        } catch (error) {
            console.error("Error al obtener consumo de la mesa:", error);
        }
    },
    cargarHistorialTramos: async function (id_mesa) {
        // SEGURO DOM: Esperar hasta que el tbody esté disponible en el DOM (hasta 500ms)
        let tbody = document.querySelector('#tablaHistorialTramos tbody');
        if (!tbody) {
            await new Promise(resolve => setTimeout(resolve, 80));
            tbody = document.querySelector('#tablaHistorialTramos tbody');
        }
        if (!tbody) {
            await new Promise(resolve => setTimeout(resolve, 150));
            tbody = document.querySelector('#tablaHistorialTramos tbody');
        }
        if (!tbody) {
            console.warn('cargarHistorialTramos: #tablaHistorialTramos tbody no encontrado tras esperar.');
            return;
        }
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:var(--gray); padding: 10px;">Cargando historial...</td></tr>';

        try {
            const response = await fetch(`${this.apiURL}?accion=get_historial_tramos&id_mesa=${id_mesa}`);
            const data = await response.json();

            // Re-adquirir referencia al tbody por si el DOM fue mutado durante el fetch
            const tbodyActual = document.querySelector('#tablaHistorialTramos tbody');
            if (!tbodyActual) return; // El usuario navegó fuera mientras se cargaba

            if (data.status === 'success') {
                if (data.data.length > 0) {
                    let html = '';
                    data.data.forEach(tramo => {
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

                        const importe = parseFloat(tramo.importe_tramo) || 0;

                        html += `
                            <tr>
                                <td>Mesa ${tramo.numero_mesa}</td>
                                <td>${strInicio}</td>
                                <td>${strFin}</td>
                                <td class="text-right">${importe.toFixed(2)}</td>
                            </tr>
                        `;
                    });
                    tbodyActual.innerHTML = html;
                } else {
                    tbodyActual.innerHTML = '<tr><td colspan="4" class="text-center" style="color:var(--gray); padding: 10px;">Sin historial de tiempo</td></tr>';
                }
            } else {
                tbodyActual.innerHTML = `<tr><td colspan="4" class="text-center text-danger" style="padding: 10px;">Error: ${data.message || 'Desconocido'}</td></tr>`;
            }
        } catch (error) {
            console.error("Error al cargar historial de tramos:", error);
            const tbodyActual = document.querySelector('#tablaHistorialTramos tbody');
            if (tbodyActual) tbodyActual.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error al cargar</td></tr>';
        }
    },
    // === Carrito: líneas, descuentos y totales los calcula el backend ===
    renderizarCarrito: function () {
        const tbody = document.querySelector('#tablaCarritoVenta tbody');
        if (!tbody) return;
        const fuente = modoActual === "mesa" ? this.liquidacionMesa : this.cotizacion;
        // En barra la hora con descuento no es una línea del carrito: la agrega el backend como cargo.
        const horaGratisBarra = modoActual !== "mesa" && this.mesaIncentivoAsignada && fuente
            ? (fuente.cargos || []).find(c => c.tipo === 'hora_gratis')
            : null;
        if (this.itemsCarrito.length === 0 && !horaGratisBarra) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: var(--gray); padding: 20px;">Carrito vacío</td></tr>`;
            this.actualizarTotalesVista();
            return;
        }
        const fila = (nombre, cantidad, precio, total, index, estilo = '') => `
                <tr style="${estilo}">
                    <td>${nombre}</td>
                    <td class="text-center">${cantidad}</td>
                    <td class="text-center">${Number(precio).toFixed(2)}</td>
                    <td class="text-right">${Number(total).toFixed(2)}</td>
                    <td class="text-center">
                        <button class="btn-icon btn-quitar" title="Quitar" onclick="gestorUI.eliminarDelCarrito(${index})">
                            <i class="material-icons">delete</i>
                        </button>
                    </td>
                </tr>`;
        const estiloCargo = 'background: var(--indigo-bg); color: var(--indigo-text);';
        let html = "";
        this.itemsCarrito.forEach((item, index) => {
            html += fila(item.nombre, item.cantidad, item.precio, item.total, index, item.tipo === 'cargo' ? estiloCargo : '');
        });
        if (horaGratisBarra) {
            html += fila(horaGratisBarra.descripcion, 1, horaGratisBarra.monto, horaGratisBarra.monto, -1, estiloCargo);
        }

        ((fuente && fuente.detalles) || []).forEach(d => {
            html += `
                <tr class="fila-promo">
                    <td colspan="3">🏷️ ${d.nombre} (${d.producto})</td>
                    <td class="text-right">-${Number(d.monto).toFixed(2)}</td>
                    <td></td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        this.actualizarTotalesVista();
    },
    // Lo que se manda al backend para cotizar o cobrar el carrito de barra.
    pedidoCarrito: function () {
        const de = tipo => this.itemsCarrito.filter(i => i.tipo === tipo);
        return {
            productos: de('producto').map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad })),
            combos: de('combo').map(i => ({ id_combo: i.id_combo, cantidad: i.cantidad })),
            pares: de('par').map(i => ({ id_promocion: i.id_promocion, cantidad: i.cantidad })),
            cargos: de('cargo').map(i => ({ id_concepto: i.id_concepto || null, descripcion: i.nombre, monto: i.precio, cantidad: i.cantidad })),
            hora_gratis: !!this.mesaIncentivoAsignada,
            id_promo_hora: this.mesaIncentivoAsignada && this.promoHoraBarra ? this.promoHoraBarra.id_promocion : null
        };
    },
    // Barra: el backend fija precios y promos del carrito. Si llegan dos respuestas, vale la del último pedido.
    cotizarCarrito: function () {
        const promesa = this._cotizar(++this.secuenciaCotizacion);
        this.cotizacionPendiente = promesa;
        return promesa;
    },
    _cotizar: async function (secuencia) {
        if (this.itemsCarrito.length === 0) {
            this.cotizacion = null;
            this.renderizarCarrito();
            return null;
        }
        let data;
        try {
            data = await this.api(Object.assign({ accion: "cotizar_carrito" }, this.pedidoCarrito()));
        } catch (error) {
            console.error("Error al cotizar el carrito:", error);
            window.mostrarToast("Error de conexión al calcular el total", "error");
            return null;
        }
        if (secuencia !== this.secuenciaCotizacion) return this.cotizacionPendiente;

        if (data.status === "success") {
            this.cotizacion = data.cotizacion;
            // Se muestran los precios que fijó el backend: pueden diferir de la lista si empezó o terminó una promo.
            // Lo que suman las líneas de cada combo y de cada par 2x1 (el backend reparte el precio entre sus productos)
            const totalGrupo = {};
            data.cotizacion.productos.forEach(linea => {
                const clave = linea.id_combo ? `combo-${linea.id_combo}` : linea.id_promocion ? `par-${linea.id_promocion}` : null;
                if (clave) {
                    totalGrupo[clave] = (totalGrupo[clave] || 0) + Number(linea.subtotal);
                    return;
                }
                const item = this.itemsCarrito.find(i => i.tipo === 'producto' && parseInt(i.id_producto) === parseInt(linea.id_producto));
                if (item) {
                    item.precio = Number(linea.precio);
                    item.total = Number(linea.subtotal);
                }
            });
            this.itemsCarrito.filter(i => i.tipo === 'combo' || i.tipo === 'par').forEach(item => {
                const clave = item.tipo === 'combo' ? `combo-${item.id_combo}` : `par-${item.id_promocion}`;
                if (totalGrupo[clave] !== undefined) {
                    item.total = totalGrupo[clave];
                    item.precio = item.total / item.cantidad;
                }
            });
            this.renderizarCarrito();
            return this.cotizacion;
        }
        if (data.codigo === "promo_no_vigente") {
            // Terminó la hora con descuento o un combo: se quitan y se vuelve a cotizar.
            if (this.mesaIncentivoAsignada) this.quitarHoraPromoDelCarrito();
            else this.itemsCarrito = this.itemsCarrito.filter(i => i.tipo !== 'combo' && i.tipo !== 'par');
            window.mostrarToast(data.message, "warning");
            await this.cargarDatalistProductos();
            return this.cotizarCarrito();
        }
        this.cotizacion = null;
        this.renderizarCarrito();
        window.mostrarToast(data.message || "No se pudo calcular el total", "error");
        return null;
    },
    quitarHoraPromoDelCarrito: function () {
        this.mesaIncentivoAsignada = null;
        this.promoHoraBarra = null;
    },
    // === Cargos: roturas, daños. Se arma una lista con cantidades y se agrega todo de una vez.
    // El concepto sugiere el monto; el cajero puede cambiarlo. ===
    cargosModal: [], // [{ id_concepto, descripcion, monto, cantidad }]
    abrirModalCargo: async function () {
        if (!this.conceptosCargo.length) await this.cargarConceptosCargo();
        const mesaCard = modoActual === "mesa" ? this.tarjetaSeleccionada() : null;
        document.getElementById("lblDestinoCargo").textContent = mesaCard
            ? `Se suman a ${mesaCard.getAttribute("data-nombre")}`
            : "Se suman a la venta en barra";
        document.getElementById("listaConceptosCargo").innerHTML = this.conceptosCargo.map(c => `
            <button type="button" class="cargo-concepto" data-id="${c.id_concepto}" onclick="gestorUI.sumarConceptoCargo(${parseInt(c.id_concepto)})">
                <span class="cargo-concepto-nombre">${escaparHTML(c.nombre)}</span>
                <span class="cargo-concepto-precio">${Number(c.monto_sugerido).toFixed(2)} Bs</span>
            </button>`).join('') + `
            <button type="button" class="cargo-concepto cargo-concepto-otro" onclick="gestorUI.mostrarCargoOtro()">
                <span class="cargo-concepto-nombre">Otro</span>
                <span class="cargo-concepto-precio"><i class="material-icons" style="font-size:16px;">edit</i>Escribir</span>
            </button>`;
        this.cargosModal = [];
        document.getElementById("formCargoOtro").classList.add("hidden");
        document.getElementById("inputDescripcionCargo").value = "";
        document.getElementById("inputMontoCargo").value = "";
        this.renderizarCargosModal();
        document.getElementById("modalAgregarCargo").classList.remove("hidden");
    },
    cerrarModalCargo: function () {
        this.cargosModal = [];
        document.getElementById("modalAgregarCargo").classList.add("hidden");
    },
    // Suma una unidad del concepto (si ya está en la lista con el mismo monto, sube la cantidad).
    sumarConceptoCargo: function (idConcepto) {
        const concepto = this.conceptosCargo.find(c => parseInt(c.id_concepto) === parseInt(idConcepto));
        if (!concepto) return;
        this.sumarCargoModal({ id_concepto: parseInt(concepto.id_concepto), descripcion: concepto.nombre, monto: Number(concepto.monto_sugerido) });
    },
    mostrarCargoOtro: function () {
        const form = document.getElementById("formCargoOtro");
        form.classList.remove("hidden");
        document.getElementById("inputDescripcionCargo").focus();
    },
    agregarCargoOtro: function () {
        const descripcion = document.getElementById("inputDescripcionCargo").value.trim();
        const monto = parseFloat(document.getElementById("inputMontoCargo").value);
        if (!descripcion || !(monto > 0)) {
            window.mostrarToast("Escriba la descripción y un monto mayor a cero.", "warning");
            return;
        }
        this.sumarCargoModal({ id_concepto: null, descripcion, monto });
        document.getElementById("inputDescripcionCargo").value = "";
        document.getElementById("inputMontoCargo").value = "";
        document.getElementById("formCargoOtro").classList.add("hidden");
    },
    sumarCargoModal: function (cargo) {
        const igual = this.cargosModal.find(c => c.id_concepto === cargo.id_concepto
            && c.descripcion === cargo.descripcion && Math.abs(c.monto - cargo.monto) < 0.001);
        if (igual) igual.cantidad++;
        else this.cargosModal.push(Object.assign({ cantidad: 1 }, cargo));
        this.renderizarCargosModal();
    },
    cambiarCantidadCargo: function (index, delta) {
        const cargo = this.cargosModal[index];
        if (!cargo) return;
        cargo.cantidad = Math.min(50, cargo.cantidad + delta);
        if (cargo.cantidad < 1) this.cargosModal.splice(index, 1);
        this.renderizarCargosModal();
    },
    cambiarMontoCargo: function (index, valor) {
        const cargo = this.cargosModal[index];
        if (!cargo) return;
        cargo.monto = parseFloat(valor) || 0;
        this.renderizarCargosModal(false);
    },
    quitarCargoModal: function (index) {
        this.cargosModal.splice(index, 1);
        this.renderizarCargosModal();
    },
    // conLista = false: solo totales (para no perder el foco mientras se escribe un monto).
    renderizarCargosModal: function (conLista = true) {
        const lista = document.getElementById("listaCargosModal");
        if (conLista) {
            lista.innerHTML = this.cargosModal.length === 0
                ? `<div class="cargo-vacio">Todavía no hay cargos. Toque un concepto de arriba.</div>`
                : this.cargosModal.map((c, i) => `
                <div class="cargo-item">
                    <div class="cargo-item-nombre">${escaparHTML(c.descripcion)}
                        <div class="cargo-item-unitario">
                            <input type="number" step="0.50" min="0.50" inputmode="decimal" value="${c.monto.toFixed(2)}" aria-label="Monto por unidad"
                                oninput="gestorUI.cambiarMontoCargo(${i}, this.value)"> Bs c/u
                        </div>
                    </div>
                    <div class="cargo-stepper">
                        <button type="button" title="Quitar uno" onclick="gestorUI.cambiarCantidadCargo(${i}, -1)"><i class="material-icons">remove</i></button>
                        <span>${c.cantidad}</span>
                        <button type="button" title="Sumar uno" onclick="gestorUI.cambiarCantidadCargo(${i}, 1)"><i class="material-icons">add</i></button>
                    </div>
                    <div class="cargo-item-total" data-total="${i}"></div>
                    <button type="button" class="cargo-item-quitar" title="Quitar" onclick="gestorUI.quitarCargoModal(${i})"><i class="material-icons">delete_outline</i></button>
                </div>`).join('');
        }
        this.cargosModal.forEach((c, i) => {
            const celda = lista.querySelector(`[data-total="${i}"]`);
            if (celda) celda.textContent = `${(c.monto * c.cantidad).toFixed(2)} Bs`;
        });
        document.querySelectorAll("#listaConceptosCargo .cargo-concepto[data-id]").forEach(b => {
            b.classList.toggle("activo", this.cargosModal.some(c => String(c.id_concepto) === b.getAttribute("data-id")));
        });
        const unidades = this.cargosModal.reduce((s, c) => s + c.cantidad, 0);
        const total = this.cargosModal.reduce((s, c) => s + c.monto * c.cantidad, 0);
        document.getElementById("lblTotalCargosModal").textContent = `${total.toFixed(2)} Bs`;
        document.getElementById("lblBotonCargos").textContent = unidades > 0 ? `Agregar ${unidades} ${unidades === 1 ? 'cargo' : 'cargos'}` : "Agregar";
        document.getElementById("btnConfirmarCargos").disabled = unidades === 0;
    },
    confirmarCargo: async function () {
        const cargos = this.cargosModal.map(c => ({ id_concepto: c.id_concepto, descripcion: c.descripcion, monto: c.monto, cantidad: c.cantidad }));
        if (!cargos.length) {
            window.mostrarToast("Agregue al menos un cargo.", "warning");
            return;
        }
        if (cargos.some(c => !(c.monto > 0))) {
            window.mostrarToast("Cada cargo debe tener un monto mayor a cero.", "warning");
            return;
        }
        const unidades = cargos.reduce((s, c) => s + c.cantidad, 0);
        const btn = document.getElementById("btnConfirmarCargos");
        const originalHTML = setBtnLoading(btn, true);
        try {
            if (modoActual === "mesa") {
                const mesaCard = this.tarjetaSeleccionada();
                if (!mesaCard) return;
                const data = await this.api({ accion: "agregar_cargo_mesa", id_mesa: mesaCard.getAttribute("data-id"), cargos });
                if (data.status !== "success") {
                    window.mostrarToast(data.message || "No se pudieron agregar los cargos", "error");
                    return;
                }
                await this.cargarConsumoMesaActual(mesaCard.getAttribute("data-id"));
                await this.cargarGrillaMesas();
                this.pintarRelojes();
            } else {
                cargos.forEach(c => {
                    const igual = this.itemsCarrito.find(i => i.tipo === 'cargo' && (i.id_concepto || null) === c.id_concepto
                        && i.nombre === c.descripcion && Math.abs(i.precio - c.monto) < 0.001);
                    if (igual) {
                        igual.cantidad += c.cantidad;
                        igual.total = igual.precio * igual.cantidad;
                    } else {
                        this.itemsCarrito.push({ tipo: 'cargo', id_concepto: c.id_concepto, nombre: c.descripcion, precio: c.monto, cantidad: c.cantidad, total: c.monto * c.cantidad });
                    }
                });
                await this.cotizarCarrito();
            }
            this.cerrarModalCargo();
            window.mostrarToast(unidades === 1 ? "Cargo agregado." : `${unidades} cargos agregados.`, "success");
        } finally {
            setBtnLoading(btn, false, originalHTML);
            if (this.cargosModal.length === 0) btn.disabled = true;
        }
    },
    // Cargos iguales (mismo tipo, descripción y monto) en una sola línea con su cantidad.
    agruparCargos: function (cargos) {
        const grupos = [];
        (cargos || []).forEach(c => {
            const monto = Number(c.monto);
            const igual = grupos.find(g => g.tipo === c.tipo && g.descripcion === c.descripcion && Math.abs(g.monto - monto) < 0.001);
            if (igual) {
                igual.cantidad++;
                igual.total += monto;
                igual.ids.push(c.id_cargo);
            } else {
                grupos.push({ tipo: c.tipo, descripcion: c.descripcion, monto, cantidad: 1, total: monto, ids: [c.id_cargo] });
            }
        });
        return grupos;
    },
    // === 3. CENTRALIZADOR DE TRANSICIONES Y NAVEGACIÓN (MÓVIL / SPA) ===
    cambiarEstadoLayout: function (nuevaClaseEstado) {
        const layout = document.querySelector(".atencion-layout");
        if (layout) {
            layout.classList.remove("state-barra", "state-seleccionando", "state-mesa-info", "state-mesa-consumo");
            layout.classList.add(nuevaClaseEstado);
        }
    },
    // =========================================================================
    // MOTOR DE TRANSICIONES MÓVIL ("EFECTO CORTINA")
    // La barra (tab) es el borde que se desplaza. El contenido NO se mueve: queda
    // fijo en su posición y se va revelando u ocultando detrás de la barra. El footer
    // de acciones de mesa entra/sale por el borde inferior de la pantalla.
    // Uso: this.transicionLayout(() => { ...cambios de DOM / cambiarEstadoLayout... });
    // =========================================================================
    DURACION_TRANSICION_MS: 300,
    _animLayout: null,
    esVistaMovil: function () {
        return window.matchMedia("(max-width: 768px)").matches;
    },
    _medirLayout: function (layout, el) {
        const base = layout.getBoundingClientRect();
        const medir = (e) => {
            const r = e.getBoundingClientRect();
            return r.height > 0 ? { top: r.top - base.top, h: r.height } : null;
        };
        const tabIzq = medir(el.tabIzq);
        const tabDer = medir(el.tabDer);
        let barra = null;
        if (tabIzq) barra = Object.assign({ el: el.tabIzq }, tabIzq);
        else if (tabDer) barra = Object.assign({ el: el.tabDer }, tabDer);
        return { H: base.height, barra, izq: medir(el.contIzq), der: medir(el.contDer), footer: medir(el.footer) };
    },
    // Foto del contenido izquierdo saliente (para poder "taparlo" aunque el DOM real ya cambió)
    _clonarContenido: function (origen) {
        const cs = getComputedStyle(origen);
        const fondoPanel = getComputedStyle(origen.parentElement).backgroundColor;
        const nodo = origen.cloneNode(true);
        nodo.removeAttribute("id");
        nodo.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
        nodo.setAttribute("aria-hidden", "true");
        Object.assign(nodo.style, {
            position: "absolute", left: "0", right: "0", margin: "0", zIndex: "1",
            display: "flex", flexDirection: "column", boxSizing: "border-box", overflow: "hidden",
            paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
            paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
            pointerEvents: "none",
            background: (fondoPanel && fondoPanel !== "rgba(0, 0, 0, 0)") ? fondoPanel : getComputedStyle(document.body).backgroundColor
        });
        return { nodo, scroll: origen.scrollTop };
    },
    transicionLayout: function (aplicarCambios) {
        if (this._animLayout) this._animLayout.terminar();

        const layout = document.querySelector(".atencion-layout");
        const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const el = {
            panelIzq: document.getElementById("panelIzquierdo"),
            panelDer: document.getElementById("panelDerecho"),
            tabIzq: document.getElementById("tabIzquierdo"),
            tabDer: document.getElementById("tabDerecho"),
            contIzq: document.getElementById("contenidoIzquierdo"),
            contDer: document.getElementById("contenidoDerecho"),
            footer: document.getElementById("footerAccionesMesa"),
            vistaConMesa: document.getElementById("vistaConMesa"),
            txtTabDer: document.getElementById("txtTabDerecho"),
            icoTabDer: document.getElementById("icoTabDerecho"),
            txtTabIzq: document.getElementById("txtTabIzquierdo"),
            icoTabIzq: document.getElementById("icoTabIzquierdo")
        };
        if (!layout || !this.esVistaMovil() || reducirMovimiento || Object.values(el).some(e => !e)) {
            aplicarCambios();
            return;
        }

        // 1. Foto del estado de origen
        const antes = this._medirLayout(layout, el);
        const vistaMesaAntes = !el.vistaConMesa.classList.contains("hidden");
        const clon = antes.izq ? this._clonarContenido(el.contIzq) : null;

        // 2. Aplicar el estado destino (síncrono, sin pintar todavía)
        aplicarCambios();
        const despues = this._medirLayout(layout, el);
        if (!antes.barra || !despues.barra) return;

        const cambioVistaIzq = vistaMesaAntes !== !el.vistaConMesa.classList.contains("hidden");
        if (cambioVistaIzq) el.contIzq.scrollTop = 0;

        // 3. Geometría de la animación (coordenadas relativas al layout)
        const H = despues.H;
        const T = despues.barra.h;
        const y0 = antes.barra.top, y1 = despues.barra.top;
        const rectIzq = despues.izq || antes.izq;          // contenido izquierdo: anclado arriba
        const rectDer = despues.der || antes.der;          // contenido derecho: fijo en su sitio
        const hayFooter = !!(despues.footer || antes.footer);
        const f0 = antes.footer ? antes.footer.top : H;    // H = fuera de pantalla (abajo)
        const f1 = despues.footer ? despues.footer.top : H;
        const usarClon = !!clon && cambioVistaIzq;
        const cortinaClon = usarClon && !!despues.izq;     // la vista nueva aparece en el mismo lugar

        // 4. Tomar control del layout con posicionamiento absoluto
        const tocados = new Map();
        const set = (e, prop, val) => {
            e.style.setProperty(prop, val, "important");
            if (!tocados.has(e)) tocados.set(e, new Set());
            tocados.get(e).add(prop);
        };
        set(layout, "position", "relative");
        [el.panelIzq, el.panelDer].forEach(p => {
            set(p, "position", "absolute"); set(p, "left", "0"); set(p, "right", "0");
            set(p, "margin", "0"); set(p, "flex", "none"); set(p, "overflow", "hidden");
            set(p, "min-height", "0"); set(p, "max-height", "none");
        });
        set(el.panelIzq, "top", "0"); set(el.panelIzq, "z-index", "1");
        set(el.panelDer, "z-index", "2");

        // Una sola barra móvil: el tab derecho (va pegado arriba del panel derecho)
        set(el.tabIzq, "display", "none");
        set(el.tabDer, "display", "flex");
        set(el.tabDer, "position", "relative");
        set(el.tabDer, "z-index", "2");
        const etiquetaTabDer = [el.txtTabDer.textContent, el.icoTabDer.textContent];
        const cambiarEtiqueta = despues.barra.el === el.tabIzq;
        if (cambiarEtiqueta) {
            el.txtTabDer.textContent = el.txtTabIzq.textContent;
            el.icoTabDer.textContent = el.icoTabIzq.textContent;
        }

        if (rectIzq) {
            set(el.contIzq, "display", "flex"); set(el.contIzq, "position", "absolute");
            set(el.contIzq, "left", "0"); set(el.contIzq, "right", "0");
            set(el.contIzq, "top", rectIzq.top + "px"); set(el.contIzq, "height", rectIzq.h + "px");
        }
        if (rectDer) {
            set(el.contDer, "display", "flex"); set(el.contDer, "position", "absolute");
            set(el.contDer, "left", "0"); set(el.contDer, "right", "0");
            set(el.contDer, "height", rectDer.h + "px");
        } else {
            set(el.contDer, "display", "none");
        }
        if (hayFooter) {
            set(el.footer, "display", "flex"); set(el.footer, "position", "absolute");
            set(el.footer, "left", "0"); set(el.footer, "right", "0");
            set(el.footer, "margin", "0"); set(el.footer, "z-index", "3");
        }
        if (usarClon) {
            clon.nodo.style.top = antes.izq.top + "px";
            clon.nodo.style.height = antes.izq.h + "px";
            el.panelIzq.appendChild(clon.nodo);
            clon.nodo.scrollTop = clon.scroll;
        }

        // 5. Pintado de un fotograma (p = progreso suavizado 0..1)
        const lerp = (a, b, p) => a + (b - a) * p;
        const finDer = rectDer ? rectDer.top + rectDer.h : 0;
        const pintar = (p) => {
            const barY = lerp(y0, y1, p);
            set(el.panelIzq, "height", barY + "px");
            set(el.panelDer, "top", barY + "px");
            set(el.panelDer, "height", Math.max(T, finDer - barY) + "px");
            if (rectDer) {
                // El contenido derecho no se mueve en pantalla; solo se recorta bajo la barra
                set(el.contDer, "top", (rectDer.top - barY) + "px");
                set(el.contDer, "clip-path", `inset(${Math.max(0, barY + T - rectDer.top)}px 0 0 0)`);
            }
            if (hayFooter) set(el.footer, "top", lerp(f0, f1, p) + "px");
            if (cortinaClon) clon.nodo.style.clipPath = `inset(${p * antes.izq.h}px 0 0 0)`;
        };

        // 6. Bucle de animación
        const suavizar = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const duracion = this.DURACION_TRANSICION_MS;
        let raf = null, inicio = null, terminada = false;
        const anim = {
            terminar: () => {
                if (terminada) return;
                terminada = true;
                if (raf) cancelAnimationFrame(raf);
                tocados.forEach((props, e) => props.forEach(prop => e.style.removeProperty(prop)));
                if (usarClon) clon.nodo.remove();
                if (cambiarEtiqueta) {
                    el.txtTabDer.textContent = etiquetaTabDer[0];
                    el.icoTabDer.textContent = etiquetaTabDer[1];
                }
                if (this._animLayout === anim) this._animLayout = null;
            }
        };
        this._animLayout = anim;
        pintar(0);
        const paso = (ts) => {
            if (inicio === null) inicio = ts;
            const t = Math.min(1, (ts - inicio) / duracion);
            pintar(suavizar(t));
            if (t < 1) raf = requestAnimationFrame(paso);
            else anim.terminar();
        };
        raf = requestAnimationFrame(paso);
    },
    clickMesa: function (elementoMesa) {
        const nombreMesa = elementoMesa.querySelector("h4").innerText;
        const idMesa = elementoMesa.getAttribute("data-id");
        const esLibre = elementoMesa.classList.contains("disponible") ||
            elementoMesa.getAttribute("data-estado") === "disponible" ||
            elementoMesa.querySelector(".estado-badge.disponible") !== null;
        if (esLibre) {
            this.abrirModalOcupar(nombreMesa, idMesa);
        } else {
            mesaSeleccionadaActual = nombreMesa;
            modoActual = "mesa";
            this.transicionLayout(() => {
                this.seleccionarMesa(nombreMesa, elementoMesa);
                if (this.esVistaMovil()) {
                    document.getElementById("tabDerecho").classList.remove("hidden");
                    document.getElementById("txtTabDerecho").innerText = `Consumo ${nombreMesa}`;
                    document.getElementById("icoTabDerecho").innerText = "keyboard_arrow_up";
                }
            });
        }
    },
    clickTabIzquierdo: function () {
        if (modoActual === "barra") {
            this.transicionLayout(() => {
                this.cambiarEstadoLayout("state-seleccionando");
                document.getElementById("txtTabDerecho").innerText = "Seleccionando Mesa";
                document.getElementById("icoTabDerecho").innerText = "close";
            });
        } else if (modoActual === "mesa") {
            this.transicionLayout(() => {
                this.cambiarEstadoLayout("state-mesa-info");
                document.getElementById("txtTabDerecho").innerText = `Consumo ${mesaSeleccionadaActual}`;
                document.getElementById("icoTabDerecho").innerText = "keyboard_arrow_up";
            });
        }
    },
    clickTabDerecho: function () {
        if (modoActual === "barra") {
            this.transicionLayout(() => {
                this.cambiarEstadoLayout("state-barra");
                document.getElementById("txtTabIzquierdo").innerText = "seleccionar mesa...";
                document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
            });
        } else if (modoActual === "mesa") {
            this.transicionLayout(() => {
                this.cambiarEstadoLayout("state-mesa-consumo");
                document.getElementById("txtTabIzquierdo").innerText = `Información ${mesaSeleccionadaActual}`;
                document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
                document.getElementById("lblTituloVenta").innerText = `Venta: ${mesaSeleccionadaActual}`;
            });
        }
    },
    seleccionarMesa: function (nombreMesa, elementoMesa) {
        modoActual = "mesa";
        mesaSeleccionadaActual = nombreMesa;
        const lblTituloVenta = document.getElementById("lblTituloVenta");
        if (lblTituloVenta) lblTituloVenta.innerText = `Venta: ${nombreMesa}`;
        const lblNombreMesa = document.getElementById("lblNombreMesaSeleccionada");
        if (lblNombreMesa) lblNombreMesa.innerText = nombreMesa;
        const vistaSinMesa = document.getElementById("vistaSinMesa");
        const vistaConMesa = document.getElementById("vistaConMesa");
        if (vistaSinMesa) vistaSinMesa.classList.add("hidden");
        if (vistaConMesa) vistaConMesa.classList.remove("hidden");
        const cardDetalle = document.querySelector('.detalle-mesa-card');
        if (cardDetalle) {
            const lblEstado = cardDetalle.querySelector('.detalle-estado strong');
            const rowsIzq = cardDetalle.querySelectorAll('.col-izq .detalle-row strong');
            const rowsDer = cardDetalle.querySelectorAll('.col-der .detalle-row strong');

            const horaPausaData = elementoMesa.getAttribute('data-hora-pausa');
            const estaPausada = horaPausaData && horaPausaData !== 'null' && horaPausaData !== '';

            if (lblEstado) {
                if (estaPausada) {
                    lblEstado.innerText = "Pausada";
                    lblEstado.className = "text-warning"; // Cambia a color naranja de advertencia/pausa
                } else {
                    lblEstado.innerText = "Ocupada";
                    lblEstado.className = "text-danger";
                }
            }
            let horaBD = elementoMesa.getAttribute("data-hora-inicio");
            if (horaBD && horaBD !== "null" && horaBD !== "") {
                let f = new Date(horaBD.replace(/-/g, '/'));
                let hh = f.getHours().toString().padStart(2, '0');
                let mm = f.getMinutes().toString().padStart(2, '0');
                if (rowsIzq[0]) rowsIzq[0].innerText = `${hh}:${mm}`;
            } else {
                if (rowsIzq[0]) rowsIzq[0].innerText = "--:--";
            }
            if (rowsIzq[1]) rowsIzq[1].innerText = elementoMesa.getAttribute("data-tiempo") || "00:00:00";
            if (rowsDer[0]) rowsDer[0].innerText = (elementoMesa.getAttribute("data-importe") || "0.00") + " Bs";
            if (rowsDer[1]) rowsDer[1].innerText = (elementoMesa.getAttribute("data-consumo") || "0.00") + " Bs";
        }
        const footerBarra = document.getElementById("footerVentaBarra");
        const footerMesa = document.getElementById("footerAccionesMesa");
        if (footerMesa) footerMesa.classList.remove("hidden");
        if (footerBarra) footerBarra.classList.add("hidden");
        // == CONTROL DE BOTÓN PAUSA SEGÚN TIPO DE MESA (REGLA DE NEGOCIO) ==
        const btnPausa = footerMesa ? footerMesa.querySelector('.btn-accion:first-child') : null;
        if (btnPausa) {
            const precioHora = parseFloat(elementoMesa.getAttribute('data-precio-hora')) || 0;
            if (precioHora === 0) {
                // Deshabilitar botón para Mesas de Consumo sin cobro por tiempo
                btnPausa.className = 'btn-accion';
                btnPausa.style.opacity = '0.5';
                btnPausa.style.cursor = 'not-allowed';
                btnPausa.disabled = true;
                btnPausa.innerHTML = '<i class="material-icons">timer_off</i> <span class="txt-btn">Tiempo Sin Costo</span>';
            } else {
                // Habilitar y configurar normalmente para mesas con tarifa activa
                btnPausa.style.opacity = '1';
                btnPausa.style.cursor = 'pointer';
                btnPausa.disabled = false;
                const horaPausaData = elementoMesa.getAttribute('data-hora-pausa');
                const estaPausada = horaPausaData && horaPausaData !== 'null' && horaPausaData !== '';
                if (estaPausada) {
                    btnPausa.className = 'btn-accion btn-success';
                    btnPausa.innerHTML = '<i class="material-icons">play_arrow</i> <span class="txt-btn">Reanudar Tiempo</span>';
                } else {
                    btnPausa.className = 'btn-accion btn-warning';
                    btnPausa.innerHTML = '<i class="material-icons">pause</i> <span class="txt-btn">Pausar Tiempo</span>';
                }
            }
        }
        // No mostrar el total de la mesa anterior mientras llega el de esta.
        this.liquidacionMesa = null;
        this.cargarDatalistProductos();
        this.cargarConsumoMesaActual(elementoMesa.getAttribute("data-id"));
        // Diferir el historial un tick para asegurar que vistaConMesa ya está en el DOM
        const _idMesa = elementoMesa.getAttribute("data-id");
        setTimeout(() => this.cargarHistorialTramos(_idMesa), 0);
        this.cambiarEstadoLayout("state-mesa-info");
    },
    deseleccionarMesa: function () {
        // En móvil: la barra sube al top tapando la info de mesa y revelando el carrito,
        // y el footer de acciones baja fuera de pantalla antes de ocultarse.
        this.transicionLayout(() => this._aplicarDeseleccionMesa());
    },
    // Celular: sale de la mesa y muestra directamente la lista de mesas para elegir otra.
    volverAElegirMesa: function () {
        this.transicionLayout(() => {
            this._aplicarDeseleccionMesa();
            this.cambiarEstadoLayout("state-seleccionando");
            document.getElementById("txtTabDerecho").innerText = "Seleccionando Mesa";
            document.getElementById("icoTabDerecho").innerText = "close";
        });
    },
    _aplicarDeseleccionMesa: function () {
        modoActual = "barra";
        mesaSeleccionadaActual = "";
        this.cambiarEstadoLayout("state-barra");
        const vistaSinMesa = document.getElementById("vistaSinMesa");
        const vistaConMesa = document.getElementById("vistaConMesa");
        if (vistaConMesa) vistaConMesa.classList.add("hidden");
        if (vistaSinMesa) vistaSinMesa.classList.remove("hidden");
        document.getElementById("lblTituloVenta").innerText = "Venta: En Barra";
        const footerBarra = document.getElementById("footerVentaBarra");
        if (footerBarra) footerBarra.classList.remove("hidden");
        const btnDerecho = document.querySelector("#footerVentaBarra button");
        if (btnDerecho) {
            btnDerecho.innerText = "Realizar Venta";
            // Pasa por el flujo completo, que ofrece la hora con descuento cuando corresponde.
            btnDerecho.onclick = () => gestorUI.iniciarFlujoCobro('efectivo_qr');
        }
        // Limpiamos el carrito local (si era de una mesa, se limpiará la memoria temporal)
        this.liquidacionMesa = null;
        this.limpiarCarrito();
        this.cargarDatalistProductos();
        document.getElementById("footerAccionesMesa").classList.add("hidden");
        if (window.innerWidth <= 768) {
            document.getElementById("tabIzquierdo").classList.remove("hidden");
            document.getElementById("txtTabIzquierdo").innerText = "seleccionar mesa...";
            document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
        }
    },
    // =========================================================================
    // TOTALES DEL PIE: vienen del backend (cotización del carrito o liquidación de la mesa)
    // =========================================================================
    actualizarTotalesVista: function () {
        let texto = "0.00 Bs";
        if (modoActual === "mesa" && mesaSeleccionadaActual) {
            const card = this.tarjetaSeleccionada();
            const total = this.liquidacionMesa ? Number(this.liquidacionMesa.total) : (card ? parseFloat(card.getAttribute('data-total')) || 0 : 0);
            texto = `${total.toFixed(2)} Bs`;
            const rowsDer = document.querySelectorAll(".detalle-columnas .col-der strong");
            if (rowsDer[1] && this.liquidacionMesa) rowsDer[1].innerText = `${Number(this.liquidacionMesa.subtotal_productos).toFixed(2)} Bs`;
        } else if (this.itemsCarrito.length) {
            texto = this.cotizacion ? `${Number(this.cotizacion.total).toFixed(2)} Bs` : "Calculando...";
        }
        ["lblTotalUnificado", "lblTotalCarrito"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = texto;
        });
    },

    // =========================================================================
    // RELOJ: cada segundo corre el tiempo en pantalla. Los importes no se calculan aquí: cuando empieza un
    // bloque nuevo en alguna mesa (o pasa un minuto) se piden al backend junto con promos y precios.
    // =========================================================================
    segundosEnMesa: function (mesa, ahora) {
        const inicioStr = mesa.getAttribute('data-hora-inicio');
        if (!inicioStr || inicioStr === "null") return 0;
        const pausaStr = mesa.getAttribute('data-hora-pausa');
        const fin = (pausaStr && pausaStr !== "null") ? new Date(pausaStr.replace(/-/g, '/')).getTime() : ahora;
        const actual = Math.max(0, Math.floor((fin - new Date(inicioStr.replace(/-/g, '/')).getTime()) / 1000));
        return actual + (parseInt(mesa.getAttribute('data-segundos-acumulados')) || 0);
    },
    pintarRelojes: function () {
        const ahora = Date.now();
        const dos = n => n.toString().padStart(2, '0');
        document.querySelectorAll('.mesa-card.ocupada, .mesa-card.pausada').forEach(mesa => {
            const total = (parseFloat(mesa.getAttribute('data-total')) || 0).toFixed(2);
            const precioHora = parseFloat(mesa.getAttribute('data-precio-hora')) || 0;
            const resumen = mesa.querySelector('.mesa-info-resumen');
            let tiempo = "00:00:00";
            if (precioHora === 0) {
                if (resumen) resumen.innerHTML = `
                    <span class="estado-badge consumo">Consumo</span>
                    <span class="total-badge">${total} Bs</span>
                `;
            } else {
                const seg = this.segundosEnMesa(mesa, ahora);
                const hh = dos(Math.floor(seg / 3600));
                const mm = dos(Math.floor((seg % 3600) / 60));
                tiempo = `${hh}:${mm}:${dos(seg % 60)}`;
                const badgeGratis = mesa.getAttribute('data-primera-hora-gratis') === '1'
                    ? `<span class="chip-promo">1ª H. c/ desc.</span>`
                    : '';
                if (resumen) resumen.innerHTML = `
                    <span class="estado-badge reloj">${hh}:${mm} hrs</span>
                    <span class="total-badge">${total} Bs</span>
                    ${badgeGratis}
                `;
            }
            mesa.setAttribute('data-tiempo', tiempo);

            if (modoActual === "mesa" && mesaSeleccionadaActual === mesa.getAttribute('data-nombre')) {
                const importe = this.liquidacionMesa
                    ? Number(this.liquidacionMesa.tiempo).toFixed(2)
                    : (parseFloat(mesa.getAttribute('data-importe')) || 0).toFixed(2);
                const rowsIzq = document.querySelectorAll(".detalle-columnas .col-izq strong");
                const rowsDer = document.querySelectorAll(".detalle-columnas .col-der strong");
                if (rowsIzq[1]) rowsIzq[1].innerText = tiempo;
                if (rowsDer[0]) rowsDer[0].innerText = `${importe} Bs`;
                const lblTiempo = document.getElementById("lblTiempoMesa");
                const lblImporte = document.getElementById("lblImporteMesa");
                if (lblTiempo) lblTiempo.innerText = tiempo;
                if (lblImporte) lblImporte.innerText = `${importe} Bs`;
            }
        });
        if (modoActual === "mesa" && mesaSeleccionadaActual) this.actualizarTotalesVista();
    },
    // Devuelve la promesa del refresco en curso, para quien necesite esperarlo.
    actualizarRelojes: function () {
        this.pintarRelojes();
        if (Date.now() >= this.siguienteRefresco) return this.refrescarDatos();
        return this.refrescoEnCurso || undefined;
    },
    refrescarDatos: function () {
        if (this.refrescoEnCurso) return this.refrescoEnCurso;
        this.refrescoEnCurso = (async () => {
            try {
                await Promise.all([this.cargarGrillaMesas(), this.cargarPromocionesActivas(), this.cargarDatalistProductos()]);
                const card = this.tarjetaSeleccionada();
                if (modoActual === "mesa" && card) await this.cargarConsumoMesaActual(card.getAttribute("data-id"));
                else if (modoActual !== "mesa" && this.itemsCarrito.length) await this.cotizarCarrito();
                this.pintarRelojes();
            } catch (error) {
                console.error("Error al refrescar datos:", error);
                this.siguienteRefresco = Date.now() + 10000;
            } finally {
                this.refrescoEnCurso = null;
            }
        })();
        return this.refrescoEnCurso;
    },
    iniciarMotorReloj: function () {
        if (window.intervaloMesas) clearInterval(window.intervaloMesas);
        this.pintarRelojes();
        window.intervaloMesas = setInterval(() => this.actualizarRelojes(), 1000);
    },
    abrirModal: function (idModal) {
        if (idModal === 'modalConfirmarCobro') {
            if (modoActual === "barra" || modoActual === undefined) {
                if (this.itemsCarrito.length < 1) {
                    window.mostrarToast("Debe agregar productos al carrito para realizar una venta", "warning");
                } else {
                    document.getElementById(idModal).classList.remove('hidden');
                }
            } else {
                document.getElementById(idModal).classList.remove('hidden');
            }
        } else {
            document.getElementById(idModal).classList.remove('hidden');
        }
    },
    cerrarModal: async function (idModal) {
        document.getElementById(idModal).classList.add('hidden');
        if (idModal !== 'modalConfirmarCobro' && idModal !== 'modalDividirPago') return;
        const cobro = this.cobroEnCurso;
        this.cobroEnCurso = null;
        // Si se cancela el cobro en barra, la hora con descuento elegida en el buscador sigue en el carrito.
        if (window.mesaAutoPausada) await this.reanudarPausaSistema(cobro && cobro.id_mesa);
    },
    // Deshace la pausa que puso el sistema al abrir el cobro: el tiempo sigue como si no se hubiera pausado.
    reanudarPausaSistema: async function (idMesa) {
        window.mesaAutoPausada = false;
        const card = this.tarjetaSeleccionada();
        const id = idMesa || (card && card.getAttribute("data-id"));
        if (!id) return;
        try {
            await this.api({ accion: "reanudar_mesa", id_mesa: id, tipo_pausa: "sistema" });
            await this.cargarGrillaMesas();
            this.pintarRelojes();
        } catch (error) {
            console.error("Error al auto-reanudar:", error);
        }
    },
    // Abre el cobro de barra (pago único o mixto). La hora con descuento ya la eligió el cajero en el buscador.
    iniciarFlujoCobro: async function (tipoFlujo) {
        if (modoActual === 'barra' && this.itemsCarrito.length === 0) {
            window.mostrarToast('Debe agregar productos al carrito para realizar una venta', 'warning');
            return;
        }
        if (tipoFlujo === 'mixto') await this.prepararPagoDividido();
        else await this.abrirModalCobro();
    },
    // El cajero eligió en el buscador una promoción "N productos + 1 hora con descuento de mesa".
    // En una mesa ocupada se aplica a esa mesa; en barra se elige la mesa libre que se habilitará al cobrar.
    elegirIncentivo: async function (promo, cantidad) {
        if (cantidad !== 1) {
            window.mostrarToast("La hora con descuento se aplica una vez por mesa: se agrega 1 promoción.", "info");
        }
        const conStock = promo.tipo_producto !== 'preparado';
        if (conStock && promo.stock_producto < promo.cantidad_producto) {
            alert(`Stock insuficiente. Solo quedan ${promo.stock_producto} unidades.`);
            return;
        }

        if (modoActual === "mesa") {
            const mesaCard = this.tarjetaSeleccionada();
            if (!mesaCard) return;
            if (parseInt(mesaCard.getAttribute("data-id-tipo-mesa")) !== parseInt(promo.id_tipo_mesa)) {
                window.mostrarToast(`Esta promoción es para mesas de tipo ${promo.tipo_mesa}.`, "warning");
                return;
            }
            const yaTieneGratis = mesaCard.getAttribute("data-primera-hora-gratis") === "1"
                || !!(this.liquidacionMesa && this.liquidacionMesa.hora_gratis);
            if (yaTieneGratis) {
                window.mostrarToast("Esta mesa ya tiene la hora con descuento.", "warning");
                return;
            }
            await this.agregarAMesa(mesaCard.getAttribute("data-id"), {
                productos: [{ id_producto: promo.id_producto, cantidad: promo.cantidad_producto }],
                aplicar_hora_gratis: 1,
                id_promo_hora: promo.id_promocion
            }, "¡Promoción aplicada! 1 hora con descuento en la mesa y el monto adicional quedó como cargo.");
            return;
        }

        if (this.mesaIncentivoAsignada) {
            window.mostrarToast("Este carrito ya tiene una hora con descuento. Cobre esta venta antes de agregar otra.", "warning");
            return;
        }
        const mesasLibres = Array.from(document.querySelectorAll(`.mesa-card.disponible[data-id-tipo-mesa="${promo.id_tipo_mesa}"]`))
            .map(el => ({ id_mesa: el.getAttribute('data-id'), nombre: el.getAttribute('data-nombre') }));
        this.abrirModalIncentivoProducto(promo, mesasLibres);
    },
    abrirModalIncentivoProducto: function (promo, mesasLibres) {
        this.flujoIncentivoPendiente = promo;
        document.getElementById("lblNombrePromoIncentivo").innerText = promo.nombre_producto;
        document.getElementById("lblDetallePromoIncentivo").innerText =
            `${promo.cantidad_producto} ${promo.producto} + ${Number(promo.monto_adicional).toFixed(2)} Bs = 1 hora con descuento en ${promo.tipo_mesa}`;
        const select = document.getElementById("selectMesaIncentivo");
        const aviso = document.getElementById("lblAvisoMesasLibres");
        select.innerHTML = '<option value="">-- Seleccionar mesa libre --</option>'
            + mesasLibres.map(m => `<option value="${m.id_mesa}">${m.nombre}</option>`).join('');
        aviso.style.display = mesasLibres.length ? "none" : "block";
        document.getElementById("btnAceptarIncentivoProd").disabled = true;
        this.abrirModal('modal_apply_incentivoproducto');
    },
    onSeleccionarMesaIncentivo: function () {
        const select = document.getElementById("selectMesaIncentivo");
        document.getElementById("btnAceptarIncentivoProd").disabled = !(select && select.value !== "");
    },
    // Barra: agrega al carrito los productos de la promoción y reserva la mesa elegida para la hora con descuento.
    confirmarIncentivoProducto: async function () {
        const promo = this.flujoIncentivoPendiente;
        if (!promo) return;
        const select = document.getElementById("selectMesaIncentivo");
        if (!select || !select.value) {
            window.mostrarToast("Por favor, seleccione una mesa libre.", "warning");
            return;
        }
        const existente = this.itemsCarrito.find(i => i.tipo === 'producto' && parseInt(i.id_producto) === parseInt(promo.id_producto));
        if (existente) {
            existente.cantidad += promo.cantidad_producto;
        } else {
            const base = this.productosLocal.find(p => !p.es_combo && !p.es_2x1 && !p.es_incentivo && parseInt(p.id_producto) === parseInt(promo.id_producto));
            this.itemsCarrito.push({
                tipo: 'producto',
                id_producto: promo.id_producto,
                nombre: promo.producto,
                precio: base ? Number(base.precio) : 0,
                cantidad: promo.cantidad_producto,
                total: base ? Number(base.precio) * promo.cantidad_producto : 0
            });
        }
        this.mesaIncentivoAsignada = select.value;
        this.promoHoraBarra = { id_promocion: promo.id_promocion, nombre: promo.nombre_producto };
        this.cerrarModalIncentivo();
        this.limpiarFormularioVenta();
        await this.cotizarCarrito();
    },
    cerrarModalIncentivo: function () {
        this.cerrarModal('modal_apply_incentivoproducto');
        this.flujoIncentivoPendiente = null;
    },
    // Agrega productos, combos o la hora con descuento a una mesa. El precio lo fija el backend.
    agregarAMesa: async function (idMesa, pedido, mensajeExito) {
        try {
            const data = await this.api(Object.assign({ accion: "agregar_productos_mesa", id_mesa: idMesa }, pedido));
            if (data.status === "success") {
                this.limpiarFormularioVenta();
                await this.cargarConsumoMesaActual(idMesa);
                await this.cargarGrillaMesas();
                await this.cargarDatalistProductos();
                this.pintarRelojes();
                window.mostrarToast(mensajeExito, "success");
            } else if (data.codigo === "mesa_sin_partida") {
                await this.manejarErrorCobro(data, null);
            } else {
                window.mostrarToast(data.message || "Error al agregar a mesa", data.codigo ? "warning" : "error");
                if (data.codigo === "promo_no_vigente") await this.cargarDatalistProductos();
            }
        } catch (error) {
            console.error("Error al agregar a mesa:", error);
            window.mostrarToast("Error de conexión", "error");
        }
    },
    abrirModalOcupar: function (nombreMesa, idMesa) {
        mesaPendienteOcupar = nombreMesa;
        window.idMesaPendiente = idMesa;
        document.getElementById("lblMesaOcupar").innerText = nombreMesa;
        this.abrirModal("modalOcuparMesa");
    },
    abrirModalTransferir: async function () {
        // 1. Mesa de origen: la seleccionada en la grilla
        const mesaCardActiva = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`)
        if (!mesaCardActiva) {
            window.mostrarToast("Seleccione una mesa ocupada válida.", "warning");
            return;
        }
        const idMesaOrigen = mesaCardActiva.getAttribute("data-id");
        try {
            // 2. Mesas libres, con su tipo y tarifa
            const response = await fetch(`${this.apiURL}?accion=get_mesas_disponibles&excluir_id=${idMesaOrigen}`);
            const mesasLibres = (await response.json()).filter(m => String(m.id_mesa) !== String(idMesaOrigen));
            if (mesasLibres.length === 0) {
                window.mostrarToast("No hay mesas disponibles en este momento.", "info");
                return;
            }
            // 3. El select (oculto) guarda la elección; las tarjetas, agrupadas por tipo, la eligen.
            const selectDestino = document.getElementById("selectMesaDestino");
            selectDestino.innerHTML = '<option value="">-- Seleccione una mesa --</option>'
                + mesasLibres.map(m => `<option value="${m.id_mesa}">${escaparHTML(m.nombre_mesa)}</option>`).join('');
            selectDestino.setAttribute("data-origen-id", idMesaOrigen);
            const grupos = [];
            mesasLibres.forEach(m => {
                const tipo = m.tipo || "Mesas";
                let grupo = grupos.find(g => g.tipo === tipo);
                if (!grupo) grupos.push(grupo = { tipo, precio: m.precio_hora, mesas: [] });
                grupo.mesas.push(m);
            });
            document.getElementById("listaMesasDestino").innerHTML = grupos.map(g => `
                <div class="transferir-grupo">
                    <div class="transferir-grupo-titulo">${escaparHTML(g.tipo)}${g.precio !== undefined ? `<span>${Number(g.precio).toFixed(2)} Bs/h</span>` : ''}</div>
                    <div class="transferir-grupo-mesas">
                        ${g.mesas.map(m => `
                            <button type="button" class="transferir-mesa" data-id="${m.id_mesa}" onclick="gestorUI.elegirMesaDestino('${m.id_mesa}')">
                                <i class="material-icons">table_restaurant</i>
                                <span>${escaparHTML(m.nombre_mesa)}</span>
                            </button>`).join('')}
                    </div>
                </div>`).join('');
            document.getElementById("lblTransferirOrigen").textContent = mesaCardActiva.getAttribute("data-nombre");
            this.elegirMesaDestino("");
            this.abrirModal('modalTransferirMesa');
        } catch (error) {
            console.error("Error al cargar mesas:", error);
            window.mostrarToast("Error al conectar con el servidor", "error");
        }
    },
    // Marca la tarjeta elegida y la guarda en el select oculto ("" = ninguna).
    elegirMesaDestino: function (idMesa) {
        const selectDestino = document.getElementById("selectMesaDestino");
        selectDestino.value = String(idMesa);
        document.querySelectorAll("#listaMesasDestino .transferir-mesa").forEach(b => {
            b.classList.toggle("activa", b.getAttribute("data-id") === String(idMesa));
        });
        const opcion = selectDestino.options[selectDestino.selectedIndex];
        const destino = document.getElementById("lblTransferirDestino");
        destino.textContent = idMesa && opcion ? opcion.text : "Elija una mesa";
        destino.parentElement.classList.toggle("elegida", !!idMesa);
        document.getElementById("btnConfirmarTransferencia").disabled = !idMesa;
    },
    confirmarTransferencia: async function () {
        const selectDestino = document.querySelector("#modalTransferirMesa select");
        const idMesaOrigen = selectDestino.getAttribute("data-origen-id");
        const idMesaDestino = selectDestino.value;
        if (!idMesaDestino) {
            window.mostrarToast("Por favor seleccione una mesa de destino.", "warning");
            return;
        }

        const btn = document.getElementById("btnConfirmarTransferencia");
        const originalHTML = setBtnLoading(btn, true);

        try {
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accion: "transferir_mesa",
                    id_mesa_origen: idMesaOrigen,
                    id_mesa_destino: idMesaDestino
                })
            });
            const data = await response.json();
            if (data.status === "success") {
                window.mostrarToast(data.message, "success");
                this.cerrarModal('modalTransferirMesa');

                // Mudar el foco operativo a la mesa destino
                const nombreNuevaMesa = selectDestino.options[selectDestino.selectedIndex].text;
                mesaSeleccionadaActual = nombreNuevaMesa;

                // 1. Volver a cargar la grilla: el backend ya suma el tiempo de la mesa anterior al total
                await this.cargarGrillaMesas();

                // Cargar el historial de tramos de la nueva mesa destino
                this.cargarHistorialTramos(idMesaDestino);

                // 2. Sincronizar elementos informativos fijos del panel
                const lblNombreMesa = document.getElementById("lblNombreMesaSeleccionada");
                if (lblNombreMesa) lblNombreMesa.innerText = nombreNuevaMesa;

                await this.cargarConsumoMesaActual(idMesaDestino);
                this.pintarRelojes();

            } else if (data.codigo === "mesa_no_disponible") {
                await this.avisarMesaNoDisponible(data, "modalTransferirMesa");
            } else {
                window.mostrarToast(data.message || "Error al procesar transferencia", "error");
            }
        } catch (error) {
            console.error("Error en transferencia:", error);
            window.mostrarToast("Error de red al conectar con el servidor.", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    // Otra caja ya tomó la mesa: no se guardó nada. Se cierra el modal y se refrescan las mesas para elegir otra.
    avisarMesaNoDisponible: async function (data, idModal) {
        window.mostrarToast(data.message, "warning");
        if (idModal) await this.cerrarModal(idModal);
        await this.cargarGrillaMesas();
        this.pintarRelojes();
    },
    confirmarOcupacion: async function () {
        if (!window.idMesaPendiente) return;
        const btn = document.querySelector('#modalOcuparMesa .btn-primary');
        const originalHTML = setBtnLoading(btn, true);
        try {
            const payload = {
                accion: "ocupar_mesa",
                id_mesa: window.idMesaPendiente,
                id_usuario: localStorage.getItem("id_usuario") || 1
            };
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.status === "success") {
                window.mostrarToast(`Jornada iniciada en ${mesaPendienteOcupar}`, "success");
                this.cerrarModal("modalOcuparMesa");
                // Crucial: Recargar grilla para pintar la tarjeta de ocupada (rojo) 
                // e inyectar la 'hora_inicio' real asignada por la Base de Datos
                await this.cargarGrillaMesas();
                this.pintarRelojes();
            } else if (data.codigo === "mesa_no_disponible") {
                await this.avisarMesaNoDisponible(data, "modalOcuparMesa");
            } else {
                window.mostrarToast(data.message || "Error al habilitar la mesa", "error");
            }
        } catch (error) {
            console.error("Error al confirmar ocupación:", error);
            window.mostrarToast("Error de comunicación con el servidor", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    togglePausa: async function (btn) {
        // Obtenemos la tarjeta activa de la mesa seleccionada actualmente
        const mesaCardActiva = Array.from(document.querySelectorAll('.mesa-card')).find(el => el.querySelector('h4').innerText === mesaSeleccionadaActual);
        if (!mesaCardActiva) {
            window.mostrarToast("Seleccione una mesa ocupada primero", "warning");
            return;
        }
        if (!btn) {
            btn = document.querySelector('#footerAccionesMesa .btn-accion:first-child');
        }
        let originalHTML = "";
        let isSuccess = false;
        const idMesa = mesaCardActiva.getAttribute("data-id");
        const horaPausaStr = mesaCardActiva.getAttribute("data-hora-pausa");
        // Si tiene un registro de hora_pausa en el DOM, significa que el estado actual es "pausado"
        const esPausadoActualmente = (horaPausaStr && horaPausaStr !== "null" && horaPausaStr !== "");
        const accionFetch = esPausadoActualmente ? "reanudar_mesa" : "pausar_mesa";
        try {
            originalHTML = setBtnLoading(btn, true);
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accion: accionFetch,
                    id_mesa: idMesa,
                    tipo_pausa: "manual"
                })
            });
            const data = await response.json();
            if (data.status === "success") {
                isSuccess = true;
                window.mostrarToast(data.message, "success");
                // Recargar grilla para obtener nuevos timestamps desde la BD
                // NOTA: esto regenera el DOM, las referencias a mesaCardActiva quedan obsoletas
                await this.cargarGrillaMesas();
                await this.cargarConsumoMesaActual(idMesa);
                this.pintarRelojes();

                // Recargar historial de tramos inmediatamente tras cambiar estado
                this.cargarHistorialTramos(idMesa);

                // Actualizar el botón directamente (btn sigue siendo el mismo elemento del footer)
                if (btn) {
                    if (accionFetch === "pausar_mesa") {
                        // Se acaba de pausar → mostrar botón "Reanudar Tiempo" en verde
                        btn.className = 'btn-accion btn-success';
                        btn.innerHTML = '<i class="material-icons">play_arrow</i> <span class="txt-btn">Reanudar Tiempo</span>';
                    } else {
                        // Se acaba de reanudar → mostrar botón "Pausar Tiempo" en naranja
                        btn.className = 'btn-accion btn-warning';
                        btn.innerHTML = '<i class="material-icons">pause</i> <span class="txt-btn">Pausar Tiempo</span>';
                    }
                }
            } else {
                window.mostrarToast(data.message || "Error al procesar la pausa", "error");
            }
        } catch (error) {
            console.error("Error en operación de pausa:", error);
            window.mostrarToast("Error de red al intentar pausar la mesa", "error");
        } finally {
            if (!isSuccess) {
                setBtnLoading(btn, false, originalHTML);
            } else if (btn) {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
            }
        }
    },
    // =========================================================================
    // COBRO: la pantalla solo muestra lo que calcula el backend y le envía lo que el cajero vio.
    // Si al confirmar el total ya no es el mismo, el backend no guarda nada y devuelve el nuevo.
    // =========================================================================
    totalCobroEnCurso: function () {
        return this.cobroEnCurso ? Number(this.cobroEnCurso.liquidacion.total) : 0;
    },
    calcularDividirPago: function (origen) {
        const inputEf = document.getElementById("inputDividirEfectivo");
        const inputQR = document.getElementById("inputDividirQR");
        const total = this.totalCobroEnCurso();
        if (origen === 'efectivo') {
            const faltante = total - (parseFloat(inputEf.value) || 0);
            inputQR.value = faltante > 0 ? faltante.toFixed(2) : "0.00";
        } else if (origen === 'qr') {
            const faltante = total - (parseFloat(inputQR.value) || 0);
            inputEf.value = faltante > 0 ? faltante.toFixed(2) : "0.00";
        }
        this.actualizarEstadoDividir();
    },
    // Botones rápidos: fracción del total en efectivo (1 = todo, 0.5 = mitad redondeada a .50, 0 = todo QR).
    repartirPago: function (fraccionEfectivo) {
        const total = this.totalCobroEnCurso();
        const efectivo = fraccionEfectivo === 1 ? total : Math.ceil(total * fraccionEfectivo * 2) / 2;
        document.getElementById("inputDividirEfectivo").value = efectivo.toFixed(2);
        document.getElementById("inputDividirQR").value = (total - efectivo).toFixed(2);
        this.actualizarEstadoDividir();
    },
    // Barra de proporción y aviso: cuadra, falta o sobra.
    actualizarEstadoDividir: function () {
        const total = this.totalCobroEnCurso();
        const ef = Math.max(0, parseFloat(document.getElementById("inputDividirEfectivo").value) || 0);
        const qr = Math.max(0, parseFloat(document.getElementById("inputDividirQR").value) || 0);
        const base = Math.max(total, ef + qr) || 1;
        document.getElementById("barraDividirEfectivo").style.width = `${(ef / base) * 100}%`;
        document.getElementById("barraDividirQR").style.width = `${(qr / base) * 100}%`;
        const diferencia = Math.round((ef + qr - total) * 100) / 100;
        const estado = document.getElementById("lblEstadoDividir");
        if (Math.abs(diferencia) < 0.005) {
            estado.className = "mm-estado ok";
            estado.innerHTML = `<i class="material-icons">check_circle</i>Los montos cuadran con el total`;
        } else if (diferencia < 0) {
            estado.className = "mm-estado falta";
            estado.innerHTML = `<i class="material-icons">error_outline</i>Faltan ${Math.abs(diferencia).toFixed(2)} Bs`;
        } else {
            estado.className = "mm-estado sobra";
            estado.innerHTML = `<i class="material-icons">error_outline</i>Sobran ${diferencia.toFixed(2)} Bs`;
        }
        document.getElementById("btnProcesarDividido").disabled = Math.abs(diferencia) >= 0.005;
    },
    // Pide el desglose al backend. En mesa fija la hora de corte: pausa la mesa si no lo estaba.
    prepararCobro: async function () {
        if (modoActual === "mesa") {
            const mesaCard = this.tarjetaSeleccionada();
            if (!mesaCard) {
                window.mostrarToast("Por favor, seleccione una mesa en la grilla antes de proceder al cobro.", "warning");
                return null;
            }
            const idMesa = mesaCard.getAttribute("data-id");
            const data = await this.api({ accion: "preparar_cobro", id_mesa: idMesa });
            if (data.status !== "success") {
                await this.manejarErrorCobro(data, null);
                return null;
            }
            window.mesaAutoPausada = !!data.auto_pausada;
            this.cobroEnCurso = { modo: "mesa", id_mesa: idMesa, nombre: data.mesa, liquidacion: data.liquidacion };
            await this.cargarGrillaMesas();
            this.pintarRelojes();
        } else {
            if (this.itemsCarrito.length < 1) {
                window.mostrarToast("Debe agregar productos al carrito para realizar una venta", "warning");
                return null;
            }
            const cotizacion = await this.cotizarCarrito();
            if (!cotizacion) return null;
            this.cobroEnCurso = { modo: "barra", liquidacion: cotizacion };
        }
        return this.cobroEnCurso;
    },
    // El cobro no llegó a mostrarse: la mesa vuelve a correr.
    descartarCobro: async function () {
        this.cobroEnCurso = null;
        if (window.mesaAutoPausada) await this.reanudarPausaSistema();
    },
    prepararPagoDividido: async function () {
        if (!(await this.prepararCobro())) return;
        if (this.totalCobroEnCurso() <= 0) {
            window.mostrarToast("No hay un monto para dividir. Use el cobro normal.", "warning");
            await this.descartarCobro();
            return;
        }
        this.mostrarModalDividir();
    },
    mostrarModalDividir: function () {
        const total = this.totalCobroEnCurso();
        const lblTotal = document.getElementById("lblTotalDividir");
        if (lblTotal) lblTotal.innerText = total.toFixed(2);
        // Por UX, sugerimos efectivo total por defecto
        document.getElementById("inputDividirEfectivo").value = total.toFixed(2);
        document.getElementById("inputDividirQR").value = "0.00";
        this.actualizarEstadoDividir();
        document.getElementById("modalDividirPago").classList.remove("hidden");
    },
    confirmarPagoDividido: async function () {
        const cobro = this.cobroEnCurso;
        if (!cobro) return;
        const valEf = parseFloat(document.getElementById("inputDividirEfectivo").value) || 0;
        const valQR = parseFloat(document.getElementById("inputDividirQR").value) || 0;
        const total = this.totalCobroEnCurso();
        if (valEf < 0 || valQR < 0 || Math.abs(valEf + valQR - total) > 0.001) {
            window.mostrarToast(`Los montos ingresados (Ef: ${valEf.toFixed(2)} + QR: ${valQR.toFixed(2)} = ${(valEf + valQR).toFixed(2)}) no cuadran con el total de ${total.toFixed(2)} Bs.`, "warning");
            return;
        }
        const btn = document.getElementById("btnProcesarDividido");
        const originalHTML = setBtnLoading(btn, true);
        try {
            const pagos = [{ metodo: "efectivo", monto: valEf }, { metodo: "qr", monto: valQR }];
            const data = await this.enviarCobro(cobro, pagos);
            await this.procesarRespuestaCobro(data, "modalDividirPago");
        } catch (error) {
            console.error("Error en cobro dividido:", error);
            window.mostrarToast("Error de red al conectar con el servidor.", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    prepararCobroMesa: async function () {
        modoActual = "mesa";
        if (!(await this.prepararCobro())) return;
        this.mostrarModalCobro();
    },
    abrirModalCobro: async function () {
        if (modoActual === "mesa") return this.prepararCobroMesa();
        if (!(await this.prepararCobro())) return;
        this.mostrarModalCobro();
    },
    mostrarModalCobro: function () {
        const cobro = this.cobroEnCurso;
        const liq = cobro.liquidacion;
        const esMesa = cobro.modo === "mesa";
        const fijar = (id, texto) => {
            const el = document.getElementById(id);
            if (el) el.innerText = texto;
        };
        const mostrar = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? "" : "none";
        };
        fijar("lblTipoCobroModal", esMesa ? `Liquidación de ${cobro.nombre}` : "Venta en barra");
        mostrar("contenedorDetallesMesa", true);
        mostrar("rowTiempoModal", esMesa);
        fijar("lblDetalleTiempoModal", `${Number(liq.tiempo).toFixed(2)} Bs`);
        fijar("lblDetalleConsumoModal", `${Number(liq.subtotal_productos).toFixed(2)} Bs`);
        mostrar("rowDescuentoModal", liq.descuentos > 0);
        fijar("lblDetalleDescuentoModal", `-${Number(liq.descuentos).toFixed(2)} Bs`);
        mostrar("rowCargosModal", liq.subtotal_cargos > 0);
        fijar("lblDetalleCargosModal", `+${Number(liq.subtotal_cargos || 0).toFixed(2)} Bs`);
        mostrar("rowRedondeoModal", liq.redondeo > 0);
        fijar("lblDetalleRedondeoModal", `+${Number(liq.redondeo).toFixed(2)} Bs`);
        fijar("lblTotalCobrarModal", `${Number(liq.total).toFixed(2)} Bs`);
        const rdoEfectivo = document.getElementById("pagoEfectivo");
        if (rdoEfectivo) rdoEfectivo.checked = true;
        document.getElementById("modalConfirmarCobro").classList.remove("hidden");
    },
    // Botón "Confirmar Pago" del modal
    ejecutarCobroConfirmado: async function () {
        const cobro = this.cobroEnCurso;
        if (!cobro) return;
        const btn = document.getElementById("btnConfirmarCobro");
        const originalHTML = setBtnLoading(btn, true);
        try {
            const rdoQR = document.getElementById("pagoQR");
            const metodo = (rdoQR && rdoQR.checked) ? "qr" : "efectivo";
            const data = await this.enviarCobro(cobro, [{ metodo, monto: this.totalCobroEnCurso() }]);
            await this.procesarRespuestaCobro(data, "modalConfirmarCobro");
        } catch (error) {
            console.error("Error en transacción unificada de cobro:", error);
            window.mostrarToast("Error de conexión al procesar la solicitud", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    // Código único del cobro abierto: si la misma venta se envía dos veces, el backend registra solo una.
    idOperacion: function (cobro) {
        if (!cobro.id_operacion) {
            cobro.id_operacion = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        }
        return cobro.id_operacion;
    },
    enviarCobro: function (cobro, pagos) {
        const total_mostrado = Number(cobro.liquidacion.total);
        const id_operacion = this.idOperacion(cobro);
        if (cobro.modo === "mesa") {
            return this.api({ accion: "cobrar_mesa", id_mesa: cobro.id_mesa, pagos, total_mostrado, id_operacion });
        }
        const cuerpo = Object.assign({
            accion: "registrar_venta_barra",
            pagos,
            total_mostrado,
            id_operacion
        }, this.pedidoCarrito());
        if (this.mesaIncentivoAsignada) cuerpo.id_mesa_ocupar_promo = this.mesaIncentivoAsignada;
        return this.api(cuerpo);
    },
    procesarRespuestaCobro: async function (data, idModal) {
        const cobro = this.cobroEnCurso;
        if (data.status !== "success") {
            await this.manejarErrorCobro(data, idModal);
            return;
        }
        // El cobro ya cerró la mesa: al cerrar el modal no hay pausa que deshacer ni hora con descuento que quitar.
        window.mesaAutoPausada = false;
        this.mesaIncentivoAsignada = null;
        this.cobroEnCurso = null;
        await this.cerrarModal(idModal);
        window.mostrarToast(cobro.modo === "mesa" ? "Cobro realizado y mesa liberada" : "Venta en barra registrada", "success");
        this.imprimirComprobante(cobro, data);
        if (cobro.modo === "mesa") this.deseleccionarMesa();
        else this.limpiarCarrito();
        await Promise.all([this.cargarGrillaMesas(), this.cargarDatalistProductos()]);
        this.pintarRelojes();
    },
    manejarErrorCobro: async function (data, idModal) {
        if (data.codigo === "total_cambio" && data.liquidacion && this.cobroEnCurso) {
            this.cobroEnCurso.liquidacion = data.liquidacion;
            if (idModal === "modalDividirPago") this.mostrarModalDividir();
            else this.mostrarModalCobro();
            window.mostrarToast(data.message, "warning");
            return;
        }
        if (data.codigo === "mesa_no_disponible") {
            this.cobroEnCurso = null;
            await this.avisarMesaNoDisponible(data, idModal);
            return;
        }
        if (data.codigo === "venta_duplicada") {
            // La venta ya quedó registrada con el primer envío: se cierra el cobro sin cobrar de nuevo.
            window.mesaAutoPausada = false;
            this.mesaIncentivoAsignada = null;
            this.cobroEnCurso = null;
            if (idModal) await this.cerrarModal(idModal);
            this.limpiarCarrito();
            window.mostrarToast(data.message, "warning");
            await Promise.all([this.cargarGrillaMesas(), this.cargarDatalistProductos()]);
            this.pintarRelojes();
            return;
        }
        if (data.codigo === "mesa_sin_partida") {
            window.mesaAutoPausada = false;
            this.cobroEnCurso = null;
            if (idModal) await this.cerrarModal(idModal);
            window.mostrarToast(data.message, "warning");
            this.deseleccionarMesa();
            await this.cargarGrillaMesas();
            this.pintarRelojes();
            return;
        }
        if (data.codigo === "promo_no_vigente") {
            this.cobroEnCurso = null;
            if (idModal) await this.cerrarModal(idModal);
            this.quitarHoraPromoDelCarrito();
            await this.cotizarCarrito();
            window.mostrarToast(data.message, "warning");
            return;
        }
        window.mostrarToast(data.message || "No se pudo procesar el cobro", "error");
    },
    imprimirComprobante: function (cobro, data) {
        if (typeof gestorImpresion === "undefined" || !data.liquidacion) return;
        const liq = data.liquidacion;
        const pagos = (data.pagos || []).map(p => `${p.metodo} ${Number(p.monto).toFixed(2)}`).join(" + ");
        gestorImpresion.imprimirTicketVenta({
            tipo: cobro.modo === "mesa" ? "Mesa" : "Barra",
            nombreMesa: cobro.nombre || "",
            total: liq.total,
            metodo_pago: pagos || "sin pago",
            productos: liq.productos.map(p => ({ cantidad: p.cantidad, nombre: p.grupo ? `${p.nombre} (${p.grupo})` : p.nombre, precio_unitario: p.precio })),
            tiempoMesa: liq.tiempo,
            descuentos: liq.descuentos,
            redondeo: liq.redondeo,
            cargos: this.agruparCargos(liq.cargos).map(c => ({
                descripcion: c.cantidad > 1 ? `${c.descripcion} x${c.cantidad}` : c.descripcion,
                monto: c.total
            }))
        });
    },
};

// NOTA: gestorUI.inicializar() es llamado por atencion.js cuando el router
// inyecta atencion.html en el outlet del SPA. No ejecutar aquí desde DOMContentLoaded
// porque en ese momento #listaProductos aún no existe en el DOM.