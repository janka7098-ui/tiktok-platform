const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

/* ================================
   🔐 CLAVES PERMITIDAS (10 AMIGOS)
================================ */
const allowedKeys = [
  "nexora01","nexora02","nexora03","nexora04","nexora05",
  "nexora06","nexora07","nexora08","nexora09","nexora10"
];

/* ================================
   🔥 CONEXIONES ACTIVAS
================================ */
const activeConnections = new Map();

io.on("connection", (socket) => {

    console.log("🟢 Usuario conectado:", socket.id);

    /* ================================
       VALIDAR CLAVE
    ================================ */
    socket.on("validateKey", (key) => {
        if (allowedKeys.includes(key)) {
            socket.emit("keyValid");
        } else {
            socket.emit("keyInvalid");
        }
    });

    /* ================================
       CONECTAR TIKTOK
    ================================ */
    socket.on("startConnection", async ({ username }) => {

        if (!username) return;

        console.log("🔥 Intentando conectar a:", username);

        // Si ya tenía conexión previa, cerrarla
        if (activeConnections.has(socket.id)) {
            try {
                activeConnections.get(socket.id).disconnect();
            } catch {}
            activeConnections.delete(socket.id);
        }

        const tiktok = new WebcastPushConnection(username);

        try {

            await tiktok.connect();

            activeConnections.set(socket.id, tiktok);

            socket.emit("status", "connected");

            console.log("✅ Conectado a TikTok:", username);

            /* ================================
               🎁 REGALOS (ANTI DUPLICADO)
            ================================ */
            tiktok.on("gift", (data) => {

                // SOLO cuando termina el regalo
                if (data.repeatEnd) {

                    socket.emit("gift", {
                        user: data.nickname,
                        gift: data.giftName,
                        amount: data.repeatCount
                    });

                }
            });

            /* ================================
               💬 CHAT
            ================================ */
            tiktok.on("chat", (data) => {

                socket.emit("chat", {
                    user: data.nickname,
                    message: data.comment
                });

            });

            /* ================================
               ❌ ERROR
            ================================ */
            tiktok.on("error", (err) => {
                console.log("❌ Error TikTok:", err);
                socket.emit("status", "error");
            });

        } catch (error) {

            console.log("❌ Error conectando:", error);
            socket.emit("status", "error");

        }

    });

    /* ================================
       DESCONECTAR LIVE MANUAL
    ================================ */
    socket.on("disconnectLive", () => {

        if (activeConnections.has(socket.id)) {

            try {
                activeConnections.get(socket.id).disconnect();
            } catch {}

            activeConnections.delete(socket.id);

            socket.emit("status", "disconnected");

            console.log("🔴 Live desconectado:", socket.id);
        }

    });

    /* ================================
       SI CIERRA EL NAVEGADOR
    ================================ */
    socket.on("disconnect", () => {

        if (activeConnections.has(socket.id)) {

            try {
                activeConnections.get(socket.id).disconnect();
            } catch {}

            activeConnections.delete(socket.id);

            console.log("🔴 Usuario desconectado:", socket.id);
        }

    });

});

/* ================================
   🚀 INICIAR SERVIDOR
================================ */
const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log("🚀 Nexora activo en puerto", PORT);
});
