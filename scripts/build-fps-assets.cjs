/* Convert licensed source assets into the renderer's position/normal/color format. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../underground/assets/fps'),source=path.join(root,'source');
function png(file){
  const b=fs.readFileSync(file),w=b.readUInt32BE(16),h=b.readUInt32BE(20),type=b[25],depth=b[24];
  if(depth!==8||![2,3,6].includes(type))throw Error('Unsupported palette PNG');
  const channels=type===6?4:type===2?3:1,chunks=[];let palette;
  for(let i=8;i<b.length;i+=b.readUInt32BE(i)+12){const n=b.toString('ascii',i+4,i+8),data=b.subarray(i+8,i+8+b.readUInt32BE(i));if(n==='IDAT')chunks.push(data);if(n==='PLTE')palette=data;}
  const raw=zlib.inflateSync(Buffer.concat(chunks)),pixels=Buffer.alloc(w*h*channels),stride=w*channels;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++)for(let x=0;x<stride;x++){
    const filter=raw[y*(stride+1)],value=raw[y*(stride+1)+1+x],a=x>=channels?pixels[y*stride+x-channels]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0,d=y?pixels[(y-1)*stride+x]:0;
    pixels[y*stride+x]=(value+(filter===0?0:filter===1?a:filter===2?d:filter===3?Math.floor((a+d)/2):paeth(a,d,c)))&255;
  }
  return (u,v)=>{const i=(Math.min(h-1,Math.max(0,Math.floor((1-v)*h)))*w+Math.min(w-1,Math.max(0,Math.floor(u*w))))*channels;return type===3?[0,1,2].map(c=>palette[pixels[i]*3+c]/255):[0,1,2].map(c=>pixels[i+c]/255);};
}
const result={},normal=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
function emitTriangle(out,points,normals,colors){
  const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  const face=normal([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);
  for(let i=0;i<3;i++)out.push(...points[i],...normal(normals?.[i]||face),...colors[i],0);
}
function obj(pack,name){
  const dir=path.join(source,pack),sample=png(path.join(dir,'Textures/colormap.png')),v=[],uv=[],n=[],out=[];
  for(const line of fs.readFileSync(path.join(dir,name+'.obj'),'utf8').split(/\r?\n/)){
    const [type,...rest]=line.trim().split(/\s+/);
    if(type==='v')v.push(rest.slice(0,3).map(Number));if(type==='vt')uv.push(rest.slice(0,2).map(Number));if(type==='vn')n.push(rest.map(Number));
    if(type==='f')for(let i=1;i<rest.length-1;i++){
      const indices=[rest[0],rest[i],rest[i+1]].map(s=>s.split('/').map(Number));
      emitTriangle(out,indices.map(a=>v[a[0]-1]),indices.map(a=>n[a[2]-1]),indices.map(a=>sample(...uv[a[1]-1])));
    }
  }
  return out;
}
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){const out=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
function transform(m,p,w=1){return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*w);}
function compose(t=[0,0,0],q=[0,0,0,1],s=[1,1,1]){
  const [x,y,z,w]=q;
  return [(1-2*(y*y+z*z))*s[0],2*(x*y+z*w)*s[0],2*(x*z-y*w)*s[0],0,2*(x*y-z*w)*s[1],(1-2*(x*x+z*z))*s[1],2*(y*z+x*w)*s[1],0,2*(x*z+y*w)*s[2],2*(y*z-x*w)*s[2],(1-2*(x*x+y*y))*s[2],0,...t,1];
}
function soldierFrames(){
  const g=JSON.parse(fs.readFileSync(path.join(source,'quaternius/Character_Soldier.gltf'),'utf8'));
  const buffers=g.buffers.map(b=>Buffer.from(b.uri.split(',')[1],'base64'));
  function accessor(id){
    const a=g.accessors[id],v=g.bufferViews[a.bufferView],b=buffers[v.buffer],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
    const [bytes,read]={5126:[4,'readFloatLE'],5125:[4,'readUInt32LE'],5123:[2,'readUInt16LE'],5121:[1,'readUInt8']}[a.componentType];
    return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>b[read]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||bytes*width)+j*bytes)));
  }
  const cache=new Map(),get=id=>{if(!cache.has(id))cache.set(id,accessor(id));return cache.get(id);};
  function frame(animation,time){
    const nodes=g.nodes.map(n=>({...n}));
    for(const channel of animation.channels){
      const sampler=animation.samplers[channel.sampler],times=get(sampler.input).map(a=>a[0]),values=get(sampler.output);let i=0;
      while(i<times.length-2&&times[i+1]<time)i++;
      const next=Math.min(i+1,times.length-1),alpha=Math.max(0,Math.min(1,(time-times[i])/(times[next]-times[i]||1)));
      let a=values[i],b=values[next];if(channel.target.path==='rotation'&&a.reduce((sum,v,i)=>sum+v*b[i],0)<0)b=b.map(v=>-v);
      let value=a.map((v,j)=>v+(b[j]-v)*alpha);if(channel.target.path==='rotation')value=normal(value);
      nodes[channel.target.node][channel.target.path]=value;
    }
    const global=[];
    function visit(id,parent){const n=nodes[id];global[id]=multiply(parent,n.matrix||compose(n.translation,n.rotation,n.scale));for(const child of n.children||[])visit(child,global[id]);}
    for(const id of g.scenes[g.scene||0].nodes)visit(id,identity());
    const out=[];
    const weapon=global[nodes.findIndex(n=>n.name==='AK')];
    out.mount={point:transform(weapon,[0,0,0]),forward:normal(transform(weapon,[1,0,0],0))};
    for(let id=0;id<nodes.length;id++){
      const node=nodes[id];if(node.mesh===undefined||!['Body','Head','ShoulderPad.L','ShoulderPad.R'].includes(node.name))continue;
      const skin=node.skin===undefined?null:g.skins[node.skin],matrices=skin?skin.joints.map((joint,i)=>multiply(global[joint],get(skin.inverseBindMatrices)[i])):null;
      for(const primitive of g.meshes[node.mesh].primitives){
        const pos=get(primitive.attributes.POSITION),norm=get(primitive.attributes.NORMAL),indices=primitive.indices===undefined?pos.map((_,i)=>[i]):get(primitive.indices);
        const joints=skin?get(primitive.attributes.JOINTS_0):null,weights=skin?get(primitive.attributes.WEIGHTS_0):null;
        const worldPositions=pos.map((p,i)=>skin?[0,1,2].map(axis=>weights[i].reduce((sum,w,j)=>sum+w*transform(matrices[joints[i][j]],p)[axis],0)):transform(global[id],p));
        const worldNormals=norm.map((p,i)=>normal(skin?[0,1,2].map(axis=>weights[i].reduce((sum,w,j)=>sum+w*transform(matrices[joints[i][j]],p,0)[axis],0)):transform(global[id],p,0)));
        const material=g.materials[primitive.material],name=material.name,color=name==='Character_Main'?[1,0,1]:name==='Pants'?[0,1,1]:material.pbrMetallicRoughness.baseColorFactor.slice(0,3).map(v=>v**(1/2.2));
        for(let i=0;i<indices.length;i+=3){const ids=indices.slice(i,i+3).map(a=>a[0]);emitTriangle(out,ids.map(i=>worldPositions[i]),ids.map(i=>worldNormals[i]),ids.map(()=>color));}
      }
    }
    return out;
  }
  const idle=g.animations.find(a=>a.name==='Idle_Shoot'),run=g.animations.find(a=>a.name==='Run_Gun');
  const base=frame(idle,0),ys=base.filter((_,i)=>i%10===1),min=Math.min(...ys),max=Math.max(...ys),scale=1.78/(max-min);
  const adapt=out=>{for(let i=0;i<out.length;i+=10){out[i]*=-scale;out[i+1]=(out[i+1]-min)*scale;out[i+2]*=-scale;out[i+3]*=-1;out[i+5]*=-1;}
    const p=out.mount.point,d=out.mount.forward;out.mount={point:[-p[0]*scale,(p[1]-min)*scale,-p[2]*scale],forward:[-d[0],d[1],-d[2]]};return out;};
  result['soldier-idle']=adapt(base);
  for(let i=0;i<8;i++)result['soldier-run-'+i]=adapt(frame(run,i*.08));
}
for(const name of ['blaster-f','blaster-n','crate-medium','grenade-a','clip-large'])result[name]=obj('kenney-blasters',name);
for(const name of ['wall','wall-detail','wall-window','wall-pillar','floor','floor-panel','container','container-wide','computer','display-wall','pipe','structure-barrier'])result[name]=obj('kenney-station',name);
soldierFrames();
const manifest={version:1,stride:10,meshes:{},sources:{kenney:'https://kenney.nl/assets',quaternius:'https://quaternius.com/packs/toonshootergamekit.html'}},arrays=[];let offset=0;
for(const [name,data] of Object.entries(result)){
  if(data.some(v=>!Number.isFinite(v)))throw Error('Invalid mesh '+name);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.length;i+=10)for(let a=0;a<3;a++){min[a]=Math.min(min[a],data[i+a]);max[a]=Math.max(max[a],data[i+a]);}
  manifest.meshes[name]={offset,length:data.length,min,max,...(data.mount?{mount:data.mount}:{})};arrays.push(new Float32Array(data));offset+=data.length;
}
const bytes=Buffer.concat(arrays.map(a=>Buffer.from(a.buffer)));manifest.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(root,'models.bin'),bytes);fs.writeFileSync(path.join(root,'models.bin.gz'),zlib.gzipSync(bytes,{level:9}));fs.writeFileSync(path.join(root,'models.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Imported ${arrays.length} meshes, ${(bytes.length/1024/1024).toFixed(2)} MiB`);
