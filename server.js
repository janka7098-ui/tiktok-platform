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

/* =========================
   LISTA DE REGALOS
========================= */
app.get("/gift-list",(req,res)=>{
  const giftsPath = path.join(__dirname,"public","regalos");

  if(!fs.existsSync(giftsPath)) return res.json([]);

  fs.readdir(giftsPath,(err,files)=>{
    if(err) return res.json([]);

    const giftList = files
      .filter(f=>f.toLowerCase().endsWith(".png"))
      .map(f=>({
        name:f.replace(".png",""),
        image:"/regalos/"+f
      }));

    res.json(giftList);
  });
});


/* =========================
   PROXY AVATAR
========================= */
app.get("/avatar-proxy", async (req,res)=>{
  try{
    const url = req.query.url;
    const response = await axios.get(url,{
      responseType:"arraybuffer"
    });
    res.set("Content-Type","image/jpeg");
    res.send(response.data);
  }catch(err){
    res.status(500).send("avatar error");
  }
});


const allowedKeys=[
  "nexora01",
  "nexora02",
  "nexora03",
  "nexora04",
  "nexora05",
  "nexora06",
  "nexora07",
  "nexora08",
  "nexora09",
  "nexora10"
];

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

      /* =========================
         OBTENER AVATAR DEL CREADOR
      ========================= */
      try{
        const roomInfo = await tiktok.getRoomInfo();
        const avatarUrl = roomInfo?.owner?.avatarLarger;
        if(avatarUrl){
          socket.emit("connectedUserData",{
            username,
            profilePictureUrl:`/avatar-proxy?url=${encodeURIComponent(avatarUrl)}`
          });
        }
      }catch(err){}

      /* =========================
         REGALOS
      ========================= */
      tiktok.on("gift",(data)=>{
        if(data.repeatEnd){
          socket.emit("gift",{
            user:data.nickname,
            gift:data.giftName,
            amount:data.repeatCount,
            image:`/regalos/${data.giftName}.png`,
            avatar: data.profilePictureUrl // <-- FOTO DE PERFIL AÑADIDA
          });

          const actions = userActions.get(username) || [];
          const action = actions.find(a=>a.gift.toLowerCase()===data.giftName.toLowerCase());

          if(action){
            if(action.type==="link"){
              axios.get(`${action.file}?user=${encodeURIComponent(data.nickname)}&gift=${data.giftName}&amount=${data.repeatCount}`)
              .catch(()=>console.log("URL offline"));
            }else{
              socket.emit("triggerSound",action.file);
            }
          }
        }
      });

      /* =========================
         CHAT
      ========================= */
      tiktok.on("chat",(data)=>{
        socket.emit("chat",{
          user:data.nickname,
          message:data.comment,
          avatar: data.profilePictureUrl // <-- FOTO DE PERFIL AÑADIDA
        });
      });

      /* =========================
         TAP TAP (LIKES)
      ========================= */
      const likeRanking = new Map();

      tiktok.on("like",(data)=>{
        const user=data.nickname;
        const likes=data.likeCount || 1;

        // <-- NUEVO: Evento individual para la Arena con su foto de perfil
        socket.emit("singleLike", { 
            user: user, 
            avatar: data.profilePictureUrl 
        });

        if(!likeRanking.has(user)){
          likeRanking.set(user,0);
        }
        likeRanking.set(user, likeRanking.get(user)+likes);

        const ranking=[...likeRanking.entries()]
          .sort((a,b)=>b[1]-a[1])
          .slice(0,10)
          .map((u,i)=>({
            rank:i+1,
            user:u[0],
            likes:u[1]
          }));

        socket.emit("likeRanking",ranking);
      });

    }catch(err){
      socket.emit("status","error");
    }
  });

  /* =========================
     GUARDAR MP3
  ========================= */
  socket.on("uploadAndSave",({username,gift,fileName,fileData})=>{
    if(!username || !fileData) return;

    const userFolder = path.join(__dirname,"public","uploads",username);

    if(!fs.existsSync(userFolder))
      fs.mkdirSync(userFolder,{recursive:true});

    const base64Data = fileData.split(";base64,").pop();
    const finalFileName = `${Date.now()}_${fileName}`;
    const filePath = path.join(userFolder,finalFileName);

    fs.writeFile(filePath,base64Data,{encoding:"base64"},()=>{
      if(!userActions.has(username))
        userActions.set(username,[]);

      const actions = userActions.get(username);
      actions.push({
        gift:gift,
        file:`/uploads/${username}/${finalFileName}`,
        type:"mp3"
      });

      socket.emit("actionsUpdated",actions);
      socket.emit("status","connected");
    });
  });

  /* =========================
     GUARDAR WEBHOOK
  ========================= */
  socket.on("saveAction",({username,action})=>{
    if(!username) return;
    if(!userActions.has(username))
      userActions.set(username,[]);

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

  /* =========================
     DESCONECTAR
  ========================= */
  socket.on("stopConnection",()=>{
    if(activeConnections.has(socket.id)){
      try{
        activeConnections.get(socket.id).disconnect();
      }catch{}
      activeConnections.delete(socket.id);
    }
    socket.emit("status","disconnected");
  });

  socket.on("disconnect",()=>{
    if(activeConnections.has(socket.id)){
      try{
        activeConnections.get(socket.id).disconnect();
      }catch{}
      activeConnections.delete(socket.id);
    }
  });

});

const PORT = process.env.PORT || 10000;

server.listen(PORT,()=>{
  console.log("🚀 Nexora Ultra activo en puerto",PORT);
});
