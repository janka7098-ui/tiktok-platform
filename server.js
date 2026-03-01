const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

const allowedKeys = [
  "nexora01","nexora02","nexora03","nexora04","nexora05",
  "nexora06","nexora07","nexora08","nexora09","nexora10"
];

const activeConnections = new Map();
const userActions = new Map(); // 🔥 Guardado de acciones por usuario

io.on("connection", (socket) => {

  // VALIDAR CLAVE
  socket.on("validateKey", (key) => {
    if (allowedKeys.includes(key)) {
      socket.emit("keyValid");
    } else {
      socket.emit("keyInvalid");
    }
  });

  // CONECTAR A TIKTOK
  socket.on("startConnection", async ({ username }) => {

    if (!username) return;

    if (activeConnections.has(socket.id)) {
      try { activeConnections.get(socket.id).disconnect(); } catch {}
      activeConnections.delete(socket.id);
    }

    const tiktok = new WebcastPushConnection(username);

    try {

      await tiktok.connect();
      activeConnections.set(socket.id, tiktok);

      socket.emit("status", "connected");

      // REGALOS (ANTI DUPLICADO)
      tiktok.on("gift", (data) => {
        if (data.repeatEnd) {
          socket.emit("gift", {
            user: data.nickname,
            gift: data.giftName,
            amount: data.repeatCount
          });
        }
      });

      // CHAT
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

  // GUARDAR ACCIÓN
  socket.on("saveAction", ({ username, action }) => {

    if (!userActions.has(username)) {
      userActions.set(username, []);
    }

    const actions = userActions.get(username);
    actions.push(action);

    socket.emit("actionsUpdated", actions);
  });

  // OBTENER ACCIONES
  socket.on("getActions", (username) => {
    const actions = userActions.get(username) || [];
    socket.emit("actionsUpdated", actions);
  });

  // ELIMINAR ACCIÓN
  socket.on("deleteAction", ({ username, index }) => {

    if (!userActions.has(username)) return;

    const actions = userActions.get(username);
    actions.splice(index, 1);

    socket.emit("actionsUpdated", actions);
  });

  // DESCONECTAR LIVE
  socket.on("disconnectLive", () => {
    if (activeConnections.has(socket.id)) {
      try { activeConnections.get(socket.id).disconnect(); } catch {}
      activeConnections.delete(socket.id);
      socket.emit("status", "disconnected");
    }
  });

  socket.on("disconnect", () => {
    if (activeConnections.has(socket.id)) {
      try { activeConnections.get(socket.id).disconnect(); } catch {}
      activeConnections.delete(socket.id);
    }
  });

});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("🚀 Nexora activo en puerto", PORT);
});
