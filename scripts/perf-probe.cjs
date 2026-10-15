// Benchmark-only instrumentation, never loaded by npm start.
const timers=new Set();
for(const [setName,clearName,repeating] of [['setTimeout','clearTimeout',false],['setInterval','clearInterval',true]]){
  const schedule=global[setName],clear=global[clearName];
  global[setName]=(fn,delay,...args)=>{let handle;handle=schedule(()=>{if(!repeating)timers.delete(handle);fn(...args);},delay);timers.add(handle);return handle;};
  global[clearName]=handle=>{timers.delete(handle);clear(handle);};
}
let queries=0;const sqlite3=require('sqlite3');
for(const name of ['run','get','all']){const original=sqlite3.Database.prototype[name];sqlite3.Database.prototype[name]=function(...args){queries++;return original.apply(this,args);};}
process.on('message',message=>{if(message==='sample')process.send({cpu:process.cpuUsage(),memory:process.memoryUsage(),timers:timers.size,queries,sockets:require.cache[require('node:path').resolve(process.argv[1])]?.exports.io?.engine.clientsCount||0,at:performance.now()});});
