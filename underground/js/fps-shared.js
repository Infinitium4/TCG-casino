(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FpsWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MAP = [
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
  const SPAWNS = [[2.5,2.5],[17.5,17.5],[17.5,2.5],[2.5,17.5],[10.5,2.5],[10.5,17.5],[2.5,10.5],[17.5,10.5]];
  const SPEED = 3.6, SPRINT = 5.2, RADIUS = 0.24;
  const wall = (x, y) => MAP[Math.floor(y)]?.[Math.floor(x)] !== '0';
  function free(x, y) {
    return ![[x-RADIUS,y-RADIUS],[x+RADIUS,y-RADIUS],[x-RADIUS,y+RADIUS],[x+RADIUS,y+RADIUS]].some(([a,b]) => wall(a,b));
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
      if (free(player.x+dx/steps,player.y)) player.x+=dx/steps;
      if (free(player.x,player.y+dy/steps)) player.y+=dy/steps;
    }
  }
  function rayWall(x,y,dx,dy,max=40) {
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
    let distance=rayWall(shooter.x,shooter.y,dx,dy)/horizontal;
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
    return { target,distance,headshot, end:{x:shooter.x+dx*horizontal*distance,y:1.55+(shooter.height||0)+vertical*distance,z:shooter.y+dy*horizontal*distance} };
  }
  return { MAP,SPAWNS,SPEED,SPRINT,RADIUS,wall,free,move,rayWall,trace };
});
