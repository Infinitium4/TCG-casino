/* Local WebGL renderer: no CDN, engine download, or remote assets required. */
window.FpsRenderer = class FpsRenderer {
  constructor(canvas) {
    this.canvas=canvas;
    this.assets=typeof FpsAssets!=='undefined'?FpsAssets.library:null;
    const gl=this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});
    if(!gl)throw Error('WebGL n’est pas disponible. Active l’accélération graphique de ton navigateur.');
    const vertex=`attribute vec3 position;attribute vec3 normal;attribute vec3 color;attribute float glow;
      uniform mat4 matrix;uniform vec3 eye;varying vec3 tint;varying float fog;varying vec3 surfaceNormal;varying vec3 viewDirection;varying float emission;
      void main(){tint=color;surfaceNormal=normal;viewDirection=eye-position;emission=glow;
      fog=1.-exp(-length(position-eye)*.026);gl_Position=matrix*vec4(position,1.);}`;
    const fragment=`precision mediump float;varying vec3 tint;varying float fog;varying vec3 surfaceNormal;varying vec3 viewDirection;varying float emission;
      void main(){vec3 n=normalize(surfaceNormal),v=normalize(viewDirection),l=normalize(vec3(-.4,.9,.6));
      float diffuse=.30+.65*max(0.,dot(n,l))+.13*max(0.,dot(n,normalize(vec3(.6,.2,-.7))));
      float spec=pow(max(0.,dot(n,normalize(l+v))),36.)*.19;
      float rim=pow(1.-max(0.,dot(n,v)),3.)*.075;
      vec3 lit=tint*mix(diffuse,1.25,emission)+vec3(spec+rim)*(1.-emission);
      vec3 c=mix(lit,vec3(.045,.028,.022),fog);gl_FragColor=vec4(pow(c,vec3(.85)),1.);}`;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Initialisation graphique impossible.');return s;};
    const program=this.program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Initialisation graphique impossible.');
    gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
    this.matrix=gl.getUniformLocation(program,'matrix');this.eye=gl.getUniformLocation(program,'eye');
    this.locations=['position','normal','color','glow'].map(name=>gl.getAttribLocation(program,name));
    this.staticBuffer=gl.createBuffer();this.dynamicBuffer=gl.createBuffer();
    const geometry=[];this.buildArena(geometry);
    this.staticCount=geometry.length/10;gl.bindBuffer(gl.ARRAY_BUFFER,this.staticBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geometry),gl.STATIC_DRAW);
    this.reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.vfx=canvas.id==='arena'?new FpsVfx(gl):null;
  }
  box(out,x,y,z,sx,sy,sz,color,yaw=0,pitch=0,glow=0) {
    const faces=[[[1,0,0],[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],[[-1,0,0],[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
      [[0,1,0],[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],[[0,-1,0],[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
      [[0,0,1],[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],[[0,0,-1],[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]];
    const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const rotate=(a,b,d)=>{const e=b*cp-d*sp,f=b*sp+d*cp;return[a*c-f*s,e,a*s+f*c];};
    for(const [normal,points] of faces) {
      const n=rotate(...normal);
      for(const index of [0,1,2,0,2,3]) {
        const p=points[index],r=rotate(p[0]*sx/2,p[1]*sy/2,p[2]*sz/2);
        out.push(x+r[0],y+r[1],z+r[2],...n,...color,glow);
      }
    }
  }
  buildArena(out) {
    const box=(...args)=>this.box(out,...args);
    box(20,-.15,20,42,.3,42,[.085,.065,.05]);
    for(let i=0;i<=40;i+=2) {
      box(i,.006,20,.014,.008,40,[.22,.17,.11]);box(20,.006,i,40,.008,.014,[.22,.17,.11]);
    }
    if(this.assets){
      for(let x=2;x<40;x+=2)for(let z=2;z<40;z+=2)this.assets.append(out,(x+z)%8===0?'floor-panel':'floor',[x,-.288,z],[2,1,2]);
      for(let i=2;i<40;i+=2)for(const h of [0,3.4])for(const [x,z,yaw] of [[i,.856,0],[i,39.144,Math.PI],[.856,i,-Math.PI/2],[39.144,i,Math.PI/2]])this.assets.append(out,i%6===0?'wall-window':'wall',[x,h,z],[2,3.4,1],yaw);
      for(const [x,z,yaw] of [[8,1.03,0],[20,1.03,0],[32,1.03,0],[39,12,Math.PI/2],[39,32,Math.PI/2]]){
        this.assets.append(out,'display-wall',[x,1.6,z],[1.5,1.5,.8],yaw);
        this.assets.append(out,'pipe',[x,4.2,z],[1,4,1],yaw);
      }
    }
    for(let y=0;y<FpsWorld.MAP.length;y++)for(let x=0;x<FpsWorld.MAP[y].length;x++) {
      const cell=Number(FpsWorld.MAP[y][x]);if(!cell)continue;
      const outer=cell===1,height=FpsWorld.wallHeight(x,y);
      const color=cell===2?[.25,.18,.12]:cell===3?[.32,.105,.09]:[.10,.075,.065];
      if(outer||!this.assets)box(x+.5,height/2,y+.5,1,height,1,color);
      else box(x+.5,(height-.08)/2,y+.5,.86,height-.08,.86,[.06,.055,.05]);
      if(!outer&&this.assets)for(const level of [0,.75,1.5])this.assets.append(out,cell===2?'container-wide':'container',[x+.5,level,y+.5],[1.6,1.05,1.6],(x+y)%2?Math.PI/2:0);
      box(x+.5,height+.025,y+.5,1.01,.05,1.01,cell===3?[.72,.19,.12]:[.72,.52,.23],0,0,1);
      if(!outer) {
        box(x+.5,.28,y+.5,1.035,.12,1.035,[.055,.085,.11]);
        box(x+.5,1.72,y+.5,1.02,.07,1.02,[.22,.28,.3]);
        box(x+.5,.065,y+.5,1.04,.03,1.04,[.55,.36,.15],0,0,.7);
      } else if((x+y)%3===0)box(x+.5,1.5,y+.5,1.012,.025,1.012,[.55,.28,.14],0,0,1);
    }
    // Overhead structural beams and suspended strips establish the industrial skyline.
    for(const x of [1.5,10,20,30,38.5]) {
      box(x,6.6,20,.12,.16,39,[.09,.14,.2]);
      box(x,6.5,20,.07,.03,35,[.85,.66,.33],0,0,1);
    }
    for(const y of [1.5,20,38.5])box(20,6.6,y,39,.16,.12,[.09,.14,.2]);
    for(const p of FpsWorld.PLATFORMS){
      box((p.x0+p.x1)/2,2.89,(p.z0+p.z1)/2,p.x1-p.x0,.22,p.z1-p.z0,[.20,.17,.13]);
      for(let x=p.x0+.5;x<p.x1;x++)for(let z=p.z0+.5;z<p.z1;z++){
        if(this.assets)this.assets.append(out,'floor-panel',[x,2.708,z],[.98,1,.98]);else box(x,3.008,z,.96,.012,.96,[.26,.23,.18]);
        box(x,2.77,z,.12,.025,.65,[.68,.48,.23],0,0,.5);
      }
    }
    for(const r of FpsWorld.RAILS){
      box((r.x0+r.x1)/2,(r.y0+r.y1)/2,(r.z0+r.z1)/2,r.x1-r.x0,r.y1-r.y0,r.z1-r.z0,[.73,.54,.28],0,0,.4);
      const length=Math.max(r.x1-r.x0,r.z1-r.z0);
      for(let i=0;i<=Math.ceil(length/1.5);i++){
        const t=i/Math.ceil(length/1.5);box(r.x0+(r.x1-r.x0)*t,3.4,r.z0+(r.z1-r.z0)*t,.07,.8,.07,[.17,.14,.11]);
      }
    }
    for(const r of FpsWorld.RAMPS){
      const a=[r.x0,r.slope*r.z0+r.intercept,r.z0],b=[r.x1,a[1],r.z0];
      const c=[r.x1,r.slope*r.z1+r.intercept,r.z1],d=[r.x0,c[1],r.z1];
      const lowA=[r.x0,0,r.z0],lowB=[r.x1,0,r.z0],lowC=[r.x1,0,r.z1],lowD=[r.x0,0,r.z1];
      for(const face of [[a,d,c,b],[lowA,a,b,lowB],[lowD,lowC,c,d],[lowA,lowD,d,a],[lowB,b,c,lowC]]){
        this.triangle(out,face[0],face[1],face[2],[.28,.23,.17]);this.triangle(out,face[0],face[2],face[3],[.28,.23,.17]);
      }
      for(let z=r.z0+.15;z<r.z1;z+=.35)box((r.x0+r.x1)/2,r.slope*z+r.intercept+.015,z,r.x1-r.x0,.018,.035,[.74,.54,.25],0,Math.atan(r.slope),.4);
    }
    // Spawn pads and directional lane markings.
    for(const [x,z,h=0] of FpsWorld.SPAWNS) {
      box(x,h+.014,z,.9,.015,.9,[.22,.15,.09]);
      for(const dx of [-.48,.48])box(x+dx,h+.024,z,.025,.012,.95,[.8,.62,.3],0,0,1);
      for(const dz of [-.48,.48])box(x,h+.024,z+dz,.95,.012,.025,[.8,.62,.3],0,0,1);
    }
    for(let z=5;z<15;z+=.7)box(10,.018,z,.055,.01,.3,[.65,.38,.12],0,0,.35);
  }
  triangle(out,a,b,c,color,glow=0){
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);if(length<1e-9)return;
    for(const p of [a,b,c])out.push(...p,...normal.map(n=>n/length),...color,glow);
  }
  ellipsoid(out,x,y,z,rx,ry,rz,color,yaw=0,glow=0){
    const small=Math.max(rx,ry,rz)<.04,rings=small?4:10,sides=small?8:18,ca=Math.cos(yaw),sa=Math.sin(yaw);
    const point=(i,j)=>{const p=Math.PI*i/rings,t=2*Math.PI*j/sides,px=rx*Math.sin(p)*Math.cos(t),pz=rz*Math.sin(p)*Math.sin(t);return [x+px*ca-pz*sa,y+ry*Math.cos(p),z+px*sa+pz*ca];};
    for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){
      const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
      for(const p of [a,c,b,a,d,c]){
        const dx=p[0]-x,dy=p[1]-y,dz=p[2]-z;
        const nx=(dx*ca+dz*sa)/(rx*rx),ny=dy/(ry*ry),nz=(-dx*sa+dz*ca)/(rz*rz);
        const normal=[nx*ca-nz*sa,ny,nx*sa+nz*ca],length=Math.hypot(...normal)||1;
        out.push(...p,...normal.map(n=>n/length),...color,glow);
      }
    }
  }
  cylinder(out,x,y,z,radius,length,color,yaw=0,pitch=0){
    const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const point=(a,b,d)=>{const e=b*cp-d*sp,f=b*sp+d*cp;return[x+a*c-f*s,y+e,z+a*s+f*c];};
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
      const p=point(Math.cos(a)*radius,Math.sin(a)*radius,-length/2),q=point(Math.cos(b)*radius,Math.sin(b)*radius,-length/2);
      const r=point(Math.cos(b)*radius,Math.sin(b)*radius,length/2),t=point(Math.cos(a)*radius,Math.sin(a)*radius,length/2);
      this.triangle(out,p,r,q,color);this.triangle(out,p,t,r,color);
      this.triangle(out,point(0,0,-length/2),p,q,color);this.triangle(out,point(0,0,length/2),r,t,color);
    }
  }
  rifle(out,origin,yaw,pitch,skin,scale=1,reload=0){
    if(this.assets){
      this.assets.append(out,'blaster-f',origin,scale*.7,yaw,pitch,skin);
      if(reload>.05)this.assets.append(out,'clip-large',[origin[0],origin[1]-.15-reload*.14,origin[2]],scale*.7,yaw,pitch,skin);
      return;
    }
    const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const point=(x,y,z)=>{x*=scale;y*=scale;z*=scale;const b=y*cp-z*sp,d=y*sp+z*cp;return[origin[0]+x*c-d*s,origin[1]+b,origin[2]+x*s+d*c];};
    const box=(x,y,z,w,h,d,color,tilt=0)=>this.box(out,...point(x,y,z),w*scale,h*scale,d*scale,color,yaw,pitch+tilt);
    const tube=(x,y,z,r,l,color)=>this.cylinder(out,...point(x,y,z),r*scale,l*scale,color,yaw,pitch);
    const metal=[.105,.115,.12],edge=[.24,.25,.25],polymer=[.055,.06,.065],accent=skin.body.map(v=>v*.45+.025);
    box(0,0,0,.095,.11,.30,metal);box(0,-.052,.04,.09,.045,.20,polymer);
    box(.05,.012,-.015,.012,.045,.085,edge);box(.058,.012,-.018,.013,.026,.065,polymer);
    box(-.05,.015,.02,.018,.02,.04,edge);box(-.062,.015,.02,.012,.02,.012,polymer);
    box(0,.015,-.24,.095,.105,.25,accent);tube(0,.01,-.40,.019,.15,metal);
    tube(0,.01,-.495,.026,.065,edge);tube(0,.01,-.53,.014,.005,[.008,.009,.01]);
    for(let i=0;i<6;i++){
      box(0,.077,-.31+i*.065,.10,.014,.025,edge);
      for(const side of [-1,1])box(side*.049,.012,-.32+i*.028,.008,.018,.018,polymer);
    }
    box(0,-.15-reload*.2,-.035,.062,.18,.10,polymer,-.12);box(0,-.235-reload*.2,-.025,.066,.018,.11,edge,-.12);
    for(let i=0;i<3;i++)box(.034,-.14,-.06+i*.027,.006,.11,.006,edge,-.12);
    box(0,-.14,.105,.065,.15,.065,accent,.27);
    box(-.04,-.095,.065,.012,.08,.09,metal);box(.04,-.095,.065,.012,.08,.09,metal);box(0,-.132,.065,.08,.012,.09,metal);
    box(0,-.085,.06,.012,.05,.012,edge,.25);
    tube(0,.007,.21,.023,.16,metal);box(0,-.018,.28,.075,.10,.15,accent);
    box(0,-.02,.365,.085,.13,.035,polymer);box(0,.045,.25,.075,.025,.17,polymer);
    box(0,.11,.005,.065,.055,.095,polymer);tube(0,.14,-.005,.04,.12,metal);tube(0,.14,-.068,.031,.006,[.08,.19,.18]);
    box(0,.115,-.30,.018,.065,.025,polymer);box(0,.145,-.30,.045,.015,.025,edge);
    for(const z of [-.11,.09])tube(.051,.005,z,.008,.007,edge);
  }
  character(out,p,skin,time=0,showcase=false){
    this.characterCache ||= new Map();
    const pose=p.moving&&!showcase?'soldier-run-'+Math.floor(time/80)%8:'soldier-idle',key=skin.id+pose;
    if(!this.characterCache.has(key)){
      const vertices=[];
      if(this.assets&&skin.style!=='portrait'){
        this.assets.append(vertices,pose,[0,0,0],1,0,0,skin);
        const mount=this.assets.meshes.get(pose).mount;
        if(mount){const d=mount.forward;this.rifle(vertices,mount.point.map((v,i)=>v+d[i]*.12),Math.atan2(d[0],-d[2]),Math.asin(d[1]),skin,.75);}
        if(skin.style==='sentinel')this.box(vertices,0,1.69,0,.24,.035,.25,skin.trim);
        if(skin.style==='ranger')this.box(vertices,.19,1.66,.06,.012,.26,.015,skin.trim);
        if(skin.style==='phantom')this.box(vertices,0,.94,.18,.34,.55,.025,skin.body);
        if(skin.style==='ace')for(const side of [-1,1])this.box(vertices,side*.28,1.37,0,.13,.025,.18,skin.trim);
      }else this.characterModel(vertices,{x:0,y:0,yaw:0,height:0,health:100,protectedUntil:0},skin,0,false);
      this.characterCache.set(key,new Float32Array(vertices));
    }
    const vertices=this.characterCache.get(key),c=Math.cos(p.yaw),s=Math.sin(p.yaw),h=p.height||0;
    for(let i=0;i<vertices.length;i+=10){
      const x=vertices[i],z=vertices[i+2],nx=vertices[i+3],nz=vertices[i+5];
      out.push(p.x+x*c-z*s,h+vertices[i+1],p.y+x*s+z*c,nx*c-nz*s,vertices[i+4],nx*s+nz*c,vertices[i+6],vertices[i+7],vertices[i+8],vertices[i+9]);
    }
    if(showcase)this.ellipsoid(out,p.x,h+.015,p.y,.39,.015,.25,[.035,.025,.018],p.yaw);
    if(p.protectedUntil>Date.now())this.box(out,p.x,h+.03,p.y,.8,.035,.8,skin.trim,p.yaw,0,.5);
  }
  characterModel(out,p,skin,time=0,showcase=false){
    const a=p.yaw,h=p.height||0,c=Math.cos(a),s=Math.sin(a),tint=skin.body.map(v=>v*.62+.025),trim=skin.trim.map(v=>v*.7),dark=[.045,.05,.055];
    const point=(x,y,z)=>[p.x+x*c-z*s,h+y,p.y+x*s+z*c];
    const oval=(x,y,z,rx,ry,rz,color,glow=0)=>this.ellipsoid(out,...point(x,y,z),rx,ry,rz,color,a,glow);
    const box=(x,y,z,sx,sy,sz,color,pitch=0,glow=0)=>this.box(out,...point(x,y,z),sx,sy,sz,color,a,pitch,glow);
    const panel=(outline,z,depth,color)=>{
      const front=outline.map(([x,y])=>point(x,y,z)),back=outline.map(([x,y])=>point(x,y,z+depth));
      for(let i=1;i<front.length-1;i++){this.triangle(out,front[0],front[i+1],front[i],color);this.triangle(out,back[0],back[i],back[i+1],color);}
      for(let i=0;i<front.length;i++){const j=(i+1)%front.length;this.triangle(out,front[i],front[j],back[j],color);this.triangle(out,front[i],back[j],back[i],color);}
    };
    const portrait=skin.style==='portrait',phantom=skin.style==='phantom';
    const breath=this.reduced?0:Math.sin(time*.0018)*.008;
    oval(0,.7,0,.20,.13,.145,dark);oval(0,1.03+breath,0,.245,.29,.155,tint);
    // Shaped chest plate, under-suit, belt and individual utility pouches.
    panel([[-.23,1.24],[-.13,1.30],[.13,1.30],[.23,1.24],[.18,.94],[.10,.87],[-.10,.87],[-.18,.94]],-.155,.055,portrait?tint:dark);
    if(!portrait){
      panel([[-.20,1.22],[-.09,1.25],[-.025,1.15],[-.035,.99],[-.15,.97]],-.215,.04,tint);
      panel([[.20,1.22],[.09,1.25],[.025,1.15],[.035,.99],[.15,.97]],-.215,.04,tint);
      box(0,1.17,-.225,.025,.14,.016,trim,0,.45);
      for(const side of [-1,1])for(let i=0;i<3;i++)box(side*.12,1.12-i*.045,-.26,.095,.012,.014,trim);
    }else{box(0,1.03,-.18,.008,.45,.012,[.25,.27,.29]);box(0,.86,-.17,.26,.075,.03,dark);}
    box(0,.75,-.165,.40,.045,.04,trim);
    for(const side of [-1,1]){
      oval(side*.145,.46,0,.105,.25,.11,dark);oval(side*.145,.21,.015,.09,.18,.10,tint);
      oval(side*.145,.095,-.045,.115,.095,.18,dark);
      oval(side*.145,.40,-.092,.075,.075,.04,portrait?dark:tint);
      if(!portrait)box(side*.145,.41,-.135,.055,.035,.015,trim);
      oval(side*.30,1.21+breath,0,.105,.105,.145,portrait?tint:dark);
      if(!portrait)box(side*.305,1.25,0,.16,.075,.25,tint);
      const shoulder=point(side*.30,1.19,0),elbow=point(side*.28,.96,-.12),hand=point(side<0?-.015:.13,side<0?.88:.79,side<0?-.51:-.19);
      for(const [start,end,r,color] of [[shoulder,elbow,.073,tint],[elbow,hand,.062,dark]]){
        const dx=end[0]-start[0],dy=end[1]-start[1],dz=end[2]-start[2],length=Math.hypot(dx,dy,dz);
        this.cylinder(out,(start[0]+end[0])/2,(start[1]+end[1])/2,(start[2]+end[2])/2,r,length,color,Math.atan2(-dx,dz),Math.asin(-dy/length));
        this.ellipsoid(out,...start,r,r,r,color);
      }
      this.ellipsoid(out,...hand,.065,.052,.08,dark,a);
      for(let i=0;i<4;i++)box((side<0?-.04:.10)+i*.019,side<0?.87:.78,side<0?-.565:-.23,.014,.03,.035,portrait?[.56,.39,.30]:dark);
      box(side*.15,.71,-.17,.1,.13,.07,dark);
    }
    // Fabric seams, tactical webbing and stitched boot soles give the suit scale.
    for(const side of [-1,1]){
      box(side*.16,1.13,-.19,.023,.28,.017,dark);
      box(side*.145,.055,-.045,.20,.025,.29,[.025,.027,.03]);
      for(let i=0;i<3;i++)box(side*.145,.14+i*.025,-.095,.10,.008,.012,[.12,.12,.11]);
      if(!portrait){box(side*.15,.85,-.17,.09,.12,.05,tint);box(side*.15,.88,-.20,.055,.015,.012,dark);}
    }
    if(portrait){
      const face=[.76,.55,.43],hair=[.20,.135,.085],frame=[.025,.029,.03];
      oval(0,1.29,.015,.13,.13,.13,tint);oval(0,1.47,.09,.23,.22,.16,tint);
      oval(0,1.54,-.015,.18,.225,.16,face);
      for(const side of [-1,1]){
        oval(side*.178,1.54,-.015,.035,.065,.035,face);
        oval(side*.076,1.56,-.158,.042,.015,.012,[.88,.85,.76]);
        oval(side*.076,1.56,-.171,.014,.014,.008,[.16,.20,.15]);
        // Black spectacle rims, bridge and temples; no opaque lens over the eyes.
        const rimPoint=(i,outer,back)=>{
          const t=i*Math.PI/12,c=Math.cos(t),s=Math.sin(t),w=outer?.006:-.006;
          return point(side*.078+Math.sign(c)*Math.abs(c)**.68*(.071+w),1.56+Math.sign(s)*Math.abs(s)**.68*(.049+w),back?-.175:-.187);
        };
        for(let i=0;i<24;i++){
          for(const [u,v] of [[[true,false],[false,false]],[[false,true],[true,true]],[[true,true],[true,false]],[[false,false],[false,true]]]){
            const a=rimPoint(i,...u),b=rimPoint(i+1,...u),c=rimPoint(i+1,...v),d=rimPoint(i,...v);
            this.triangle(out,a,b,c,frame);this.triangle(out,a,c,d,frame);
          }
        }
        box(side*.16,1.565,-.08,.014,.014,.18,frame);
        box(side*.075,1.615,-.15,.10,.014,.014,hair);
      }
      box(0,1.57,-.187,.035,.013,.018,frame);
      oval(0,1.51,-.171,.023,.045,.03,face);
      oval(0,1.43,-.156,.08,.037,.018,[.34,.11,.09]);
      oval(0,1.439,-.173,.065,.019,.009,[.98,.94,.81]);
      // Swept brown hair with a side part and warm highlights, inspired by the reference.
      oval(0,1.73,.015,.19,.09,.17,hair);
      for(let i=0;i<5;i++){
        const x=-.13+i*.055;oval(x,1.73-i*.009,-.11,.075,.045,.07,[.24+i*.012,.17+i*.008,.10+i*.006]);
      }
      oval(-.15,1.66,-.07,.055,.13,.10,hair);oval(.155,1.68,.01,.043,.11,.12,hair);
      oval(-.09,1.69,-.152,.07,.065,.026,[.29,.20,.12]);
      for(const side of [-1,1])box(side*.09,1.24,-.17,.012,.15,.012,[.80,.76,.65]);
    }else{
      oval(0,1.53,0,.175,.22,.165,dark);oval(0,1.65,.025,.18,.135,.17,tint);
      oval(0,1.575,-.145,.15,.038,.045,trim,.4);
      panel([[-.14,1.51],[-.075,1.46],[.075,1.46],[.14,1.51],[.11,1.40],[-.11,1.40]],-.175,.065,tint);
      for(const side of [-1,1])for(let i=0;i<3;i++)box(side*.055,1.465-i*.018,-.2,.05,.008,.015,dark);
      for(const side of [-1,1]){box(side*.18,1.52,0,.05,.16,.11,trim);box(side*.09,1.43,-.19,.03,.065,.02,dark);}
      if(skin.style==='vanguard'){
        for(const side of [-1,1]){box(side*.16,1.34,.03,.09,.10,.12,tint);box(side*.22,.79,.04,.10,.18,.09,dark);}
        box(.23,1.05,.13,.07,.30,.12,dark);
      }
      if(skin.style==='sentinel'){
        box(0,1.76,0,.04,.12,.27,trim);box(0,1.56,-.2,.022,.12,.025,dark);
        panel([[-.22,.91],[-.025,.87],[-.04,.48],[-.20,.52],[-.26,.70]],-.08,.14,tint);
        panel([[.22,.91],[.025,.87],[.04,.48],[.20,.52],[.26,.70]],-.08,.14,tint);
        for(const side of [-1,1])box(side*.21,.78,-.10,.018,.22,.02,trim);
      }
      if(skin.style==='ranger'){
        oval(0,1.67,.08,.205,.16,.19,tint);box(.19,1.76,.04,.012,.22,.015,trim);
        panel([[-.23,1.33],[.23,1.33],[.17,1.20],[0,1.11],[-.17,1.20]],-.21,.08,tint);
        for(let i=0;i<4;i++)box(-.17+i*.035,.88,-.20,.02,.09,.04,trim);
      }
      if(phantom){
        box(0,1.30,.12,.45,.12,.22,tint);
        panel([[-.24,1.31],[.24,1.31],[.31,.37],[.14,.44],[0,.34],[-.18,.43],[-.31,.37]],.17,.035,tint);
        for(const side of [-1,1])box(side*.22,1.28,-.11,.035,.075,.04,trim);
      }
      if(skin.style==='ace'){
        for(const side of [-1,1]){box(side*.12,1.76,0,.03,.17,.06,trim);box(side*.30,1.31,0,.14,.045,.21,trim);}
        panel([[-.2,1.26],[0,1.07],[-.08,.96],[-.22,1.13]],-.27,.025,trim);
        panel([[.2,1.26],[0,1.07],[.08,.96],[.22,1.13]],-.27,.025,trim);
      }
    }
    this.rifle(out,point(.12,.9,-.27),a,.12,skin,.72);
    if(showcase){oval(0,.015,0,.39,.015,.25,[.035,.025,.018]);}
    if(p.protectedUntil>Date.now())box(0,.03,0,.8,.035,.8,trim,0,.5);
  }
  bind(buffer) {
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    const sizes=[3,3,3,1],offsets=[0,12,24,36];
    this.locations.forEach((location,i)=>{gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,sizes[i],gl.FLOAT,false,40,offsets[i]);});
  }
  upload(out) {
    const gl=this.gl;if(!out.length)return;
    this.bind(this.dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(out),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,out.length/10);
  }
  viewMatrix(eye,yaw,pitch,aspect,zoom=1) {
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
    const r=[cy,0,sy],u=[-sy*sp,cp,cy*sp],f=[sy*cp,sp,-cy*cp];
    const dot=v=>v[0]*eye[0]+v[1]*eye[1]+v[2]*eye[2];
    const view=[r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-dot(r),-dot(u),dot(f),1];
    const scale=zoom/Math.tan(Math.PI/4.5),near=.035,far=110;
    const projection=[scale/aspect,0,0,0,0,scale,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    const result=new Float32Array(16);
    for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)result[c*4+row]+=projection[k*4+row]*view[c*4+k];
    return result;
  }
  static skinPreview(skin){
    try{
      this.previewCache ||= new Map();if(this.previewCache.has(skin.id))return this.previewCache.get(skin.id);
      this.previewRenderer ||= new this(document.createElement('canvas'));
      this.previewRenderer.draw({eye:[10,1,12.45],yaw:0,pitch:-.025,players:[{id:1,x:10,y:10,yaw:Math.PI+.22,health:100,skin:skin.id}],showcase:true,viewport:{width:320,height:360}});
      const url=this.previewRenderer.canvas.toDataURL('image/png');this.previewCache.set(skin.id,url);return url;
    }catch{return null;}
  }
  static arenaPreview(){
    try{
      this.previewRenderer ||= new this(document.createElement('canvas'));
      this.previewRenderer.draw({eye:[20,19,43],yaw:0,pitch:-.65,viewport:{width:640,height:300}});
      return this.previewRenderer.canvas.toDataURL('image/png');
    }catch{return null;}
  }
  draw({eye,yaw,pitch,players=[],me=null,time=0,effects=[],recoil=0,walking=false,showcase=false,viewport=null,chests=[],bombs=[],serverNow=Date.now(),aim=false}) {
    const gl=this.gl,canvas=this.canvas;
    const ratio=viewport?1:Math.min(window.devicePixelRatio||1,1.6);
    const width=Math.floor((viewport?.width||innerWidth)*ratio),height=Math.floor((viewport?.height||innerHeight)*ratio);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    const bob=walking&&!this.reduced?Math.sin(time*.012)*.018:0;
    const camera=[eye[0],eye[1]+bob,eye[2]];
    gl.clearColor(.045,.028,.022,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    const matrix=this.viewMatrix(camera,yaw,pitch+recoil*.025,width/height,aim?1.35:1);
    gl.uniformMatrix4fv(this.matrix,false,matrix);gl.uniform3fv(this.eye,camera);
    if(!showcase){this.bind(this.staticBuffer);gl.drawArrays(gl.TRIANGLES,0,this.staticCount);}
    const dynamic=[];
    if(showcase){
      const box=(...args)=>this.box(dynamic,...args);
      box(10,-.23,10,60,.3,60,[.055,.041,.035]);
      for(const x of [6,8,10,12,14]){
        box(x,2.2,6,1.92,5,.2,[.06,.045,.04]);
        box(x-.94,2.2,6.15,.025,5,.025,[.65,.41,.17],0,0,.55);
      }
      for(const p of players){
        box(p.x,-.045,p.y,1.05,.15,1.05,[.15,.11,.075],Math.PI/4);
        box(p.x,.035,p.y,1.08,.025,1.08,[.75,.53,.22],Math.PI/4,0,.8);
      }
    }
    for(const p of players) {
      if(p.id===me?.id||p.health<=0)continue;
      const skin=FpsSkins.find(s=>s.id===p.skin)||FpsSkins[0];
      this.character(dynamic,p,skin,time,showcase);
    }
    for(const chest of chests){
      const x=chest.x,z=chest.z,h=chest.height,opened=chest.readyAt>serverNow;
      if(this.assets){this.assets.append(dynamic,'crate-medium',[x,h,z],[1.45,1.5,.65]);this.box(dynamic,x,h+.35,z+.33,.12,.07,.02,opened?[.12,.16,.12]:[.9,.6,.2],0,0,opened?0:.6);continue;}
      this.box(dynamic,x,h+.26,z,.85,.5,.6,[.15,.18,.14]);
      this.box(dynamic,x,h+(opened?.65:.54),z+(opened?.18:0),.88,.12,.63,[.23,.27,.19],0,opened?-.85:0);
      for(const dx of [-.32,.32])this.box(dynamic,x+dx,h+.29,z,.055,.56,.63,[.09,.10,.09]);
      this.box(dynamic,x,h+.34,z+.31,.13,.12,.025,opened?[.20,.17,.12]:[.9,.60,.18],0,0,opened?0:.7);
      if(!opened)this.ellipsoid(dynamic,x,h+.75,z,.05,.05,.05,[.9,.65,.2],0,.6);
    }
    for(const bomb of bombs){
      if(this.assets){this.assets.append(dynamic,'grenade-a',[bomb.x,bomb.y-.10,bomb.z],.8);continue;}
      this.ellipsoid(dynamic,bomb.x,bomb.y,bomb.z,.085,.11,.085,[.19,.24,.12]);
      this.box(dynamic,bomb.x,bomb.y+.10,bomb.z,.035,.035,.06,[.38,.39,.33]);
    }
    this.upload(dynamic);
    if(this.vfx&&!showcase){this.vfx.draw(matrix,camera,effects,time,yaw,pitch,this.reduced);gl.useProgram(this.program);}
    if(me&&me.health>0) {
      const skin=FpsSkins.find(s=>s.id===me.skin)||FpsSkins[0];
      const gun=[],right=[Math.cos(yaw),0,Math.sin(yaw)],up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)],forward=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
      const point=(r,u,f)=>camera.map((n,i)=>n+right[i]*r+up[i]*u+forward[i]*f);
      const reload=me.reloadUntil>serverNow?Math.sin(Math.PI*(1-Math.min(1,(me.reloadUntil-serverNow)/1500))):0;
      const tilt=-reload*.55;
      const box=(r,u,f,w,h,d,color,glow=0)=>{const p=point(r,u+tilt*.15,f-recoil*.07);this.box(gun,...p,w,h,d,color,yaw,pitch+tilt,glow);};
      this.rifle(gun,point(aim?.015:.22,aim?-.12:-.25+bob,.44-recoil*.06),yaw,pitch+tilt,skin,.72,reload);
      // Sleeves, gloves and fingers follow the receiver and fore-end.
      for(const [r,u,f] of [[.29,-.34,.23],[.08,-.30,.60]]){
        const hand=point(r,u,f);this.ellipsoid(gun,...hand,.055,.05,.10,[.06,.065,.067],yaw);
        const cuff=point(r,u-.025,f-.10);this.ellipsoid(gun,...cuff,.07,.065,.13,skin.body.map(v=>v*.4+.02),yaw);
      }
      gl.clear(gl.DEPTH_BUFFER_BIT);this.upload(gun);
    }
  }
};
