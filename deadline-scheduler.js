// Wake at the next persisted deadline instead of polling an empty table forever.
function createDeadlineScheduler({nextDeadline,runDue,onError=console.error}){
  let timer=null,revision=0,closed=false,running=false;
  async function refresh(minDelay=25){
    if(closed)return;const current=++revision;
    let deadline;
    try{deadline=await nextDeadline();}catch(error){
      if(!closed&&current===revision){if(timer)clearTimeout(timer);timer=setTimeout(()=>refresh().catch(onError),1000);timer.unref();}
      throw error;
    }
    if(closed||current!==revision)return;
    if(timer)clearTimeout(timer);timer=null;
    if(deadline===null||deadline===undefined)return;
    timer=setTimeout(async()=>{
      timer=null;if(closed||running)return;running=true;
      let failed=false;
      try{await runDue();}catch(error){failed=true;onError(error);}finally{running=false;refresh(failed?1000:25).catch(onError);}
    },Math.max(minDelay,Math.min(2147483647,Number(deadline)-Date.now())));
    timer.unref();
  }
  return {refresh,close(){closed=true;revision++;if(timer)clearTimeout(timer);timer=null;}};
}
module.exports={createDeadlineScheduler};
