const {Worker}=require('node:worker_threads');
const path=require('node:path');
function createPasswordService({maxPending=8,timeoutMs=10000}={}){
  let worker=null,current=null,timer=null,closed=false;const queue=[];
  const busy=()=>Object.assign(new Error('Trop de connexions simultanées. Réessaie dans quelques secondes.'),{code:'PASSWORD_BUSY'});
  function dispatch(){
    if(closed||current||!queue.length)return;
    if(!worker){
      const created=worker=new Worker(path.join(__dirname,'password-worker.js'));created.unref();
      const failed=error=>{
        if(worker!==created)return;worker=null;clearTimeout(timer);timer=null;
        if(current){current.reject(error);current=null;}created.terminate();dispatch();
      };
      created.on('error',failed);created.on('exit',code=>{if(worker===created)failed(Object.assign(new Error('Password worker stopped: '+code),{code:'PASSWORD_BUSY'}));});
      created.on('message',result=>{
        if(worker!==created||!current)return;clearTimeout(timer);timer=null;
        const job=current;current=null;created.unref();
        result.error?job.reject(new Error(result.error)):job.resolve(result.value);dispatch();
      });
    }
    current=queue.shift();worker.ref();worker.postMessage(current.job);
    timer=setTimeout(()=>{
      const expired=worker;worker=null;timer=null;current.reject(busy());current=null;expired.terminate();dispatch();
    },timeoutMs);timer.unref();
  }
  function execute(job){
    if(closed||queue.length+Number(Boolean(current))>=maxPending)return Promise.reject(busy());
    return new Promise((resolve,reject)=>{queue.push({job,resolve,reject});dispatch();});
  }
  return {
    compare:(password,hash)=>execute({type:'compare',password,hash}),
    hash:(password,rounds=10)=>execute({type:'hash',password,rounds}),
    async close(){closed=true;clearTimeout(timer);if(current){current.reject(busy());current=null;}for(const job of queue.splice(0))job.reject(busy());const previous=worker;worker=null;if(previous)await previous.terminate();}
  };
}
module.exports={createPasswordService};
