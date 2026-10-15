const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('chat and games share one connection and subscriptions wait for the authenticated session, including reconnects',()=>{
  const handlers=new Map();let connections=0;
  const socket={on(name,handler){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);},off(name,handler){handlers.get(name)?.delete(handler);}};
  const window={io(){connections++;return socket;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../underground/js/realtime.js'),'utf8'),{window});
  const shared=window.casinoRealtime;assert.equal(shared.getSocket(),shared.getSocket());assert.equal(connections,1);
  let subscriptions=0;const remove=shared.onReady(()=>subscriptions++);assert.equal(subscriptions,0);
  const emit=name=>{for(const handler of handlers.get(name)||[])handler();};
  emit('session:ready');assert.equal(subscriptions,1);
  let late=0;shared.onReady(()=>late++);assert.equal(late,1);
  emit('disconnect');let reconnect=0;shared.onReady(()=>reconnect++);assert.equal(reconnect,0);
  emit('session:ready');assert.equal(subscriptions,2);assert.equal(reconnect,1);
  remove();emit('session:ready');assert.equal(subscriptions,2);assert.equal(connections,1);
});
test('a slow Crash request does not prevent casino navigation and other game controls from initializing',async()=>{
  let finishCrash;const calls=[];
  const noop=()=>{},node={addEventListener:noop};
  const context={console,getPlayer:noop,savePlayer:noop,document:{addEventListener:noop,getElementById:()=>node},window:{location:{replace(){throw Error('Unexpected redirect');}}},accountUser:{isAdmin:false},loadAccountData:async()=>true,fetch:async()=>({ok:true,json:async()=>({games:{}})}),crashModule:{initialize:()=>new Promise(resolve=>finishCrash=resolve)}};
  for(const name of ['plinko','dice','mines','tower','clicker','horses','roulette','blackjack','poker','slots','admin'])context[name+'Module']={initialize:()=>calls.push(name)};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../underground/js/app.js'),'utf8'),context);
  for(const name of ['applyGameAvailability','bindNavigation','bindGlobalButtons','updateTopbar','renderHomeView','renderProfileView','renderLeaderboard'])context[name]=()=>calls.push(name);
  const initialized=context.initializeApp();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.includes('bindNavigation'));assert.ok(calls.includes('blackjack'));assert.ok(calls.includes('poker'));
  finishCrash(true);await initialized;
});
