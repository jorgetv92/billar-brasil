const gestorImpresion = {
    imprimirContenido: function (htmlContent) {
        const imprimirTermicaEnabled = localStorage.getItem('imprimirTermicaHabilitado');
        if (imprimirTermicaEnabled === 'false') {
            console.log('Impresión térmica deshabilitada en este dispositivo.');
            return;
        }

        let iframe = document.getElementById('iframeImpresion');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'iframeImpresion';
            iframe.style.position = 'absolute';
            iframe.style.width = '0px';
            iframe.style.height = '0px';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);
        }

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <html>
            <head>
                <style>
                    @page { margin: 0; }
                    body {
                        font-family: 'Courier New', Courier, monospace;
                        font-size: 12px;
                        margin: 0;
                        padding: 10px;
                        width: 58mm; /* Configurable para 58mm o 80mm */
                        color: #000;
                    }
                    .text-center { text-align: center; }
                    .text-right { text-align: right; }
                    .text-left { text-align: left; }
                    .bold { font-weight: bold; }
                    .divider { border-bottom: 1px dashed #000; margin: 5px 0; }
                    .ticket-header { margin-bottom: 10px; }
                    .ticket-header h2 { margin: 0; font-size: 16px; }
                    .ticket-header p { margin: 2px 0; font-size: 10px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
                    table th, table td { padding: 2px 0; }
                    table th { border-bottom: 1px solid #000; text-align: left; }
                    .total-row { font-size: 14px; font-weight: bold; margin-top: 10px; text-align: right; }
                    .footer { text-align: center; font-size: 10px; margin-top: 15px; }
                </style>
            </head>
            <body>
                ${htmlContent}
                <script>
                    window.onload = function() {
                        window.print();
                    };
                </script>
            </body>
            </html>
        `);
        doc.close();
    },

    imprimirTicketVenta: function (datos) {
        // datos = { tipo: "Barra" | "Mesa", nombreMesa: "", total: 0, metodo_pago: "", productos: [], tiempoMesa: 0 }
        
        const fecha = new Date().toLocaleString();
        let productosHtml = '';
        
        if (datos.productos && datos.productos.length > 0) {
            productosHtml += `
            <table>
                <thead>
                    <tr>
                        <th>Cant</th>
                        <th>Desc</th>
                        <th class="text-right">SubT</th>
                    </tr>
                </thead>
                <tbody>
            `;
            datos.productos.forEach(prod => {
                const subT = prod.cantidad * prod.precio_unitario;
                // Truncar nombre para que entre bien
                const nombreCorto = prod.nombre.length > 10 ? prod.nombre.substring(0,10) + '.' : prod.nombre;
                productosHtml += `
                    <tr>
                        <td>${prod.cantidad}</td>
                        <td>${nombreCorto}</td>
                        <td class="text-right">${subT.toFixed(2)}</td>
                    </tr>
                `;
            });
            productosHtml += `</tbody></table>`;
        } else if (datos.tipo === "Mesa" && (!datos.productos || datos.productos.length === 0)) {
            productosHtml += `<p class="text-center" style="font-size:10px;">(Detalle de consumo omitido en impresión directa)</p>`;
        }

        let tiempoHtml = '';
        if (datos.tipo === "Mesa" && datos.tiempoMesa > 0) {
            tiempoHtml = `
            <div class="divider"></div>
            <div><span class="bold">Uso de Mesa:</span> ${parseFloat(datos.tiempoMesa).toFixed(2)} Bs</div>
            `;
        }

        const html = `
            <div class="ticket-header text-center">
                <h2>BILLAR & BAR</h2>
                <p>Comprobante de Venta</p>
                <p>Fecha: ${fecha}</p>
                <p class="bold">Tipo: ${datos.tipo === 'Barra' ? 'Venta en Barra' : 'Cobro Mesa (' + datos.nombreMesa + ')'}</p>
            </div>
            
            <div class="divider"></div>
            
            ${productosHtml}
            ${tiempoHtml}
            
            <div class="divider"></div>
            <div class="total-row">TOTAL: ${parseFloat(datos.total).toFixed(2)} Bs</div>
            <div class="text-right" style="font-size:10px; margin-top:5px;">Método: ${datos.metodo_pago.toUpperCase()}</div>
            
            <div class="footer">
                <p>¡Gracias por su preferencia!</p>
            </div>
        `;

        this.imprimirContenido(html);
    },

    imprimirTicketJornada: function (datos) {
        // datos = { id_jornada, encargado, fecha_apertura, fecha_cierre, ingresos_efectivo, ingresos_qr, monto_inicial, total_caja, total_tiempo_mesas, total_productos }
        
        const html = `
            <div class="ticket-header text-center">
                <h2>BILLAR & BAR</h2>
                <p>Cierre de Jornada #${datos.id_jornada}</p>
                <p>Encargado: ${datos.encargado}</p>
            </div>
            
            <div class="divider"></div>
            <p style="font-size:10px;"><strong>Apertura:</strong><br>${datos.fecha_apertura}</p>
            <p style="font-size:10px;"><strong>Cierre:</strong><br>${datos.fecha_cierre}</p>
            <div class="divider"></div>
            
            <table>
                <tbody>
                    <tr><td>Fondo Inicial:</td><td class="text-right">${parseFloat(datos.monto_inicial).toFixed(2)} Bs</td></tr>
                    <tr><td>Ventas Tiempo:</td><td class="text-right">${parseFloat(datos.total_tiempo_mesas).toFixed(2)} Bs</td></tr>
                    <tr><td>Ventas Productos:</td><td class="text-right">${parseFloat(datos.total_productos).toFixed(2)} Bs</td></tr>
                </tbody>
            </table>
            
            <div class="divider"></div>
            <div class="text-center bold" style="margin-bottom:5px;">RESUMEN DE INGRESOS</div>
            <table>
                <tbody>
                    <tr><td>Ingresos Efectivo:</td><td class="text-right">${parseFloat(datos.ingresos_efectivo).toFixed(2)} Bs</td></tr>
                    <tr><td>Ingresos QR:</td><td class="text-right">${parseFloat(datos.ingresos_qr).toFixed(2)} Bs</td></tr>
                </tbody>
            </table>
            
            <div class="divider"></div>
            <div class="total-row">TOTAL EN CAJA: ${parseFloat(datos.total_caja).toFixed(2)} Bs</div>
            
            <div class="footer">
                <p>Reporte generado automáticamente</p>
            </div>
        `;

        this.imprimirContenido(html);
    }
};
