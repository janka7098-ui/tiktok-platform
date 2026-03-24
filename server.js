const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io con mayor buffer para archivos de audio
const io = socketIo(server, {
    maxHttpBufferSize: 1e7,
    cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
    ESTADO Y COLA (QUEUE)
========================= */
// Usamos una cola para que Roblox no pierda eventos rápidos
let eventQueue = []; 

const allowedKeys = ["nexora01", "nexora02", "nexora03", "nexora04", "nexora05", "nexora06", "nexora07", "nexora08", "nexora09", "nexora10"];
const activeConnections = new Map();
const userActions = new Map();

// Asegurar que existan las carpetas necesarias
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

/* =========================
    RUTAS DE NAVEGACIÓN
========================= */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/interactive', (req, res) => res.sendFile(path.join(__dirname, 'public', 'interactivo.html')));
/* =========================
    PUENTE PARA ROBLOX
========================= */

// Roblox debe consultar esta ruta. Devuelve un Array de eventos y limpia la cola.
app.get('/get-events', (req, res) => {
    const tempEvents = [...eventQueue];
    eventQueue = []; // Vaciar cola tras la lectura
    res.json(tempEvents);
});

// Mantengo /lastevent por compatibilidad, pero devuelve el último de la cola sin borrarla
app.get('/lastevent', (req, res) => {
    if (eventQueue.length === 0) return res.json({ id: "0", action: "none" });
    res.json(eventQueue[eventQueue.length - 1]);
});

app.get('/reset', (req, res) => {
    eventQueue.push({
        id: Date.now().toString(),
        action: "reset",
        amount: 0,
        target: "ALL"
    });
    console.log("🔄 Reset general enviado a cola");
    res.json({ success: true });
});

app.post('/test', (req, res) => {
    const { gift, repeatCount, parts, type, robloxUser } = req.body;
    const newEvent = {
        id: Date.now().toString(),
        action: type === "win" ? "win" : "move",
        amount: Number(parts) * Number(repeatCount), 
        target: robloxUser === "ALL_USERS" ? "ALL" : robloxUser
    };
    eventQueue.push(newEvent);
    console.log("🔥 Test enviado:", newEvent);
    res.json({ success: true });
});

/* =========================
    LISTA DE REGALOS Y PROXY
========================= */
app.get("/gift-list", (req, res) => {
    const giftsPath = path.join(__dirname, "public", "regalos");
    if (!fs.existsSync(giftsPath)) return res.json([]);
    fs.readdir(giftsPath, (err, files) => {
        if (err) return res.json([]);
        const giftList = files
            .filter(f => f.toLowerCase().endsWith(".png"))
            .map(f => ({ name: f.replace(".png", ""), image: "/regalos/" + f }));
        res.json(giftList);
    });
});

app.get("/avatar-proxy", async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send("No URL");
        const response = await axios.get(url, { responseType: "arraybuffer", timeout: 5000 });
        res.set("Content-Type", "image/jpeg");
        res.send(response.data);
    } catch (err) { res.status(500).send("error"); }
});

/* =========================
    LÓGICA SOCKET.IO (TIKTOK)
========================= */
io.on("connection", (socket) => {

    socket.on("startConnection", async ({ username, key }) => {
        if (!username || !key || !allowedKeys.includes(key)) {
            return socket.emit("status", "invalid_key");
        }

        const tiktok = new WebcastPushConnection(username);

        try {
            await tiktok.connect();
            activeConnections.set(socket.id, tiktok);
            socket.emit("status", "connected");

            tiktok.on("gift", (data) => {
                if (data.repeatEnd) {
                    // 1. Notificar al panel web
                    socket.emit("gift", {
                        user: data.nickname,
                        gift: data.giftName,
                        amount: data.repeatCount,
                        image: `/regalos/${data.giftName}.png`,
                        avatar: data.profilePictureUrl
                    });

                    // 2. Insertar en la cola de Roblox
                    eventQueue.push({
                        id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        action: "move",
                        amount: data.repeatCount,
                        target: "ALL",
                        giftName: data.giftName
                    });

                    console.log(`🎁 Gift: ${data.giftName} x${data.repeatCount} -> Agregado a cola`);

                    // 3. Ejecutar acción de sonido o link
                    const actions = userActions.get(username) || [];
                    const action = actions.find(a => a.gift.toLowerCase() === data.giftName.toLowerCase());
                    if (action) {
                        if (action.type === "link") {
                            axios.get(`${action.file}?user=${encodeURIComponent(data.nickname)}&gift=${data.giftName}&amount=${data.repeatCount}`).catch(() => {});
                        } else { 
                            socket.emit("triggerSound", action.file); 
                        }
                    }
                }
            });

            tiktok.on("chat", (data) => {
                socket.emit("chat", {
                    user: data.nickname,
                    message: data.comment,
                    avatar: data.profilePictureUrl
                });
            });

            tiktok.on("like", (data) => {
                socket.emit("singleLike", { user: data.nickname, avatar: data.profilePictureUrl });
            });

        } catch (err) { 
            socket.emit("status", "error"); 
        }
    });

    // --- Gestión de Acciones ---
    socket.on("uploadAndSave", ({ username, gift, fileName, fileData }) => {
        if (!username || !fileData) return;
        const userFolder = path.join(uploadsDir, username);
        if (!fs.existsSync(userFolder)) fs.mkdirSync(userFolder, { recursive: true });
        
        const base64Data = fileData.split(";base64,").pop();
        const finalFileName = `${Date.now()}_${fileName}`;
        const filePath = path.join(userFolder, finalFileName);
        
        fs.writeFile(filePath, base64Data, { encoding: "base64" }, (err) => {
            if (err) return;
            if (!userActions.has(username)) userActions.set(username, []);
            userActions.get(username).push({ gift, file: `/uploads/${username}/${finalFileName}`, type: "mp3" });
            socket.emit("actionsUpdated", userActions.get(username));
        });
    });

    socket.on("saveAction", ({ username, action }) => {
        if (!username) return;
        if (!userActions.has(username)) userActions.set(username, []);
        userActions.get(username).push(action);
        socket.emit("actionsUpdated", userActions.get(username));
    });

    socket.on("getActions", (username) => {
        socket.emit("actionsUpdated", userActions.get(username) || []);
    });

    socket.on("deleteAction", ({ username, index }) => {
        if (!userActions.has(username)) return;
        userActions.get(username).splice(index, 1);
        socket.emit("actionsUpdated", userActions.get(username));
    });

    socket.on("stopConnection", () => {
        if (activeConnections.has(socket.id)) {
            activeConnections.get(socket.id).disconnect();
            activeConnections.delete(socket.id);
        }
        socket.emit("status", "disconnected");
    });

    socket.on("disconnect", () => {
        if (activeConnections.has(socket.id)) {
            activeConnections.get(socket.id).disconnect();
            activeConnections.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("🚀 Nexora Ultra (Queue Mode) activo en puerto", PORT);
});
