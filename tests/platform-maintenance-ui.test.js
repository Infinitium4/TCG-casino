const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(initial,pathname='/game',search=''){
  let state=initial,reloads=0,released=0;const events=new Map(),nodes=new Map(),classes=new Set();
  const root={set innerHTML(value){this.markup=value;},getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener(){}});return nodes.get(id);}};
  const host={hidden:false,attachShadow:()=>root,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};
  const page={inert:false},alreadyDisabled={inert:true},body={children:[page,alreadyDisabled],append(node){this.children.push(node);}};
  const document={body,createElement:()=>host,hidden:false,pointerLockElement:{},exitPointerLock(){released++;}};
  const window={addEventListener(name,handler){events.set(name,handler);},dispatchEvent(){}};
  const context={document,window,location:{pathname,search,reload(){reloads++;}},URLSearchParams,CustomEvent:class{},setInterval(){},fetch:async()=>({ok:true,json:async()=>state})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../underground/js/platform-maintenance.js'),'utf8'),context);
  return {host,page,alreadyDisabled,root,classes,get reloads(){return reloads;},get released(){return released;},async update(next){state=next;events.get('platform-maintenance:changed')();await flush();}};
}
test('maintenance blocks the open page and keyboard focus, displays text safely and restores access on reopening',async()=>{
  const ui=setup({enabled:true,authenticated:true,canManage:false,hasActiveGame:false,message:'<img src=x onerror=alert(1)>'});await flush();
  assert.equal(ui.host.hidden,false);assert.equal(ui.page.inert,true);assert.equal(ui.released,1);
  assert.equal(ui.root.getElementById('message').textContent,'<img src=x onerror=alert(1)>');assert.doesNotMatch(ui.root.markup,/<img/);
  await ui.update({enabled:false,authenticated:true,canManage:false,hasActiveGame:false,message:''});
  assert.equal(ui.host.hidden,true);assert.equal(ui.page.inert,false);assert.equal(ui.alreadyDisabled.inert,true);assert.equal(ui.reloads,1);
});
test('the principal admin and players settling existing bets retain controls; the admin login stays reachable',async()=>{
  for(const permissions of [{canManage:true,hasActiveGame:false},{canManage:false,hasActiveGame:true}]){
    const ui=setup({enabled:true,authenticated:true,message:'Maintenance',...permissions});await flush();
    assert.equal(ui.classes.has('banner'),true);assert.equal(ui.page.inert,false);assert.equal(ui.released,0);
  }
  const login=setup({enabled:true,authenticated:false,canManage:false,hasActiveGame:false,message:'Maintenance'},'/','?administration=1');await flush();
  assert.equal(login.host.hidden,true);assert.equal(login.page.inert,false);
  await login.update({enabled:true,authenticated:true,canManage:false,hasActiveGame:false,message:'Maintenance'});
  assert.equal(login.host.hidden,false);assert.equal(login.page.inert,true);
});
test('a principal admin never retains the maintenance banner after reopening or on an already-open casino',async()=>{
  const state={enabled:false,authenticated:true,canManage:true,canAccessAdmin:true,hasActiveGame:false,message:'Maintenance'};
  const ui=setup(state);await flush();assert.equal(ui.host.hidden,true);assert.equal(ui.classes.has('banner'),false);
  await ui.update({...state,enabled:true});assert.equal(ui.host.hidden,false);assert.equal(ui.classes.has('banner'),true);
  await ui.update(state);assert.equal(ui.host.hidden,true);assert.equal(ui.classes.has('banner'),false);assert.equal(ui.page.inert,false);
});
