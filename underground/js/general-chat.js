(() => {
  'use strict';
  const host=document.createElement('div');host.id='general-chat-widget';document.body.append(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<link rel="stylesheet" href="/css/general-chat.css?v=1">
    <section id="panel" hidden aria-label="Chat général"><header><div><small>LE CASINO · EN DIRECT</small><h2>Chat général</h2></div><button id="close" aria-label="Fermer le chat">✕</button></header>
    <p id="status" role="status">Connexion…</p><div id="messages" role="log" aria-label="Messages du chat" aria-live="polite"></div>
    <form id="form"><label for="draft">Ton message</label><textarea id="draft" maxlength="800" rows="2" placeholder="Discute avec les joueurs…"></textarea><footer><span id="count">0 / 400</span><button id="send" type="submit">Envoyer ↗</button></footer></form>
    <p id="error" role="alert"></p></section><button id="launcher" aria-expanded="false" aria-controls="panel">💬 <span>Chat général</span><b id="unread" hidden>0</b></button>`;
  const $=id=>root.getElementById(id),messages=new Map();let user=null,canModerate=false,open=false,unread=0,sending=false,pending=null,socket=null,refreshing=false;
  const say=value=>{$('error').textContent=value;};
  for(const event of ['keydown','keyup','mousedown','mouseup','click'])root.addEventListener(event,e=>e.stopPropagation());
  function toggle(value){open=value;$('panel').hidden=!value;$('launcher').setAttribute('aria-expanded',String(value));if(value){unread=0;$('unread').hidden=true;window.dispatchEvent(new CustomEvent('general-chat:open'));$('draft').focus();$('messages').scrollTop=$('messages').scrollHeight;}}
  $('launcher').addEventListener('click',()=>toggle(!open));$('close').addEventListener('click',()=>{toggle(false);$('launcher').focus();});
  root.addEventListener('keydown',e=>{if(e.key==='Escape'){toggle(false);$('launcher').focus();}});
  async function api(path='',options={}){const response=await fetch('/api/chat'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error||'Connexion impossible.'),{status:response.status});return body;}
  function render(){
    const area=$('messages'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90;
    const fragment=document.createDocumentFragment();
    for(const message of [...messages.values()].sort((a,b)=>a.id-b.id).slice(-100)){
      const item=document.createElement('article');item.className=message.userId===user?.id?'own':'';
      const meta=document.createElement('div');meta.className='meta';const author=document.createElement('strong');author.textContent=message.username;meta.append(author);
      const time=document.createElement('time');time.dateTime=new Date(message.createdAt).toISOString();time.textContent=new Date(message.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});meta.append(time);item.append(meta);
      const body=document.createElement('p');body.textContent=message.deleted?'Message supprimé par la modération.':message.text;if(message.deleted)body.className='deleted';item.append(body);
      if(canModerate&&!message.deleted){const remove=document.createElement('button');remove.className='remove';remove.textContent='Supprimer';remove.setAttribute('aria-label','Supprimer le message de '+message.username);remove.addEventListener('click',async()=>{remove.disabled=true;try{receive(await api('/messages/'+message.id,{method:'DELETE',body:'{}'}));}catch(error){say(error.message);remove.disabled=false;}});item.append(remove);}
      fragment.append(item);
    }
    if(!messages.size){const empty=document.createElement('p');empty.className='empty';empty.textContent='Le salon est ouvert. Lance la conversation !';fragment.append(empty);}
    area.replaceChildren(fragment);if(nearBottom)area.scrollTop=area.scrollHeight;
  }
  function receive(message,live=false){const previous=messages.get(message.id);if(previous?.deleted&&!message.deleted)return;messages.set(message.id,message);if(messages.size>100){const oldest=Math.min(...messages.keys());messages.delete(oldest);}render();if(live&&!previous&&!open&&message.userId!==user?.id){unread++;$('unread').textContent=unread>99?'99+':String(unread);$('unread').hidden=false;}}
  async function refresh(){if(refreshing)return;refreshing=true;try{
    const data=await api();const first=!user;user=data.user;canModerate=data.canModerate;
    $('form').hidden=false;$('draft').disabled=false;$('status').textContent=socket?.connected?'● En direct · Tous les joueurs':'Salon général · Tous les joueurs';
    data.messages.forEach(message=>receive(message));render();
    if(first){try{$('draft').value=sessionStorage.getItem('chat-draft-'+user.id)||'';}catch{}updateCount();}
    if(!socket&&typeof window.io==='function'){
      socket=window.io({forceNew:true});socket.on('connect',()=>{socket.emit('general-chat:subscribe');$('status').textContent='● En direct · Tous les joueurs';refresh();});
      socket.on('general-chat:message',message=>receive(message,true));socket.on('disconnect',()=>{$('status').textContent='Reconnexion au salon…';});
    }
  }catch(error){if(error.status===401||error.status===403){user=null;socket?.disconnect();socket=null;messages.clear();$('messages').replaceChildren();$('form').hidden=true;$('status').textContent=error.status===401?'Connecte-toi pour rejoindre la conversation.':error.message;}else $('status').textContent='Connexion interrompue. Nouvelle tentative automatique…';}finally{refreshing=false;}}
  function updateCount(){$('count').textContent=Array.from($('draft').value).length+' / 400';try{if(user)sessionStorage.setItem('chat-draft-'+user.id,$('draft').value);}catch{}}
  $('draft').addEventListener('input',()=>{pending=null;updateCount();});
  $('draft').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('form').requestSubmit();}});
  $('form').addEventListener('submit',async e=>{
    e.preventDefault();if(sending||!user)return;const text=$('draft').value.trim();if(!text||Array.from(text).length>400){say('Écris entre 1 et 400 caractères.');return;}
    sending=true;$('send').disabled=true;$('draft').readOnly=true;say('');
    pending=pending?.text===text?pending:{text,requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')};
    try{receive(await api('/messages',{method:'POST',body:JSON.stringify(pending)}));$('draft').value='';pending=null;updateCount();$('messages').scrollTop=$('messages').scrollHeight;}
    catch(error){say(error.message);}finally{sending=false;$('send').disabled=false;$('draft').readOnly=false;}
  });
  $('form').hidden=true;refresh();setInterval(()=>{if(!document.hidden)refresh();},12000);window.addEventListener('online',refresh);
})();
