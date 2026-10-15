const test=require('node:test');
const assert=require('node:assert/strict');
const {Arena,MAGAZINE,RELOAD_MS,MATCH_MS}=require('../fps');
const W=require('../underground/js/fps-shared');

function duel() {
  const room=new Arena('test','Test',1,1000,()=>.5);
  const a=room.add(1,'Alice',1000),b=room.add(2,'Bob',1000);
  Object.assign(a,{x:10.5,y:10.5,yaw:0,pitch:-.1,protectedUntil:0});
  Object.assign(b,{x:10.5,y:7.5,yaw:Math.PI,protectedUntil:0});
  return {room,a,b};
}
test('movement normalizes diagonals, stops at arena walls, and rejects invalid client positions',()=>{
  const p={x:10.5,y:10.5,yaw:0};W.move(p,{forward:1,strafe:1},.1);
  assert.ok(Math.hypot(p.x-10.5,p.y-10.5)<=W.SPEED*.1+.00001);
  const blocked={x:2.5,y:3.5,yaw:Math.PI/2};W.move(blocked,{forward:1},1);
  assert.ok(blocked.x<3);assert.equal(W.free(blocked.x,blocked.y),true);
  const {room,a}=duel();room.input(1,{yaw:0,pitch:0,forward:0,strafe:0,x:999,y:999,health:999},2000);
  assert.equal(a.x,10.5);assert.equal(a.health,100);
  room.input(1,{yaw:NaN,pitch:0,forward:1,strafe:0},2100);assert.equal(a.yaw,0);
});
test('the server owns damage, fire cadence, ammunition, kills, and respawn',()=>{
  const {room,a,b}=duel();
  for(const now of [2500,2700,2900,3100]) {
    room.input(1,{yaw:0,pitch:-.1,forward:0,strafe:0,fire:true},now);room.tick(now);
    if(now===2500){assert.equal(b.health,74);const ammo=a.ammo;room.tick(now+10);assert.equal(a.ammo,ammo);}
  }
  assert.equal(b.health,0);assert.equal(a.kills,1);assert.equal(b.deaths,1);assert.equal(a.ammo,MAGAZINE-4);
  room.tick(b.respawnAt);assert.equal(b.health,100);assert.ok(b.protectedUntil>3100);
});
test('cover blocks hits, headshots deal more damage, and protection ends when firing',()=>{
  const {room,a,b}=duel();
  Object.assign(a,{x:2.5,y:4.5,yaw:Math.PI/2,pitch:0});Object.assign(b,{x:6.5,y:4.5});
  assert.equal(W.trace(a,room.players.values()).target,null);
  Object.assign(a,{x:10.5,y:10.5,yaw:0,pitch:0,protectedUntil:5000});Object.assign(b,{x:10.5,y:7.5});
  room.input(1,{yaw:0,pitch:0,forward:0,strafe:0,fire:true},2500);room.tick(2500);
  assert.equal(b.health,52);assert.equal(a.protectedUntil,0);
});
test('reload blocks shooting until the server timer ends and stale movement stops',()=>{
  const {room,a}=duel();a.ammo=3;
  room.input(1,{yaw:0,pitch:0,forward:0,strafe:0,reload:true,fire:true},2500);room.tick(2500);
  assert.equal(a.ammo,3);assert.equal(a.reloadUntil,2500+RELOAD_MS);
  room.input(1,{yaw:0,pitch:0,forward:0,strafe:0},4000);room.tick(4000);assert.equal(a.ammo,MAGAZINE);
  room.input(1,{yaw:0,pitch:0,forward:1,strafe:0},4100);room.tick(4500);assert.equal(a.y,10.5);
});
test('rooms contain only joined humans, host transfers, and matches reset on the server',()=>{
  const room=new Arena('test','Test',1,1000);room.add(1,'Alice',1000);
  room.tick(2000);assert.equal(room.players.size,1);
  for(let i=2;i<=5;i++)room.add(i,'Player '+i,2000);
  room.tick(3000);assert.equal(room.players.size,5);
  assert.deepEqual([...room.players.keys()],[1,2,3,4,5]);
  room.remove(1);assert.equal(room.hostId,2);
  room.players.get(2).kills=8;room.tick(1000+MATCH_MS);assert.equal(room.winner,'Player 2');
  room.tick(1000+MATCH_MS+10000);assert.equal(room.finishedAt,0);assert.equal(room.players.get(2).kills,0);
});
test('every spawn is walkable and shots cannot leave the arena',()=>{
  for(const [x,y] of W.SPAWNS)assert.equal(W.free(x,y),true);
  for(let angle=0;angle<6.3;angle+=.2)assert.ok(W.rayWall(10.5,10.5,Math.sin(angle),-Math.cos(angle))<30);
});
