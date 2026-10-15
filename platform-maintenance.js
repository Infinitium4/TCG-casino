const DEFAULT_MESSAGE='Le casino est temporairement en maintenance. Reviens dans quelques instants.';
function registerPlatformMaintenance({app,io,get,run,withDatabaseTransaction,requireAuth,requireAdmin,requirePrimaryAdmin,handleAsync,recordAdminAction,primaryUsername,hasActiveGame}){
  let state={enabled:false,message:DEFAULT_MESSAGE};
  const completion=/^\/api\/(?:crash\/bets\/\d+\/cashout|mines\/(?:reveal|cashout)|tower\/(?:place|cashout)|horses\/[^/]+\/(?:start|settle)|horses\/tables\/[^/]+\/(?:start|leave)|(?:blackjack|poker)\/tables\/[^/]+\/(?:action|leave))$/;
  async function status(req){
    const user=req.session?.userId?await get('SELECT username,is_admin FROM users WHERE id=?',[req.session.userId]):null;
    const canManage=Boolean(user?.is_admin&&!req.session.supportOriginalUserId&&user.username.toLowerCase()===primaryUsername.toLowerCase());
    const original=req.session?.supportOriginalUserId?await get('SELECT username,is_admin FROM users WHERE id=?',[req.session.supportOriginalUserId]):null;
    const canAccessAdmin=canManage||Boolean(original?.is_admin&&original.username.toLowerCase()===primaryUsername.toLowerCase());
    return {...state,authenticated:Boolean(user),canManage,canAccessAdmin,hasActiveGame:Boolean(state.enabled&&user&&await hasActiveGame(req.session.userId))};
  }
  app.get('/api/maintenance',handleAsync(async(req,res)=>res.set('Cache-Control','no-store').json(await status(req))));
  app.post('/api/admin/maintenance',requireAuth,requireAdmin,requirePrimaryAdmin,handleAsync(async(req,res)=>{
    if(!req.is('application/json')||req.get('Sec-Fetch-Site')==='cross-site')return res.status(403).json({error:'Requête non autorisée.'});
    const enabled=req.body?.enabled,message=typeof req.body?.message==='string'?req.body.message.trim():DEFAULT_MESSAGE,reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
    if(typeof enabled!=='boolean'||!message||message.length>300||!reason||reason.length>240)return res.status(400).json({error:'Indique un message (300 caractères maximum) et un motif (240 caractères maximum).'});
    const next={enabled,message};
    await withDatabaseTransaction(async()=>{
      await run(`INSERT INTO casino_platform_settings(setting_key,setting_value,updated_at) VALUES('global_maintenance',?,CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP`,[JSON.stringify(next)]);
      await recordAdminAction(req.adminUserId,enabled?'maintenance_enabled':'maintenance_disabled',reason);
    });
    state=next;io.emit('maintenance:changed',state);res.json({...state,canManage:true});
  }));
  io.on('connection',socket=>{
    socket.use(([event,...args],next)=>{
      if(!state.enabled||event==='general-chat:subscribe'||/:(?:list|sync|subscribe|unsubscribe|action|leave)$/.test(event))return next();
      const ack=args.at(-1);if(typeof ack==='function')ack({error:state.message,maintenance:true});
    });
  });
  return {
    getState:()=>({...state}),
    async initialize(){const row=await get("SELECT setting_value FROM casino_platform_settings WHERE setting_key='global_maintenance'");if(row){const saved=JSON.parse(row.setting_value);state={enabled:saved.enabled===true,message:saved.message||DEFAULT_MESSAGE};}},
    guard(req,res,next){
      if(!state.enabled||['GET','HEAD','OPTIONS'].includes(req.method)||!req.path.startsWith('/api/')||req.path.startsWith('/api/admin/')||req.path.startsWith('/api/chat/')||['/api/login','/api/logout','/api/screen-time/heartbeat','/api/screen-time/stop'].includes(req.path)||completion.test(req.path))return next();
      res.set('Retry-After','30').status(503).json({error:state.message,maintenance:true});
    }
  };
}
module.exports={registerPlatformMaintenance};
