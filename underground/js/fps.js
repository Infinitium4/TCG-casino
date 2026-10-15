(async () => {
  const $=id=>document.getElementById(id),W=FpsWorld;
  let renderer,socket,state=null,userId=null,isAdmin=false,joined=false,joining=false,practice=null;
  let predicted=null,yaw=0,pitch=0,lastFrame=performance.now(),lastInput=0,lastEvent=0,lastHealth=100,recoil=0;
  let lastSnapshot=0,offset=0,audio=null,audioPack=null,muted=false,roomId=null,scoresOpen=false;
  const keys=new Set(),display=new Map(),effects=[],feed=[];
  let firing=false,aiming=false;
  let lastLobbyFrame=0,lastRadar=-Infinity,feedSignature='';
  let lobbyTab='play',lobbySkin='classic',onlineUsers=[],pendingInvite=null,partySignature='';
  function selectLobbyTab(tab){
    sound('ui');
    lobbyTab=tab;
    for(const button of document.querySelectorAll('[data-lobby-tab]')){
      const active=button.dataset.lobbyTab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
      $('panel-'+button.dataset.lobbyTab).hidden=!active;
    }
    $('lobby').dataset.tab=tab;
  }
  function renderOnline(){
    const query=$('playerSearch').value.trim().toLocaleLowerCase();
    const others=onlineUsers.filter(p=>p.id!==userId);
    text('onlineCount',others.length);$('onlinePlayers').replaceChildren();
    for(const player of others.filter(p=>p.name.toLocaleLowerCase().includes(query))){
      const row=document.createElement('div');row.className='online-player';
      const avatar=document.createElement('span');avatar.className='online-avatar';avatar.textContent=player.name.slice(0,2).toUpperCase();
      const copy=document.createElement('div'),name=document.createElement('strong'),status=document.createElement('small');
      name.textContent=player.name;status.textContent=player.roomId===roomId&&roomId?'Dans ton groupe':player.roomId?'Dans un autre groupe':'Dans le lobby';copy.append(name,status);
      const invite=document.createElement('button');invite.type='button';invite.className='invite-player';invite.textContent=player.roomId===roomId&&roomId?'✓':'+';invite.setAttribute('aria-label','Inviter '+player.name);invite.disabled=Boolean(player.roomId===roomId&&roomId)||joining;
      invite.addEventListener('click',async()=>{
        invite.disabled=true;
        if(!joined){const result=await join({create:true,name:$('roomName').value});if(!result){invite.disabled=false;return;}}
        if(!state?.waiting){text('socialFeedback','Tu pourras inviter des joueurs depuis le lobby.');invite.disabled=false;return;}
        socket.timeout(5000).emit('fps:invite',{userId:player.id},(error,result)=>{text('socialFeedback',error?'Invitation impossible. Réessaie.':result?.error||'Invitation envoyée à '+player.name+'.');invite.disabled=false;});
      });row.append(avatar,copy,invite);$('onlinePlayers').append(row);
    }
    if(!$('onlinePlayers').children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=query?'Aucun joueur trouvé.':'Tes amis apparaîtront ici quand ils ouvriront le FPS.';$('onlinePlayers').append(empty);}
  }
  function showGroup(){
    const waiting=Boolean(joined&&state?.waiting);
    $('lobby').hidden=joined&&!waiting;$('createArea').hidden=waiting;$('waitingRoom').hidden=!waiting;$('inviteTools').hidden=!waiting;$('hud').hidden=!joined||waiting;
    if(!waiting){$('waitingPlayers').replaceChildren();partySignature='';}
  }
  function locked(){return document.pointerLockElement===$('arena');}
  function hint(message){$('feedback').textContent=message;}
  function text(id,value){const node=$(id);if(node.textContent!==String(value))node.textContent=value;}
  function sound(kind) {
    if(muted||!audio||audio.state!=='running')return;
    if(audioPack?.play(kind))return;
    const now=audio.currentTime,gain=audio.createGain();gain.connect(audio.destination);
    gain.gain.setValueAtTime(kind==='shot'?.045:.035,now);gain.gain.exponentialRampToValueAtTime(.001,now+.12);
    if(kind==='shot') {
      const buffer=audio.createBuffer(1,audio.sampleRate*.08,audio.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);
      const source=audio.createBufferSource(),filter=audio.createBiquadFilter();
      source.buffer=buffer;filter.type='lowpass';filter.frequency.value=1400;source.connect(filter);filter.connect(gain);source.start();
    }else {
      const oscillator=audio.createOscillator();oscillator.type='triangle';oscillator.frequency.setValueAtTime(kind==='kill'?880:kind==='head'?1100:620,now);oscillator.frequency.exponentialRampToValueAtTime(kind==='kill'?1320:340,now+.1);oscillator.connect(gain);oscillator.start();oscillator.stop(now+.12);
    }
  }
  async function resume() {
    if(!joined)return;
    try {await $('arena').requestPointerLock();}
    catch {text('pauseText','La souris n’a pas pu être activée. Clique à nouveau sur Entrer.');return;}
    try {
      audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();
      if(typeof FpsAudio!=='undefined')audioPack ||= new FpsAudio(audio);
    }catch{}
  }
  function clearInput(){keys.clear();firing=false;aiming=false;sendInput();}
  function showPause() {
    $('pause').hidden=!joined||locked()||scoresOpen||Boolean(state?.finishedAt)||Boolean(state?.waiting);
    if(joined&&!practice&&!socket?.connected){$('pause').hidden=false;text('pauseTitle','Connexion interrompue');text('pauseText','Reconnexion au serveur en cours…');}
  }
  function showScores(value) {
    scoresOpen=value;$('scoreboard').hidden=!value;
    if(value&&locked())document.exitPointerLock();
    clearInput();renderScores();showPause();
  }
  function backToLobby(message='') {
    practice=null;
    joined=false;joining=false;state=null;predicted=null;roomId=null;scoresOpen=false;
    display.clear();effects.length=0;feed.length=0;keys.clear();firing=false;
    if(locked())document.exitPointerLock();
    $('lobby').hidden=false;$('hud').hidden=true;$('pause').hidden=true;$('scoreboard').hidden=true;$('waitingRoom').hidden=true;
    showGroup();renderOnline();
    hint(message);refreshRooms();refreshFpsShop();
  }
  function startPractice(){
    if(joining)return;
    if(joined&&!practice)socket?.emit('fps:leave');
    practice=new FpsPractice(userId,accountUser.username,lobbySkin);joined=true;roomId=practice.id;scoresOpen=false;
    lastEvent=0;lastHealth=100;predicted=null;state=null;display.clear();effects.length=0;feed.length=0;keys.clear();firing=false;
    $('roomBrowser').hidden=true;$('scoreboard').hidden=true;accept(practice.snapshot());showGroup();
    text('pauseTitle','Entraînement solo');text('pauseText','Tu es seul dans une arène privée, sans bots ni limite de temps. Clique sur Entrer pour jouer.');
    text('resume','Entrer et tester');showPause();
    // Capture the mouse while the click still has browser user activation.
    try{const lock=$('arena').requestPointerLock();lock?.catch(()=>showPause());}catch{showPause();}
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});if(typeof FpsAudio!=='undefined')audioPack ||= new FpsAudio(audio);}catch{}
  }
  async function join(data) {
    if(joining||!socket?.connected)return false;joining=true;hint('Connexion à l’arène…');$('create').disabled=true;
    return new Promise(resolve=>{
    socket.timeout(7000).emit('fps:join',data,(error,result)=>{
      joining=false;$('create').disabled=false;
      if(error||result?.error){hint(result?.error||'Le serveur ne répond pas. Réessaie.');resolve(false);return;}
      joined=true;roomId=result.state.id;userId=result.userId;isAdmin=result.isAdmin;
      practice=null;
      lastEvent=result.state.events.at(-1)?.id||0;lastHealth=100;display.clear();feed.length=0;effects.length=0;
      predicted=null;accept(result.state);showGroup();$('roomBrowser').hidden=true;selectLobbyTab('play');hint('');renderOnline();
      text('pauseTitle','Prêt à entrer ?');text('pauseText','Clique pour capturer la souris et rejoindre le combat.');
      showPause();
      resolve(true);
    });
    });
  }
  async function refreshRooms() {
    try {
      const response=await fetch('/api/fps/rooms',{cache:'no-store'});
      if(response.status===401){location.assign('/');return;}
      if(!response.ok)throw Error('Impossible de charger les salons.');
      const payload=await response.json();$('rooms').replaceChildren();
      for(const room of payload.rooms) {
        const row=document.createElement('div');row.className='room';
        const icon=document.createElement('span');icon.className='room-icon';icon.textContent='⌖';
        const copy=document.createElement('div');copy.className='room-copy';
        const name=document.createElement('strong');name.textContent=room.name;
        const description=document.createElement('small');description.textContent=room.waiting?'THE FOUNDRY · Salon en attente':'THE FOUNDRY · Match en cours';
        const count=document.createElement('span');count.className='room-count';count.textContent=`${room.players} / 8`;
        const button=document.createElement('button');button.type='button';button.textContent=room.players>=8?'Complet':'Rejoindre ↗';button.disabled=room.players>=8||joining;
        button.addEventListener('click',()=>join({roomId:room.id}));
        copy.append(name,description);row.append(icon,copy,count,button);$('rooms').append(row);
      }
      if(!payload.rooms.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Le calme avant l’orage. Crée la première arène et invite tes amis à te rejoindre.';$('rooms').append(empty);}
    }catch(error){hint(error.message);}
  }
  function accept(payload) {
    if(!joined||payload.id!==roomId)return;
    const previous=state;state=payload;offset=payload.serverNow-Date.now();lastSnapshot=performance.now();
    const me=state.players.find(p=>p.id===userId);
    if(!me){backToLobby('Tu ne fais plus partie de ce salon.');return;}
    showGroup();
    if(state.waiting){
      if(locked())document.exitPointerLock();
      scoresOpen=false;$('scoreboard').hidden=true;$('pause').hidden=true;
      text('waitingName',state.name);text('waitingCount',`${state.players.length} / 8`);
      $('inviteLink').value=location.origin+'/fps?room='+encodeURIComponent(state.id);
      $('startMatch').disabled=state.hostId!==userId;
      $('startMatch').textContent=state.hostId!==userId?'En attente de l’hôte':state.players.length===1?'Jouer en solo':'Lancer le match';
      const signature=JSON.stringify(state.players.map(p=>[p.id,p.name,p.skin,state.hostId]));
      if(signature!==partySignature){partySignature=signature;$('waitingPlayers').replaceChildren();
      for(const player of state.players){
        const row=document.createElement('div');row.className='waiting-player';
        const skin=FpsSkins.find(s=>s.id===player.skin)||FpsSkins[0];
        const swatch=document.createElement('i');swatch.style.background=skin.color;
        const name=document.createElement('strong');name.textContent=player.name;
        const badge=document.createElement('small');badge.textContent=(player.id===state.hostId?'HÔTE · ':'')+skin.name;
        row.append(swatch,name,badge);$('waitingPlayers').append(row);
      }
      }
    }else if(previous?.waiting){predicted=null;showPause();}
    if(!predicted||(!previous?.players.find(p=>p.id===userId)?.health&&me.health>0)) {
      predicted={...me};yaw=me.yaw;pitch=0;
    }else {
      const error=Math.hypot(predicted.x-me.x,predicted.y-me.y);
      if(error>1.2||me.health<=0){predicted.x=me.x;predicted.y=me.y;}
      else{predicted.x+=(me.x-predicted.x)*.24;predicted.y+=(me.y-predicted.y)*.24;}
      predicted.height=me.height;
      predicted.velocity=me.velocity||0;predicted.grounded=me.grounded;
    }
    for(const event of state.events) {
      if(event.id<=lastEvent)continue;
      lastEvent=event.id;
      if(event.type==='shot') {
        let muzzle;
        if(event.playerId===userId){
          const origin=[predicted?.x??me.x,1.55+(predicted?.height??me.height??0),predicted?.y??me.y];
          const right=[Math.cos(yaw),0,Math.sin(yaw)],up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)],forward=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
          muzzle=origin.map((v,i)=>v+right[i]*(aiming?.015:.22)+up[i]*(aiming?-.113:-.243)+forward[i]*.83);
        }else{
          const shooter=state.players.find(p=>p.id===event.playerId);
          if(shooter)muzzle=[shooter.x+Math.sin(shooter.yaw)*.65+Math.cos(shooter.yaw)*.12,(shooter.height||0)+.95,shooter.y-Math.cos(shooter.yaw)*.65+Math.sin(shooter.yaw)*.12];
        }
        effects.push(FpsVfx.shot(event,performance.now(),muzzle));if(effects.length>160)effects.shift();
        if(event.playerId===userId){recoil=1;sound('shot');}
      }else if(event.type==='explosion'){
        effects.push(FpsVfx.explosion(event,performance.now()));sound('explosion');
      }else if(event.type==='loot'&&event.playerId===userId){
        sound('loot');
      }else if(event.type==='hit'&&event.playerId===userId) {
        $('hitmarker').classList.add('show');$('hitmarker').classList.toggle('headshot',event.headshot);
        setTimeout(()=>$('hitmarker').classList.remove('show'),110);sound(event.headshot?'head':'hit');
      }else if(event.type==='kill') {
        feed.unshift({...event,until:Date.now()+5000});if(feed.length>4)feed.pop();
        if(event.playerId===userId)sound('kill');
      }
    }
    if(me.health<lastHealth){$('damage').style.opacity='.55';setTimeout(()=>$('damage').style.opacity='0',160);}
    lastHealth=me.health;
    if(me.reloadUntil&&me.reloadUntil!==previous?.players.find(p=>p.id===userId)?.reloadUntil)sound('reload');
    text('matchName',state.name);text('health',Math.ceil(me.health));$('healthBar').style.width=me.health+'%';
    text('ammo',me.ammo);text('kills',me.kills);text('deaths',`${me.deaths} MORT${me.deaths===1?'':'S'}`);
    if(state.finishedAt&&!previous?.finishedAt)showScores(true);
    if(!state.finishedAt&&previous?.finishedAt){showScores(false);showPause();}
    if(scoresOpen)renderScores();
    renderFeed();
  }
  function renderFeed() {
    const visible=feed.filter(f=>f.until>Date.now()),signature=visible.map(item=>item.id+':'+item.until).join(',');
    if(signature===feedSignature)return;feedSignature=signature;
    $('killfeed').replaceChildren();
    for(const item of visible) {
      const row=document.createElement('div'),killer=document.createElement('strong');killer.textContent=item.killer;
      const victim=document.createElement('span');victim.textContent=` ${item.headshot?'⌖':'→'} ${item.victim}`;
      row.append(killer,victim);$('killfeed').append(row);
    }
  }
  function renderScores() {
    if(!state)return;
    text('scoreTitle',state.finishedAt?`${state.winner} remporte le match`:'Le tableau des scores');
    $('scoreRows').replaceChildren();
    for(const player of [...state.players].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths)) {
      const row=document.createElement('div');row.className='score-row'+(player.id===userId?' me':'');
      const name=document.createElement('span');name.textContent=player.name;
      const badge=document.createElement('small');badge.textContent=player.id===state.hostId?'HÔTE':player.id===userId?'TOI':'';name.append(badge);
      const kills=document.createElement('span');kills.textContent=player.kills;
      const deaths=document.createElement('span');deaths.textContent=player.deaths;
      const action=document.createElement('span');
      if(player.id!==userId&&(state.hostId===userId||isAdmin)) {
        const kick=document.createElement('button');kick.className='kick';kick.textContent='Expulser';
        kick.addEventListener('click',()=>{kick.disabled=true;socket.timeout(5000).emit('fps:kick',{roomId,playerId:player.id},(error,result)=>{if(error||result?.error){text('scoreTitle',result?.error||'Expulsion impossible.');kick.disabled=false;}});});
        action.append(kick);
      }
      row.append(name,kills,deaths,action);$('scoreRows').append(row);
    }
  }
  function currentInput() {
    const active=joined&&locked()&&(practice||socket?.connected)&&!document.hidden&&!scoresOpen&&!state?.finishedAt&&!state?.waiting;
    return {yaw,pitch,forward:active?(Number(keys.has('KeyW')||keys.has('KeyZ'))-Number(keys.has('KeyS'))):0,
      strafe:active?(Number(keys.has('KeyD'))-Number(keys.has('KeyA')||keys.has('KeyQ'))):0,
      sprint:active&&(keys.has('ShiftLeft')||keys.has('ShiftRight')),jump:active&&keys.has('Space'),
      reload:active&&keys.has('KeyR'),fire:active&&firing,aim:Boolean(active&&aiming),interact:active&&keys.has('KeyE'),grenade:active&&keys.has('KeyG')};
  }
  function sendInput(){if(joined&&!practice&&socket?.connected)socket.volatile.emit('fps:input',currentInput());}
  function radar(me) {
    const now=performance.now();if(now-lastRadar<100)return;lastRadar=now;
    const ctx=$('radar').getContext('2d'),scale=160/W.SIZE;
    ctx.clearRect(0,0,160,160);
    for(let y=0;y<W.MAP.length;y++)for(let x=0;x<W.MAP[y].length;x++)if(W.MAP[y][x]!=='0') {
      ctx.fillStyle=W.MAP[y][x]==='3'?'#723e37':'#594b36';ctx.fillRect(x*scale,y*scale,scale-.7,scale-.7);
    }
    ctx.strokeStyle='#c5a15a77';ctx.lineWidth=1;
    for(const p of W.PLATFORMS)ctx.strokeRect(p.x0*scale,p.z0*scale,(p.x1-p.x0)*scale,(p.z1-p.z0)*scale);
    for(const r of W.RAMPS){ctx.fillStyle='#c5a15a55';ctx.fillRect(r.x0*scale,r.z0*scale,(r.x1-r.x0)*scale,(r.z1-r.z0)*scale);}
    for(const c of state.chests||[]){ctx.fillStyle=c.readyAt>Date.now()+offset?'#70644d':'#ffc76a';ctx.fillRect(c.x*scale-1,c.z*scale-1,3,3);}
    ctx.fillStyle='#e8c780';ctx.font='9px Segoe UI';ctx.fillText((me?.height||0)>2.6?'ÉTAGE 01':'REZ-DE-CHAUSSÉE',8,153);
    for(const p of state.players) {
      if(p.health<=0||p.id!==userId)continue; // Radar reveals the map and your position, not hidden enemies.
      ctx.save();ctx.translate(p.x*scale,p.y*scale);ctx.rotate(yaw);ctx.fillStyle='#e8c780';ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(-3,4);ctx.lineTo(3,4);ctx.closePath();ctx.fill();ctx.restore();
    }
  }
  function frame(timestamp) {
    if(document.hidden){lastFrame=timestamp;requestAnimationFrame(frame);return;}
    if(!joined&&timestamp-lastLobbyFrame<1000/30){requestAnimationFrame(frame);return;}
    lastLobbyFrame=timestamp;
    const dt=Math.min(.05,(timestamp-lastFrame)/1000);lastFrame=timestamp;
    if(practice){practice.tick(currentInput(),dt);accept(practice.snapshot());predicted={...practice.player};}
    if(joined&&state&&predicted&&!state.waiting) {
      const me=state.players.find(p=>p.id===userId),input=currentInput();
      if(!practice&&me?.health>0&&!state.finishedAt&&performance.now()-lastSnapshot<500) {
        predicted.yaw=yaw;W.step(predicted,input,dt);
      }
      for(const p of state.players) {
        const old=display.get(p.id)||{...p},alpha=1-Math.exp(-dt*18);
        old.moving=Math.hypot(p.x-old.x,p.y-old.y)>.015;
        old.x+=(p.x-old.x)*alpha;old.y+=(p.y-old.y)*alpha;old.height+=(p.height-old.height)*alpha;
        let angle=(p.yaw-old.yaw+Math.PI*3)%(Math.PI*2)-Math.PI;
        old.yaw+=angle*alpha;Object.assign(old,{health:p.health,protectedUntil:p.protectedUntil,skin:p.skin});display.set(p.id,old);
      }
      for(const id of display.keys())if(!state.players.some(p=>p.id===id))display.delete(id);
      for(let i=effects.length-1;i>=0;i--)if(effects[i].until<timestamp)effects.splice(i,1);
      renderer.draw({eye:[predicted.x,1.55+(predicted.height||0),predicted.y],yaw,pitch,players:[...display.values()],me,time:timestamp,effects,recoil,aim:input.aim,walking:Boolean(input.forward||input.strafe),chests:state.chests||[],bombs:state.bombs||[],serverNow:Date.now()+offset});
      recoil=Math.max(0,recoil-dt*9);
      const now=Date.now()+offset,seconds=Math.max(0,Math.ceil((state.endsAt-now)/1000));
      text('time',practice?'LIBRE':`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`);
      text('matchMode',practice?'ENTRAÎNEMENT SOLO':'MATCH À MORT');text('matchGoal',practice?'ARÈNE PRIVÉE · SANS BOTS':'OBJECTIF · 20 ÉLIMINATIONS');
      text('reloadHint',me?.reloadUntil>now?'RECHARGEMENT…':me?.ammo<7?'R · RECHARGER':'VX–24 · AUTOMATIQUE');
      text('network',practice?'SOLO LOCAL':timestamp-lastSnapshot>1200?'CONNEXION INSTABLE':'EN DIRECT');
      text('grenadeCount',me?.grenades||0);
      const nearby=(state.chests||[]).find(c=>Math.hypot(c.x-predicted.x,c.z-predicted.y)<1.9&&Math.abs(c.height-(me?.height||0))<.8);
      text('interactHint',nearby?(nearby.readyAt>now?'COFFRE VIDE · RÉAPPROVISIONNEMENT':(me?.grenades||0)>=3?'GRENADES AU MAXIMUM':'E · OUVRIR LE COFFRE · +2 GRENADES'):'');
      if(state.finishedAt)text('announcement',`PROCHAIN MATCH DANS ${Math.max(0,Math.ceil((state.finishedAt+10000-now)/1000))} S`);
      else if(me?.health<=0)text('announcement',`SIGNAL PERDU\nRéapparition dans ${Math.max(1,Math.ceil((me.respawnAt-now)/1000))} s`);
      else text('announcement',me?.protectedUntil>now?'PROTECTION DE RÉAPPARITION':'');
      if(timestamp-lastInput>50){sendInput();lastInput=timestamp;}
      radar(me);
    }else{
      const team=state?.waiting?state.players:[];
      const me=team.find(p=>p.id===userId)||{id:userId,skin:lobbySkin,health:100};
      const others=lobbyTab==='play'?team.filter(p=>p.id!==userId).slice(0,3):[];
      const players=[{...me,skin:lobbySkin,x:10,y:10,yaw:Math.PI+.17,health:100,height:0},...others.map((p,i)=>({...p,x:10+(i%2?1:-1)*(1.35+Math.floor(i/2)*.8),y:9.5-Math.floor(i/2)*.6,yaw:Math.PI,health:100,height:0}))];
      const compact=innerWidth<850;
      renderer.draw({eye:[lobbyTab==='locker'?8.85:compact?9.25:10,1,compact?14:12.8],yaw:0,pitch:-.025,players,time:timestamp,showcase:true});
      if(joined&&timestamp-lastInput>100){sendInput();lastInput=timestamp;}
    }
    requestAnimationFrame(frame);
  }
  try {
    if(!await loadAccountData()){location.replace('/');return;}
    userId=Number(accountUser.id);isAdmin=accountUser.isAdmin;text('identity',accountUser.username.toUpperCase());
    text('heroName',accountUser.username);
    window.addEventListener('fps:shop-updated',event=>{
      lobbySkin=event.detail.equipped;
      const skin=FpsSkins.find(s=>s.id===lobbySkin)||FpsSkins[0];text('heroSkin',skin.name);text('lockerSkinName',skin.name);
      if(socket?.connected)socket.emit('fps:loadout');
    });
    if(typeof FpsAssets!=='undefined'){
      text('identity','CHARGEMENT DES MODÈLES…');
      try{await FpsAssets.load();}catch(error){console.warn(error);hint('Modèles indisponibles : affichage de secours actif.');}
      text('identity',accountUser.username.toUpperCase());
    }
    await refreshFpsShop();
    const arenaArt=FpsRenderer.arenaPreview?.();
    const modeArt=document.querySelector?.('.mode-art');if(arenaArt&&modeArt){modeArt.style.backgroundImage='url('+arenaArt+')';modeArt.classList.add('has-art');}
    renderer=new FpsRenderer($('arena'));socket=io();
    const invitedRoom=new URLSearchParams(location.search).get('room');let inviteUsed=false;
    socket.on('fps:state',accept);
    socket.on('fps:presence',users=>{onlineUsers=users;renderOnline();});
    socket.on('fps:invitation',invite=>{pendingInvite=invite;text('invitationFrom',invite.from+' t’invite à jouer');text('invitationRoom',invite.roomName);$('invitationToast').hidden=false;});
    socket.on('fps:kicked',payload=>backToLobby(payload?.message||'Tu as été expulsé de ce salon.'));
    socket.on('connect',()=>{
      socket.emit('fps:lobby');
      if(practice)return;
      if(joined&&roomId) {
        const previous=roomId;backToLobby('Reconnexion au salon…');join({roomId:previous});
      }else{refreshRooms();if(invitedRoom&&!inviteUsed){inviteUsed=true;join({roomId:invitedRoom});}}
    });
    socket.on('connect_error',()=>{if(practice)return;hint('Connexion au serveur impossible. Tu peux quand même utiliser Tester en solo.');showPause();});
    socket.on('disconnect',()=>{if(practice)return;clearInput();if(locked())document.exitPointerLock();showPause();});
    $('testSolo').addEventListener('click',startPractice);
    $('createForm').addEventListener('submit',event=>{event.preventDefault();join({create:true,name:$('roomName').value});});
    for(const button of document.querySelectorAll('[data-lobby-tab]')){
      button.addEventListener('click',()=>selectLobbyTab(button.dataset.lobbyTab));
      button.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
        const tabs=[...document.querySelectorAll('[data-lobby-tab]')],index=tabs.indexOf(button);
        const next=tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];selectLobbyTab(next.dataset.lobbyTab);next.focus();
      });
    }
    $('customizeSkin').addEventListener('click',()=>selectLobbyTab('locker'));$('openShop').addEventListener('click',()=>selectLobbyTab('shop'));
    $('browseRooms').addEventListener('click',()=>{$('roomBrowser').hidden=false;refreshRooms();});$('closeRooms').addEventListener('click',()=>{$('roomBrowser').hidden=true;});
    $('playerSearch').addEventListener('input',renderOnline);
    $('acceptInvite').addEventListener('click',async()=>{
      if(!pendingInvite)return;const invite=pendingInvite;$('acceptInvite').disabled=true;
      try{if(invite.expires<Date.now())hint('Invitation expirée.');else await join({invitationId:invite.id});}
      finally{$('acceptInvite').disabled=false;$('invitationToast').hidden=true;pendingInvite=null;}
    });
    $('declineInvite').addEventListener('click',()=>{$('invitationToast').hidden=true;pendingInvite=null;});
    $('refresh').addEventListener('click',refreshRooms);$('resume').addEventListener('click',resume);
    $('leave').addEventListener('click',()=>{if(!practice)socket.emit('fps:leave');backToLobby();});
    $('leaveWaiting').addEventListener('click',()=>{socket.emit('fps:leave');backToLobby();});
    $('copyInvite').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText($('inviteLink').value);text('waitingFeedback','Lien copié. Envoie-le à tes amis !');}
      catch{$('inviteLink').select();text('waitingFeedback','Copie le lien sélectionné avec Ctrl+C.');}
    });
    $('startMatch').addEventListener('click',()=>{
      $('startMatch').disabled=true;
      socket.timeout(5000).emit('fps:start',{},(error,result)=>{text('waitingFeedback',error?'Connexion impossible. Réessaie.':result?.error||'');});
    });
    $('closeScores').addEventListener('click',()=>showScores(false));
    $('arena').addEventListener('mousedown',event=>{if(!locked())return;if(event.button===0){firing=true;sendInput();}if(event.button===2)aiming=true;});
    $('arena').addEventListener('contextmenu',event=>event.preventDefault());
    document.addEventListener('mouseup',event=>{if(event.button===0){firing=false;sendInput();}if(event.button===2)aiming=false;});
    document.addEventListener('mousemove',event=>{if(!locked())return;yaw+=event.movementX*.0022;pitch=Math.max(-1.2,Math.min(1.2,pitch-event.movementY*.0022));});
    document.addEventListener('pointerlockchange',()=>{clearInput();showPause();});
    document.addEventListener('keydown',event=>{
      if(!joined||state?.waiting||event.target instanceof HTMLInputElement)return;
      if(['Tab','Space','KeyR','KeyW','KeyA','KeyS','KeyD','KeyZ','KeyQ'].includes(event.code))event.preventDefault();
      if(event.code==='Tab'&&!event.repeat){showScores(!scoresOpen);return;}
      if(event.code==='KeyM'&&!event.repeat){muted=!muted;return;}
      if(locked()){keys.add(event.code);sendInput();}
    });
    document.addEventListener('keyup',event=>{keys.delete(event.code);sendInput();});
    window.addEventListener('blur',clearInput);
    window.addEventListener('general-chat:open',()=>{clearInput();if(locked())document.exitPointerLock();showPause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
    $('arena').addEventListener('webglcontextlost',event=>{event.preventDefault();clearInput();if(locked())document.exitPointerLock();text('pauseTitle','Affichage interrompu');text('pauseText','Le contexte graphique a été perdu. Recharge la page pour reprendre.');});
    setInterval(()=>{if(!joined&&!document.hidden)refreshRooms();else if(joined)renderFeed();},4000);
    requestAnimationFrame(frame);await refreshRooms();
  }catch(error){hint(error.message||'Le jeu ne peut pas démarrer.');$('create').disabled=true;}
})();
