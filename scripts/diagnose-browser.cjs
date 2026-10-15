// Local browser diagnostic with a fresh profile and an isolated database.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'casino-browser-'));
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const server=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DATA_DIR:folder,SESSION_SECRET:'browser-diagnostic-isolated-session',ADMIN_USERNAME:'diagnostic',ADMIN_PASSWORD:'diagnostic-password',CRASH_ENABLED:'true'},stdio:'pipe'});
  let browser,ws;const errors=[],requests=[];
  try{
    for(let i=0;i<200;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await sleep(50);if(i===199)throw Error('Server did not start');}
    const executable=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+path.join(folder,'browser'),'--window-size=1366,900','about:blank'],{windowsHide:true,stdio:'pipe'});
    const endpoint=await new Promise((resolve,reject)=>{let log='';browser.stderr.on('data',b=>{log+=b;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)resolve(match[1]);});browser.once('error',reject);browser.once('exit',code=>reject(Error('Browser exited '+code)));});
    const address=new URL(endpoint);const tabs=await (await fetch('http://'+address.host+'/json/list')).json();
    ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0;const pending=new Map();
    ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const job=pending.get(data.id);if(job){pending.delete(data.id);data.error?job.reject(Error(data.error.message)):job.resolve(data.result);}}
      if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
      if(data.method==='Network.requestWillBeSent'&&!data.params.request.url.startsWith('data:'))requests.push(data.params.request.url.replace(base,''));
    };
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
    await call('Runtime.enable');await call('Network.enable');await call('Page.enable');await call('Performance.enable');
    await call('Page.navigate',{url:base});await sleep(600);
    await evaluate("fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'diagnostic',password:'diagnostic-password'})}).then(r=>r.status)");
    const reports=[];
    for(const page of ['/game',...(process.env.PERF_FPS==='true'?['/fps']:[])]){
      errors.length=0;requests.length=0;await call('Page.navigate',{url:base+page});await sleep(3000);
      const initial=await evaluate("({title:document.title,text:document.body.innerText.slice(0,500),ready:document.readyState,images:document.images.length})");
      await call('Profiler.enable');await call('Profiler.start');
      const a=(await call('Performance.getMetrics')).metrics;await sleep(5000);const b=(await call('Performance.getMetrics')).metrics;
      const profile=(await call('Profiler.stop')).profile;
      const delta=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount','JSHeapUsedSize'].map(name=>[name,b.find(m=>m.name===name)?.value-(name==='JSHeapUsedSize'?0:a.find(m=>m.name===name)?.value)]));
      const hotspots=profile.nodes.filter(n=>n.hitCount).sort((x,y)=>y.hitCount-x.hitCount).slice(0,12).map(n=>({function:n.callFrame.functionName,file:n.callFrame.url.replace(base,''),hits:n.hitCount}));
      reports.push({page,initial,delta,errors:[...errors],requests:[...requests],hotspots});
      if(page==='/game')await call('Page.captureScreenshot',{format:'png'}).then(result=>fs.writeFileSync(path.join(os.tmpdir(),'casino-home-diagnostic.png'),Buffer.from(result.data,'base64')));
    }
    let smoke=null;
    if(process.env.BROWSER_SMOKE==='true'){
      const assert=require('node:assert/strict');await call('Page.navigate',{url:base+'/game'});await sleep(1500);
      await evaluate("showView('admin')");await sleep(500);
      const admin=await evaluate("document.getElementById('adminAccountsBody').children.length");assert.ok(admin>0,'Admin panel failed to load');
      const id=await evaluate("fetch('/api/blackjack/tables',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableName:'Browser diagnostic'})}).then(r=>r.json()).then(data=>data.table.id)");
      assert.ok(id);await call('Page.navigate',{url:base+'/blackjack/game/'+id});await sleep(1500);
      const table=await evaluate("document.getElementById('tableBanner').textContent");assert.match(table,/Browser diagnostic/);
      const start=await evaluate("fetch('/api/blackjack/tables/"+id+"/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({betAmount:1})}).then(r=>r.status)");assert.equal(start,200);await sleep(500);
      const cards=await evaluate("document.getElementById('dealerCards').children.length");assert.equal(cards,2);
      await evaluate("document.querySelector('[data-blackjack-action=stand]')?.click()");await sleep(500);
      assert.equal(errors.length,0,errors.join('\n'));smoke={adminAccounts:admin,blackjackTable:true,blackjackStarted:true,dealerCards:cards,errors:[]};
    }
    const report={measuredAt:new Date().toISOString(),reports,smoke};console.log(JSON.stringify(report,null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));
  }finally{
    ws?.close();
    for(const child of [browser,server])if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    // Fresh diagnostic files only; Chromium may briefly retain its profile handles.
    try{fs.rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
