const express = require("express");
const http = require("http");
const { WebcastPushConnection } = require("tiktok-live-connector");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

const io = socketIo(server,{
  maxHttpBufferSize:1e7
});

app.use(express.static("public"));
app.use(express.json()); 

/* =========================
   ESTADO PARA ROBLOX
========================= */
let currentEvent = {
    id: "0",
    action: "none",
    amount: 0,
    target: "ALL"
};

/* =========================
   PUENTE PARA ROBLOX (MODIFICADO)
========================= */
app.get('/ping', (req, res) => {
    console.log("👋 ¡Bingo! El panel web se comunicó.");
    res.json({ mensaje: "Prueba exitosa" });
});

// 👇 AÑADIDO: Este es el que busca tu script de Roblox
app.get('/lastevent', (req, res) => {
    res.json(currentEvent);
});

app.post('/test', (req, res) => {
    const { gift, repeatCount, parts, type, robloxUser } = req.body;

    currentEvent = {
        id: Date.now().toString(),
        action: type === "win" ? "win" : "move",
        amount: Number(parts) * Number(repeatCount), 
        target: robloxUser === "ALL_USERS" ? "ALL" : robloxUser
    };

    console.log("🔥 Nuevo evento (TEST):", currentEvent);
    res.json({ success: true, message: "Evento enviado a Roblox" });
});

app.get('/get-event', (req, res) => {
    res.json(currentEvent);
});

app.get('/reset', (req, res) => {
    currentEvent = {
        id: Date.now().toString(),
        action: "reset",
        amount: 0,
        target: "ALL"
    };
    console.log("🔄 Reset general activado");
    res.json({ success: true });
});


/* =========================
   LISTA DE REGALOS Y PROXY
========================= */
app.get("/gift-list",(req,res)=>{
  const giftsPath = path.join(__dirname,"public","regalos");
  if(!fs.existsSync(giftsPath)) return res.json([]);
  fs.readdir(giftsPath,(err,files)=>{
    if(err) return res.json([]);
    const giftList = files
      .filter(f=>f.toLowerCase().endsWith(".png"))
      .map(f=>({ name:f.replace(".png",""), image:"/regalos/"+f }));
    res.json(giftList);
  });
});

app.get("/avatar-proxy", async (req,res)=>{
  try{
    const url = req.query.url;
    const response = await axios.get(url,{ responseType:"arraybuffer" });
    res.set("Content-Type","image/jpeg");
    res.send(response.data);
  }catch(err){ res.status(500).send("avatar error"); }
});

const allowedKeys=["nexora01","nexora02","nexora03","nexora04","nexora05","nexora06","nexora07","nexora08","nexora09","nexora10"];
const activeConnections=new Map();
const userActions=new Map();

io.on("connection",(socket)=>{

  socket.on("startConnection", async ({username,key})=>{
    if(!username || !key) return;
    if(!allowedKeys.includes(key)){
      socket.emit("status","invalid_key");
      return;
    }

    const tiktok = new WebcastPushConnection(username);

    try{
      await tiktok.connect();
      activeConnections.set(socket.id,tiktok);
      socket.emit("status","connected");

      // 👇 MEJORADO: Ahora los regalos de TikTok activan Roblox automáticamente
      tiktok.on("gift",(data)=>{
        if(data.repeatEnd){
          socket.emit("gift",{
            user:data.nickname,
            gift:data.giftName,
            amount:data.repeatCount,
            image:`/regalos/${data.giftName}.png`,
            avatar: data.profilePictureUrl
          });

          // ENVÍO AUTOMÁTICO A ROBLOX
          currentEvent = {
              id: Date.now().toString(),
              action: "move",
              amount: data.repeatCount, // Mueve tantos niveles como regalos mande
              target: "ALL"
          };
          console.log(`🎁 Regalo en Vivo: ${data.giftName} x${data.repeatCount} -> Roblox`);

          const actions = userActions.get(username) || [];
          const action = actions.find(a=>a.gift.toLowerCase()===data.giftName.toLowerCase());
          if(action){
            if(action.type==="link"){
              axios.get(`${action.file}?user=${encodeURIComponent(data.nickname)}&gift=${data.giftName}&amount=${data.repeatCount}`).catch(()=>console.log("URL offline"));
            }else{ socket.emit("triggerSound",action.file); }
          }
        }
      });

      tiktok.on("chat",(data)=>{
        socket.emit("chat",{
          user:data.nickname,
          message:data.comment,
          avatar: data.profilePictureUrl, 
          isMod: data.isModerator,
          isSub: data.isSubscriber,
          isFollower: data.followRole === 1 || data.followRole === 2
        });
      });

      const likeRanking = new Map();
      tiktok.on("like",(data)=>{
        const user=data.nickname;
        const likes=data.likeCount || 1;
        socket.emit("singleLike", { user: user, avatar: data.profilePictureUrl });
        if(!likeRanking.has(user)){ likeRanking.set(user,0); }
        likeRanking.set(user, likeRanking.get(user)+likes);
        const ranking=[...likeRanking.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map((u,i)=>({ rank:i+1, user:u[0], likes:u[1] }));
        socket.emit("likeRanking",ranking);
      });

    }catch(err){ socket.emit("status","error"); }
  });

  /* (Resto de funciones de guardado se mantienen igual) */
  socket.on("uploadAndSave",({username,gift,fileName,fileData})=>{
    if(!username || !fileData) return;
    const userFolder = path.join(__dirname,"public","uploads",username);
    if(!fs.existsSync(userFolder)) fs.mkdirSync(userFolder,{recursive:true});
    const base64Data = fileData.split(";base64,").pop();
    const finalFileName = `${Date.now()}_${fileName}`;
    const filePath = path.join(userFolder,finalFileName);
    fs.writeFile(filePath,base64Data,{encoding:"base64"},()=>{
      if(!userActions.has(username)) userActions.set(username,[]);
      const actions = userActions.get(username);
      actions.push({ gift:gift, file:`/uploads/${username}/${finalFileName}`, type:"mp3" });
      socket.emit("actionsUpdated",actions);
      socket.emit("status","connected");
    });
  });

  socket.on("saveAction",({username,action})=>{
    if(!username) return;
    if(!userActions.has(username)) userActions.set(username,[]);
    const actions=userActions.get(username);
    actions.push(action);
    socket.emit("actionsUpdated",actions);
  });

  socket.on("getActions",(username)=>{
    const actions=userActions.get(username) || [];
    socket.emit("actionsUpdated",actions);
  });

  socket.on("deleteAction",({username,index})=>{
    if(!userActions.has(username)) return;
    const actions=userActions.get(username);
    actions.splice(index,1);
    socket.emit("actionsUpdated",actions);
  });

  socket.on("stopConnection",()=>{
    if(activeConnections.has(socket.id)){
      try{ activeConnections.get(socket.id).disconnect(); }catch{}
      activeConnections.delete(socket.id);
    }
    socket.emit("status","disconnected");
  });

  socket.on("disconnect",()=>{
    if(activeConnections.has(socket.id)){
      try{ activeConnections.get(socket.id).disconnect(); }catch{}
      activeConnections.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT,()=>{
  console.log("🚀 Nexora Ultra activo en puerto",PORT);
});
