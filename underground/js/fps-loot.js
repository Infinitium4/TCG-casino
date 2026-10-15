(function(root,factory){
  const World=typeof module==='object'&&module.exports?require('./fps-shared'):root.FpsWorld;
  const Loot=factory(World);if(typeof module==='object'&&module.exports)module.exports=Loot;else root.FpsLoot=Loot;
})(globalThis,W=>class FpsLoot{
  constructor(){
    this.chests=[[11,10,0],[6,6,0],[16,11,0],[5,2,3],[23,17,0],[34,17,0],[20,34,0],[36,27,3]].map(([x,z,height],id)=>({id,x,z,height,readyAt:0}));
    this.bombs=[];this.nextId=0;
  }
  update(players,now,dt,emit,blast){
    for(const p of players){
      const input=p.input||{};
      if(p.health>0&&input.interact&&!p.wasInteracting&&(p.grenades||0)<3){
        const chest=this.chests.find(c=>c.readyAt<=now&&Math.hypot(p.x-c.x,p.y-c.z)<1.9&&Math.abs((p.height||0)-c.height)<.8&&W.rayWorld([p.x,1+(p.height||0),p.y],[(c.x-p.x)/Math.max(.001,Math.hypot(p.x-c.x,p.y-c.z)),0,(c.z-p.y)/Math.max(.001,Math.hypot(p.x-c.x,p.y-c.z))])>=Math.hypot(p.x-c.x,p.y-c.z)-.2);
        if(chest){p.grenades=Math.min(3,(p.grenades||0)+2);chest.readyAt=now+20000;emit('loot',{playerId:p.id,chestId:chest.id});}
      }
      if(p.health>0&&input.grenade&&!p.wasThrowing&&(p.grenades||0)>0&&now-(p.lastGrenade||0)>=600){
        p.grenades--;p.lastGrenade=now;p.protectedUntil=0;
        this.bombs.push({id:++this.nextId,ownerId:p.id,x:p.x,y:1.45+(p.height||0),z:p.y,vx:Math.sin(p.yaw)*8,vy:3+Math.sin(p.pitch)*6,vz:-Math.cos(p.yaw)*8,explodeAt:now+2200});
      }
      p.wasInteracting=Boolean(input.interact);p.wasThrowing=Boolean(input.grenade);
    }
    for(const b of this.bombs){
      b.vy-=10*dt;
      for(const [axis,velocity] of [['x','vx'],['y','vy'],['z','vz']]){
        const delta=b[velocity]*dt;if(Math.abs(delta)<1e-7)continue;
        const dir=[0,0,0];dir[['x','y','z'].indexOf(axis)]=Math.sign(delta);
        const hit=W.rayWorld([b.x,b.y,b.z],dir,Math.abs(delta)+.07);
        if(hit<=Math.abs(delta)+.06){b[axis]+=Math.sign(delta)*Math.max(0,hit-.07);b[velocity]*=-.42;b.vx*=.88;b.vz*=.88;}
        else b[axis]+=delta;
      }
      if(now>=b.explodeAt){emit('explosion',{x:b.x,y:b.y,z:b.z});blast(b,now);}
    }
    this.bombs=this.bombs.filter(b=>b.explodeAt>now);
  }
  damage(b,p){
    const origin=[b.x,b.y,b.z],target=[p.x,(p.height||0)+.85,p.y];
    const d=Math.hypot(...target.map((v,i)=>v-origin[i]));if(d>=5)return 0;
    const direction=target.map((v,i)=>(v-origin[i])/Math.max(.001,d));
    if(W.rayWorld(origin,direction,d)<d-.15)return 0;
    return Math.round(110*(1-d/5));
  }
  snapshot(){return {chests:this.chests,bombs:this.bombs.map(({vx,vy,vz,...b})=>b)};}
});
