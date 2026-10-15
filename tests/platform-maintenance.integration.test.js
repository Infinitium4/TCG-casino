const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {createPlayerFixture}=require('./helpers/player-fixture.cjs');

test('global maintenance is primary-admin only, persists, blocks new games and preserves settlements',async(t)=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-'));
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
  const player=await createPlayerFixture(base,dataDir,{username:'maintenance-player',password:'test-password'},1000);
  const secondary=await createPlayerFixture(base,dataDir,{username:'maintenance-secondary',password:'test-password'},1000);
  const sqlite3=require('sqlite3');const database=new sqlite3.Database(path.join(dataDir,'database.sqlite'));
  await new Promise((resolve,reject)=>database.run('UPDATE users SET is_admin=1 WHERE username=?',['maintenance-secondary'],error=>error?reject(error):resolve()));await new Promise(resolve=>database.close(resolve));
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password'})});
  const adminCookie=login.headers.get('set-cookie').split(';')[0];
  async function request(route,body,cookie=player.cookie){const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
  assert.equal((await request('/api/maintenance')).body.enabled,false);
  const mine=await request('/api/mines/start',{stake:10,mineCount:3,requestId:'maintenance-mines-start-001'});assert.equal(mine.status,200);
  const config={enabled:true,message:'Maintenance <script>alert(1)</script>',reason:'Test global maintenance'};
  assert.equal((await request('/api/admin/maintenance',config)).status,403);
  assert.equal((await request('/api/admin/maintenance',config,secondary.cookie)).status,403);
  assert.equal((await request('/api/admin/maintenance',{...config,enabled:'yes'},adminCookie)).status,400);
  assert.equal((await request('/api/admin/maintenance',config,adminCookie)).status,200);
  let status=(await request('/api/maintenance')).body;assert.equal(status.enabled,true);assert.equal(status.hasActiveGame,true);assert.equal(status.canManage,false);
  assert.equal((await request('/api/maintenance',null,adminCookie)).body.canManage,true);
  for(const route of ['/api/dice/roll','/api/clicker/click','/api/fps/shop/buy','/api/blackjack/tables','/api/register'])assert.equal((await request(route,{})).status,503,route);
  const cashout=await request('/api/mines/cashout',{gameId:mine.body.game.id,requestId:'maintenance-mines-cashout-001'});assert.equal(cashout.status,200);assert.equal(cashout.body.balance,Math.round((mine.body.balance+cashout.body.game.payout)*100)/100);
  assert.equal((await request('/api/maintenance')).body.hasActiveGame,false);
  assert.equal((await request('/api/admin/settings',null,adminCookie)).body.maintenance.enabled,true);
  assert.equal((await fetch(base+'/game',{headers:{Cookie:adminCookie}})).status,200);
  assert.equal((await fetch(base+'/js/platform-maintenance.js')).status,200);
  // The existing socket cannot open new FPS rooms during maintenance.
  const handshake=await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:player.cookie}});
  const sid=JSON.parse((await handshake.text()).slice(1)).sid,url=base+'/socket.io/?EIO=4&transport=polling&sid='+sid;
  const packet=body=>fetch(url,{method:'POST',headers:{Cookie:player.cookie,'Content-Type':'text/plain'},body});
  const poll=async()=> (await fetch(url,{headers:{Cookie:player.cookie},signal:AbortSignal.timeout(5000)})).text();
  await packet('40');await poll();await packet('420["fps:join",{"create":true,"name":"Blocked"}]');
  let blocked=false;for(let i=0;i<5&&!blocked;i++)blocked=(await poll()).includes('"maintenance":true');assert.equal(blocked,true);await packet('1');
  await stop();await start();status=(await request('/api/maintenance')).body;assert.equal(status.enabled,true);assert.equal(status.message,config.message);
  assert.equal((await request('/api/admin/maintenance',{...config,enabled:false},adminCookie)).status,200);
  assert.equal((await request('/api/maintenance')).body.enabled,false);
  assert.equal((await request('/api/mines/start',{stake:10,mineCount:3,requestId:'maintenance-mines-start-002'})).status,200);
  const audit=(await request('/api/admin/audit',null,adminCookie)).body.entries;
  assert.ok(audit.some(row=>row.action==='maintenance_enabled'));assert.ok(audit.some(row=>row.action==='maintenance_disabled'));
});
