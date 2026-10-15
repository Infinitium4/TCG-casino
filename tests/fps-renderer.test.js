const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const world=require('../underground/js/fps-shared');
const skins=require('../underground/js/fps-skins');
function renderer(){
  const context={window:{},FpsWorld:world,FpsSkins:skins,Math,Date,Float32Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../underground/js/fps-renderer.js'),'utf8'),context);
  const result=Object.create(context.window.FpsRenderer.prototype);result.reduced=true;return result;
}
test('every character mesh is finite, within playable proportions and has a distinct silhouette',()=>{
  const r=renderer(),meshes=[];
  for(const skin of skins){
    const vertices=[];r.character(vertices,{x:0,y:0,yaw:0,height:0,health:100},skin,0,true);
    assert.ok(vertices.length>10000);assert.equal(vertices.length%30,0);assert.ok(vertices.every(Number.isFinite));
    const heights=vertices.filter((_,i)=>i%10===1);assert.ok(Math.max(...heights)<=1.9);assert.ok(Math.min(...heights)>=0);
    meshes.push(vertices.filter((_,i)=>i%10<3).join(','));
  }
  assert.equal(new Set(meshes).size,skins.length);
});
test('the multilevel arena generates valid geometry above both floor levels',()=>{
  const vertices=[];renderer().buildArena(vertices);
  assert.equal(vertices.length%30,0);assert.ok(vertices.every(Number.isFinite));
  assert.ok(vertices.some((v,i)=>i%10===1&&v>6));
  for(const platform of world.PLATFORMS){
    const x=(platform.x0+platform.x1)/2,z=(platform.z0+platform.z1)/2;
    assert.equal(world.floorHeight(x,z,3),3);
    assert.ok(Math.abs(world.rayWorld([x,4,z],[0,-1,0])-1)<.001);
  }
});
