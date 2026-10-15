const test=require('node:test');
const assert=require('node:assert/strict');
const Loot=require('../underground/js/fps-loot');
const W=require('../underground/js/fps-shared');
const {Arena}=require('../fps');

test('chests award grenades once, require proximity and elevation, and refill after cooldown',()=>{
  const loot=new Loot(),p={id:1,x:11,y:10,height:0,health:100,grenades:0,input:{interact:true}},events=[];
  const update=now=>loot.update([p],now,.05,(type,data)=>events.push({type,...data}),()=>{});
  update(1000);assert.equal(p.grenades,2);assert.equal(events.length,1);
  update(1100);assert.equal(p.grenades,2);
  p.input={};update(1200);p.input={interact:true};update(1300);assert.equal(p.grenades,2);
  p.input={};update(22000);p.input={interact:true};p.height=3;update(22050);assert.equal(p.grenades,2);
  p.input={};update(22100);p.height=0;p.input={interact:true};update(22150);assert.equal(p.grenades,3);
});

test('grenades consume inventory, cannot be repeated by holding G, and explode after their fuse',()=>{
  const loot=new Loot(),p={id:1,x:20,y:20,height:0,yaw:0,pitch:0,health:100,grenades:2,input:{grenade:true}};let explosions=0;
  const update=now=>loot.update([p],now,.05,()=>{},()=>explosions++);
  update(1000);assert.equal(p.grenades,1);assert.equal(loot.bombs.length,1);
  update(1200);assert.equal(p.grenades,1);assert.equal(loot.bombs.length,1);
  p.input={};for(let now=1250;now<=3250;now+=50)update(now);
  assert.equal(explosions,1);assert.equal(loot.bombs.length,0);
  p.grenades=0;p.input={grenade:true};update(4000);assert.equal(loot.bombs.length,0);
});

test('explosion damage decreases with distance and walls protect players',()=>{
  const loot=new Loot(),bomb={x:20,y:.5,z:20};
  assert.ok(loot.damage(bomb,{x:20,y:21,height:0})>loot.damage(bomb,{x:20,y:23,height:0}));
  assert.equal(loot.damage(bomb,{x:20,y:27,height:0}),0);
  assert.equal(loot.damage({x:2.5,y:1,z:4.5},{x:5.5,y:4.5,height:0}),0);
});

test('multiplayer loot is server-owned and the large arena has accessible chests',()=>{
  const arena=new Arena('test','Test',1,1000),p=arena.add(1,'Solo',1000);Object.assign(p,{x:11,y:10,height:0});
  arena.input(1,{yaw:0,pitch:0,forward:0,strafe:0,interact:true,grenades:999},2000);arena.tick(2000);
  assert.equal(p.grenades,2);assert.equal(arena.snapshot(2000).chests.length,8);
  assert.equal(W.SIZE,40);assert.equal(W.MAP.length*W.MAP[0].length,1600);
  for(const c of arena.loot.chests){assert.equal(W.free(c.x,c.z,c.height),true);assert.equal(W.floorHeight(c.x,c.z,c.height),c.height);}
});

test('grenades bounce inside arena boundaries and server explosions credit kills',()=>{
  const loot=new Loot(),p={id:1,x:38.5,y:20,height:0,yaw:Math.PI/2,pitch:0,health:100,grenades:1,input:{grenade:true}};
  for(let i=0;i<42;i++){
    loot.update([p],1000+i*50,.05,()=>{},()=>{});p.input={};
    for(const bomb of loot.bombs){assert.ok(bomb.x<39);assert.ok(bomb.y>=0);}
  }
  const room=new Arena('test','Test',1,1000),a=room.add(1,'Alice',1000),b=room.add(2,'Bob',1000);
  Object.assign(a,{x:20,y:20,height:0,protectedUntil:0});Object.assign(b,{x:20,y:21,height:0,protectedUntil:0,health:40});
  room.loot.bombs.push({id:1,ownerId:1,x:20,y:.5,z:20,vx:0,vy:0,vz:0,explodeAt:2000});
  room.tick(2000);assert.equal(b.health,0);assert.equal(a.kills,1);assert.equal(b.deaths,1);
});
