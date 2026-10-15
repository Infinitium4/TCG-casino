// Frozen pre-optimization ray algorithm: used only for equivalence tests and microbenchmarks.
const W=require('../../underground/js/fps-shared');
const {SIZE,PLATFORMS,RAILS,RAMPS,UPPER}=W;
const solidCells=[];
for(let z=0;z<SIZE;z++)for(let x=0;x<SIZE;x++)if(W.wall(x,z))solidCells.push([x,z,W.wallHeight(x,z)]);
  function referenceRayWorld(origin,direction,max=80,details=false){
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
module.exports=referenceRayWorld;
