(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FpsWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CORE = [
    '11111111111111111111',
    '10000000000000000001',
    '10000000000000000001',
    '10022000000000220001',
    '10022000000000220001',
    '10000000330000000001',
    '10000000330000000001',
    '10000000000000000001',
    '10003300000033000001',
    '10003300000033000001',
    '10000000000000000001',
    '10000000000000000001',
    '10000002200000000001',
    '10000002200000000001',
    '10022000000000220001',
    '10022000000000220001',
    '10000000000000000001',
    '10000000000000000001',
    '10000000000000000001',
    '11111111111111111111'
  ];
  const SIZE=40;
  const MAP=Array.from({length:SIZE},(_,z)=>Array.from({length:SIZE},(_,x)=>{
    if(x===0||z===0||x===SIZE-1||z===SIZE-1)return '1';
    if(x<19&&z<19)return CORE[z][x];
    if(((x>=27&&x<=29)&&(z>=4&&z<=12))||((x>=5&&x<=14)&&(z>=29&&z<=30)))return '2';
    if(((x>=31&&x<=33)&&(z>=31&&z<=34))||((x>=23&&x<=25)&&(z>=32&&z<=34)))return '3';
    return '0';
  }).join(''));
  const SPAWNS = [[2.5,2.5],[17.5,17.5],[17.5,2.5],[2.5,17.5],[10.5,2.5],[10.5,17.5],[2.5,10.5],[17.5,10.5],[5,2,3],[15,18,3],[2,11,3],[18,11,3],[36.5,3.5],[36.5,36.5],[3.5,36.5],[22,18],[32,27.5,3],[36,14,3]];
  const SPEED = 3.6, SPRINT = 5.2, RADIUS = 0.24, BODY_HEIGHT=1.8, UPPER=3;
  // Shared geometry: rendering, movement and bullets use these same surfaces.
  const PLATFORMS=[{x0:22,x1:38,z0:26,z1:29},{x0:35,x1:38,z0:8,z1:26},{x0:22,x1:38,z0:6,z1:8},{x0:1,x1:19,z0:1,z1:3},{x0:1,x1:19,z0:17,z1:19},{x0:1,x1:3,z0:3,z1:17},{x0:17,x1:19,z0:3,z1:17}];
  const RAMPS=[{x0:24,x1:26,z0:20,z1:26,slope:.5,intercept:-10},{x0:22,x1:24,z0:8,z1:14,slope:-.5,intercept:7},{x0:10,x1:12,z0:3,z1:9,slope:-.5,intercept:4.5},{x0:10,x1:12,z0:11,z1:17,slope:.5,intercept:-5.5}];
  const RAILS=[
    {x0:3,x1:9.9,z0:2.94,z1:3.04},{x0:12.1,x1:17,z0:2.94,z1:3.04},
    {x0:3,x1:9.9,z0:16.96,z1:17.06},{x0:12.1,x1:17,z0:16.96,z1:17.06},
    {x0:2.94,x1:3.04,z0:3,z1:17},{x0:16.96,x1:17.06,z0:3,z1:17}
  ].map(r=>({...r,y0:3.8,y1:3.92}));
  const within=(x,z,r)=>x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1;
  const wallHeight=(x,z)=>MAP[Math.floor(z)]?.[Math.floor(x)]==='1'?6.8:2.25;
  const wall = (x, y) => MAP[Math.floor(y)]?.[Math.floor(x)] !== '0';
  const solidCells=[];
  for(let z=0;z<SIZE;z++)for(let x=0;x<SIZE;x++)if(wall(x,z))solidCells.push([x,z,wallHeight(x,z)]);
  function floorHeight(x,z,limit=Infinity){
    let height=0;
    for(const p of PLATFORMS)if(within(x,z,p)&&UPPER<=limit+.001)height=UPPER;
    for(const r of RAMPS)if(within(x,z,r)){const h=r.slope*z+r.intercept;if(h<=limit+.001)height=Math.max(height,h);}
    if(wall(x,z)&&wallHeight(x,z)<=limit+.001)height=Math.max(height,wallHeight(x,z));
    return height;
  }
  function free(x, y, height=0) {
    for(const [a,b] of [[x-RADIUS,y-RADIUS],[x+RADIUS,y-RADIUS],[x-RADIUS,y+RADIUS],[x+RADIUS,y+RADIUS]]){
      if(a<1||a>=SIZE-1||b<1||b>=SIZE-1)return false;
      if(wall(a,b)&&height<wallHeight(a,b)-.02)return false;
      if(PLATFORMS.some(p=>within(a,b,p)&&height<UPPER-.19&&height+BODY_HEIGHT>UPPER-.22))return false;
      if(RAMPS.some(r=>within(a,b,r)&&height+.19<r.slope*b+r.intercept))return false;
      if(RAILS.some(r=>within(a,b,r)&&height<r.y1&&height+BODY_HEIGHT>r.y0))return false;
    }
    return true;
  }
  function move(player, input, dt) {
    let forward = Math.max(-1, Math.min(1, Number(input.forward) || 0));
    let strafe = Math.max(-1, Math.min(1, Number(input.strafe) || 0));
    const length = Math.max(1, Math.hypot(forward, strafe));
    const speed = (input.sprint ? SPRINT : SPEED) * dt / length;
    const dx = (Math.sin(player.yaw)*forward + Math.cos(player.yaw)*strafe)*speed;
    const dy = (-Math.cos(player.yaw)*forward + Math.sin(player.yaw)*strafe)*speed;
    // Substeps prevent crossing thin obstacles even after a slow frame.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx,dy)/0.1));
    for (let i=0;i<steps;i++) {
      const advance=(x,y)=>{
        const h=player.height||0,next=floorHeight(x,y,h+.18);
        const grounded=player.grounded!==false&&(player.velocity||0)<=0;
        const feet=grounded&&Math.abs(next-h)<=.18?next:h;
        if(!free(x,y,feet))return;
        player.x=x;player.y=y;player.height=feet;
      };
      advance(player.x+dx/steps,player.y);advance(player.x,player.y+dy/steps);
    }
  }
  function step(player,input,dt){
    const frames=Math.max(1,Math.ceil(dt/.025)),slice=dt/frames;
    for(let i=0;i<frames;i++){
      move(player,input,slice);
      let h=player.height||0,v=player.velocity||0;
      const floor=floorHeight(player.x,player.y,h+.03);
      const grounded=h<=floor+.03&&v<=0;
      if(grounded){h=floor;v=0;if(input.jump){v=4.1;player.grounded=false;}}
      if(!grounded||v>0){v-=12*slice;let next=h+v*slice;
        if(v>0)for(const p of PLATFORMS)if(within(player.x,player.y,p)&&h+BODY_HEIGHT<=UPPER-.22&&next+BODY_HEIGHT>UPPER-.22){next=UPPER-.22-BODY_HEIGHT;v=0;}
        if(next<=floor){next=floor;v=0;}
        h=next;
      }
      player.height=h;player.velocity=v;player.grounded=v===0&&Math.abs(h-floor)<.03;
    }
  }
  function rayWall(x,y,dx,dy,max=80) {
    if (wall(x,y)) return 0;
    let mx=Math.floor(x),my=Math.floor(y);
    const deltaX=Math.abs(1/dx),deltaY=Math.abs(1/dy);
    const stepX=dx<0?-1:1,stepY=dy<0?-1:1;
    let sideX=(dx<0?x-mx:mx+1-x)*deltaX,sideY=(dy<0?y-my:my+1-y)*deltaY;
    for(let i=0;i<100;i++) {
      let distance;
      if(sideX<sideY){distance=sideX;sideX+=deltaX;mx+=stepX;}
      else{distance=sideY;sideY+=deltaY;my+=stepY;}
      if(distance>max)return max;
      if(wall(mx,my))return distance;
    }
    return max;
  }
  function trace(shooter, players) {
    const dx=Math.sin(shooter.yaw),dy=-Math.cos(shooter.yaw);
    const horizontal=Math.cos(shooter.pitch),vertical=Math.sin(shooter.pitch);
    const origin=[shooter.x,1.55+(shooter.height||0),shooter.y],direction=[dx*horizontal,vertical,dy*horizontal];
    const worldHit=rayWorld(origin,direction,80,true);
    let distance=worldHit.distance;
    let target=null,headshot=false;
    for(const player of players) {
      if(player.id===shooter.id || player.health<=0)continue;
      const rx=player.x-shooter.x,ry=player.y-shooter.y;
      const along=rx*dx+ry*dy,perp=Math.abs(rx*dy-ry*dx);
      if(along<=0 || perp>0.3)continue;
      const hit=(along-Math.sqrt(0.3**2-perp**2))/horizontal;
      const height=1.55+(shooter.height||0)+vertical*hit-(player.height||0);
      if(hit<distance && height>=0.15 && height<=1.85) {
        target=player;distance=hit;headshot=height>1.35;
      }
    }
    return { target,distance,headshot,normal:worldHit.normal,hitWorld:!target&&worldHit.distance<79.999,hitPlayer:Boolean(target),end:{x:shooter.x+dx*horizontal*distance,y:1.55+(shooter.height||0)+vertical*distance,z:shooter.y+dy*horizontal*distance} };
  }
  function rayWorld(origin,direction,max=80,details=false){
    let distance=max,normal=direction.map(v=>-v);
    const clip=planes=>{
      let near=0,far=distance,entryNormal=normal;
      for(const [nx,ny,nz,bound] of planes){
        const at=nx*origin[0]+ny*origin[1]+nz*origin[2]-bound;
        const rate=nx*direction[0]+ny*direction[1]+nz*direction[2];
        if(Math.abs(rate)<1e-9){if(at>1e-7)return;continue;}
        const t=-at/rate;if(rate<0){if(t>=near){near=t;const n=Math.hypot(nx,ny,nz);entryNormal=[nx/n,ny/n,nz/n];}}else far=Math.min(far,t);
        if(near>far)return;
      }
      if(far>=0&&near<distance){distance=near;normal=entryNormal;}
    };
    const box=(x0,x1,y0,y1,z0,z1)=>clip([[1,0,0,x1],[-1,0,0,-x0],[0,1,0,y1],[0,-1,0,-y0],[0,0,1,z1],[0,0,-1,-z0]]);
    for(const [x,z,height] of solidCells)box(x,x+1,0,height,z,z+1);
    for(const p of PLATFORMS)box(p.x0,p.x1,UPPER-.22,UPPER,p.z0,p.z1);
    for(const r of RAILS)box(r.x0,r.x1,r.y0,r.y1,r.z0,r.z1);
    for(const r of RAMPS)clip([[1,0,0,r.x1],[-1,0,0,-r.x0],[0,-1,0,0],[0,1,-r.slope,r.intercept],[0,0,1,r.z1],[0,0,-1,-r.z0]]);
    if(direction[1]<0&&-origin[1]/direction[1]<distance){distance=-origin[1]/direction[1];normal=[0,1,0];}
    return details?{distance,normal}:distance;
  }
  return { SIZE,MAP,SPAWNS,SPEED,SPRINT,RADIUS,BODY_HEIGHT,UPPER,PLATFORMS,RAMPS,RAILS,wallHeight,floorHeight,wall,free,move,step,rayWall,rayWorld,trace };
});
