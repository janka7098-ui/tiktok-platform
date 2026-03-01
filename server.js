const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

io.on("connection", (socket) => {
    console.log("🟢 Usuario conectado:", socket.id);

    let tiktokConnection = null;
    let reconnectInterval = null;

    socket.on("startConnection", async (data) => {
        const { username } = data;

        if (!username) {
            console.log("⚠ Username vacío");
            return;
        }

        console.log(`🔥 Intentando conectar a TikTok: ${username}`);

        // 🔥 CONEXIÓN FORZANDO POLLING
        tiktokConnection = new WebcastPushConnection(username, {
            enableExtendedGiftInfo: true,
            processInitialData: false,
            fetchRoomInfoOnConnect: true,
            requestPollingIntervalMs: 2000
        });

        const connectToTikTok = async () => {
            try {
                await tiktokConnection.connect({
                    enableWebsocketUpgrade: false // 🚫 Desactiva websocket
                });

                console.log("✅ Conectado a TikTok LIVE");
                socket.emit("connected");

                // 🎁 Regalos
                tiktokConnection.on("gift", (data) => {
                    console.log("🎁 Gift:", data.giftName);

                    io.emit("gift", {
                        user: data.uniqueId,
                        gift: data.giftName,
                        amount: data.repeatCount
                    });
                });

                // 💬 Chat
                tiktokConnection.on("chat", (data) => {
                    console.log("💬 Chat:", data.comment);

                    io.emit("chat", {
                        user: data.uniqueId,
                        message: data.comment
                    });
                });

                // ⭐ Follow
                tiktokConnection.on("follow", (data) => {
                    console.log("⭐ Follow:", data.uniqueId);

                    io.emit("follow", {
                        user: data.uniqueId
                    });
                });

                // ❤️ Likes
                tiktokConnection.on("like", (data) => {
                    console.log("❤️ Likes:", data.likeCount);

                    io.emit("like", {
                        user: data.uniqueId,
                        likes: data.likeCount
                    });
                });

                // 🔌 Si TikTok se desconecta
                tiktokConnection.on("disconnected", () => {
                    console.log("⚠ TikTok se desconectó");
                    socket.emit("disconnected");
                    startReconnect();
                });

            } catch (err) {
                console.log("❌ Error al conectar:", err.message);
                startReconnect();
            }
        };

        const startReconnect = () => {
            if (reconnectInterval) return;

            console.log("🔄 Activando reconexión automática cada 5 segundos");

            reconnectInterval = setInterval(async () => {
                console.log("🔁 Reintentando conexión...");

                try {
                    await tiktokConnection.connect({
                        enableWebsocketUpgrade: false
                    });

                    console.log("✅ Reconectado correctamente");
                    clearInterval(reconnectInterval);
                    reconnectInterval = null;
                    socket.emit("connected");

                } catch (err) {
                    console.log("❌ Falló reconexión:", err.message);
                }
            }, 5000);
        };

        await connectToTikTok();
    });

    socket.on("disconnect", () => {
        console.log("🔴 Usuario desconectado:", socket.id);

        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        if (reconnectInterval) {
            clearInterval(reconnectInterval);
        }
    });
});
