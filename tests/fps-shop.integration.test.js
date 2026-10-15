const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {createPlayerFixture}=require('./helpers/player-fixture.cjs');

test('skins debit once under concurrency, reject unowned equips and insufficient funds, and survive restart',async(t)=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'fps-shop-'));
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
  const player=await createPlayerFixture(base,dataDir,{username:'skin-buyer',password:'test-password'},2100);
  const other=await createPlayerFixture(base,dataDir,{username:'other-buyer',password:'test-password'},100);
  async function request(route,skinId,cookie=player.cookie){
    const response=await fetch(base+'/api/fps/shop'+route,{method:skinId?'POST':'GET',headers:{Cookie:cookie,...(skinId?{'Content-Type':'application/json'}:{})},...(skinId?{body:JSON.stringify({skinId})}:{})});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await fetch(base+'/api/fps/shop',{redirect:'manual'})).status,401);
  assert.equal((await request('/equip','gold')).status,403);
  assert.equal((await request('/buy','invented')).status,400);
  const purchases=await Promise.all([request('/buy','emerald'),request('/buy','emerald')]);
  assert.ok(purchases.every(p=>p.status===200));
  let state=(await request('')).body;assert.equal(state.balance,100);assert.deepEqual(state.owned,['classic','emerald']);
  assert.equal((await request('/buy','gold')).status,409);
  assert.equal((await request('/buy','ivory',other.cookie)).status,409);
  assert.equal((await request('/equip','emerald')).body.equipped,'emerald');
  assert.equal((await request('',null,other.cookie)).body.equipped,'classic');
  const crossSite=await fetch(base+'/api/fps/shop/buy',{method:'POST',headers:{Cookie:player.cookie,'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:JSON.stringify({skinId:'ivory'})});
  assert.equal(crossSite.status,403);
  await stop();await start();state=(await request('')).body;
  assert.equal(state.balance,100);assert.equal(state.equipped,'emerald');assert.ok(state.owned.includes('emerald'));
  assert.equal((await request('/equip','classic')).body.equipped,'classic');
  assert.equal((await request('/buy','smile')).status,409);
  const collector=await createPlayerFixture(base,dataDir,{username:'portrait-collector',password:'test-password'},6500);
  const portrait=await request('/buy','smile',collector.cookie);assert.equal(portrait.status,200);assert.equal(portrait.body.balance,4500);
  assert.equal(portrait.body.skins.find(s=>s.id==='smile').name,'Elouan');
  assert.equal((await request('/buy','smile',collector.cookie)).body.owned.filter(id=>id==='smile').length,1);
  assert.equal((await request('/equip','smile',collector.cookie)).body.equipped,'smile');
  const titans=await Promise.all([request('/buy','titan',collector.cookie),request('/buy','titan',collector.cookie)]);
  assert.ok(titans.every(r=>r.status===200));assert.equal(titans[0].body.balance,2100);
  assert.equal((await request('/buy','striker',collector.cookie)).body.balance,0);
  assert.equal((await request('/equip','striker',collector.cookie)).body.equipped,'striker');
  await stop();await start();const collection=(await request('',null,collector.cookie)).body;
  assert.equal(collection.balance,0);assert.equal(collection.equipped,'striker');
  for(const id of ['smile','titan','striker'])assert.ok(collection.owned.includes(id));
});
