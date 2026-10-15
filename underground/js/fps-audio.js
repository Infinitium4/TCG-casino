(function(root,factory){const Audio=factory();if(typeof module==='object'&&module.exports)module.exports=Audio;else root.FpsAudio=Audio;})(globalThis,()=>class FpsAudio{
  static files={shot:'laserLarge_000',explosion:'explosionCrunch_000',hit:'impactMetal_000',loot:'doorOpen_000',reload:'doorClose_000',ui:'click_001',back:'back_001'};
  constructor(context){
    this.context=context;this.buffers=new Map();this.active=[];
    this.ready=Promise.allSettled(Object.entries(FpsAudio.files).map(async([kind,name])=>{
      const response=await fetch('/assets/fps/audio/'+name+'.ogg');if(!response.ok)throw Error('Audio indisponible');
      this.buffers.set(kind,await context.decodeAudioData(await response.arrayBuffer()));
    }));
  }
  play(kind){
    const mapped=kind==='head'?'hit':kind==='kill'?'ui':kind,buffer=this.buffers.get(mapped),ctx=this.context;
    if(!buffer||ctx.state!=='running')return false;
    const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;
    source.playbackRate.value=kind==='head'?1.25:kind==='shot'?.97+Math.random()*.06:1;
    gain.gain.value=kind==='explosion'?.2:kind==='shot'?.10:.12;
    source.connect(gain);gain.connect(ctx.destination);source.onended=()=>{source.disconnect();gain.disconnect();this.active=this.active.filter(s=>s!==source);};
    if(this.active.length>=24)this.active.shift().stop();this.active.push(source);source.start();return true;
  }
});
