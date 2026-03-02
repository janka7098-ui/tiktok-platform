const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

/* =========================
   PROXY AVATAR (SOLUCIÓN CORS)
========================= */

app.get("/avatar-proxy", async (req, res) => {
  try {
    const url = req.query.url;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.set("Content-Type", "image/jpeg");
    res.send(response.data);
  } catch (err) {
    res.status(500).send("Error avatar");
  }
});

/* =========================
   CONFIGURACIÓN
========================= */

const allowedKeys = [
  "nexora01","nexora02","nexora03","nexora04","nexora05",
  "nexora06","nexora07","nexora08","nexora09","nexora10"
];

const activeConnections = new Map();
const userActions = new Map();

io.on("connection", (socket) => {

  /* ===== INICIAR CONEXIÓN ===== */

  socket.on("startConnection", async ({ username, key }) => {

    if (!username || !key) return;

    if (!allowedKeys.includes(key)) {
      socket.emit("status", "invalid_key");
      return;
    }

    if (activeConnections.has(socket.id)) {
      try { activeConnections.get(socket.id).disconnect(); } catch {}
      activeConnections.delete(socket.id);
    }

    const tiktok = new WebcastPushConnection(username);

    try {

      await tiktok.connect();
      activeConnections.set(socket.id, tiktok);

      socket.emit("status", "connected");

      /* ===== OBTENER AVATAR ===== */

      try {
        const roomInfo = await tiktok.getRoomInfo();
        const avatarUrl = roomInfo?.owner?.avatarLarger;

        if (avatarUrl) {
          socket.emit("connectedUserData", {
            username,
            profilePictureUrl: `/avatar-proxy?url=${encodeURIComponent(avatarUrl)}`
          });
        }

      } catch (err) {
        console.log("Error avatar:", err);
      }

      /* ===== REGALOS ===== */

      tiktok.on("gift", (data) => {
        if (data.repeatEnd) {
          socket.emit("gift", {
            user: data.nickname,
            gift: data.giftName,
            amount: data.repeatCount
          });
        }
      });

      /* ===== CHAT ===== */

      tiktok.on("chat", (data) => {
        socket.emit("chat", {
          user: data.nickname,
          message: data.comment
        });
      });

    } catch (err) {
      socket.emit("status", "error");
    }
  });

  socket.on("disconnectLive", () => {
    if (activeConnections.has(socket.id)) {
      try { activeConnections.get(socket.id).disconnect(); } catch {}
      activeConnections.delete(socket.id);
      socket.emit("status", "disconnected");
    }
  });

});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log("🚀 Nexora activo en puerto", PORT);
});
