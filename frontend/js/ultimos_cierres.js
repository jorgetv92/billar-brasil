// Lógica para Últimos Cierres de Jornada

async function cargarListadoPdfs() {
    const listadoContainer = document.getElementById("listadoPdfs");
    listadoContainer.innerHTML = "<p>Cargando reportes...</p>";

    try {
        const res = await fetch("../backend/api/reportes_pdf.php?action=list_pdfs");
        const json = await res.json();

        if (json.status === "success") {
            const archivos = json.data;

            if (archivos.length === 0) {
                listadoContainer.innerHTML = "<p style='color: #64748b;'>No hay reportes de cierre de jornada guardados.</p>";
                return;
            }

            let html = "";
            archivos.forEach(archivo => {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 15px; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="material-icons" style="color: #ef4444;">picture_as_pdf</i>
                            <div>
                                <h4 style="margin: 0; color: #1e293b; font-size: 1rem;">${archivo.name}</h4>
                                <span style="font-size: 0.8rem; color: #64748b;">${new Date(archivo.date).toLocaleString()}</span>
                            </div>
                        </div>
                        <button class="btn btn-primary" style="display: flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 0.85rem;" onclick="abrirVisorPdf('${archivo.name}')">
                            <i class="material-icons" style="font-size: 1.1rem;">visibility</i> Ver
                        </button>
                    </div>
                `;
            });
            listadoContainer.innerHTML = html;
        } else {
            listadoContainer.innerHTML = `<p style="color: #ef4444;">Error al cargar: ${json.message}</p>`;
        }
    } catch (err) {
        console.error("Error al cargar listado de PDFs:", err);
        listadoContainer.innerHTML = `<p style="color: #ef4444;">Error de conexión.</p>`;
    }
}

window.abrirVisorPdf = function(filename) {
    const iframe = document.getElementById("iframePdf");
    iframe.src = `../backend/api/reportes_pdf.php?action=view_pdf&file=${encodeURIComponent(filename)}`;
    document.getElementById("tituloModalPdf").innerText = filename;
    document.getElementById("modalVistaPdf").style.display = "flex";
};

window.cerrarModalPdf = function() {
    document.getElementById("modalVistaPdf").style.display = "none";
    document.getElementById("iframePdf").src = "";
};

// Cargar al inicializar la vista
cargarListadoPdfs();
