const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {createPlayerFixture}=require('./helpers/player-fixture.cjs');

test('ADMIN_PASSWORD updates an existing principal admin without losing data, invalidates old sessions and stays idempotent',async(t)=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-password-'));
  const root=path.resolve(__dirname,'..');let child,base;
  async function stop(){if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
  t.after(async()=>{await stop();fs.rmSync(dataDir,{recursive:true,force:true});});
  async function start(password='old-admin-password'){
    const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
    const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dataDir,SESSION_SECRET:'fps-shop-test-session-secret',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password,CRASH_ENABLED:'false'},stdio:'pipe'});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    for(let i=0;i<200;i++){
      if(child.exitCode!==null)throw Error(output);
      try{if((await fetch(base+'/api/health')).ok)return;}catch{}
      await new Promise(r=>setTimeout(r,50));
    }throw Error(output);
  }
  const sqlite3=require('sqlite3');
  async function sql(query,params=[],read=false){const db=new sqlite3.Database(path.join(dataDir,'database.sqlite'));try{return await new Promise((resolve,reject)=>db[read?'get':'run'](query,params,function(error,row){error?reject(error):resolve(read?row:this.changes);}));}finally{await new Promise(r=>db.close(r));}}
  async function login(username,password){const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  await start();const oldLogin=await login('admin','old-admin-password');assert.equal(oldLogin.status,200);
  await createPlayerFixture(base,dataDir,{username:'ordinary-player',password:'player-password'},123.45);
  const original=await sql("SELECT id,password_hash FROM users WHERE username='admin'",[],true);
  await sql('UPDATE users SET chips=4321.09,avatar=? WHERE id=?',['custom-avatar',original.id]);
  await sql('INSERT INTO game_history(user_id,game_name,bet,result,payout,net) VALUES(?,?,?,?,?,?)',[original.id,'roulette',10,'Test',20,10]);
  await stop();await start('new-admin-password-$-#-v2');
  assert.equal((await login('admin','old-admin-password')).status,401);
  const updatedLogin=await login('admin','new-admin-password-$-#-v2');assert.equal(updatedLogin.status,200);
  const stale=await fetch(base+'/api/me',{headers:{Cookie:oldLogin.cookie}});assert.equal(stale.status,401);
  const updated=await sql("SELECT id,chips,avatar,password_hash,is_admin FROM users WHERE username='admin'",[],true);
  assert.equal(updated.id,original.id);assert.equal(updated.chips,4321.09);assert.equal(updated.avatar,'custom-avatar');assert.equal(updated.is_admin,1);assert.notEqual(updated.password_hash,original.password_hash);
  assert.equal((await sql('SELECT COUNT(*) AS count FROM game_history WHERE user_id=?',[original.id],true)).count,1);
  assert.equal((await login('ordinary-player','player-password')).status,200);
  await stop();await start('new-admin-password-$-#-v2');
  assert.equal((await sql("SELECT password_hash FROM users WHERE username='admin'",[],true)).password_hash,updated.password_hash);
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:updatedLogin.cookie}})).status,200);
  await stop();await start('');assert.equal((await login('admin','new-admin-password-$-#-v2')).status,200);
});
