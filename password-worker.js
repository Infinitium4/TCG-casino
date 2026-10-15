const {parentPort}=require('node:worker_threads');
const bcrypt=require('bcryptjs');
parentPort.on('message',job=>{
  try{
    const value=job.type==='compare'?bcrypt.compareSync(job.password,job.hash):bcrypt.hashSync(job.password,job.rounds);
    parentPort.postMessage({value});
  }catch(error){parentPort.postMessage({error:error.message});}
});
