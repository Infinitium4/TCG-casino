const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../underground/js/fps-shared'),reference=require('./helpers/reference-fps-ray.cjs');
function rays(count){
  let seed=1729;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  return Array.from({length:count},(_,i)=>{
    const origin=[random()*W.SIZE,random()*8,random()*W.SIZE],yaw=random()*Math.PI*2,pitch=(random()-.5)*Math.PI;
    const direction=i%4===0?[0,-1,0]:i%4===1?[1,0,0]:[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
    return {origin,direction,max:1+random()*80};
  });
}
test('cached collision geometry preserves ray distances and impact normals across the multilevel arena',()=>{
  for(const ray of rays(2000)){
    const previous=reference(ray.origin,ray.direction,ray.max,true),current=W.rayWorld(ray.origin,ray.direction,ray.max,true);
    assert.deepEqual(current,previous);assert.equal(W.rayWorld(ray.origin,ray.direction,ray.max),previous.distance);
  }
});
module.exports={rays};
