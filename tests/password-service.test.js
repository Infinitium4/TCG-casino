const test=require('node:test'),assert=require('node:assert/strict'),bcrypt=require('bcryptjs');
const {createPasswordService}=require('../password-service');
test('password hashing stays compatible while the main event loop remains responsive',async t=>{
  const service=createPasswordService();t.after(()=>service.close());let ticks=0;const timer=setInterval(()=>ticks++,10);
  try{
    const hash=await service.hash('worker-password',12);assert.ok(ticks>=3);
    assert.equal(await bcrypt.compare('worker-password',hash),true);
    assert.equal(await service.compare('worker-password',hash),true);assert.equal(await service.compare('wrong-password',hash),false);
  }finally{clearInterval(timer);}
});
test('password work has a bounded queue and rejects excess demand without starting more workers',async()=>{
  const service=createPasswordService({maxPending:2});
  try{
    const a=service.hash('first',10),b=service.hash('second',10);
    await assert.rejects(service.hash('excess',10),{code:'PASSWORD_BUSY'});
    const hashes=await Promise.all([a,b]);assert.equal(await bcrypt.compare('first',hashes[0]),true);assert.equal(await bcrypt.compare('second',hashes[1]),true);
  }finally{await service.close();}
});
