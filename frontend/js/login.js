document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const errorMessage = document.getElementById("errorMessage");
    const btnSubmit = document.getElementById("btnSubmit");

    loginForm.addEventListener("submit", async (e) => {
        // Evitamos que la página se recargue (Mejor UX)
        e.preventDefault();

        // Limpiamos mensajes de error previos
        errorMessage.style.display = "none";
        errorMessage.textContent = "";

        // Capturamos los valores
        const usuario = document.getElementById("usuario").value;
        const password = document.getElementById("password").value;

        // Preparamos los datos en JSON
        const data = {
            usuario: usuario,
            password: password
        };

        try {
            // Cambiamos el texto del botón mientras carga
            btnSubmit.textContent = "Verificando...";
            btnSubmit.disabled = true;

            // Hacemos la petición POST al backend (Ajusta la ruta según tu servidor)
            const response = await fetch("../backend/api/login.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok && result.status === "success") {
                // Login exitoso: Redireccionamos según el rol
                const rol = result.data.rol;
                localStorage.setItem("id_usuario", result.data.id_usuario);
                localStorage.setItem("usuario_nombre", result.data.nombres + " " + result.data.apellidos);
                if (rol === "administrador") {
                    window.location.href = "portal_admin.html";
                } else if (rol === "atencion") {
                    window.location.href = "portal_atencion.html";
                }
            } else {
                // Credenciales incorrectas
                mostrarError(result.message || "Error al iniciar sesión.");
            }

        } catch (error) {
            // Error de conexión o servidor caído
            console.error("Error en la petición:", error);
            mostrarError("Error de conexión con el servidor.");
        } finally {
            // Restauramos el botón
            btnSubmit.textContent = "Iniciar Sesión";
            btnSubmit.disabled = false;
        }
    });

    // Función auxiliar para mostrar errores
    function mostrarError(mensaje) {
        errorMessage.textContent = mensaje;
        errorMessage.style.display = "block";
    }
});