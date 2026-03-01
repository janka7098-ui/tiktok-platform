const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

const connections = {};

io.on("connection", (socket) => {
    console.log("Usuario conectado:", socket.id);

    socket.on("startConnection", async (data) => {
        const { username } = data;
        if (!username) return;

        // 🔥 Cerrar conexión previa si existe
        if (connections[socket.id]) {
            connections[socket.id].tiktokConnection.disconnect();
            delete connections[socket.id];
        }

        const tiktokConnection = new WebcastPushConnection(username);

        try {
            await tiktokConnection.connect();

            connections[socket.id] = {
                username,
                tiktokConnection
            };

            socket.emit("status", "connected");

            // 🎁 REGALOS
            tiktokConnection.on("gift", (giftData) => {
                socket.emit("gift", {
                    id: giftData.giftId + "-" + giftData.repeatCount + "-" + Date.now(),
                    user: giftData.nickname,
                    gift: giftData.giftName,
                    amount: giftData.repeatCount
                });
            });

            // 💬 CHAT
            tiktokConnection.on("chat", (chatData) => {
                socket.emit("chat", {
                    id: chatData.uniqueId + "-" + Date.now(),
                    user: chatData.nickname,
                    message: chatData.comment
                });
            });

        } catch (err) {
            console.log("Error conectando:", err);
            socket.emit("status", "error");
        }
    });

    socket.on("disconnectLive", () => {
        if (connections[socket.id]) {
            connections[socket.id].tiktokConnection.disconnect();
            delete connections[socket.id];
            socket.emit("status", "disconnected");
        }
    });

    socket.on("disconnect", () => {
        if (connections[socket.id]) {
            connections[socket.id].tiktokConnection.disconnect();
            delete connections[socket.id];
        }
    });
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log("Servidor corriendo en puerto", PORT);
});
