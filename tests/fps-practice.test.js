const test=require('node:test');
const assert=require('node:assert/strict');
const Practice=require('../underground/js/fps-practice');
test('local solo starts immediately with one player and never expires',()=>{
  const game=new Practice(1,'Solo','smile',1000);
  assert.equal(game.snapshot(1000).waiting,false);assert.equal(game.snapshot(1000).players.length,1);
  assert.equal(game.player.skin,'smile');assert.equal(game.player.x,10.5);
  game.tick({yaw:0,pitch:0,forward:1},.05,100000000);
  assert.ok(game.player.y<10.5);assert.equal(game.snapshot().finishedAt,0);
  assert.equal(game.snapshot().practice,true);assert.equal(game.snapshot().endsAt,0);
});
test('local solo permits shooting, reloading and climbing without sockets or other players',()=>{
  const game=new Practice(1,'Solo','classic',1000);
  game.tick({yaw:0,pitch:0,fire:true},.05,1000);assert.equal(game.player.ammo,23);assert.equal(game.events.length,1);
  game.tick({yaw:0,pitch:0,reload:true},.05,1200);assert.equal(game.player.reloadUntil,2700);
  game.tick({yaw:0,pitch:0},.05,2700);assert.equal(game.player.ammo,24);
  Object.assign(game.player,{x:11,y:9.5});
  for(let i=0;i<85;i++)game.tick({yaw:0,pitch:0,forward:1},.025,2800+i*25);
  assert.ok(game.player.height>2.9);assert.equal(game.snapshot().players.length,1);
});
