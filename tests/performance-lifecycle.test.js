const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createDeadlineScheduler}=require('../deadline-scheduler');
test('deadline scheduler sleeps without work, settles a due task once and cancels on close',async()=>{
  let reads=0,runs=0,deadline=null;
  const scheduler=createDeadlineScheduler({nextDeadline:async()=>{reads++;return deadline;},runDue:async()=>{runs++;deadline=null;},onError:error=>{throw error;}});
  await scheduler.refresh();await new Promise(r=>setTimeout(r,55));assert.equal(reads,1);assert.equal(runs,0);
  deadline=Date.now()+30;await scheduler.refresh();await new Promise(r=>setTimeout(r,80));assert.equal(runs,1);assert.equal(reads,3);
  deadline=Date.now()+30;await scheduler.refresh();scheduler.close();await new Promise(r=>setTimeout(r,60));assert.equal(runs,1);
});
test('FPS has no idle simulation timer, keeps 20Hz in a match, and stops after the final departure',async()=>{
  const active=new Map();let connection;
  const context={require:id=>require(id.startsWith('.')?path.resolve(__dirname,'..',id):id),module:{exports:{}},Date,Math,setInterval(fn,ms){const handle={unref(){}};active.set(handle,{fn,ms});return handle;},clearInterval(handle){active.delete(handle);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../fps.js'),'utf8'),context);
  const game=context.module.exports.registerFps({app:{get(){}},io:{on(event,handler){connection=handler;},sockets:{sockets:new Map()},to:()=>({volatile:{emit(){}}})},get:async sql=>sql.includes('fps_loadouts')?null:{id:1,username:'Player'},path:{}});
  assert.equal(active.size,0);const handlers={},socket={id:'test',connected:true,request:{session:{userId:1}},on(name,handler){handlers[name]=handler;},join(){},leave(){}};connection(socket);
  await handlers['fps:join']({create:true},()=>{});assert.equal(active.size,1);assert.equal([...active.values()][0].ms,1000);
  handlers['fps:start']({},()=>{});assert.equal(active.size,1);assert.equal([...active.values()][0].ms,50);
  handlers['fps:leave']();assert.equal(game.rooms.size,0);assert.equal(active.size,0);game.close();
});
