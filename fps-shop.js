const SKINS=require('./underground/js/fps-skins');
async function initializeFpsShopSchema(run){
  await run(`CREATE TABLE IF NOT EXISTS fps_skins (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skin_id TEXT NOT NULL, purchased_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,skin_id))`);
  await run(`CREATE TABLE IF NOT EXISTS fps_loadouts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    skin_id TEXT NOT NULL DEFAULT 'classic')`);
}
function registerFpsShop({app,requireAuth,handleAsync,run,get,all,withDatabaseTransaction,isUserInActiveTable}){
  const fail=(status,message)=>Object.assign(new Error(message),{status});
  async function state(id){
    const user=await get('SELECT chips FROM users WHERE id=?',[id]);
    const owned=await all('SELECT skin_id FROM fps_skins WHERE user_id=?',[id]);
    const loadout=await get('SELECT skin_id FROM fps_loadouts WHERE user_id=?',[id]);
    return {balance:Number(user.chips),owned:['classic',...owned.map(s=>s.skin_id)],equipped:loadout?.skin_id||'classic',skins:SKINS};
  }
  app.get('/api/fps/shop',requireAuth,handleAsync(async(req,res)=>{
    res.set('Cache-Control','no-store');res.json(await withDatabaseTransaction(()=>state(req.session.userId)));
  }));
  for(const action of ['buy','equip'])app.post('/api/fps/shop/'+action,requireAuth,handleAsync(async(req,res)=>{
    if(!req.is('application/json')||req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({error:'Requête non autorisée.'});
    try{
      const result=await withDatabaseTransaction(async()=>{
        const id=req.session.userId,skin=SKINS.find(s=>s.id===req.body?.skinId);
        if(!skin)throw fail(400,'Skin inconnu.');
        const user=await get('SELECT chips,is_bank,is_banned,suspended_until,infinite_money FROM users WHERE id=?',[id]);
        if(!user||user.is_bank||user.is_banned||Number(user.suspended_until)>Date.now())throw fail(403,'Compte indisponible.');
        const owned=skin.id==='classic'||await get('SELECT 1 FROM fps_skins WHERE user_id=? AND skin_id=?',[id,skin.id]);
        if(action==='buy'&&!owned){
          if(skin.price>0){
            if(isUserInActiveTable(id))throw fail(409,'Termine ta partie à table avant un achat.');
            if(user.infinite_money)throw fail(409,'Désactive le solde infini avant un achat.');
            const debit=await run('UPDATE users SET chips=ROUND(chips-?,2) WHERE id=? AND chips>=?',[skin.price,id,skin.price]);
            if(debit.changes!==1)throw fail(409,'Tu n’as pas assez de jetons pour ce skin.');
          }
          await run('INSERT INTO fps_skins(user_id,skin_id,purchased_at) VALUES(?,?,?)',[id,skin.id,Date.now()]);
        }
        if(action==='equip'){
          if(!owned)throw fail(403,'Achète ce skin avant de l’équiper.');
          await run('INSERT INTO fps_loadouts(user_id,skin_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET skin_id=excluded.skin_id',[id,skin.id]);
        }
        return state(id);
      });
      res.json(result);
    }catch(error){if(error.status)return res.status(error.status).json({error:error.message});throw error;}
  }));
}
module.exports={initializeFpsShopSchema,registerFpsShop};
