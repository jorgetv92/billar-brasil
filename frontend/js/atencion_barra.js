let mesaSeleccionadaActual = "";
let modoActual = "barra"; // barra | mesa
let mesaPendienteOcupar = "";
let totalActualCobro = 0.00;
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

window.gestorUI = {
    // === 0. PROPIEDADES DE ESTADO LOCAL ===
    apiURL: '../backend/api/atencion_barra.php',
    productosLocal: [], // Guarda la lista del backend [id, nombre completo, stock, precio]
    itemsCarrito: [], // Elementos actualmente añadidos al carrito de compras
    promocionesActivas: [], // Promociones vigentes obtenidas de la API
    idProductoHoraPromo: null, // ID del producto especial para item hora promo
    mesaIncentivoAsignada: null, // ID de mesa asignada en modal_apply_incentivoproducto en modo barra
    flujoIncentivoPendiente: null, // Configuración activa del modal de incentivo
    totalDividirCongelado: 0,
    inicializar: async function () {
        await Promise.all([
            this.cargarGrillaMesas(),
            this.cargarDatalistProductos(),
            this.cargarPromocionesActivas()
        ]);
        this.limpiarCarrito();
        this.iniciarMotorReloj();
    },
    cargarPromocionesActivas: async function () {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_promociones_activas`);
            const result = await response.json();
            if (result.status === 'success') {
                this.promocionesActivas = result.data || [];
                if (result.id_producto_hora_promo) {
                    this.idProductoHoraPromo = parseInt(result.id_producto_hora_promo);
                }
            }
        } catch (error) {
            console.error("Error al cargar promociones activas:", error);
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
                    let esOcupada = m.estado_actual === 'ocupada';
                    // Detectar pausa por la presencia de hora_pausa
                    let esPausada = esOcupada && m.hora_pausa && m.hora_pausa !== '' && m.hora_pausa !== null && m.hora_pausa !== 'null';
                    let cssClass = esPausada ? 'pausada' : (esOcupada ? 'ocupada' : 'disponible');
                    let displayInfo = '';
                    let tieneGratis = (parseInt(m.primera_hora_gratis) === 1);
                    let badgeGratis = tieneGratis ? `<span style="background:#8b5cf6; color:white; font-size:0.75rem; padding:2px 5px; border-radius:4px; margin-left:4px; font-weight:bold;">1ª H. Gratis</span>` : '';
                    if (esOcupada || esPausada) {
                        displayInfo = `<div class="mesa-info-resumen">
                            <span class="estado-badge" style="background: ${esPausada ? '#f59e0b' : '#ef4444'};">${esPausada ? 'Pausada' : 'Ocupada'}</span>
                            ${badgeGratis}
                        </div>`;
                        // La inyección dinámica de "horasV:minV" e importe total la hace iniciarMotorReloj() en vivo para las mesas ocupadas/pausadas
                    } else {
                        displayInfo = `<span class="estado-badge" style="background:#10b981;color:white;padding:3px 8px;border-radius:10px;display:inline-block;margin-top:10px;">Disponible</span>`;
                    }
                    const retorno = `
                    <div class="mesa-card ${cssClass}" 
                        data-id="${m.id_mesa}" 
                        data-id-tipo-mesa="${tipo.id_tipo_mesa}"
                        data-nombre="${m.numero_mesa}"
                        data-estado="${m.estado_actual}"
                        data-hora-inicio="${m.fecha_hora_inicio || ''}"
                        data-hora-pausa="${m.hora_pausa || ''}"
                        data-consumo="${m.total_consumo || '0.00'}"
                        data-importe="${parseFloat(m.importe_acumulado_tiempo || 0).toFixed(2)}"
                        data-importe-acumulado="${parseFloat(m.importe_acumulado_tiempo || 0).toFixed(2)}"
                        data-segundos-acumulados="${m.segundos_acumulados || 0}"
                        data-precio-hora="${tipo.precio_hora}"
                        data-primera-hora-gratis="${m.primera_hora_gratis || 0}"
                        onclick="gestorUI.clickMesa(this)">
                        <h4>${m.numero_mesa}</h4>
                        ${displayInfo}
                    </div>`;
                    return retorno
                }).join('');

                const badgePromoHeader = tipo.tiene_promocion ? `<span style="background:#8b5cf6; color:white; font-size:0.75rem; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:bold;" title="${tipo.nombre_promocion}">🏷️ ${tipo.nombre_promocion}</span>` : '';

                contenedor.innerHTML += `
                    <h3 class="tipo-mesa-titulo">${tipo.tipo_mesa} <small style="font-size: 0.8em; color: #64748b;">(${tipo.precio_hora} Bs/h)</small> ${badgePromoHeader}</h3>
                    <div class="grid-mesas">${mesasHTML}</div>
                `;
            });
        } catch (error) {
            console.error("Error al cargar mesas:", error);
        }
    },
    cargarDatalistProductos: async function () {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_productos_datalist`);
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
        if (cantidad > producto.stock) {
            alert(`Stock insuficiente. Solo quedan ${producto.stock} unidades.`);
            return;
        }

        const precioUnitario = parseFloat(producto.precio);
        const nombreLimpio = producto.display_nombre.split(" - ")[0];

        if (modoActual === "mesa") {
            // == MODO MESA: GUARDAR DIRECTO EN BD ==
            const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
            if (!mesaCard) return;
            const id_mesa_actual = mesaCard.getAttribute("data-id");
            const idTipoMesaActual = parseInt(mesaCard.getAttribute("data-id-tipo-mesa"));
            const tieneGratisActual = mesaCard.getAttribute("data-primera-hora-gratis") === "1";

            // Verificar si la mesa ya tiene asignada la promo hora
            const yaTienePromoItem = this.itemsCarrito.some(item => 
                (this.idProductoHoraPromo && parseInt(item.id_producto) === parseInt(this.idProductoHoraPromo)) || 
                (item.nombre && item.nombre.includes("Hora Promo"))
            );

            // Buscar si existe promoción incentivo_producto aplicable a este producto y tipo de mesa
            const promoIncentivo = (!tieneGratisActual && !yaTienePromoItem) ? this.promocionesActivas.find(p => {
                return p.tipo_promo === 'incentivo_producto' && 
                       parseInt(p.id_item_condicion) === parseInt(producto.id_producto) &&
                       parseInt(p.id_item_secundario) === idTipoMesaActual;
            }) : null;

            if (promoIncentivo) {
                const cantRequerida = parseFloat(promoIncentivo.cantidad_condicion);
                const cantPrevia = this.itemsCarrito
                    .filter(i => parseInt(i.id_producto) === parseInt(producto.id_producto))
                    .reduce((sum, i) => sum + parseInt(i.cantidad), 0);
                const cantTotal = cantPrevia + cantidad;

                if (cantTotal >= cantRequerida) {
                    // Cumple la condición de la promoción: preguntar vía modal_apply_incentivoproducto
                    this.abrirModalIncentivoProducto({
                        modo: 'mesa',
                        producto: producto,
                        cantidad: cantidad,
                        precioUnitario: precioUnitario,
                        nombreLimpio: nombreLimpio,
                        id_mesa: id_mesa_actual,
                        promo: promoIncentivo
                    });
                    return;
                }
            }

            await this.ejecutarAgregarProductoMesaDirecto(id_mesa_actual, producto, cantidad, precioUnitario, false);
        } else {
            // == MODO BARRA: GUARDAR EN MEMORIA LOCAL ==
            const itemExistente = this.itemsCarrito.find(item => item.id_producto === producto.id_producto);
            if (itemExistente) {
                if ((itemExistente.cantidad + cantidad) > producto.stock) {
                    alert(`No puedes añadir esa cantidad. Supera el stock total disponible.`);
                    return;
                }
                itemExistente.cantidad += cantidad;
                itemExistente.total = itemExistente.cantidad * precioUnitario;
            } else {
                this.itemsCarrito.push({
                    id_producto: producto.id_producto,
                    nombre: nombreLimpio,
                    precio: precioUnitario,
                    cantidad: cantidad,
                    total: cantidad * precioUnitario
                });
            }
            this.limpiarFormularioVenta();
            this.renderizarCarrito();

            // =========================================================================
            // REACCIÓN EN CALIENTE: Sincroniza el footer tras añadir al carrito en Barra
            // =========================================================================
            this.actualizarTotalesVista();
            // =========================================================================
        }
    },
    eliminarDelCarrito: async function (index) {
        if (modoActual === "mesa") {
            const item = this.itemsCarrito[index];
            if (!item.id_detalle_prod) return;
            try {
                const response = await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        accion: "eliminar_producto_mesa",
                        id_detalle_prod: item.id_detalle_prod
                    })
                });
                const data = await response.json();
                if (data.status === "success") {
                    const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
                    if (mesaCard) await this.cargarConsumoMesaActual(mesaCard.getAttribute("data-id"));
                    await this.cargarGrillaMesas();
                    await this.cargarDatalistProductos(); // Actualizar stock de buscador
                    this.actualizarRelojes();
                    this.actualizarTotalesVista();
                } else {
                    window.mostrarToast(data.message, "error");
                }
            } catch (error) {
                console.error(error);
                window.mostrarToast("Error de conexión", "error");
            }
        } else {
            const itemEliminado = this.itemsCarrito[index];
            if (itemEliminado && (itemEliminado.es_promo_hora || itemEliminado.id_producto == this.idProductoHoraPromo)) {
                this.mesaIncentivoAsignada = null;
            }
            this.itemsCarrito.splice(index, 1);
            this.renderizarCarrito();
            this.actualizarTotalesVista();
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
    cargarConsumoMesaActual: async function (id_mesa) {
        try {
            const response = await fetch(`${this.apiURL}?accion=get_consumo_mesa&id_mesa=${id_mesa}`);
            const data = await response.json();
            if (Array.isArray(data)) {
                this.itemsCarrito = data.map(prod => ({
                    id_detalle_prod: prod.id_detalle_prod,
                    id_producto: prod.id_producto,
                    nombre: prod.display_nombre,
                    precio: parseFloat(prod.precio),
                    cantidad: parseInt(prod.cantidad),
                    total: parseFloat(prod.precio) * parseInt(prod.cantidad)
                }));
                this.renderizarCarrito();
            }
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
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Cargando historial...</td></tr>';

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
                    tbodyActual.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#94a3b8; padding: 10px;">Sin historial de tiempo</td></tr>';
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
    calcularDescuentosLocales: function () {
        let descuentoTotal = 0;
        let detallesDescuento = [];

        if (!this.promocionesActivas || this.promocionesActivas.length === 0) {
            return { descuentoTotal: 0, detalles: [] };
        }

        // 1. Combo 2x1
        const combos2x1 = this.promocionesActivas.filter(p => p.tipo_promo === 'combo_2x1');
        combos2x1.forEach(cp => {
            const idItem = parseInt(cp.id_item_condicion);
            this.itemsCarrito.forEach(item => {
                if (parseInt(item.id_producto) === idItem && item.cantidad >= 2) {
                    const gratis = Math.floor(item.cantidad / 2);
                    const monto = gratis * item.precio;
                    descuentoTotal += monto;
                    detallesDescuento.push({
                        nombre: cp.nombre_promo,
                        descripcion: `2x1 (${item.nombre})`,
                        monto: monto
                    });
                }
            });
        });

        // 2. Incentivo Cruzado (Mesa + Barra)
        if (modoActual === "mesa" && mesaSeleccionadaActual) {
            const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
            if (mesaCard) {
                const segundosAcumulados = parseInt(mesaCard.getAttribute('data-segundos-acumulados')) || 0;
                const horaInicioStr = mesaCard.getAttribute('data-hora-inicio');
                let segundosActuales = 0;
                if (horaInicioStr && horaInicioStr !== 'null' && horaInicioStr !== '') {
                    const horaInicio = new Date(horaInicioStr.replace(/-/g, '/'));
                    segundosActuales = Math.floor((new Date() - horaInicio) / 1000);
                    if (segundosActuales < 0) segundosActuales = 0;
                }
                const horasTotales = (segundosAcumulados + segundosActuales) / 3600;

            const cruzados = this.promocionesActivas.filter(p => p.tipo_promo === 'incentivo_cruzado');
                cruzados.forEach(xp => {
                    const horasRequeridas = parseFloat(xp.cantidad_condicion);
                    if (horasTotales >= horasRequeridas) {
                        const idBenef = parseInt(xp.id_item_condicion);
                        const precioEspecial = parseFloat(xp.valor_descuento);
                        this.itemsCarrito.forEach(item => {
                            if (parseInt(item.id_producto) === idBenef && item.precio > precioEspecial) {
                                const monto = (item.precio - precioEspecial) * item.cantidad;
                                descuentoTotal += monto;
                                detallesDescuento.push({
                                    nombre: xp.nombre_promo,
                                    descripcion: `Incentivo (${horasRequeridas}h juego): ${item.nombre}`,
                                    monto: monto
                                });
                            }
                        });
                    }
                });

                // 3. Incentivo en Mesa (Descuento por horas jugadas)
                const incMesaPromos = this.promocionesActivas.filter(p => p.tipo_promo === 'incentivo_mesa');
                incMesaPromos.forEach(imp => {
                    const horasRequeridas = parseFloat(imp.cantidad_condicion);
                    if (horasTotales >= horasRequeridas) {
                        const idMesaRequerida = parseInt(imp.id_item_condicion);
                        const idMesaActual = parseInt(mesaCard.getAttribute('data-id-tipo-mesa'));
                        
                        if (idMesaActual === idMesaRequerida) {
                            const importeTotalActual = parseFloat(mesaCard.getAttribute('data-importe')) || 0;
                            const precioEspecialHora = parseFloat(imp.valor_descuento);
                            const costoEspecialTotal = precioEspecialHora * horasTotales;
                            
                            if (importeTotalActual > costoEspecialTotal) {
                                const montoDesc = importeTotalActual - costoEspecialTotal;
                                descuentoTotal += montoDesc;
                                detallesDescuento.push({
                                    nombre: imp.nombre_promo,
                                    descripcion: `Descuento en Mesa`,
                                    monto: montoDesc
                                });
                            }
                        }
                    }
                });
            }
        }

        return { descuentoTotal, detalles: detallesDescuento };
    },
    renderizarCarrito: function () {
        const tbody = document.querySelector('#tablaCarritoVenta tbody');
        if (!tbody) return;
        if (this.itemsCarrito.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: #94a3b8; padding: 20px;">Carrito vacío</td></tr>`;
            this.actualizarUIPrecios(0);
            return;
        }
        let html = "";
        let granTotal = 0;
        this.itemsCarrito.forEach((item, index) => {
            granTotal += item.total;
            html += `
                <tr>
                    <td>${item.nombre}</td>
                    <td class="text-center">${item.cantidad}</td>
                    <td class="text-center">${item.precio.toFixed(2)}</td>
                    <td class="text-right">${item.total.toFixed(2)}</td>
                    <td class="text-center">
                        <button class="btn-icon" style="color: var(--danger); cursor: pointer; border: none; background: none;" onclick="gestorUI.eliminarDelCarrito(${index})">
                            <i class="material-icons" style="font-size: 18px;">delete</i>
                        </button>
                    </td>
                </tr>
            `;
        });

        const resPromo = this.calcularDescuentosLocales();
        if (resPromo.descuentoTotal > 0) {
            resPromo.detalles.forEach(d => {
                html += `
                    <tr style="background: #edfdf6; color: #047857; font-weight: bold;">
                        <td colspan="3">🏷️ ${d.nombre} (${d.descripcion})</td>
                        <td class="text-right">-${d.monto.toFixed(2)}</td>
                        <td></td>
                    </tr>
                `;
            });
        }

        tbody.innerHTML = html;
        this.actualizarUIPrecios(granTotal);
    },
    actualizarUIPrecios: function (totalCarrito) {
        const resPromo = this.calcularDescuentosLocales();
        const descuentoTotal = resPromo.descuentoTotal;
        const totalCarritoNeto = Math.max(0, totalCarrito - descuentoTotal);

        const lblTotalCarrito = document.getElementById('lblTotalCarrito');
        if (lblTotalCarrito) lblTotalCarrito.innerText = `${totalCarritoNeto.toFixed(2)} Bs`;

        const lblTotalUnificado = document.getElementById('lblTotalUnificado');
        if (modoActual === "mesa") {
            const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
            const importeMesa = mesaCard ? parseFloat(mesaCard.getAttribute('data-importe')) || 0 : 0;
            const importeTiempoRedondeado = parseFloat(this.redondearTarifaMesa(importeMesa));
            totalActualCobro = Math.max(0, importeTiempoRedondeado + totalCarrito - descuentoTotal);
            if (lblTotalUnificado) lblTotalUnificado.innerText = `${totalActualCobro.toFixed(2)} Bs`;

            const rowsDer = document.querySelectorAll(".detalle-columnas .col-der strong");
            if (rowsDer[1]) rowsDer[1].innerText = `${totalCarritoNeto.toFixed(2)} Bs`;
        } else {
            totalActualCobro = totalCarritoNeto;
            if (lblTotalUnificado) lblTotalUnificado.innerText = `${totalActualCobro.toFixed(2)} Bs`;
        }
    },
    // === 3. CENTRALIZADOR DE TRANSICIONES Y NAVEGACIÓN (MÓVIL / SPA) ===
    cambiarEstadoLayout: function (nuevaClaseEstado) {
        const layout = document.querySelector(".atencion-layout");
        if (layout) {
            layout.classList.remove("state-barra", "state-seleccionando", "state-mesa-info", "state-mesa-consumo");
            layout.classList.add(nuevaClaseEstado);
        }
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
            this.seleccionarMesa(nombreMesa, elementoMesa);
            if (window.innerWidth <= 768) {
                this.transicionContenido("izquierdo", () => {
                    this.cambiarEstadoLayout("state-mesa-info");
                    document.getElementById("tabDerecho").classList.remove("hidden");
                    document.getElementById("txtTabDerecho").innerText = `Consumo ${nombreMesa}`;
                    document.getElementById("icoTabDerecho").innerText = "keyboard_arrow_up";
                });
            }
        }
    },
    clickTabIzquierdo: function () {
        if (modoActual === "barra") {
            this.transicionContenido("izquierdo", () => {
                this.cambiarEstadoLayout("state-seleccionando");
                document.getElementById("txtTabDerecho").innerText = "Seleccionando Mesa";
                document.getElementById("icoTabDerecho").innerText = "close";
            });
        } else if (modoActual === "mesa") {
            this.transicionContenido("izquierdo", () => {
                this.cambiarEstadoLayout("state-mesa-info");
                document.getElementById("txtTabDerecho").innerText = `Consumo ${mesaSeleccionadaActual}`;
                document.getElementById("icoTabDerecho").innerText = "keyboard_arrow_up";
            });
        }
    },
    clickTabDerecho: function () {
        if (modoActual === "barra") {
            this.transicionContenido("derecho", () => {
                this.cambiarEstadoLayout("state-barra");
                document.getElementById("txtTabIzquierdo").innerText = "seleccionar mesa...";
                document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
            });
        } else if (modoActual === "mesa") {
            this.transicionContenido("derecho", () => {
                this.cambiarEstadoLayout("state-mesa-consumo");
                document.getElementById("txtTabIzquierdo").innerText = `Información ${mesaSeleccionadaActual}`;
                document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
                document.getElementById("lblTituloVenta").innerText = `Venta: ${mesaSeleccionadaActual}`;
            });
        }
    },
    transicionContenido: function (panel, accionCambioDOM) {
        const target = panel === "izquierdo" ? document.getElementById("contenidoIzquierdo") : document.getElementById("contenidoDerecho");
        if (target) target.classList.add("fade-out");
        setTimeout(() => {
            accionCambioDOM();
            if (target) target.classList.remove("fade-out");
        }, 150);
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
        this.cargarConsumoMesaActual(elementoMesa.getAttribute("data-id"));
        // Diferir el historial un tick para asegurar que vistaConMesa ya está en el DOM
        const _idMesa = elementoMesa.getAttribute("data-id");
        setTimeout(() => this.cargarHistorialTramos(_idMesa), 0);
        this.cambiarEstadoLayout("state-mesa-info");
    },
    deseleccionarMesa: function () {
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
            btnDerecho.onclick = () => gestorUI.abrirModalCobro();
        }
        // Limpiamos el carrito local (si era de una mesa, se limpiará la memoria temporal)
        this.limpiarCarrito();
        document.getElementById("footerAccionesMesa").classList.add("hidden");
        if (window.innerWidth <= 768) {
            document.getElementById("tabIzquierdo").classList.remove("hidden");
            document.getElementById("txtTabIzquierdo").innerText = "seleccionar mesa...";
            document.getElementById("icoTabIzquierdo").innerText = "keyboard_arrow_down";
        }
    },
    // =========================================================================
    // MÉTODO CENTRALIZADO: CALCULA Y SINCRO-REACCIONA LOS TOTALES EN EL FOOTER
    // =========================================================================
    actualizarTotalesVista: function () {
        // 1. Calcular el total puramente del carrito de productos
        const totalCarrito = this.itemsCarrito.reduce((suma, item) => suma + item.total, 0);

        let totalMesaTiempo = 0;

        // 2. Si estamos en modo mesa, extraemos el importe de tiempo congelado o dinámico de la tarjeta activa
        if (modoActual === "mesa" && mesaSeleccionadaActual) {
            const mesaCard = Array.from(document.querySelectorAll('.mesa-card'))
                .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);

            if (mesaCard) {
                totalMesaTiempo = parseFloat(mesaCard.getAttribute('data-importe')) || 0;
            }
        }

        // Aplicamos la regla de redondeo comercial al importe de la mesa
        totalMesaTiempo = parseFloat(this.redondearTarifaMesa(totalMesaTiempo));

        // 3. Seteamos la variable maestra global combinada para el cobro unificado
        totalActualCobro = totalCarrito + totalMesaTiempo;

        // 4. Inyectamos reactivamente el valor en el texto del Footer de acciones
        const lblTotalFooter = document.getElementById("lblTotalUnificado") || document.getElementById("lblTotalPagarFooter") || document.getElementById("totalPagar");
        if (lblTotalFooter) {
            lblTotalFooter.innerText = `${totalActualCobro.toFixed(2)} Bs`;
        }
    },

    // =========================================================================
    // MOTOR DEL RELOJ UNIFICADO Y REACTIVO
    // =========================================================================
    actualizarRelojes: function () {
        const mesasOcupadas = document.querySelectorAll('.mesa-card.ocupada, .mesa-card.pausada');
        const ahora = new Date();

        mesasOcupadas.forEach(mesa => {
            const inicioStr = mesa.getAttribute('data-hora-inicio');
            const pausaStr = mesa.getAttribute('data-hora-pausa');
            const precioHora = parseFloat(mesa.getAttribute('data-precio-hora')) || 0;
            const total_consumo = parseFloat(mesa.getAttribute('data-consumo')) || 0;

            // =========================================================================
            // BLINDAJE PARA MESAS DE CONSUMO (PRECIO HORA = 0) CON REGLA DE TRASPASO
            // =========================================================================
            if (precioHora === 0) {
                const importeActual = parseFloat(mesa.getAttribute('data-importe')) || 0;
                const importeTiempo = importeActual > 0 ? importeActual : 0.00;
                const importe_total = (importeTiempo + total_consumo).toFixed(2);

                const resumen = mesa.querySelector('.mesa-info-resumen');
                if (resumen) {
                    resumen.innerHTML = `
                        <span class="estado-badge" style="background:#3b82f6;">Consumo</span>
                        <span class="total-badge">${importe_total} Bs</span>
                    `;
                }

                mesa.setAttribute('data-tiempo', `00:00:00`);
                mesa.setAttribute('data-importe', importeTiempo.toFixed(2));

                // Sincronización en caliente con el Panel Lateral Derecho si la mesa está seleccionada
                if (modoActual === "mesa" && mesaSeleccionadaActual === mesa.getAttribute('data-nombre')) {
                    const rowsIzq = document.querySelectorAll(".detalle-columnas .col-izq strong");
                    const rowsDer = document.querySelectorAll(".detalle-columnas .col-der strong");

                    if (rowsIzq && rowsIzq[1]) rowsIzq[1].innerText = `00:00:00`;
                    if (rowsDer && rowsDer[0]) rowsDer[0].innerText = `${importeTiempo.toFixed(2)} Bs`;

                    const lblTiempo = document.getElementById("lblTiempoMesa");
                    const lblImporte = document.getElementById("lblImporteMesa");
                    if (lblTiempo) lblTiempo.innerText = `00:00:00`;
                    if (lblImporte) lblImporte.innerText = `${importeTiempo.toFixed(2)} Bs`;
                }
                return; // Saltamos los cálculos matemáticos de tiempo dinámico para esta mesa de consumo
            }
            // =========================================================================

            // Flujo estándar de cálculo para mesas de billar con tarifa activa por hora
            if (inicioStr && inicioStr !== "null" && inicioStr !== "") {
                const horaInicio = new Date(inicioStr.replace(/-/g, '/'));
                let horaFinCalculo = ahora;

                if (pausaStr && pausaStr !== "null" && pausaStr !== "") {
                    horaFinCalculo = new Date(pausaStr.replace(/-/g, '/'));
                }

                const difTotalSegundos = Math.floor((horaFinCalculo - horaInicio) / 1000);
                if (difTotalSegundos < 0) return;

                const difMinutos = Math.floor(difTotalSegundos / 60);
                const bloques = Math.ceil(difMinutos / 5);
                const minutesCobrables = bloques * 5;

                const acumulado = parseFloat(mesa.getAttribute('data-importe-acumulado')) || 0;
                let importeCalculado = (acumulado + (minutesCobrables * (precioHora / 60)));

                const tienePrimeraHoraGratis = mesa.getAttribute('data-primera-hora-gratis') === '1';
                if (tienePrimeraHoraGratis && precioHora > 0) {
                    importeCalculado = Math.max(0, importeCalculado - precioHora);
                }
                const importe = importeCalculado.toFixed(2);
                const importe_total = (Number(importe) + Number(total_consumo)).toFixed(2);

                const segundosAcumuladosAnteriores = parseInt(mesa.getAttribute('data-segundos-acumulados')) || 0;
                const segundosVisuales = difTotalSegundos + segundosAcumuladosAnteriores;

                const horasV = Math.floor(segundosVisuales / 3600).toString().padStart(2, '0');
                const minV = Math.floor((segundosVisuales % 3600) / 60).toString().padStart(2, '0');
                const segV = (segundosVisuales % 60).toString().padStart(2, '0');

                const resumen = mesa.querySelector('.mesa-info-resumen');
                if (resumen) {
                    const badgeGratis = tienePrimeraHoraGratis ? `<span style="background:#8b5cf6; color:white; font-size:0.75rem; padding:2px 5px; border-radius:4px; margin-left:4px; font-weight:bold;">1ª H. Gratis</span>` : '';
                    resumen.innerHTML = `
                        <span class="estado-badge">${horasV}:${minV} hrs</span>
                        <span class="total-badge">${importe_total} Bs</span>
                        ${badgeGratis}
                    `;
                }

                mesa.setAttribute('data-tiempo', `${horasV}:${minV}:${segV}`);
                mesa.setAttribute('data-importe', importe);

                if (modoActual === "mesa" && mesaSeleccionadaActual === mesa.getAttribute('data-nombre')) {
                    const rowsIzq = document.querySelectorAll(".detalle-columnas .col-izq strong");
                    const rowsDer = document.querySelectorAll(".detalle-columnas .col-der strong");

                    if (rowsIzq && rowsIzq[1]) rowsIzq[1].innerText = `${horasV}:${minV}:${segV}`;
                    if (rowsDer && rowsDer[0]) rowsDer[0].innerText = `${importe} Bs`;

                    const lblTiempo = document.getElementById("lblTiempoMesa");
                    const lblImporte = document.getElementById("lblImporteMesa");
                    if (lblTiempo) lblTiempo.innerText = `${horasV}:${minV}:${segV}`;
                    if (lblImporte) lblImporte.innerText = `${importe} Bs`;
                }
            }
        });

        // =========================================================================
        // REFRESCAMIENTO AUTOMÁTICO EN CADA SEGUNDO PARA EL TOTAL DEL FOOTER ACCIONES
        // =========================================================================
        if (modoActual === "mesa" && mesaSeleccionadaActual) {
            this.actualizarTotalesVista();
        }
    },
    iniciarMotorReloj: function () {
        if (window.intervaloMesas) clearInterval(window.intervaloMesas);
        this.actualizarRelojes();
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
        if ((idModal === 'modalConfirmarCobro' || idModal === 'modalDividirPago') && (modoActual === "barra" || modoActual === undefined) && this.mesaIncentivoAsignada) {
            // Si se cancela el cobro en barra y se había asignado incentivo, revertir el item de hora promo
            this.itemsCarrito = this.itemsCarrito.filter(i => !i.es_promo_hora && i.id_producto != this.idProductoHoraPromo);
            this.mesaIncentivoAsignada = null;
            this.renderizarCarrito();
            this.actualizarTotalesVista();
        }
        if ((idModal === 'modalConfirmarCobro' || idModal === 'modalDividirPago') && window.mesaAutoPausada) {
            window.mesaAutoPausada = false;
            if (modoActual === "mesa" && mesaSeleccionadaActual) {
                const mesaCardSeleccionada = Array.from(document.querySelectorAll('.mesa-card'))
                    .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);
                if (mesaCardSeleccionada) {
                    const idMesa = mesaCardSeleccionada.getAttribute("data-id");
                    try {
                        await fetch(this.apiURL, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accion: "reanudar_mesa", id_mesa: idMesa, tipo_pausa: "sistema" })
                        });
                        await this.cargarGrillaMesas();
                        this.actualizarRelojes();
                    } catch (error) {
                        console.error("Error al auto-reanudar:", error);
                    }
                }
            }
        }
    },
    detectarPromoIncentivoBarra: function () {
        if (this.mesaIncentivoAsignada) return null;
        const yaTienePromoItem = this.itemsCarrito.some(item => 
            (this.idProductoHoraPromo && parseInt(item.id_producto) === parseInt(this.idProductoHoraPromo)) || 
            (item.nombre && item.nombre.includes("Hora Promo"))
        );
        if (yaTienePromoItem) return null;

        const promos = this.promocionesActivas.filter(p => p.tipo_promo === 'incentivo_producto');
        for (const p of promos) {
            const idProd = parseInt(p.id_item_condicion);
            const cantReq = parseFloat(p.cantidad_condicion);
            const idTipoMesa = parseInt(p.id_item_secundario);

            const cantEnCarrito = this.itemsCarrito
                .filter(item => parseInt(item.id_producto) === idProd)
                .reduce((sum, item) => sum + parseInt(item.cantidad), 0);

            if (cantEnCarrito >= cantReq) {
                // Mesas libres del tipo configurado (se obtienen del DOM)
                const mesasLibresDom = Array.from(document.querySelectorAll(`.mesa-card.disponible[data-id-tipo-mesa="${idTipoMesa}"]`))
                    .map(el => ({
                        id_mesa: el.getAttribute('data-id'),
                        nombre: el.getAttribute('data-nombre')
                    }));

                return {
                    promo: p,
                    mesasLibres: mesasLibresDom,
                    idTipoMesa: idTipoMesa
                };
            }
        }
        return null;
    },
    // Método orquestador: intercepta "Realizar Venta" y "Pago Mixto" en modo barra
    iniciarFlujoCobro: function (tipoFlujo) {
        if (modoActual !== 'barra') {
            // No debe llamarse en modo mesa, pero por seguridad redirigimos
            if (tipoFlujo === 'mixto') this.prepararPagoDividido();
            else this.abrirModalCobro();
            return;
        }
        if (this.itemsCarrito.length === 0) {
            window.mostrarToast('Debe agregar productos al carrito para realizar una venta', 'warning');
            return;
        }
        // Detectar si aplica la promo incentivo_producto
        const deteccion = this.detectarPromoIncentivoBarra();
        if (deteccion) {
            // Hay promo aplicable: mostrar modal primero
            this.abrirModalIncentivoProducto({
                modo: 'barra',
                origen: tipoFlujo === 'mixto' ? 'pago_mixto' : 'cobro_directo',
                promo: deteccion.promo,
                mesasLibres: deteccion.mesasLibres
            });
        } else {
            // Sin promo: abrir directamente el modal de cobro
            if (tipoFlujo === 'mixto') this.prepararPagoDividido();
            else this.abrirModalCobro();
        }
    },
    abrirModalIncentivoProducto: function (config) {
        this.flujoIncentivoPendiente = config;
        const montoAumento = parseFloat(config.promo.valor_descuento) || 0;

        const lblMonto = document.getElementById("lblMontoAumentoIncentivo");
        if (lblMonto) lblMonto.innerText = montoAumento.toFixed(2);

        // Resetear radio buttons y apariencia de toggles
        const rdoSi = document.getElementById("optIncentivoSi");
        const rdoNo = document.getElementById("optIncentivoNo");
        if (rdoSi) rdoSi.checked = false;
        if (rdoNo) rdoNo.checked = false;
        const lblSi = document.getElementById("lblBtnIncentivoSi");
        const lblNo = document.getElementById("lblBtnIncentivoNo");
        if (lblSi) lblSi.classList.remove('activo');
        if (lblNo) lblNo.classList.remove('activo');

        const btnAceptar = document.getElementById("btnAceptarIncentivoProd");
        if (btnAceptar) btnAceptar.disabled = true;

        const contSelect = document.getElementById("contenedorSelectMesaIncentivo");
        const contMesaAct = document.getElementById("contenedorMesaActualIncentivo");
        // Ocultar ambos por defecto
        if (contSelect) contSelect.style.display = "none";
        if (contMesaAct) contMesaAct.style.display = "none";

        if (config.modo === 'barra') {
            const select = document.getElementById("selectMesaIncentivo");
            const aviso = document.getElementById("lblAvisoMesasLibres");
            if (select) {
                select.innerHTML = '<option value="">-- Seleccionar mesa libre --</option>';
                if (config.mesasLibres && config.mesasLibres.length > 0) {
                    config.mesasLibres.forEach(m => {
                        select.innerHTML += `<option value="${m.id_mesa}">${m.nombre}</option>`;
                    });
                    if (aviso) aviso.style.display = "none";
                } else {
                    if (aviso) aviso.style.display = "block";
                }
            }
        } else if (config.modo === 'mesa') {
            const lblAct = document.getElementById("lblMesaActualIncentivo");
            if (lblAct) lblAct.innerText = mesaSeleccionadaActual;
        }

        this.abrirModal('modal_apply_incentivoproducto');
    },
    onToggleIncentivo: function (valor) {
        if (!this.flujoIncentivoPendiente) return;
        const config = this.flujoIncentivoPendiente;
        const contSelect = document.getElementById("contenedorSelectMesaIncentivo");
        const contMesaAct = document.getElementById("contenedorMesaActualIncentivo");
        const btnAceptar = document.getElementById("btnAceptarIncentivoProd");

        // Actualizar apariencia de toggles
        const lblSi = document.getElementById("lblBtnIncentivoSi");
        const lblNo = document.getElementById("lblBtnIncentivoNo");
        if (lblSi) lblSi.classList.toggle('activo', valor === 'si');
        if (lblNo) lblNo.classList.toggle('activo', valor === 'no');

        if (valor === 'no') {
            // Solo ocultar extras y deshabilitar Aceptar; NO cerrar modal ni abrir cobro aquí
            if (contSelect) contSelect.style.display = "none";
            if (contMesaAct) contMesaAct.style.display = "none";
            if (btnAceptar) btnAceptar.disabled = false; // habilitar para confirmar el "No"
        } else if (valor === 'si') {
            if (config.modo === 'barra') {
                if (contSelect) contSelect.style.display = "block";
                if (contMesaAct) contMesaAct.style.display = "none";
                const select = document.getElementById("selectMesaIncentivo");
                if (btnAceptar) {
                    btnAceptar.disabled = !(select && select.value !== "");
                }
            } else if (config.modo === 'mesa') {
                if (contSelect) contSelect.style.display = "none";
                if (contMesaAct) contMesaAct.style.display = "block";
                if (btnAceptar) btnAceptar.disabled = false;
            }
        }
    },
    onSeleccionarMesaIncentivo: function () {
        const select = document.getElementById("selectMesaIncentivo");
        const btnAceptar = document.getElementById("btnAceptarIncentivoProd");
        if (btnAceptar) {
            btnAceptar.disabled = !(select && select.value !== "");
        }
    },
    confirmarIncentivoProducto: async function () {
        if (!this.flujoIncentivoPendiente) return;
        const config = this.flujoIncentivoPendiente;
        const montoAumento = parseFloat(config.promo.valor_descuento) || 0;

        // Si eligió "No" (btnAceptar habilitado en estado no)
        const rdoNo = document.getElementById("optIncentivoNo");
        if (rdoNo && rdoNo.checked) {
            // Confirmar el "No": cerrar modal y abrir cobro normal
            this.cerrarModal('modal_apply_incentivoproducto');
            if (config.modo === 'barra') {
                if (config.origen === 'pago_mixto') this.prepararPagoDividido();
                else this.abrirModalCobro();
            } else if (config.modo === 'mesa') {
                await this.ejecutarAgregarProductoMesaDirecto(config.id_mesa, config.producto, config.cantidad, config.precioUnitario, false);
            }
            this.flujoIncentivoPendiente = null;
            return;
        }

        if (config.modo === 'barra') {
            const select = document.getElementById("selectMesaIncentivo");
            const idMesaSeleccionada = select ? select.value : "";
            if (!idMesaSeleccionada) {
                window.mostrarToast("Por favor, seleccione una mesa libre.", "warning");
                return;
            }

            this.mesaIncentivoAsignada = idMesaSeleccionada;
            
            // Agregar el item hora con descuento al carrito
            this.itemsCarrito.push({
                id_producto: this.idProductoHoraPromo || 47,
                nombre: `Hora Promo (Incentivo)`,
                precio: montoAumento,
                cantidad: 1,
                total: montoAumento,
                es_promo_hora: true
            });

            this.renderizarCarrito();
            this.actualizarTotalesVista();
            this.cerrarModal('modal_apply_incentivoproducto');

            // Abrir el modal de cobro con el monto + aumento aplicado
            if (config.origen === 'pago_mixto') {
                this.prepararPagoDividido();
            } else {
                this.abrirModalCobro();
            }
            this.flujoIncentivoPendiente = null;

        } else if (config.modo === 'mesa') {
            this.cerrarModal('modal_apply_incentivoproducto');
            await this.ejecutarAgregarProductoMesaDirecto(config.id_mesa, config.producto, config.cantidad, config.precioUnitario, true, config.promo);
            this.flujoIncentivoPendiente = null;
        }
    },
    cerrarModalIncentivo: function (forzarNo = false) {
        this.cerrarModal('modal_apply_incentivoproducto');
        if (forzarNo && this.flujoIncentivoPendiente) {
            this.onToggleIncentivo('no');
        } else {
            this.flujoIncentivoPendiente = null;
        }
    },
    ejecutarAgregarProductoMesaDirecto: async function (idMesa, producto, cantidad, precioUnitario, aplicarPromo, promo) {
        const productosPayload = [{
            id_producto: producto.id_producto,
            cantidad: cantidad,
            precio_unitario: precioUnitario
        }];

        if (aplicarPromo && promo) {
            const montoAumento = parseFloat(promo.valor_descuento) || 0;
            productosPayload.push({
                id_producto: this.idProductoHoraPromo || 47,
                cantidad: 1,
                precio_unitario: montoAumento
            });
        }

        try {
            const payload = {
                accion: "agregar_productos_mesa",
                id_mesa: idMesa,
                productos: productosPayload
            };
            if (aplicarPromo) {
                payload.aplicar_primera_hora_gratis = 1;
            }

            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.status === "success") {
                this.limpiarFormularioVenta();

                // Si se aplicó la promo: ajustar el data-importe de la mesa card restando una hora
                if (aplicarPromo && promo) {
                    const mesaCard = document.querySelector(`.mesa-card[data-id="${idMesa}"]`);
                    if (mesaCard) {
                        const precioHora = parseFloat(mesaCard.getAttribute('data-precio-hora')) || 0;
                        const importeActual = parseFloat(mesaCard.getAttribute('data-importe')) || 0;
                        const nuevoImporte = Math.max(0, importeActual - precioHora);
                        mesaCard.setAttribute('data-importe', nuevoImporte.toFixed(2));
                        mesaCard.setAttribute('data-primera-hora-gratis', '1');
                    }
                }

                await this.cargarConsumoMesaActual(idMesa);
                await this.cargarGrillaMesas();
                await this.cargarDatalistProductos();
                this.actualizarRelojes();
                this.actualizarTotalesVista();
                if (aplicarPromo) {
                    window.mostrarToast("¡Promoción aplicada! 1 hora gratis en mesa y aumento añadido al carrito.", "success");
                } else {
                    window.mostrarToast("Producto agregado a la mesa.", "success");
                }
            } else {
                window.mostrarToast(data.message || "Error al agregar a mesa", "error");
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
        console.log("Mesa actual buscada:", mesaSeleccionadaActual);
        // 1. Obtener ID de la mesa activa actual desde el DOM
        const mesaCardActiva = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`)
        if (!mesaCardActiva) {
            window.mostrarToast("Seleccione una mesa ocupada válida.", "warning");
            return;
        }
        const idMesaOrigen = mesaCardActiva.getAttribute("data-id");
        try {
            // 2. Llamada a la API para traer mesas disponibles reales
            const response = await fetch(`${this.apiURL}?accion=get_mesas_disponibles&excluir_id=${idMesaOrigen}`);
            console.log("response => ", response);
            const mesasLibres = await response.json();
            console.log("mesas libre =>", mesasLibres);
            const selectDestino = document.getElementById("selectMesaDestino");
            selectDestino.innerHTML = '<option value="">-- Seleccione una mesa --</option>';
            if (mesasLibres.length === 0) {
                window.mostrarToast("No hay mesas disponibles en este momento.", "info");
                return;
            }
            // 3. Poblar el select
            mesasLibres.forEach(mesa => {
                const opt = document.createElement("option");
                opt.value = mesa.id_mesa;
                opt.innerText = mesa.nombre_mesa;
                selectDestino.appendChild(opt);
            });
            // Guardar origen para el momento de confirmar
            selectDestino.setAttribute("data-origen-id", idMesaOrigen);
            this.abrirModal('modalTransferirMesa');
        } catch (error) {
            console.error("Error al cargar mesas:", error);
            window.mostrarToast("Error al conectar con el servidor", "error");
        }
    },
    confirmarTransferencia: async function () {
        const selectDestino = document.querySelector("#modalTransferirMesa select");
        const idMesaOrigen = selectDestino.getAttribute("data-origen-id");
        const idMesaDestino = selectDestino.value;
        if (!idMesaDestino) {
            window.mostrarToast("Por favor seleccione una mesa de destino.", "warning");
            return;
        }

        // Capturamos el importe devengado acumulado en caliente de la mesa origen antes de destruirla
        const mesaCardOrigen = document.querySelector(`.mesa-card[data-id="${idMesaOrigen}"]`);
        const importeTiempoAcumulado = mesaCardOrigen ? parseFloat(mesaCardOrigen.getAttribute('data-importe')) || 0 : 0;

        const btn = document.querySelector('#modalTransferirMesa .btn-primary');
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

                // 1. Volver a cargar la grilla (trae los nuevos tramos desde la Base de Datos)
                await this.cargarGrillaMesas();
                this.actualizarRelojes();

                // Cargar el historial de tramos de la nueva mesa destino
                this.cargarHistorialTramos(idMesaDestino);

                // 2. Sincronizar elementos informativos fijos del panel
                const lblNombreMesa = document.getElementById("lblNombreMesaSeleccionada");
                if (lblNombreMesa) lblNombreMesa.innerText = nombreNuevaMesa;

                // 3. Buscar la nueva tarjeta destino en el DOM recién renderizado
                const nuevaMesaCard = document.querySelector(`.mesa-card[data-id="${idMesaDestino}"]`);
                if (nuevaMesaCard) {
                    const precioHoraDestino = parseFloat(nuevaMesaCard.getAttribute('data-precio-hora')) || 0;

                    if (precioHoraDestino === 0) {
                        // REGLA DE ORO DE TRASPASO: Inyectamos el valor acumulado directamente.
                        // Si el backend por retraso de caché de subconsulta devolviera 0, el cliente no pierde dinero.
                        // Si el backend devolviera el saldo correcto, garantizamos la consistencia decimal exacta de lo que vio en pantalla.
                        nuevaMesaCard.setAttribute('data-importe', importeTiempoAcumulado.toFixed(2));

                        // Levantar los hilos del reloj (ahora blindados contra sobreescritura a cero)
                        this.iniciarMotorReloj();

                        // Forzar al panel lateral derecho a renderizar de inmediato el saldo unificado
                        const totalProductos = this.itemsCarrito.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);
                        this.actualizarUIPrecios(totalProductos);
                    } else {
                        this.iniciarMotorReloj();
                    }
                } else {
                    this.iniciarMotorReloj();
                }

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
                this.actualizarRelojes();
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
                this.actualizarRelojes();

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
    calcularDividirPago: function (origen) {
        const inputEf = document.getElementById("inputDividirEfectivo");
        const inputQR = document.getElementById("inputDividirQR");
        let valEf = parseFloat(inputEf.value) || 0;
        let valQR = parseFloat(inputQR.value) || 0;

        // Usamos el total CONGELADO para que no varíe si el reloj hace tick de 5 min en este instante
        if (origen === 'efectivo') {
            let faltante = this.totalDividirCongelado - valEf;
            inputQR.value = faltante > 0 ? faltante.toFixed(2) : 0;
        } else if (origen === 'qr') {
            let faltante = this.totalDividirCongelado - valQR;
            inputEf.value = faltante > 0 ? faltante.toFixed(2) : 0;
        }
    },
    // === MÉTODO CORAZÓN: PREPARAR EL MODAL ===
    // === 1. PREPARAR PAGO DIVIDIDO / MIXTO ===
    prepararPagoDividido: async function () {
        if (totalActualCobro <= 0) {
            window.mostrarToast("No hay un monto válido para cobrar.", "warning");
            return;
        }

        // Validación y lógica exclusiva para modo Mesa
        if (modoActual === "mesa") {
            if (!mesaSeleccionadaActual) {
                window.mostrarToast("Seleccione una mesa para realizar este cobro.", "warning");
                return;
            }

            // [REINTEGRADO]: Lógica de Auto-Pausar Mesa Física
            const mesaCardSeleccionada = Array.from(document.querySelectorAll('.mesa-card'))
                .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);

            if (mesaCardSeleccionada) {
                const horaPausaStr = mesaCardSeleccionada.getAttribute("data-hora-pausa");
                const estaPausada = horaPausaStr && horaPausaStr !== "null" && horaPausaStr !== "";
                if (!estaPausada) {
                    const idMesa = mesaCardSeleccionada.getAttribute("data-id");
                    try {
                        await fetch(this.apiURL, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accion: "pausar_mesa", id_mesa: idMesa, tipo_pausa: "sistema" })
                        });
                        window.mesaAutoPausada = true;
                        await this.cargarGrillaMesas();
                        if (typeof this.actualizarRelojes === "function") this.actualizarRelojes();
                        this.actualizarTotalesVista();
                    } catch (error) {
                        console.error("Error al auto-pausar:", error);
                    }
                } else {
                    window.mesaAutoPausada = false;
                }
            }

            // [REINTEGRADO]: Aplicar regla de redondeo por bloques de 5 minutos en mesas
            this.totalDividirCongelado = parseFloat(this.redondearTarifaMesa(totalActualCobro));
        }
        // Validación exclusiva para modo Barra
        else if (modoActual === "barra") {
            if (this.itemsCarrito.length === 0) {
                window.mostrarToast("El carrito está vacío, no hay nada que cobrar.", "warning");
                return;
            }
            // En barra es una venta directa, no lleva redondeo de tiempo
            this.totalDividirCongelado = totalActualCobro;
        }

        // Imprimir el total congelado unificado en el modal
        const lblTotal = document.getElementById("lblTotalDividir");
        if (lblTotal) lblTotal.innerText = this.totalDividirCongelado.toFixed(2);

        // Por UX, sugerimos efectivo total por defecto
        document.getElementById("inputDividirEfectivo").value = this.totalDividirCongelado.toFixed(2);
        document.getElementById("inputDividirQR").value = "0.00";

        this.abrirModal('modalDividirPago');
    },

    // === 2. CONFIRMAR PAGO DIVIDIDO / MIXTO ===
    confirmarPagoDividido: async function () {
        const inputEf = document.getElementById("inputDividirEfectivo");
        const inputQR = document.getElementById("inputDividirQR");

        let valEf = parseFloat(inputEf.value) || 0;
        let valQR = parseFloat(inputQR.value) || 0;
        let sumaPagar = valEf + valQR;

        // Validar descuadre matemático
        if (Math.abs(sumaPagar - this.totalDividirCongelado) > 0.01) {
            window.mostrarToast(`Los montos ingresados (Ef: ${valEf.toFixed(2)} + QR: ${valQR.toFixed(2)} = ${sumaPagar.toFixed(2)}) no cuadran con el total de ${this.totalDividirCongelado.toFixed(2)} Bs.`, "warning");
            return;
        }

        // Validación previa de mesa
        let id_mesa_actual = null;
        if (modoActual === "mesa") {
            const mesaCard = Array.from(document.querySelectorAll('.mesa-card'))
                .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);

            if (!mesaCard) {
                window.mostrarToast("No se encontró la mesa activa en pantalla.", "error");
                return;
            }
            id_mesa_actual = mesaCard.getAttribute("data-id");
        }

        const btn = document.querySelector('#modalDividirPago .btn-success');
        const originalHTML = setBtnLoading(btn, true);

        try {
            // ==========================================
            // RAMA 1: COBRAR MESA CON PAGO DIVIDIDO
            // ==========================================
            if (modoActual === "mesa") {
                const payload = {
                    accion: "cobrar_mesa_pago_dividido", // <<< ¡CORREGIDO AQUÍ!
                    id_mesa: id_mesa_actual,
                    metodo_pago: "dividido",
                    monto_efectivo: valEf,
                    monto_qr: valQR,
                    total_congelado_frontend: this.totalDividirCongelado
                };

                const response = await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (data.status === "success") {
                    window.mostrarToast("Cobro dividido registrado con éxito.", "success");
                    this.cerrarModal('modalDividirPago');

                    // Deselección formal y limpieza de interfaz de mesa
                    this.deseleccionarMesa();
                    mesaSeleccionadaActual = "";
                    modoActual = "barra";
                    this.limpiarCarrito();

                    const lblModo = document.getElementById("lblModoVenta");
                    if (lblModo) lblModo.innerText = "Venta: en barra";
                    const seccionMesa = document.getElementById("seccionInfoMesaSeleccionada");
                    if (seccionMesa) seccionMesa.style.display = "none";

                    await this.cargarGrillaMesas();
                } else {
                    window.mostrarToast(data.message || "Error al procesar el cobro dividido", "error");
                }
            }
            // ==========================================
            // RAMA 2: COBRAR BARRA CON PAGO MIXTO (CARRITO)
            // ==========================================
            else if (modoActual === "barra") {
                const payload = {
                    accion: "cobrar_carrito_dividido", // <<< Mantiene el endpoint de barra pura
                    metodo_pago: "dividido",
                    monto_efectivo: valEf,
                    monto_qr: valQR,
                    total_congelado_frontend: this.totalDividirCongelado,
                    productos: this.itemsCarrito.map(item => ({
                        id_producto: item.id_producto,
                        cantidad: item.cantidad,
                        precio_unitario: item.precio
                    }))
                };
                // Si hay mesa promo asignada por incentivo_producto, incluirla
                if (this.mesaIncentivoAsignada) {
                    payload.id_mesa_ocupar_promo = this.mesaIncentivoAsignada;
                }

                const response = await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (data.status === "success") {
                    window.mostrarToast("Venta mixta en barra exitosa.", "success");
                    this.cerrarModal('modalDividirPago');
                    this.mesaIncentivoAsignada = null; // Limpiar estado de promo tras cobro
                    this.limpiarCarrito();
                    await this.cargarDatalistProductos();
                    this.actualizarTotalesVista();
                } else {
                    window.mostrarToast(data.message || "Error al procesar", "error");
                }
            }
        } catch (error) {
            console.error("Error en cobro dividido:", error);
            window.mostrarToast("Error de red al conectar con el servidor.", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    // === MÓDULO DE COBRO UNIFICADO (BARRA / MESA) ===
    // Algoritmo de redondeo estratégico (Sube al .50 o al entero superior más cercano)
    redondearTarifaMesa: function (valor) {
        const numero = parseFloat(valor) || 0;
        return (Math.ceil(numero * 2) / 2).toFixed(2);
    },
    prepararCobroMesa: async function () {
        // 1. Seteamos la variable de control maestro de la SPA a modo mesa
        modoActual = "mesa";
        // 2. Buscamos en el DOM la tarjeta de la mesa que se encuentra activa o seleccionada en la grilla
        const mesaCardSeleccionada = Array.from(document.querySelectorAll('.mesa-card'))
            .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);
        if (!mesaCardSeleccionada) {
            window.mostrarToast("Por favor, seleccione una mesa en la grilla antes de proceder al cobro.", "warning");
            return;
        }
        // 3. Extraemos dinámicamente el identificador semántico (nombre) de los atributos de la tarjeta
        const nombreMesa = mesaCardSeleccionada.getAttribute('data-nombre');
        if (!nombreMesa) {
            window.mostrarToast("La tarjeta de la mesa seleccionada no cuenta con el atributo 'data-nombre'.", "error");
            return;
        }
        // 4. Registramos el identificador en la variable de control global
        mesaSeleccionadaActual = nombreMesa;

        const horaPausaStr = mesaCardSeleccionada.getAttribute("data-hora-pausa");
        const estaPausada = horaPausaStr && horaPausaStr !== "null" && horaPausaStr !== "";
        if (!estaPausada) {
            const idMesa = mesaCardSeleccionada.getAttribute("data-id");
            try {
                await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ accion: "pausar_mesa", id_mesa: idMesa, tipo_pausa: "sistema" })
                });
                window.mesaAutoPausada = true;
                await this.cargarGrillaMesas();
                this.actualizarRelojes();
            } catch (error) {
                console.error("Error al auto-pausar:", error);
            }
        } else {
            window.mesaAutoPausada = false;
        }

        // 5. Invocamos al método de inyección y apertura; este interceptará la tarjeta .ocupada sin problemas
        this.abrirModalCobro();
    },
    // Orquestador del Modal de Confirmación de Cobro
    abrirModalCobro: function () {
        const contenedorDetalles = document.getElementById("contenedorDetallesMesa");
        // Configuración inicial común: Resetear el radio button por defecto a Efectivo
        const rdoEfectivo = document.getElementById("pagoEfectivo");
        if (rdoEfectivo) rdoEfectivo.checked = true;
        console.log("Modo actual al abrir modal:", modoActual);
        // Caso A: Venta directa en Barra
        if (modoActual === "barra" || modoActual === undefined) {
            if (this.itemsCarrito.length < 1) {
                window.mostrarToast("Debe agregar productos al carrito para realizar una venta", "warning");
                return;
            }
            // Ocultar detalles de comanda de tiempo en modo barra
            if (contenedorDetalles) contenedorDetalles.style.display = "none";
            const totalInsumos = this.itemsCarrito.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);
            const resPromo = this.calcularDescuentosLocales();
            const descuentoTotal = resPromo.descuentoTotal;
            const totalInsumosNeto = Math.max(0, totalInsumos - descuentoTotal);

            // ========================================================
            // BLINDAJE DEFENSIVO - CASO BARRA
            // ========================================================
            const lblTipo = document.getElementById("lblTipoCobroModal");
            if (lblTipo) lblTipo.innerText = "Venta en Barra Directa";
            const lblTotal = document.getElementById("lblTotalCobrarModal");
            if (lblTotal) lblTotal.innerText = `${totalInsumosNeto.toFixed(2)} Bs`;

            // Establecer el total definitivo global para el cobro
            window.totalActualCobro = totalInsumosNeto;
            this.abrirModal('modalConfirmarCobro');
        }
        // Caso B: Venta y Cierre Operativo de Mesa
        else if (modoActual === "mesa") {
            const mesaCard = Array.from(document.querySelectorAll('.mesa-card'))
                .find(el => el.getAttribute('data-nombre') === mesaSeleccionadaActual);

            if (!mesaCard) {
                window.mostrarToast("No se pudo interceptar la tarjeta de la mesa activa.", "error");
                return;
            }
            // Mostrar los detalles específicos de la mesa (tiempo + productos)
            if (contenedorDetalles) contenedorDetalles.style.display = "block";

            const idMesa = mesaCard.getAttribute("data-id");

            // =========================================================================
            // BLINDAJE ESTRATÉGICO PARA COBRO DE MESA (CONTEMPLA TRASPASOS CON SALDOS)
            // =========================================================================
            const importeTiempoCrudo = parseFloat(mesaCard.getAttribute("data-importe")) || 0;
            // =========================================================================

            // REGLA DE ORO: Aplicar el redondeo comercial hacia arriba (.50 o entero)
            const importeTiempoRedondeado = parseFloat(this.redondearTarifaMesa(importeTiempoCrudo));
            // Calcular consumos actuales en el carrito de esta comanda
            const totalCarritoActual = this.itemsCarrito.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);
            const resPromo = this.calcularDescuentosLocales();
            const descuentoTotal = resPromo.descuentoTotal;
            // Gran Total Combinado con Descuentos
            const granTotalMesa = Math.max(0, importeTiempoRedondeado + totalCarritoActual - descuentoTotal);

            // ========================================================
            // BLINDAJE DEFENSIVO - CASO MESA
            // ========================================================
            const lblTipo = document.getElementById("lblTipoCobroModal");
            if (lblTipo) lblTipo.innerText = `Liquidación: ${mesaSeleccionadaActual}`;
            const lblDetalleTiempo = document.getElementById("lblDetalleTiempoModal");
            if (lblDetalleTiempo) lblDetalleTiempo.innerText = `${importeTiempoRedondeado.toFixed(2)} Bs`;
            const lblDetalleConsumo = document.getElementById("lblDetalleConsumoModal");
            if (lblDetalleConsumo) lblDetalleConsumo.innerText = `${totalCarritoActual.toFixed(2)} Bs`;

            const rowDesc = document.getElementById("rowDescuentoModal");
            const lblDesc = document.getElementById("lblDetalleDescuentoModal");
            if (rowDesc && lblDesc) {
                if (descuentoTotal > 0) {
                    lblDesc.innerText = `-${descuentoTotal.toFixed(2)} Bs`;
                    rowDesc.style.display = "block";
                } else {
                    rowDesc.style.display = "none";
                }
            }

            const lblTotalMesa = document.getElementById("lblTotalCobrarModal");
            if (lblTotalMesa) lblTotalMesa.innerText = `${granTotalMesa.toFixed(2)} Bs`;

            // Almacenar estados maestros en memoria global del script
            window.idMesaPendiente = idMesa;
            window.totalActualCobro = granTotalMesa;

            this.abrirModal('modalConfirmarCobro');
        }
    },
    // Enrutador del botón definitivo "Confirmar Cobro" dentro del Modal
    ejecutarCobroConfirmado: async function () {
        const btn = document.querySelector('#modalConfirmarCobro .btn-primary.btn-success');
        const originalHTML = setBtnLoading(btn, true);
        try {
            // 1. Obtener el método de pago seleccionado en el modal
            const rdoQR = document.getElementById("pagoQR");
            const metodoPago = (rdoQR && rdoQR.checked) ? "qr" : "efectivo";
            let operacionExitosa = false;
            let mensajeExito = "Operación procesada exitosamente";
            let datosImpresion = null;

            // 2. Bifurcación de flujos según el modo de venta actual
            if (modoActual === "barra" || modoActual === undefined) {
                // Armamos el payload específico para registrar la venta directa en barra
                const payloadBarra = {
                    accion: "registrar_venta_barra",
                    id_usuario: 1, // Reemplazar dinámicamente según sesión de usuario activa
                    total: window.totalActualCobro,
                    metodo_pago: metodoPago,
                    productos: this.itemsCarrito.map(item => ({
                        id_producto: item.id_producto,
                        cantidad: item.cantidad,
                        precio_unitario: item.precio,
                        nombre: item.nombre
                    }))
                };
                // Si hay mesa promo asignada por incentivo_producto, incluirla
                if (this.mesaIncentivoAsignada) {
                    payloadBarra.id_mesa_ocupar_promo = this.mesaIncentivoAsignada;
                }
                const response = await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payloadBarra)
                });
                const data = await response.json();
                if (data.status === "success") {
                    operacionExitosa = true;
                    mensajeExito = data.message || "Venta en barra registrada";
                    datosImpresion = {
                        tipo: "Barra",
                        nombreMesa: "",
                        total: window.totalActualCobro,
                        metodo_pago: metodoPago,
                        productos: [...payloadBarra.productos],
                        tiempoMesa: 0
                    };
                } else {
                    window.mostrarToast(data.message || "Error al procesar venta en barra", "error");
                }
            } else if (modoActual === "mesa") {
                // Armamos el payload para el desglose de pagos de la mesa
                const payloadMesa = {
                    accion: "cobrar_mesa",
                    id_mesa: window.idMesaPendiente,
                    id_usuario: 1, // Reemplazar dinámicamente según sesión de usuario activa
                    total: window.totalActualCobro,
                    pagos: [
                        { metodo: metodoPago, monto: window.totalActualCobro }
                    ],
                    // ========================================================
                    // SOLUCIÓN AL DOBLE DESCUENTO: 
                    // En modo mesa el stock ya se descontó al "agregar producto".
                    // Pasamos un array vacío porque el backend ya tiene los consumos en BD.
                    // ========================================================
                    productos: []
                    // ========================================================
                };
                const response = await fetch(this.apiURL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payloadMesa)
                });
                const data = await response.json();
                if (data.status === "success") {
                    operacionExitosa = true;
                    mensajeExito = data.message || "Cobro realizado y mesa liberada";

                    const lblTiempoModal = document.getElementById("lblDetalleTiempoModal");
                    const tiempoMesaVal = lblTiempoModal ? parseFloat(lblTiempoModal.innerText) || 0 : 0;

                    datosImpresion = {
                        tipo: "Mesa",
                        nombreMesa: mesaSeleccionadaActual,
                        total: window.totalActualCobro,
                        metodo_pago: metodoPago,
                        productos: this.itemsCarrito.map(item => ({ cantidad: item.cantidad, nombre: item.nombre, precio_unitario: item.precio })),
                        tiempoMesa: tiempoMesaVal
                    };

                    this.deseleccionarMesa();
                } else {
                    window.mostrarToast(data.message || "Error al procesar cobro de mesa", "error");
                }
            }
            // 3. Bloque común de finalización tras una transacción exitosa en base de datos
            if (operacionExitosa) {
                window.mostrarToast(mensajeExito, "success");
                this.cerrarModal('modalConfirmarCobro');
                this.mesaIncentivoAsignada = null; // Limpiar estado de promo tras cobro
                this.limpiarCarrito();
                // Sincronización completa de la interfaz de usuario con el backend
                await this.cargarGrillaMesas(); // Actualiza estados visuales e importes acumulados del grid
                await this.cargarDatalistProductos(); // REFRESCAR EL DATALIST CON EL NUEVO STOCK REAL EN CALIENTE

                // Disparar Impresión si el gestor está disponible
                if (typeof gestorImpresion !== 'undefined' && datosImpresion) {
                    gestorImpresion.imprimirTicketVenta(datosImpresion);
                }
            }
        } catch (error) {
            console.error("Error en transacción unificada de cobro:", error);
            window.mostrarToast("Error de conexión al procesar la solicitud", "error");
        } finally {
            setBtnLoading(btn, false, originalHTML);
        }
    },
    // NUEVO MÉTODO OPERATIVO: Transacción de Cierre y Liberación de Mesa
    procesarCobroMesa: async function () {
        // AQUÍ SE INCLUYE: Capturamos el radio seleccionado justo antes de armar el payload
        const metodoSeleccionado = document.querySelector('input[name="metodoPago"]:checked').value;
        try {
            const payload = {
                accion: "cobrar_mesa",
                id_mesa: window.idMesaPendiente,
                id_usuario: localStorage.getItem("id_usuario") || 1,
                total: window.totalActualCobro,
                // Inyectamos el método capturado dinámicamente para la tabla 'pagos'
                pagos: [{ metodo: metodoSeleccionado, monto: window.totalActualCobro }],
                productos: this.itemsCarrito.map(item => ({
                    id_producto: item.id_producto,
                    cantidad: item.cantidad,
                    precio_unitario: item.precio
                }))
            };
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.status === "success") {
                window.mostrarToast("Mesa cobrada y liberada exitosamente.", "success");
                this.cerrarModal('modalConfirmarCobro');
                this.limpiarCarrito();
                modoActual = "barra";
                mesaSeleccionadaActual = "";
                this.cambiarEstadoLayout("state-barra");
                await this.cargarGrillaMesas();
            } else {
                window.mostrarToast(data.message || "Error al procesar cobro", "error");
            }
        } catch (error) {
            console.error("Error en cobro de mesa:", error);
            window.mostrarToast("Error de red en el servidor.", "error");
        }
    },
    procesarVentaBarra: async function () {
        if (this.itemsCarrito.length === 0) {
            window.mostrarToast("El carrito está vacío. Agregue productos primero.", "warning");
            return;
        }
        // AQUÍ SE INCLUYE: Capturamos el método de pago elegido para registrarlo en la barra
        const metodoSeleccionado = document.querySelector('input[name="metodoPago"]:checked').value;
        try {
            const payload = {
                accion: "registrar_venta_barra",
                id_usuario: localStorage.getItem("id_usuario") || 1,
                total: this.itemsCarrito.reduce((sum, item) => sum + (item.cantidad * item.precio), 0),
                metodo_pago: metodoSeleccionado, // Sincronizado para el Backend
                productos: this.itemsCarrito.map(item => ({
                    id_producto: item.id_producto,
                    cantidad: item.cantidad,
                    precio_unitario: item.precio
                }))
            };
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.status === "success") {
                window.mostrarToast("Venta registrada exitosamente", "success");
                this.limpiarCarrito();
            } else {
                window.mostrarToast(data.message || "Error al procesar la venta", "error");
            }
        } catch (error) {
            console.error("Error en la venta de barra:", error);
            window.mostrarToast("Error de conexión al procesar transacción", "error");
        }
    },
    procesarAgregarProductosMesa: async function () {
        if (this.itemsCarrito.length === 0) {
            window.mostrarToast("El carrito está vacío. Agregue productos primero.", "warning");
            return;
        }
        // Obtener el ID de la mesa seleccionada actualmente
        const mesaCard = document.querySelector(`.mesa-card[data-nombre="${mesaSeleccionadaActual}"]`);
        if (!mesaCard) return;
        const id_mesa_actual = mesaCard.getAttribute("data-id");
        try {
            const payload = {
                accion: "agregar_productos_mesa",
                id_mesa: id_mesa_actual,
                productos: this.itemsCarrito.map(item => ({
                    id_producto: item.id_producto,
                    cantidad: item.cantidad,
                    precio_unitario: item.precio
                }))
            };
            const response = await fetch(this.apiURL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.status === "success") {
                window.mostrarToast("Productos agregados a la mesa", "success");
                this.limpiarCarrito();
                // Recargar grilla para actualizar el consumo total y verlo en la vista
                await this.cargarGrillaMesas();
            } else {
                window.mostrarToast(data.message || "Error al agregar productos a la mesa", "error");
            }
        } catch (error) {
            console.error("Error al agregar a mesa:", error);
            window.mostrarToast("Error de conexión al procesar transacción", "error");
        }
    },
};
// NOTA: gestorUI.inicializar() es llamado por atencion.js cuando el router
// inyecta atencion.html en el outlet del SPA. No ejecutar aquí desde DOMContentLoaded
// porque en ese momento #listaProductos aún no existe en el DOM.