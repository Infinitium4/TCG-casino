const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('Tester en solo enters the map and accepts movement even with a disconnected socket',async()=>{
  const nodes=new Map(),docEvents={},socketEvents={},frames=[],draws=[];
  function node(id=''){
    return {id,hidden:false,value:'',textContent:'',children:[],dataset:{},style:{},events:{},classList:{add(){},remove(){},toggle(){}},
      addEventListener(name,fn){this.events[name]=fn;},setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}};
  }
  const html=fs.readFileSync(path.join(__dirname,'../underground/fps.html'),'utf8');
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,node(id));
  nodes.get('radar').getContext=()=>({clearRect(){},fillRect(){},strokeRect(){},fillText(){},save(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},restore(){}});
  const document={hidden:false,pointerLockElement:null,getElementById:id=>nodes.get(id),createElement:()=>node(),querySelectorAll:()=>[],addEventListener:(name,fn)=>docEvents[name]=fn};
  nodes.get('arena').requestPointerLock=()=>{document.pointerLockElement=nodes.get('arena');docEvents.pointerlockchange();return Promise.resolve();};
  const socket={connected:false,on:(name,fn)=>socketEvents[name]=fn,emit(){throw Error('Solo must not send socket messages');},timeout(){throw Error('Solo must not await a server acknowledgment');}};
  const context={document,window:{addEventListener(){}},accountUser:{id:1,username:'Tester',isAdmin:false},
    loadAccountData:async()=>true,refreshFpsShop:async()=>{},FpsWorld:require('../underground/js/fps-shared'),FpsSkins:require('../underground/js/fps-skins'),FpsPractice:require('../underground/js/fps-practice'),
    FpsVfx:require('../underground/js/fps-vfx'),FpsRenderer:class{draw(data){draws.push(data);}},io:()=>socket,fetch:async()=>({ok:true,json:async()=>({rooms:[]})}),
    performance:{now:()=>1000},requestAnimationFrame:fn=>frames.push(fn),setInterval(){},setTimeout,Date,Math,URLSearchParams,HTMLInputElement:class{},
    innerWidth:1280,location:{origin:'http://localhost',search:'',assign(){throw Error('Unexpected redirect');},replace(){throw Error('Unexpected redirect');}}};
  await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../underground/js/fps.js'),'utf8'),context);
  assert.equal(typeof nodes.get('testSolo').events.click,'function');
  nodes.get('testSolo').events.click();
  assert.equal(nodes.get('lobby').hidden,true);assert.equal(nodes.get('hud').hidden,false);
  assert.equal(nodes.get('pause').hidden,true);
  docEvents.keydown({code:'KeyW',target:{},preventDefault(){}});
  frames.shift()(1016);
  assert.ok(draws.at(-1).eye[2]<10.5);assert.equal(draws.at(-1).me.name,'Tester');
  assert.equal(nodes.get('time').textContent,'LIBRE');assert.equal(nodes.get('network').textContent,'SOLO LOCAL');
  docEvents.keyup({code:'KeyW'});
  docEvents.keydown({code:'KeyE',target:{},preventDefault(){}});frames.shift()(1032);
  assert.equal(nodes.get('grenadeCount').textContent,2);
  docEvents.keyup({code:'KeyE'});docEvents.keydown({code:'KeyG',target:{},preventDefault(){}});frames.shift()(1048);
  assert.equal(nodes.get('grenadeCount').textContent,1);assert.equal(draws.at(-1).bombs.length,1);
  nodes.get('arena').events.mousedown({button:0});frames.shift()(1064);
  assert.ok(draws.at(-1).effects.some(fx=>fx.type==='shot'&&fx.start&&Number.isFinite(fx.born)));
  socketEvents.disconnect();assert.equal(nodes.get('lobby').hidden,true);
});
