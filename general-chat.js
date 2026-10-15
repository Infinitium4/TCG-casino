async function initializeGeneralChatSchema(run) {
  await run(`CREATE TABLE IF NOT EXISTS general_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username TEXT NOT NULL, body TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, deleted_at INTEGER, UNIQUE(user_id, request_id))`);
}
function registerGeneralChat({app, io, requireAuth, requireAdmin, handleAsync, run, get, all, withDatabaseTransaction}) {
  const project = row => ({id:row.id,userId:row.user_id,username:row.username,text:row.deleted_at?'':row.body,createdAt:row.created_at,deleted:Boolean(row.deleted_at)});
  const fail = (status,message) => Object.assign(new Error(message),{status});
  const safeWrite = (req,res,next) => {
    if (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({error:'Requête non autorisée.'});
    next();
  };
  app.get('/api/chat',requireAuth,handleAsync(async(req,res)=>{
    const user=await get('SELECT id,username,is_admin FROM users WHERE id=?',[req.session.userId]);
    const rows=await all('SELECT id,user_id,username,CASE WHEN deleted_at IS NULL THEN body ELSE \'\' END AS body,created_at,deleted_at FROM general_chat_messages ORDER BY id DESC LIMIT 100');
    res.set('Cache-Control','no-store').json({user:{id:user.id,username:user.username},canModerate:Boolean(user.is_admin&&!req.session.supportOriginalUserId),messages:rows.reverse().map(project)});
  }));
  app.post('/api/chat/messages',requireAuth,safeWrite,handleAsync(async(req,res)=>{
    try {
      const text=typeof req.body?.text==='string'?req.body.text.normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim():'';
      const requestId=req.body?.requestId;
      if(!text||Array.from(text).length>400||text.split('\n').length>8) throw fail(400,'Écris un message de 1 à 400 caractères (8 lignes maximum).');
      if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId))throw fail(400,'Identifiant du message invalide.');
      const result=await withDatabaseTransaction(async()=>{
        const user=await get('SELECT id,username,is_banned,is_bank,suspended_until FROM users WHERE id=?',[req.session.userId]);
        if(!user||user.is_banned||user.is_bank||Number(user.suspended_until)>Date.now())throw fail(403,'Compte indisponible.');
        const previous=await get('SELECT * FROM general_chat_messages WHERE user_id=? AND request_id=?',[user.id,requestId]);
        if(previous){if(!previous.deleted_at&&previous.body!==text)throw fail(409,'Ce message a déjà été envoyé.');return {message:project(previous),fresh:false};}
        const recent=await get('SELECT MAX(created_at) AS latest, COUNT(*) AS count FROM general_chat_messages WHERE user_id=? AND created_at>?',[user.id,Date.now()-60000]);
        if(Date.now()-Number(recent.latest||0)<1500||recent.count>=10)throw fail(429,'Tu envoies trop vite. Patiente quelques instants.');
        const createdAt=Date.now();
        const inserted=await run('INSERT INTO general_chat_messages(user_id,username,body,request_id,created_at) VALUES(?,?,?,?,?)',[user.id,user.username,text,requestId,createdAt]);
        return {message:{id:inserted.id,userId:user.id,username:user.username,text,createdAt,deleted:false},fresh:true};
      });
      if(result.fresh)io.to('general-chat').emit('general-chat:message',result.message);
      res.json(result.message);
    }catch(error){if(error.status)return res.status(error.status).json({error:error.message});throw error;}
  }));
  app.delete('/api/chat/messages/:id',requireAuth,requireAdmin,safeWrite,handleAsync(async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Message invalide.'});
    const message=await withDatabaseTransaction(async()=>{
      await run('UPDATE general_chat_messages SET body=\'\',deleted_at=? WHERE id=? AND deleted_at IS NULL',[Date.now(),id]);
      const row=await get('SELECT * FROM general_chat_messages WHERE id=?',[id]);return row?project(row):null;
    });
    if(!message)return res.status(404).json({error:'Message introuvable.'});
    io.to('general-chat').emit('general-chat:message',message);res.json(message);
  }));
  io.on('connection',socket=>{
    socket.on('general-chat:subscribe',async(ack)=>{
      try {
        const user=await get('SELECT is_banned,is_bank,suspended_until FROM users WHERE id=?',[socket.request.session?.userId]);
        if(user&&!user.is_banned&&!user.is_bank&&Number(user.suspended_until||0)<=Date.now()){
          await socket.join('general-chat');if(typeof ack==='function')ack({ok:true});
        }
      }catch{/* The next reconnect retries subscription. */}
    });
  });
}
module.exports={initializeGeneralChatSchema,registerGeneralChat};
