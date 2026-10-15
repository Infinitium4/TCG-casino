const test=require('node:test');
const assert=require('node:assert/strict');
const {registerFps}=require('../fps');

function fixture(){
  let connect;const sockets=new Map(),users=new Map([[1,'Alice'],[2,'Bob'],[3,'Eve']]);
  const io={sockets:{sockets},on:(event,handler)=>{if(event==='connection')connect=handler;},to:()=>({volatile:{emit(){}}})};
  const game=registerFps({app:{get(){}},io,get:async(sql,[id])=>sql.includes('fps_loadouts')?{skin_id:'emerald'}:{id,username:users.get(id),is_admin:0,is_banned:0,is_bank:0},path:{}});
  function socket(id){
    const handlers={},events=[];
    const s={id:'socket-'+id,connected:true,request:{session:{userId:id}},on:(name,fn)=>handlers[name]=fn,emit:(name,data)=>events.push({name,data}),join(){},leave(){},
      async send(name,data){let result;await handlers[name](data,value=>result=value);return result;},events};
    sockets.set(s.id,s);connect(s);return s;
  }
  return {game,socket};
}

test('online players receive targeted invitations and can accept into the same group',async(t)=>{
  const {game,socket}=fixture();t.after(()=>game.close());
  const alice=socket(1),bob=socket(2),eve=socket(3);
  await alice.send('fps:lobby');await bob.send('fps:lobby');await eve.send('fps:lobby');
  assert.equal(alice.events.filter(e=>e.name==='fps:presence').at(-1).data.length,3);
  assert.ok((await alice.send('fps:invite',{userId:2})).error);
  const joined=await alice.send('fps:join',{create:true,name:'Party'});assert.equal(joined.state.waiting,true);
  assert.equal((await alice.send('fps:invite',{userId:2})).ok,true);
  const invitation=bob.events.find(e=>e.name==='fps:invitation').data;
  assert.equal(invitation.from,'Alice');assert.equal(invitation.roomName,'Party');
  assert.equal(eve.events.some(e=>e.name==='fps:invitation'),false);
  assert.ok((await alice.send('fps:invite',{userId:2})).error);
  assert.ok((await eve.send('fps:join',{invitationId:invitation.id})).error);
  const accepted=await bob.send('fps:join',{invitationId:invitation.id});
  assert.equal(accepted.state.id,joined.state.id);assert.equal(accepted.state.players.length,2);
  assert.equal(accepted.state.players.find(p=>p.id===2).skin,'emerald');
  assert.ok((await bob.send('fps:start',{})).error);
  assert.equal((await alice.send('fps:start',{})).ok,true);
  assert.ok((await alice.send('fps:invite',{userId:3})).error);
  await bob.send('disconnect');
  assert.equal(alice.events.filter(e=>e.name==='fps:presence').at(-1).data.some(p=>p.id===2),false);
});

test('lobby page supplies every control used by the client and unique tab panels',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const page=fs.readFileSync(path.join(__dirname,'../underground/fps.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'../underground/js/fps.js'),'utf8');
  const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const [,id] of script.matchAll(/(?<![\w])(?:\$|text)\('([\w-]+)'(?=[,)])/g))assert.ok(ids.includes(id),'Missing control '+id);
  for(const tab of ['play','locker','shop']){assert.ok(ids.includes('panel-'+tab));assert.match(page,new RegExp('data-lobby-tab="'+tab+'"'));}
});

test('the host can launch a solo game from the real socket handler',async(t)=>{
  const {game,socket}=fixture();t.after(()=>game.close());const alice=socket(1);
  const joined=await alice.send('fps:join',{create:true,name:'Solo'});
  assert.equal((await alice.send('fps:start',{})).ok,true);
  const room=game.rooms.get(joined.state.id);room.tick(Date.now());
  assert.equal(room.waiting,false);assert.equal(room.players.size,1);
});
