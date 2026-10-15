const {fork}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createPlayerFixture}=require('../tests/helpers/player-fixture.cjs');
const root=path.resolve(__dirname,'..'),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'casino-perf-'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const child=fork(path.join(root,'server.js'),{cwd:root,execArgv:['--require',path.join(__dirname,'perf-probe.cjs')],env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,SESSION_SECRET:'benchmark-only-isolated-session',ADMIN_USERNAME:'perf-admin',ADMIN_PASSWORD:'benchmark-password',CRASH_ENABLED:'true'},stdio:['ignore','pipe','pipe','ipc']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const sample=()=>new Promise(resolve=>{child.once('message',resolve);child.send('sample');});
  async function measure(name,ms){const a=await sample();await sleep(ms);const b=await sample();return {scenario:name,durationMs:Math.round(b.at-a.at),cpuPercentOneCore:Number(((b.cpu.user+b.cpu.system-a.cpu.user-a.cpu.system)/(b.at-a.at)/10).toFixed(3)),rssMiB:Number((b.memory.rss/1048576).toFixed(2)),heapMiB:Number((b.memory.heapUsed/1048576).toFixed(2)),timers:b.timers,sockets:b.sockets,sqliteCalls:b.queries-a.queries};}
  try{
    for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(base+'/api/health')).ok)break;}catch{}await sleep(50);if(i===199)throw Error(log);}
    await sleep(1000);const results=[await measure('idle',6000)];
    const player=await createPlayerFixture(base,dataDir,{username:'perf-player',password:'benchmark-password'},1000);
    const times=[];for(let i=0;i<40;i++){const begin=performance.now();const response=await fetch(base+'/api/me',{headers:{Cookie:player.cookie}});await response.arrayBuffer();times.push(performance.now()-begin);}times.sort((a,b)=>a-b);
    const handshake=await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:player.cookie}});const sid=JSON.parse((await handshake.text()).slice(1)).sid;
    const url=base+'/socket.io/?EIO=4&transport=polling&sid='+sid;
    const send=body=>fetch(url,{method:'POST',headers:{Cookie:player.cookie,'Content-Type':'text/plain'},body});
    let receiving=true,bytes=0,packets=0;const controller=new AbortController();
    const receiver=(async()=>{while(receiving){try{const response=await fetch(url,{headers:{Cookie:player.cookie},signal:controller.signal});const body=await response.text();bytes+=Buffer.byteLength(body);packets++;if(body==='2')await send('3');}catch{break;}}})();
    await send('40');await sleep(200);await send('420["fps:join",{"create":true,"name":"Benchmark"}]');await sleep(200);await send('421["fps:start",{}]');await sleep(200);
    const input=setInterval(()=>send('42["fps:input",{"forward":1,"strafe":0,"yaw":0,"pitch":0,"fire":true}]').catch(()=>{}),100);
    results.push(await measure('fps-solo-moving-firing',6000));clearInterval(input);
    await send('42["fps:leave"]');await sleep(200);await send('42["crash:sync"]');
    await fetch(base+'/api/crash/bets',{method:'POST',headers:{Cookie:player.cookie,'Content-Type':'application/json'},body:JSON.stringify({stake:1})});
    results.push(await measure('crash-connected',6000));receiving=false;await send('1');controller.abort();await receiver;
    results.push(await measure('after-disconnect',6000));
    const report={measuredAt:new Date().toISOString(),environment:{platform:process.platform,node:process.version,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length},http:{route:'/api/me',requests:40,medianMs:Number(times[20].toFixed(2)),p95Ms:Number(times[38].toFixed(2))},socketTraffic:{bytes,packets},results};
    const output=process.argv[2];if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{if(child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}fs.rmSync(dataDir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
