/* Local WebGL renderer: no CDN, engine download, or remote assets required. */
window.FpsRenderer = class FpsRenderer {
  constructor(canvas) {
    this.canvas=canvas;
    const gl=this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});
    if(!gl)throw Error('WebGL n’est pas disponible. Active l’accélération graphique de ton navigateur.');
    const vertex=`attribute vec3 position;attribute vec3 normal;attribute vec3 color;attribute float glow;
      uniform mat4 matrix;uniform vec3 eye;varying vec3 tint;varying float fog;
      void main(){float light=.35+.65*max(0.,dot(normal,normalize(vec3(-.4,.9,.3))));
      tint=color*mix(light,1.3,glow);fog=1.-exp(-length(position-eye)*.026);gl_Position=matrix*vec4(position,1.);}`;
    const fragment=`precision mediump float;varying vec3 tint;varying float fog;
      void main(){vec3 c=mix(tint,vec3(.045,.028,.022),fog);gl_FragColor=vec4(pow(c,vec3(.85)),1.);}`;
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
    box(10,-.15,10,22,.3,22,[.085,.065,.05]);
    for(let i=0;i<=20;i+=2) {
      box(i,.006,10,.014,.008,20,[.22,.17,.11]);box(10,.006,i,20,.008,.014,[.22,.17,.11]);
    }
    for(let y=0;y<FpsWorld.MAP.length;y++)for(let x=0;x<FpsWorld.MAP[y].length;x++) {
      const cell=Number(FpsWorld.MAP[y][x]);if(!cell)continue;
      const outer=cell===1,height=outer?3.8:2.25;
      const color=cell===2?[.25,.18,.12]:cell===3?[.32,.105,.09]:[.10,.075,.065];
      box(x+.5,height/2,y+.5,1,height,1,color);
      box(x+.5,height+.025,y+.5,1.01,.05,1.01,cell===3?[.72,.19,.12]:[.72,.52,.23],0,0,1);
      if(!outer) {
        box(x+.5,.28,y+.5,1.035,.12,1.035,[.055,.085,.11]);
        box(x+.5,1.72,y+.5,1.02,.07,1.02,[.22,.28,.3]);
        box(x+.5,.065,y+.5,1.04,.03,1.04,[.55,.36,.15],0,0,.7);
      } else if((x+y)%3===0)box(x+.5,1.5,y+.5,1.012,.025,1.012,[.55,.28,.14],0,0,1);
    }
    // Overhead structural beams and suspended strips establish the industrial skyline.
    for(const x of [1.5,6,13.5,18.5]) {
      box(x,4.6,10,.12,.16,19,[.09,.14,.2]);
      box(x,4.5,10,.07,.03,15,[.85,.66,.33],0,0,1);
    }
    for(const y of [1.5,10,18.5])box(10,4.6,y,19,.16,.12,[.09,.14,.2]);
    // Spawn pads and directional lane markings.
    for(const [x,z] of FpsWorld.SPAWNS) {
      box(x,.014,z,.9,.015,.9,[.22,.15,.09]);
      for(const dx of [-.48,.48])box(x+dx,.024,z,.025,.012,.95,[.8,.62,.3],0,0,1);
      for(const dz of [-.48,.48])box(x,.024,z+dz,.95,.012,.025,[.8,.62,.3],0,0,1);
    }
    for(let z=5;z<15;z+=.7)box(10,.018,z,.055,.01,.3,[.65,.38,.12],0,0,.35);
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
  viewMatrix(eye,yaw,pitch,aspect) {
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
    const r=[cy,0,sy],u=[-sy*sp,cp,cy*sp],f=[sy*cp,sp,-cy*cp];
    const dot=v=>v[0]*eye[0]+v[1]*eye[1]+v[2]*eye[2];
    const view=[r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-dot(r),-dot(u),dot(f),1];
    const scale=1/Math.tan(Math.PI/4.5),near=.035,far=70;
    const projection=[scale/aspect,0,0,0,0,scale,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    const result=new Float32Array(16);
    for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)result[c*4+row]+=projection[k*4+row]*view[c*4+k];
    return result;
  }
  draw({eye,yaw,pitch,players=[],me=null,time=0,effects=[],recoil=0,walking=false}) {
    const gl=this.gl,canvas=this.canvas;
    const ratio=Math.min(window.devicePixelRatio||1,1.6);
    const width=Math.floor(innerWidth*ratio),height=Math.floor(innerHeight*ratio);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
    const bob=walking&&!this.reduced?Math.sin(time*.012)*.018:0;
    const camera=[eye[0],eye[1]+bob,eye[2]];
    gl.clearColor(.045,.028,.022,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.matrix,false,this.viewMatrix(camera,yaw,pitch+recoil*.025,width/height));gl.uniform3fv(this.eye,camera);
    this.bind(this.staticBuffer);gl.drawArrays(gl.TRIANGLES,0,this.staticCount);
    const dynamic=[];
    for(const p of players) {
      if(p.id===me?.id||p.health<=0)continue;
      const tint=[.55,.18,.13],a=p.yaw,h=p.height||0;
      const box=(x,y,z,sx,sy,sz,color,pitch=0,glow=0)=>this.box(dynamic,x,y,z,sx,sy,sz,color,a,pitch,glow);
      box(p.x,h+.94,p.y,.52,.65,.32,tint);
      box(p.x,h+1.51,p.y,.34,.38,.34,[.13,.2,.25]);
      box(p.x+Math.sin(a)*.18,h+1.54,p.y-Math.cos(a)*.18,.29,.10,.035,[1,.72,.3],0,1);
      box(p.x,h+.62,p.y,.43,.12,.33,[.045,.07,.1]);
      const stride=this.reduced?0:Math.sin(time*.01+p.x)*.13;
      for(const side of [-1,1]) {
        box(p.x+Math.cos(a)*side*.14,h+.3,p.y+Math.sin(a)*side*.14,.17,.58,.2,[.07,.11,.16],stride*side);
        box(p.x+Math.cos(a)*side*.36,h+1,p.y+Math.sin(a)*side*.36,.16,.51,.19,tint,-.3);
      }
      box(p.x+Math.sin(a)*.34,h+1.06,p.y-Math.cos(a)*.34,.13,.13,.5,[.035,.055,.075]);
      if(p.protectedUntil>Date.now())box(p.x,h+.03,p.y,.8,.035,.8,[.12,.65,.82],0,1);
    }
    for(const fx of effects) {
      const dx=fx.end.x-fx.x,dy=fx.end.y-fx.y,dz=fx.end.z-fx.z,length=Math.hypot(dx,dy,dz);
      if(length>.01)this.box(dynamic,(fx.x+fx.end.x)/2,(fx.y+fx.end.y)/2,(fx.z+fx.end.z)/2,.014,.014,length,[.9,.7,.27],Math.atan2(dx,-dz),Math.asin(dy/length),1);
    }
    this.upload(dynamic);
    if(me&&me.health>0) {
      const gun=[],right=[Math.cos(yaw),0,Math.sin(yaw)],up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)],forward=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
      const point=(r,u,f)=>camera.map((n,i)=>n+right[i]*r+up[i]*u+forward[i]*f);
      const tilt=me.reloadUntil>Date.now()?-.55:0;
      const box=(r,u,f,w,h,d,color,glow=0)=>{const p=point(r,u+tilt*.15,f-recoil*.07);this.box(gun,...p,w,h,d,color,yaw,pitch+tilt,glow);};
      box(.24,-.25+bob,.47,.15,.16,.58,[.06,.1,.14]);
      box(.24,-.17+bob,.44,.12,.04,.4,[.19,.27,.3]);
      box(.24,-.21+bob,.78,.08,.075,.2,[.12,.19,.22]);
      box(.24,-.18+bob,.85,.085,.02,.06,[.9,.68,.3],1);
      box(.24,-.32+bob,.4,.11,.15,.16,[.025,.045,.06]);
      box(.24,-.36+bob,.27,.11,.2,.13,[.04,.065,.08]);
      box(.24,-.135+bob,.34,.075,.035,.05,[.85,.6,.25],1);
      box(.36,-.35,.19,.15,.17,.43,[.12,.24,.25]);
      box(.08,-.35,.46,.14,.14,.38,[.12,.24,.25]);
      if(recoil>.55)box(.24,-.2,.94,.15,.15,.15,[1,.72,.23],1);
      gl.clear(gl.DEPTH_BUFFER_BIT);this.upload(gun);
    }
  }
};
