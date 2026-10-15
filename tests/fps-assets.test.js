const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),vm=require('node:vm');
const Assets=require('../underground/js/fps-assets'),Audio=require('../underground/js/fps-audio');
const root=path.join(__dirname,'../underground/assets/fps'),manifest=require('../underground/assets/fps/models.json'),bytes=fs.readFileSync(path.join(root,'models.bin'));
const library=new Assets(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
test('imported models match their manifest, retain finite vertices and compress losslessly',()=>{
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.deepEqual(zlib.gunzipSync(fs.readFileSync(path.join(root,'models.bin.gz'))),bytes);
  assert.equal(library.meshes.size,26);
  for(const mesh of library.meshes.values()){assert.equal(mesh.data.length%30,0);assert.ok(mesh.data.every(Number.isFinite));}
});
test('imported character poses and equipment render in the existing engine',()=>{
  const context={window:{},FpsAssets:{library},FpsWorld:require('../underground/js/fps-shared'),FpsSkins:require('../underground/js/fps-skins'),Math,Date,Float32Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../underground/js/fps-renderer.js'),'utf8'),context);
  const renderer=Object.create(context.window.FpsRenderer.prototype);renderer.assets=library;renderer.reduced=true;
  const idle=[],running=[];renderer.character(idle,{x:0,y:0,yaw:0,height:0},context.FpsSkins[0],0,true);renderer.character(running,{x:0,y:0,yaw:0,height:0,moving:true},context.FpsSkins[0],160,false);
  assert.ok(idle.length>10000);assert.ok(running.every(Number.isFinite));assert.notDeepEqual(idle,running);
  const arena=[];renderer.buildArena(arena);assert.ok(arena.every(Number.isFinite));
});
test('all imported sounds and model licenses are present locally',()=>{
  for(const name of Object.values(Audio.files))assert.equal(fs.readFileSync(path.join(root,'audio',name+'.ogg')).subarray(0,4).toString(),'OggS');
  for(const pack of ['kenney-station','kenney-blasters','quaternius'])assert.match(fs.readFileSync(path.join(root,'source',pack,pack==='quaternius'?'LICENSE.txt':'License.txt'),'utf8'),/CC0/);
});
test('asset loader rejects malformed buffers and out-of-range geometry',()=>{
  assert.throws(()=>new Assets({...manifest,stride:3},new ArrayBuffer(40)));
  assert.throws(()=>new Assets({stride:10,meshes:{bad:{offset:0,length:300}}},new ArrayBuffer(40)));
});
