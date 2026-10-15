(async () => {
  const $=id=>document.getElementById(id),W=FpsWorld;
  let renderer,socket,state=null,userId=null,isAdmin=false,joined=false,joining=false;
  let predicted=null,yaw=0,pitch=0,lastFrame=performance.now(),lastInput=0,lastEvent=0,lastHealth=100,recoil=0;
  let lastSnapshot=0,offset=0,audio=null,muted=false,roomId=null,scoresOpen=false;
  const keys=new Set(),display=new Map(),effects=[],feed=[];
  let firing=false;
  function locked(){return document.pointerLockElement===$('arena');}
  function hint(message){$('feedback').textContent=message;}
  function text(id,value){$(id).textContent=value;}
  function sound(kind) {
    if(muted||!audio||audio.state!=='running')return;
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
    try {
      audio ||= new (window.AudioContext||window.webkitAudioContext)();await audio.resume();
    }catch{}
    try {await $('arena').requestPointerLock();}
    catch {text('pauseText','La souris n’a pas pu être capturée. Clique à nouveau sur Entrer dans l’arène.');}
  }
  function clearInput(){keys.clear();firing=false;sendInput();}
  function showPause() {
    $('pause').hidden=!joined||locked()||scoresOpen||Boolean(state?.finishedAt);
    if(joined&&!socket.connected){$('pause').hidden=false;text('pauseTitle','Connexion interrompue');text('pauseText','Reconnexion au serveur en cours…');}
  }
  function showScores(value) {
    scoresOpen=value;$('scoreboard').hidden=!value;
    if(value&&locked())document.exitPointerLock();
    clearInput();renderScores();showPause();
  }
  function backToLobby(message='') {
    joined=false;joining=false;state=null;predicted=null;roomId=null;scoresOpen=false;
    display.clear();effects.length=0;feed.length=0;keys.clear();firing=false;
    if(locked())document.exitPointerLock();
    $('lobby').hidden=false;$('hud').hidden=true;$('pause').hidden=true;$('scoreboard').hidden=true;
    hint(message);refreshRooms();
  }
  async function join(data) {
    if(joining)return;joining=true;hint('Connexion à l’arène…');$('create').disabled=true;
    socket.timeout(7000).emit('fps:join',data,(error,result)=>{
      joining=false;$('create').disabled=false;
      if(error||result?.error){hint(result?.error||'Le serveur ne répond pas. Réessaie.');return;}
      joined=true;roomId=result.state.id;userId=result.userId;isAdmin=result.isAdmin;
      lastEvent=result.state.events.at(-1)?.id||0;lastHealth=100;display.clear();feed.length=0;effects.length=0;
      predicted=null;accept(result.state);$('lobby').hidden=true;$('hud').hidden=false;
      text('pauseTitle','Prêt à entrer ?');text('pauseText','Clique pour capturer la souris et rejoindre le combat.');
      showPause();
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
        const description=document.createElement('small');description.textContent=room.players===1?'THE FOUNDRY · En attente de joueurs':'THE FOUNDRY · Multijoueur';
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
    if(!predicted||(!previous?.players.find(p=>p.id===userId)?.health&&me.health>0)) {
      predicted={...me};yaw=me.yaw;pitch=0;
    }else {
      const error=Math.hypot(predicted.x-me.x,predicted.y-me.y);
      if(error>1.2||me.health<=0){predicted.x=me.x;predicted.y=me.y;}
      else{predicted.x+=(me.x-predicted.x)*.24;predicted.y+=(me.y-predicted.y)*.24;}
      predicted.height=me.height;
    }
    for(const event of state.events) {
      if(event.id<=lastEvent)continue;
      lastEvent=event.id;
      if(event.type==='shot') {
        effects.push({...event,until:performance.now()+85});
        if(event.playerId===userId){recoil=1;sound('shot');}
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
    text('matchName',state.name);text('health',Math.ceil(me.health));$('healthBar').style.width=me.health+'%';
    text('ammo',me.ammo);text('kills',me.kills);text('deaths',`${me.deaths} MORT${me.deaths===1?'':'S'}`);
    if(state.finishedAt&&!previous?.finishedAt)showScores(true);
    if(!state.finishedAt&&previous?.finishedAt){showScores(false);showPause();}
    if(scoresOpen)renderScores();
    renderFeed();
  }
  function renderFeed() {
    $('killfeed').replaceChildren();
    for(const item of feed.filter(f=>f.until>Date.now())) {
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
    const active=joined&&locked()&&socket.connected&&!document.hidden&&!scoresOpen&&!state?.finishedAt;
    return {yaw,pitch,forward:active?(Number(keys.has('KeyW')||keys.has('KeyZ'))-Number(keys.has('KeyS'))):0,
      strafe:active?(Number(keys.has('KeyD'))-Number(keys.has('KeyA')||keys.has('KeyQ'))):0,
      sprint:active&&(keys.has('ShiftLeft')||keys.has('ShiftRight')),jump:active&&keys.has('Space'),
      reload:active&&keys.has('KeyR'),fire:active&&firing};
  }
  function sendInput(){if(joined&&socket?.connected)socket.volatile.emit('fps:input',currentInput());}
  function radar(me) {
    const ctx=$('radar').getContext('2d'),scale=8;
    ctx.clearRect(0,0,160,160);
    for(let y=0;y<W.MAP.length;y++)for(let x=0;x<W.MAP[y].length;x++)if(W.MAP[y][x]!=='0') {
      ctx.fillStyle=W.MAP[y][x]==='3'?'#723e37':'#594b36';ctx.fillRect(x*scale,y*scale,scale-.7,scale-.7);
    }
    for(const p of state.players) {
      if(p.health<=0||p.id!==userId)continue; // Radar reveals the map and your position, not hidden enemies.
      ctx.save();ctx.translate(p.x*scale,p.y*scale);ctx.rotate(yaw);ctx.fillStyle='#e8c780';ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(-3,4);ctx.lineTo(3,4);ctx.closePath();ctx.fill();ctx.restore();
    }
  }
  function frame(timestamp) {
    const dt=Math.min(.05,(timestamp-lastFrame)/1000);lastFrame=timestamp;
    if(joined&&state&&predicted) {
      const me=state.players.find(p=>p.id===userId),input=currentInput();
      if(me?.health>0&&!state.finishedAt&&performance.now()-lastSnapshot<500) {
        predicted.yaw=yaw;W.move(predicted,input,dt);
      }
      for(const p of state.players) {
        const old=display.get(p.id)||{...p},alpha=1-Math.exp(-dt*18);
        old.x+=(p.x-old.x)*alpha;old.y+=(p.y-old.y)*alpha;old.height+=(p.height-old.height)*alpha;
        let angle=(p.yaw-old.yaw+Math.PI*3)%(Math.PI*2)-Math.PI;
        old.yaw+=angle*alpha;Object.assign(old,{health:p.health,protectedUntil:p.protectedUntil});display.set(p.id,old);
      }
      for(const id of display.keys())if(!state.players.some(p=>p.id===id))display.delete(id);
      while(effects.length&&effects[0].until<timestamp)effects.shift();
      renderer.draw({eye:[predicted.x,1.55+(predicted.height||0),predicted.y],yaw,pitch,players:[...display.values()],me,time:timestamp,effects,recoil,walking:Boolean(input.forward||input.strafe)});
      recoil=Math.max(0,recoil-dt*9);
      const now=Date.now()+offset,seconds=Math.max(0,Math.ceil((state.endsAt-now)/1000));
      text('time',`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`);
      text('reloadHint',me?.reloadUntil>now?'RECHARGEMENT…':me?.ammo<7?'R · RECHARGER':'VX–24 · AUTOMATIQUE');
      text('network',timestamp-lastSnapshot>1200?'CONNEXION INSTABLE':'EN DIRECT');
      if(state.finishedAt)text('announcement',`PROCHAIN MATCH DANS ${Math.max(0,Math.ceil((state.finishedAt+10000-now)/1000))} S`);
      else if(me?.health<=0)text('announcement',`SIGNAL PERDU\nRéapparition dans ${Math.max(1,Math.ceil((me.respawnAt-now)/1000))} s`);
      else text('announcement',state.players.length<2?'EN ATTENTE DE JOUEURS':me?.protectedUntil>now?'PROTECTION DE RÉAPPARITION':'');
      if(timestamp-lastInput>50){sendInput();lastInput=timestamp;}
      radar(me);
    }else renderer.draw({eye:[10+Math.sin(timestamp*.00004)*1.5,2.9,17],yaw:Math.sin(timestamp*.000025)*.25,pitch:-.12,time:timestamp});
    requestAnimationFrame(frame);
  }
  try {
    if(!await loadAccountData()){location.replace('/');return;}
    userId=Number(accountUser.id);isAdmin=accountUser.isAdmin;text('identity',accountUser.username.toUpperCase());
    renderer=new FpsRenderer($('arena'));socket=io();
    socket.on('fps:state',accept);
    socket.on('fps:kicked',payload=>backToLobby(payload?.message||'Tu as été expulsé de ce salon.'));
    socket.on('connect',()=>{
      if(joined&&roomId) {
        const previous=roomId;backToLobby('Reconnexion au salon…');join({roomId:previous});
      }else refreshRooms();
    });
    socket.on('connect_error',()=>{hint('Connexion au serveur impossible. Vérifie ta connexion ou reconnecte-toi.');showPause();});
    socket.on('disconnect',()=>{clearInput();if(locked())document.exitPointerLock();showPause();});
    $('createForm').addEventListener('submit',event=>{event.preventDefault();join({create:true,name:$('roomName').value});});
    $('refresh').addEventListener('click',refreshRooms);$('resume').addEventListener('click',resume);
    $('leave').addEventListener('click',()=>{socket.emit('fps:leave');backToLobby();});
    $('closeScores').addEventListener('click',()=>showScores(false));
    $('arena').addEventListener('mousedown',event=>{if(event.button===0&&locked()){firing=true;sendInput();}});
    document.addEventListener('mouseup',event=>{if(event.button===0){firing=false;sendInput();}});
    document.addEventListener('mousemove',event=>{if(!locked())return;yaw+=event.movementX*.0022;pitch=Math.max(-1.2,Math.min(1.2,pitch-event.movementY*.0022));});
    document.addEventListener('pointerlockchange',()=>{clearInput();showPause();});
    document.addEventListener('keydown',event=>{
      if(!joined||event.target instanceof HTMLInputElement)return;
      if(['Tab','Space','KeyR','KeyW','KeyA','KeyS','KeyD','KeyZ','KeyQ'].includes(event.code))event.preventDefault();
      if(event.code==='Tab'&&!event.repeat){showScores(!scoresOpen);return;}
      if(event.code==='KeyM'&&!event.repeat){muted=!muted;return;}
      if(locked())keys.add(event.code);
    });
    document.addEventListener('keyup',event=>{keys.delete(event.code);sendInput();});
    window.addEventListener('blur',clearInput);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
    $('arena').addEventListener('webglcontextlost',event=>{event.preventDefault();clearInput();if(locked())document.exitPointerLock();text('pauseTitle','Affichage interrompu');text('pauseText','Le contexte graphique a été perdu. Recharge la page pour reprendre.');});
    setInterval(()=>{if(!joined&&!document.hidden)refreshRooms();else if(joined)renderFeed();},4000);
    requestAnimationFrame(frame);await refreshRooms();
  }catch(error){hint(error.message||'Le jeu ne peut pas démarrer.');$('create').disabled=true;}
})();
