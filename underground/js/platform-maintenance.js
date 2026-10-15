(() => {
  const host=document.createElement('div');host.id='platform-maintenance';host.hidden=true;document.body.append(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{position:fixed;inset:0;z-index:2147483500;background:#100e16ed;color:#f4ece1;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;backdrop-filter:blur(18px)}:host([hidden]){display:none!important}*{box-sizing:border-box}section{width:min(540px,90vw);padding:42px;border:1px solid #a77d48;border-radius:24px;background:linear-gradient(145deg,#3d2337,#19171f);box-shadow:0 30px 100px #0008;text-align:center}small{color:#e6bb78;font-size:11px;letter-spacing:3px}h1{font-size:32px;line-height:1.2;margin:18px 0}p{white-space:pre-wrap;overflow-wrap:anywhere;color:#cec0ce}a{color:#ebc785}button{border:1px solid #b28b58;border-radius:10px;background:#e4bd7c;color:#241822;padding:10px 18px;cursor:pointer;font:inherit}.note{font-size:12px;color:#ac9aac}:host(.banner){inset:auto auto 12px 12px;width:min(430px,calc(100vw - 24px));background:#342334;display:block;backdrop-filter:none;border:1px solid #b28b58;border-radius:12px;pointer-events:none}:host(.banner) section{width:100%;padding:10px 18px;border:0;border-radius:0;box-shadow:none;background:none}:host(.banner) h1{font-size:16px;margin:0}:host(.banner) small,:host(.banner) a,:host(.banner) button{display:none}:host(.banner) p{font-size:12px;margin:2px 0}
    </style><section role="alert"><small>UNDERGROUND CASINO</small><h1>Maintenance en cours</h1><p id="message"></p><p id="detail" class="note"></p><button id="retry" type="button">Vérifier la réouverture</button><p><a href="/?administration=1">Accès administrateur</a></p></section>`;
  let busy=false,wasBlocking=false;const inertBefore=new Map();
  async function refresh(){if(busy)return;busy=true;try{
    const response=await fetch('/api/maintenance',{cache:'no-store'});if(!response.ok)return;const state=await response.json();
    const adminLogin=!state.authenticated&&location.pathname==='/'&&new URLSearchParams(location.search).has('administration');
    const adminAccess=state.canManage||state.canAccessAdmin;
    const blocking=state.enabled&&!adminAccess&&!state.hasActiveGame&&!adminLogin;
    if(blocking){for(const child of document.body.children)if(child!==host&&!inertBefore.has(child)){inertBefore.set(child,child.inert);child.inert=true;}}
    else {for(const [child,inert] of inertBefore)child.inert=inert;inertBefore.clear();}
    host.hidden=!state.enabled||adminLogin;host.classList.toggle('banner',Boolean(state.enabled&&(adminAccess||state.hasActiveGame)));
    root.getElementById('message').textContent=state.message;
    root.getElementById('detail').textContent=adminAccess?'Le site est fermé aux joueurs. Tu peux le rouvrir depuis le panneau principal.':state.hasActiveGame?'Les nouvelles parties sont bloquées. Termine ta manche ou encaisse tes gains.':'Tes données et ton solde sont conservés. Cette page se met à jour automatiquement.';
    if(blocking&&!wasBlocking){if(document.pointerLockElement)document.exitPointerLock();window.dispatchEvent(new CustomEvent('general-chat:open'));}
    if(wasBlocking&&!blocking&&!state.enabled)location.reload();wasBlocking=blocking;
  }catch{/* Keep the current display until the server responds again. */}finally{busy=false;}}
  root.getElementById('retry').addEventListener('click',refresh);
  window.addEventListener('platform-maintenance:changed',refresh);window.addEventListener('online',refresh);
  setInterval(()=>{if(!document.hidden)refresh();},5000);refresh();
})();
