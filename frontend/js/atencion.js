document.addEventListener("DOMContentLoaded", () => {
    const outlet = document.getElementById("router-outlet");
    const menuToggle = document.getElementById("menuToggle");
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const navItems = document.querySelectorAll(".nav-item[data-page]");

    // --- 1. MOSTRAR NOMBRE DEL TRABAJADOR ---
    const txtSidebarName = document.getElementById("sidebarUserName");
    const nombreGuardado = localStorage.getItem("usuario_nombre");
    txtSidebarName.innerText = nombreGuardado ? nombreGuardado : "Trabajador Activo";

    // --- 2. ENRUTAMIENTO ---
    async function navegarA(nombreArchivo) {
        try {
            const response = await fetch(`vistas/${nombreArchivo}`);
            if (!response.ok) throw new Error("Vista en construcción.");

            const html = await response.text();
            outlet.innerHTML = html;

            // Delegación de eventos para el Dashboard temporal
            if (nombreArchivo === "dashboard_atencion.html") {
                const btnAbrir = document.getElementById("btnAbrirJornadaTemp");
                if (btnAbrir) {
                    btnAbrir.addEventListener("click", () => {
                        mostrarToast("La función de Abrir Jornada se implementará pronto", "warning");
                    });
                }
            }

        } catch (error) {
            outlet.innerHTML = `
                <div class="empty-state">
                    <i class="material-icons" style="font-size: 4rem; color: #cbd5e1;">build</i>
                    <h3 style="margin-top: 15px; color: #475569;">Sección en Construcción</h3>
                    <p style="color: #64748b;">Este módulo aún no ha sido implementado.</p>
                </div>`;
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

    // --- 3. RESPONSIVO Y MENU ---
    function toggleMenu() {
        sidebar.classList.toggle("open");
        overlay.classList.toggle("show");
    }
    menuToggle.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", toggleMenu);

    // --- 4. TOASTS ---
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

    // --- 5. LOGOUT ---
    document.getElementById("btnLogout").addEventListener("click", () => {
        localStorage.removeItem("usuario_nombre");
        window.location.href = "index.html";
    });

    // Carga inicial
    navegarA("dashboard_atencion.html");
});