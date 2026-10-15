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
test('GPU character transforms match the existing world geometry and unchanged poses upload only once',()=>{
  const r=renderer(),skin=skins[0],p={x:2,y:7,height:3,yaw:.7,health:100};
  const local=r.characterVertices(p,skin,0,false),worldVertices=[];r.character(worldVertices,p,skin,0,false);
  const matrix=r.characterMatrix(p);
  for(let i=0;i<local.length;i+=Math.max(10,Math.floor(local.length/640)*10)){
    const x=local[i],y=local[i+1],z=local[i+2];
    for(const [axis,value] of [[0,matrix[0]*x+matrix[8]*z+matrix[12]],[1,y+matrix[13]],[2,matrix[2]*x+matrix[10]*z+matrix[14]]])assert.ok(Math.abs(value-worldVertices[i+axis])<1e-6);
  }
  let uploads=0,draws=0;
  r.bind=()=>{};r.gl={createBuffer:()=>({}),bindBuffer(){},bufferData(){uploads++;},uniformMatrix4fv(){},drawArrays(){draws++;}};
  r.drawCharacter(p,skin,0,false);r.drawCharacter({...p,x:4},skin,16,false);r.drawCharacter({...p,yaw:1},skin,32,false);
  assert.equal(uploads,1);assert.equal(draws,3);
});
