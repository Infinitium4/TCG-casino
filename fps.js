const crypto = require('node:crypto');
const W = require('./underground/js/fps-shared');
const MAGAZINE=24, RELOAD_MS=1500, FIRE_MS=180, MATCH_MS=180000;

class Arena {
  constructor(id,name,hostId,now=Date.now(),random=Math.random) {
    Object.assign(this,{id,name,hostId,players:new Map(),endsAt:now+MATCH_MS,finishedAt:0,events:[],eventId:0,random,winner:null});
  }
  emit(type,data) { this.events.push({id:++this.eventId,type,...data}); if(this.events.length>30)this.events.shift(); }
  spawn(player,now) {
    const others=[...this.players.values()].filter(p=>p.id!==player.id&&p.health>0);
    const choices=W.SPAWNS.map(point=>({point,score:others.length?Math.min(...others.map(p=>Math.hypot(p.x-point[0],p.y-point[1]))):this.random()*10}));
    choices.sort((a,b)=>b.score-a.score);
    const [x,y]=choices[0].point;
    Object.assign(player,{x,y,yaw:Math.atan2(10-x,y-10),pitch:0,height:0,velocity:0,health:100,ammo:MAGAZINE,
      reloadUntil:0,respawnAt:0,protectedUntil:now+1200,lastDamage:now,lastShot:0,input:{},inputAt:now});
  }
  add(id,name,now) {
    if(this.players.has(id))return this.players.get(id);
    const player={id,name:String(name).slice(0,24),kills:0,deaths:0,shots:0,hits:0};
    this.spawn(player,now);this.players.set(id,player);return player;
  }
  remove(id) {
    this.players.delete(id);
    if(this.hostId===id)this.hostId=this.players.keys().next().value||null;
  }
  input(id,data,now) {
    const player=this.players.get(id);
    if(!player || !data || typeof data!=='object' || now-player.inputAt<12)return;
    if(![data.yaw,data.pitch,data.forward,data.strafe].every(Number.isFinite))return;
    player.yaw=((data.yaw%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
    player.pitch=Math.max(-1.2,Math.min(1.2,data.pitch));
    player.input={forward:Math.max(-1,Math.min(1,data.forward)),strafe:Math.max(-1,Math.min(1,data.strafe)),
      sprint:data.sprint===true,fire:data.fire===true,reload:data.reload===true,jump:data.jump===true};
    player.inputAt=now;
  }
  tick(now,dt=.05) {
    if(this.finishedAt) {
      if(now>=this.finishedAt+10000) {
        this.finishedAt=0;this.endsAt=now+MATCH_MS;this.winner=null;this.events=[];
        for(const p of this.players.values()){p.kills=0;p.deaths=0;this.spawn(p,now);}
      }
      return;
    }
    if(now>=this.endsAt)return this.finish(now);
    for(const player of this.players.values()) {
      if(player.health<=0){if(now>=player.respawnAt)this.spawn(player,now);continue;}
      if(now-player.inputAt>300)player.input={};
      W.move(player,player.input,dt);
      if(player.input.jump&&player.height===0){player.velocity=4.1;player.height=.001;}
      player.velocity-=12*dt;player.height=Math.max(0,player.height+player.velocity*dt);
      if(!player.height)player.velocity=0;
      if(player.reloadUntil&&now>=player.reloadUntil){player.ammo=MAGAZINE;player.reloadUntil=0;}
      if((player.input.reload||player.ammo===0)&&!player.reloadUntil&&player.ammo<MAGAZINE)player.reloadUntil=now+RELOAD_MS;
      if(now-player.lastDamage>5000)player.health=Math.min(100,player.health+dt*9);
      if(player.input.fire&&!player.reloadUntil&&player.ammo>0&&now-player.lastShot>=FIRE_MS) {
        player.lastShot=now;player.ammo--;player.shots++;
        // Firing ends spawn protection, preventing invulnerable attacks.
        player.protectedUntil=0;
        const hit=W.trace(player,this.players.values());
        this.emit('shot',{playerId:player.id,x:player.x,y:1.5+player.height,z:player.y,end:hit.end});
        if(hit.target&&now>=hit.target.protectedUntil) {
          const target=hit.target;player.hits++;
          target.health=Math.max(0,target.health-(hit.headshot?48:26));target.lastDamage=now;
          this.emit('hit',{playerId:player.id,targetId:target.id,headshot:hit.headshot});
          if(target.health===0) {
            player.kills++;target.deaths++;target.respawnAt=now+3000;target.input={};
            this.emit('kill',{playerId:player.id,targetId:target.id,killer:player.name,victim:target.name,headshot:hit.headshot});
            if(player.kills>=20){this.finish(now);return;}
          }
        }
      }
    }
  }
  finish(now) {
    this.finishedAt=now;
    this.winner=[...this.players.values()].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths)[0]?.name||'Égalité';
  }
  snapshot(now) {
    return {id:this.id,name:this.name,hostId:this.hostId,serverNow:now,endsAt:this.endsAt,finishedAt:this.finishedAt,winner:this.winner,
      events:this.events,players:[...this.players.values()].map(({input,inputAt,nextTurn,velocity,lastDamage,...p})=>p)};
  }
}

function registerFps({app,io,requireAuth,handleAsync,get,gameDir,path}) {
  const rooms=new Map(),membership=new Map();
  const roomName=id=>'fps:'+id;
  const list=()=>[...rooms.values()].map(r=>({id:r.id,name:r.name,hostId:r.hostId,
    players:r.players.size,maxPlayers:8}));
  app.get('/fps',requireAuth,(req,res)=>res.sendFile(path.join(gameDir,'fps.html')));
  app.get('/api/fps/rooms',requireAuth,(req,res)=>res.json({rooms:list()}));
  function leave(socket) {
    const m=membership.get(socket.id);if(!m)return;
    const room=rooms.get(m.roomId);
    socket.leave(roomName(m.roomId));membership.delete(socket.id);
    if(room){room.remove(m.userId);if(!room.players.size)rooms.delete(room.id);}
  }
  io.on('connection',socket=>{
    const respond=(ack,payload)=>{if(typeof ack==='function')ack(payload);};
    let joining=false;
    socket.on('fps:join',async(data,ack)=>{
      if(joining)return respond(ack,{error:'Connexion en cours.'});
      joining=true;
      try {
        const userId=Number(socket.request.session.userId);
        const user=await get('SELECT id,username,is_admin,is_banned,is_bank,suspended_until FROM users WHERE id=?',[userId]);
        if(!user||user.is_banned||user.is_bank||Number(user.suspended_until)>Date.now())throw Error('Session invalide. Reconnecte-toi.');
        if(!socket.connected)return;
        let room;
        if(data?.create===true) {
          if(rooms.size>=24)throw Error('Tous les salons sont occupés.');
          room=new Arena(crypto.randomUUID(),String(data.name||`Arène de ${user.username}`).trim().slice(0,32)||'Arène',userId);
        } else {room=rooms.get(String(data?.roomId));if(!room)throw Error('Ce salon n’existe plus.');}
        if([...room.players.values()].filter(p=>p.id!==userId).length>=8)throw Error('Ce salon est complet.');
        for(const [socketId,m] of membership)if(m.userId===userId) {
          const previous=io.sockets.sockets.get(socketId);
          if(previous){leave(previous);if(previous!==socket)previous.emit('fps:kicked',{message:'Partie ouverte dans un autre onglet.'});}
        }
        if(!socket.connected)return;
        rooms.set(room.id,room);room.add(userId,user.username,Date.now());
        if(!room.hostId)room.hostId=userId;
        membership.set(socket.id,{roomId:room.id,userId});socket.join(roomName(room.id));
        respond(ack,{ok:true,userId,isAdmin:Boolean(user.is_admin),state:room.snapshot(Date.now())});
      } catch(error){respond(ack,{error:error.message||'Connexion impossible.'});}
      finally{joining=false;}
    });
    socket.on('fps:input',data=>{const m=membership.get(socket.id);if(m)rooms.get(m.roomId)?.input(m.userId,data,Date.now());});
    socket.on('fps:leave',()=>leave(socket));
    socket.on('fps:kick',async(data,ack)=>{
      try {
        const m=membership.get(socket.id),room=rooms.get(String(data?.roomId));
        const user=await get('SELECT id,is_admin FROM users WHERE id=?',[socket.request.session.userId]);
        if(!room||!user||(!user.is_admin&&(room.hostId!==user.id||m?.roomId!==room.id)))throw Error('Seul l’hôte ou un administrateur peut expulser.');
        const targetId=data?.playerId;
        if(!Number.isSafeInteger(targetId)||targetId===user.id||!room.players.has(targetId))throw Error('Joueur invalide.');
        for(const [id,member] of membership)if(member.roomId===room.id&&member.userId===targetId) {
          const target=io.sockets.sockets.get(id);if(target){leave(target);target.emit('fps:kicked',{message:'Tu as été expulsé de ce salon.'});}
        }
        respond(ack,{ok:true});
      }catch(error){respond(ack,{error:error.message});}
    });
    socket.on('disconnect',()=>leave(socket));
  });
  const timer=setInterval(()=>{
    const now=Date.now();
    for(const room of rooms.values()){room.tick(now,.05);io.to(roomName(room.id)).volatile.emit('fps:state',room.snapshot(now));}
  },50);
  timer.unref();
  return {rooms,close(){clearInterval(timer);}};
}
module.exports={Arena,registerFps,MAGAZINE,RELOAD_MS,FIRE_MS,MATCH_MS};
