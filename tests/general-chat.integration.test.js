const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {createPlayerFixture}=require('./helpers/player-fixture.cjs');

test('general chat authenticates, deduplicates, limits spam, moderates and persists',async(t)=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'general-chat-'));
  const root=path.resolve(__dirname,'..');let child,base;
  async function stop(){if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
  t.after(async()=>{await stop();fs.rmSync(dataDir,{recursive:true,force:true});});
  async function start(){
    const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
    const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir,SESSION_SECRET:'fps-shop-test-session-secret',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'test-password',CRASH_ENABLED:'false'},stdio:'pipe'});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    for(let i=0;i<200;i++){
      if(child.exitCode!==null)throw Error(output);
      try{if((await fetch(base+'/api/health')).ok)return;}catch{}
      await new Promise(r=>setTimeout(r,50));
    }throw Error(output);
  }
  await start();
  const player=await createPlayerFixture(base,dataDir,{username:'chat-player',password:'test-password'},100);
  const other=await createPlayerFixture(base,dataDir,{username:'chat-other',password:'test-password'},100);
  const adminResponse=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});
  const adminCookie=adminResponse.headers.get('set-cookie').split(';')[0];
  async function request(route='',method='GET',body,cookie=player.cookie){
    const response=await fetch(base+'/api/chat'+route,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await fetch(base+'/api/chat')).status,401);
  assert.equal((await request('/messages','POST',{text:' ',requestId:'invalid-message-0001'})).status,400);
  assert.equal((await request('/messages','POST',{text:'x'.repeat(401),requestId:'invalid-message-0002'})).status,400);
  // Exercise the actual Socket.IO transport using Engine.IO polling, without a mock server.
  const handshake=await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:other.cookie}});
  const sid=JSON.parse((await handshake.text()).slice(1)).sid;
  const socketUrl=base+'/socket.io/?EIO=4&transport=polling&sid='+encodeURIComponent(sid);
  const poll=async()=> (await fetch(socketUrl,{headers:{Cookie:other.cookie},signal:AbortSignal.timeout(5000)})).text();
  const packet=async body=>fetch(socketUrl,{method:'POST',headers:{Cookie:other.cookie,'Content-Type':'text/plain'},body});
  await packet('40');await poll();
  await packet('420["general-chat:subscribe"]');
  let acknowledged=false;
  for(let i=0;i<5&&!acknowledged;i++)acknowledged=(await poll()).includes('430[{"ok":true}]');
  assert.equal(acknowledged,true);
  const payload={text:'Bonjour <img src=x onerror=alert(1)>',requestId:'first-chat-message-001',username:'admin',userId:1};
  const sent=await Promise.all([request('/messages','POST',payload),request('/messages','POST',payload)]);
  assert.match(await poll(),/general-chat:message/);
  assert.ok(sent.every(r=>r.status===200));assert.equal(sent[0].body.id,sent[1].body.id);assert.equal(sent[0].body.username,'chat-player');
  assert.equal((await request()).body.messages.length,1);
  assert.equal((await request('/messages','POST',{...payload,text:'changed'})).status,409);
  assert.equal((await request('/messages','POST',{text:'spam',requestId:'second-chat-message-002'})).status,429);
  const id=sent[0].body.id;
  assert.equal((await request('/messages/'+id,'DELETE',{},other.cookie)).status,403);
  const crossSite=await fetch(base+'/api/chat/messages',{method:'POST',headers:{Cookie:other.cookie,'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:JSON.stringify({...payload,requestId:'cross-site-message-001'})});assert.equal(crossSite.status,403);
  assert.equal((await request('/messages/'+id,'DELETE',{},adminCookie)).body.deleted,true);
  const deletedPacket=await poll();assert.match(deletedPacket,/"deleted":true/);assert.doesNotMatch(deletedPacket,/onerror/);
  await packet('1');
  const history=(await request()).body;assert.equal(history.messages[0].text,'');assert.equal(history.canModerate,false);
  assert.equal((await request('', 'GET',null,adminCookie)).body.canModerate,true);
  assert.equal((await request('/messages','POST',{text:'Salut \u{1f44b}',requestId:'other-chat-message-001'},other.cookie)).status,200);
  await stop();await start();
  const restored=(await request()).body.messages;assert.equal(restored.length,2);assert.equal(restored[0].deleted,true);assert.equal(restored[1].text,'Salut \u{1f44b}');
});
