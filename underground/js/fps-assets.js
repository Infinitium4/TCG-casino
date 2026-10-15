(function(root,factory){const Assets=factory();if(typeof module==='object'&&module.exports)module.exports=Assets;else root.FpsAssets=Assets;})(globalThis,()=>class FpsAssets{
  constructor(manifest,buffer){
    if(manifest.stride!==10||buffer.byteLength%40)throw Error('Modèles FPS invalides.');
    this.vertices=new Float32Array(buffer);this.meshes=new Map();
    for(const [name,entry] of Object.entries(manifest.meshes)){
      if(entry.offset<0||entry.length%30||entry.offset+entry.length>this.vertices.length)throw Error('Modèle FPS incomplet.');
      this.meshes.set(name,{...entry,data:this.vertices.subarray(entry.offset,entry.offset+entry.length)});
    }
  }
  static async load(){
    if(this.library)return this.library;
    if(!this.loading)this.loading=(async()=>{
      const responses=await Promise.all([fetch('/assets/fps/models.json?v=art-5'),fetch('/assets/fps/models.bin?v=art-5')]);
      if(responses.some(r=>!r.ok))throw Error('Téléchargement des modèles FPS impossible.');
      const [manifest,buffer]=await Promise.all([responses[0].json(),responses[1].arrayBuffer()]);
      return this.library=new this(manifest,buffer);
    })();
    try{return await this.loading;}catch(error){this.loading=null;throw error;}
  }
  append(out,name,origin=[0,0,0],scale=[1,1,1],yaw=0,pitch=0,skin=null){
    const mesh=this.meshes.get(name);if(!mesh)return false;
    if(typeof scale==='number')scale=[scale,scale,scale];
    const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),v=mesh.data;
    for(let i=0;i<v.length;i+=10){
      const x=v[i]*scale[0],y=v[i+1]*scale[1],z=v[i+2]*scale[2],py=y*cp-z*sp,pz=y*sp+z*cp;
      const nx=v[i+3]/scale[0],ny=v[i+4]/scale[1],nz=v[i+5]/scale[2],npy=ny*cp-nz*sp,npz=ny*sp+nz*cp;
      const n=[nx*c-npz*s,npy,nx*s+npz*c],len=Math.hypot(...n)||1;
      let color=[v[i+6],v[i+7],v[i+8]];
      if(skin&&color[0]>.99&&color[1]<.01&&color[2]>.99)color=skin.body.map(v=>v*.72+.025);
      else if(skin&&color[0]<.01&&color[1]>.99&&color[2]>.99)color=skin.body.map(v=>v*.18+.035);
      else if(skin&&name.startsWith('blaster')&&color[0]>.2&&color[2]>color[0]+.06&&color[1]<color[0]-.04)color=skin.body.map(v=>v*.72+.03);
      out.push(origin[0]+x*c-pz*s,origin[1]+py,origin[2]+x*s+pz*c,...n.map(v=>v/len),...color,v[i+9]);
    }
    return true;
  }
});
