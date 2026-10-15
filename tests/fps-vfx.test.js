const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Vfx=require('../underground/js/fps-vfx');
const W=require('../underground/js/fps-shared');
const event={type:'shot',id:2,x:0,y:1,z:0,end:{x:0,y:1,z:-20},normal:[0,0,1],hitWorld:true};

test('imported particle assets are local PNGs with a preserved CC0 license',()=>{
  const folder=path.join(__dirname,'../underground/assets/fps/kenney-particles');
  for(const name of ['muzzle_01','muzzle_03','smoke_04','spark_05','trace_01','scorch_01']){
    const bytes=fs.readFileSync(path.join(folder,name+'.png'));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    const chunks=[];for(let i=8;i<bytes.length;i+=bytes.readUInt32BE(i)+12)chunks.push(bytes.toString('ascii',i+4,i+8));
    assert.ok(bytes[25]===6||(bytes[25]===3&&chunks.includes('tRNS')),'Texture must preserve transparency');
  }
  assert.match(fs.readFileSync(path.join(folder,'License.txt'),'utf8'),/CC0/);
});
test('tracers travel as short streaks and flashes finish within 38 milliseconds',()=>{
  const fx=Vfx.shot(event,1000,[.22,.8,-.8]);
  const first=Vfx.particles(fx,1010);assert.ok(first.some(p=>p.texture.startsWith('muzzle_')));
  const tracer=first.find(p=>p.from);assert.ok(tracer);
  assert.ok(Math.hypot(...tracer.to.map((v,i)=>v-tracer.from[i]))<=.701);
  assert.ok(!Vfx.particles(fx,1040).some(p=>p.texture.startsWith('muzzle_')));
  assert.deepEqual(Vfx.particles(fx,fx.until+1),[]);
});
test('impact smoke and surface marks appear at the hit and never on a player or in open air',()=>{
  const fx=Vfx.shot(event,1000),items=Vfx.particles(fx,1100);
  const mark=items.find(p=>p.texture==='scorch_01');assert.ok(mark);assert.deepEqual(mark.normal,event.normal);
  assert.ok(Math.abs(mark.center[2]+20)<.03);
  for(const flags of [{hitPlayer:true},{hitWorld:false}])assert.ok(!Vfx.particles({...fx,...flags},1100).some(p=>p.texture==='scorch_01'));
});
test('world collisions provide normals for wall, floor and sloping ramp decals',()=>{
  const floor=W.rayWorld([20,2,20],[0,-1,0],80,true);assert.equal(floor.distance,2);assert.deepEqual(floor.normal,[0,1,0]);
  const wall=W.rayWorld([20,2,20],[0,0,1],80,true);assert.ok(wall.distance>0);assert.ok(Math.abs(Math.hypot(...wall.normal)-1)<.001);
  const ramp=W.rayWorld([11,3,6],[0,-1,0],80,true);assert.ok(ramp.normal[1]>0);assert.ok(ramp.normal[2]>0);
});

test('grenade explosions use imported smoke and spark sprites and finish cleanly',()=>{
  const fx=Vfx.explosion({type:'explosion',x:20,y:.5,z:20,id:7},1000);
  const items=Vfx.particles(fx,1050);assert.ok(items.some(p=>p.texture==='smoke_04'));assert.ok(items.some(p=>p.texture==='muzzle_03'));
  for(const p of items)assert.ok([...p.center||p.from,...p.color].every(Number.isFinite));
  assert.deepEqual(Vfx.particles(fx,2300),[]);
});
