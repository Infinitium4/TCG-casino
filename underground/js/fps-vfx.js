(function(root,factory){const Vfx=factory();if(typeof module==='object'&&module.exports)module.exports=Vfx;else root.FpsVfx=Vfx;})(globalThis,()=>{
  const unit=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const add=(a,b,s=1)=>a.map((x,i)=>x+b[i]*s);
  return class FpsVfx{
    static shot(event,now,start){
      return {...event,start:start||[event.x,event.y,event.z],born:now,until:now+1700};
    }
    static explosion(event,now){return {...event,born:now,until:now+1200};}
    static particles(fx,now){
      if(fx.type==='explosion'){
        const age=(now-fx.born)/1000;if(age<0||age>1.2)return [];
        const center=[fx.x,fx.y,fx.z],items=[];
        if(age<.14)items.push({texture:'muzzle_03',center,w:.5+age*7,h:.5+age*9,color:[1,.57,.18,(1-age/.14)*.9],rotation:fx.id||0});
        for(let i=0;i<7;i++){
          const a=i*2.399,r=age*(.5+i*.1),p=add(center,[Math.cos(a)*r,age*.8,Math.sin(a)*r]);
          items.push({texture:'smoke_04',center:p,w:.35+age*1.1,h:.5+age*1.3,color:[.36,.33,.28,(1-age/1.2)*.26],rotation:a+age*.2});
          if(age<.3){const v=[Math.cos(a)*3,1.4+i*.1,Math.sin(a)*3],head=add(center,v,age);items.push({texture:'trace_01',from:add(head,v,-.025),to:head,w:.012,color:[1,.63,.25,1-age/.3]});}
        }
        return items;
      }
      if(fx.type!=='shot'||now<fx.born||now>fx.until)return [];
      const age=now-fx.born,start=fx.start,end=[fx.end.x,fx.end.y,fx.end.z];
      const length=Math.hypot(...end.map((v,i)=>v-start[i]));if(length<.01)return [];
      const dir=unit(end.map((v,i)=>v-start[i])),flight=length/320*1000,seed=(fx.id||1)*2.399;
      const items=[],sprite=(texture,center,w,h,color,rotation=0,normal=null)=>items.push({texture,center,w,h,color,rotation,normal});
      if(age<38){
        sprite(fx.id%2?'muzzle_01':'muzzle_03',start,.16,.25,[1,.77,.43,(1-age/38)*.85],seed);
      }
      if(age<flight&&fx.id%2===0){
        const head=add(start,dir,Math.min(length,.4+age*.32)),tail=add(head,dir,-Math.min(.7,age*.32+.15));
        items.push({texture:'trace_01',from:tail,to:head,w:.018,color:[1,.87,.57,.65]});
      }
      if(age>35&&age<420){const t=(age-35)/385;sprite('smoke_04',add(start,[0,.23,0],t),.10+t*.22,.14+t*.30,[.48,.44,.38,(1-t)*.11],seed+t*.3);}
      if(age<flight||fx.hitPlayer||fx.hitWorld===false)return items;
      const t=(age-flight)/1000,normal=fx.normal||unit(dir.map(v=>-v));
      const hit=add(end,normal,.025);
      if(t<.07)sprite('spark_05',hit,.20,.20,[1,.75,.37,(1-t/.07)*.8],seed);
      if(t<.24)for(let i=0;i<5;i++){
        const a=seed+i*2.4,velocity=add([Math.cos(a)*.9,Math.sin(a*1.7)*.7+.6,Math.sin(a)*.9],normal,1.5);
        const head=add(add(hit,velocity,t),[0,-2.5,0],t*t),tail=add(head,velocity,-.018);
        items.push({texture:'trace_01',from:tail,to:head,w:.009,color:[1,.62,.25,(1-t/.24)*.7]});
      }
      if(t<.7)sprite('smoke_04',add(hit,[0,.28,0],t),.15+t*.42,.18+t*.45,[.50,.46,.39,(1-t/.7)*.20],seed+t*.2);
      if(t<1.5)sprite('scorch_01',hit,.13,.13,[.07,.06,.045,.75*Math.min(1,(1.5-t)*4)],seed,normal);
      return items;
    }
    constructor(gl){
      this.gl=gl;this.textures=new Map();
      const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Initialisation des effets impossible.');return s;};
      const p=this.program=gl.createProgram();
      gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec3 position;attribute vec2 uv;attribute vec4 color;uniform mat4 matrix;varying mediump vec2 tex;varying mediump vec4 tint;void main(){tex=uv;tint=color;gl_Position=matrix*vec4(position,1.);}'));
      gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D sprite;varying mediump vec2 tex;varying mediump vec4 tint;void main(){vec4 c=texture2D(sprite,tex);float a=c.a*tint.a;if(a<.008)discard;gl_FragColor=vec4(c.rgb*tint.rgb,a);}'));
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Initialisation des effets impossible.');
      this.locations=['position','uv','color'].map(name=>gl.getAttribLocation(p,name));this.matrix=gl.getUniformLocation(p,'matrix');this.sampler=gl.getUniformLocation(p,'sprite');this.buffer=gl.createBuffer();
      for(const name of ['muzzle_01','muzzle_03','spark_05','smoke_04','scorch_01','trace_01']){
        const image=new Image();image.onload=()=>{
          const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          this.textures.set(name,texture);
        };image.src='/assets/fps/kenney-particles/'+name+'.png';
      }
    }
    draw(matrix,eye,effects,time,yaw,pitch,reduced=false){
      const gl=this.gl,groups=new Map(),cameraRight=[Math.cos(yaw),0,Math.sin(yaw)],cameraUp=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),Math.cos(yaw)*Math.sin(pitch)];
      for(const fx of effects)for(const item of FpsVfx.particles(fx,time)){
        if(reduced&&['muzzle_01','muzzle_03','spark_05'].includes(item.texture))continue;
        if(!this.textures.has(item.texture))continue;
        let center=item.center,right=cameraRight,up=cameraUp,w=item.w,h=item.h;
        if(item.from){
          center=item.from.map((v,i)=>(v+item.to[i])/2);up=unit(item.to.map((v,i)=>v-item.from[i]));
          right=unit(cross(up,eye.map((v,i)=>v-center[i])));h=Math.hypot(...item.to.map((v,i)=>v-item.from[i]));
        }else if(item.normal){
          const n=item.normal;right=unit(cross(Math.abs(n[1])>.9?[1,0,0]:[0,1,0],n));up=unit(cross(n,right));
        }
        const c=Math.cos(item.rotation||0),s=Math.sin(item.rotation||0),r=right.map((v,i)=>v*c+up[i]*s),u=up.map((v,i)=>v*c-right[i]*s);
        const vertices=groups.get(item.texture)||[];
        for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]])vertices.push(...center.map((v,i)=>v+r[i]*x*w/2+u[i]*y*h/2),(x+1)/2,(y+1)/2,...item.color);
        groups.set(item.texture,vertices);
      }
      if(!groups.size)return;
      gl.useProgram(this.program);gl.uniformMatrix4fv(this.matrix,false,matrix);gl.uniform1i(this.sampler,0);gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);gl.depthMask(false);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      this.locations.forEach((loc,i)=>{gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,[3,2,4][i],gl.FLOAT,false,36,[0,12,20][i]);});
      for(const [name,vertices] of groups){
        const additive=!['smoke_04','scorch_01'].includes(name);gl.blendFunc(gl.SRC_ALPHA,additive?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);
        gl.bindTexture(gl.TEXTURE_2D,this.textures.get(name));gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,vertices.length/9);
      }
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
  };
});
