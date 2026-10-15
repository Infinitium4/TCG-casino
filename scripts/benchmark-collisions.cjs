const fs=require('node:fs'),W=require('../underground/js/fps-shared'),reference=require('../tests/helpers/reference-fps-ray.cjs');
const rays=Array.from({length:2000},(_,i)=>{
  const spawn=W.SPAWNS[i%W.SPAWNS.length],yaw=i*.73,pitch=Math.sin(i*.31)*.8;
  return [[spawn[0],1.55+(spawn[2]||0),spawn[1]],[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)]];
});
function run(fn){const start=performance.now();let checksum=0;for(const args of rays)checksum+=fn(...args);return {ms:performance.now()-start,checksum};}
run(reference);run(W.rayWorld);const before=[],after=[];
for(let i=0;i<7;i++){
  const a=i%2?run(W.rayWorld):run(reference),b=i%2?run(reference):run(W.rayWorld);
  const old=i%2?b:a,current=i%2?a:b;if(old.checksum!==current.checksum)throw Error('Collision results changed');before.push(old.ms);after.push(current.ms);
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const result={measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,raysPerRun:rays.length,runs:7,beforeMs:before,afterMs:after,medianBeforeMs:median(before),medianAfterMs:median(after)};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
