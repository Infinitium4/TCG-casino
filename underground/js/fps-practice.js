(function(root,factory){
  const World=typeof module==='object'&&module.exports?require('./fps-shared'):root.FpsWorld;
  const Loot=typeof module==='object'&&module.exports?require('./fps-loot'):root.FpsLoot;
  const Practice=factory(World,Loot);
  if(typeof module==='object'&&module.exports)module.exports=Practice;else root.FpsPractice=Practice;
})(globalThis,(W,Loot)=>class FpsPractice{
  constructor(id,name,skin,now=Date.now()){
    this.id='local-practice';this.hostId=id;this.name='Entraînement solo';this.waiting=false;this.practice=true;
    this.events=[];this.eventId=0;
    this.loot=new Loot();
    this.player={id,name,skin,x:10.5,y:10.5,yaw:0,pitch:0,height:0,velocity:0,grounded:true,health:100,ammo:24,grenades:0,kills:0,deaths:0,reloadUntil:0,protectedUntil:0,lastShot:now-180};
  }
  tick(input,dt,now=Date.now()){
    const p=this.player;
    p.input=input;
    this.loot.update([p],now,dt,(type,data)=>{this.events.push({id:++this.eventId,type,...data});if(this.events.length>30)this.events.shift();},()=>{});
    if([input.yaw,input.pitch].every(Number.isFinite)){p.yaw=input.yaw;p.pitch=input.pitch;}
    W.step(p,input,Math.max(0,Math.min(.05,dt)));
    if(p.reloadUntil&&now>=p.reloadUntil){p.ammo=24;p.reloadUntil=0;}
    if((input.reload||p.ammo===0)&&!p.reloadUntil&&p.ammo<24)p.reloadUntil=now+1500;
    if(input.fire&&!p.reloadUntil&&p.ammo>0&&now-p.lastShot>=180){
      p.ammo--;p.lastShot=now;const hit=W.trace(p,[]);
      this.events.push({id:++this.eventId,type:'shot',playerId:p.id,x:p.x,y:1.55+p.height,z:p.y,end:hit.end,normal:hit.normal,hitPlayer:hit.hitPlayer,hitWorld:hit.hitWorld});
      if(this.events.length>30)this.events.shift();
    }
  }
  snapshot(now=Date.now()){
    return {id:this.id,name:this.name,hostId:this.hostId,practice:true,waiting:false,serverNow:now,endsAt:0,finishedAt:0,winner:null,...this.loot.snapshot(),events:this.events,players:[{...this.player}]};
  }
});
