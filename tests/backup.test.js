const test=require('node:test'),assert=require('node:assert/strict'),sqlite3=require('sqlite3'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {backupDatabase}=require('../scripts/backup-data.cjs');
test('SQLite snapshots retain balances, pass integrity checks and never replace a previous backup',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'casino-backup-test-')),source=path.join(folder,'source.sqlite'),target=path.join(folder,'backup.sqlite');
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const db=new sqlite3.Database(source),run=sql=>new Promise((resolve,reject)=>db.run(sql,error=>error?reject(error):resolve()));
  await run('CREATE TABLE users(id INTEGER PRIMARY KEY, chips REAL)');await run('INSERT INTO users VALUES(1,123.45)');
  await backupDatabase(source,target);await run('UPDATE users SET chips=999');
  const copy=new sqlite3.Database(target,sqlite3.OPEN_READONLY);const get=sql=>new Promise((resolve,reject)=>copy.get(sql,(error,row)=>error?reject(error):resolve(row)));
  try{assert.equal((await get('SELECT chips FROM users')).chips,123.45);assert.equal((await get('PRAGMA integrity_check')).integrity_check,'ok');await assert.rejects(backupDatabase(source,target),/already exists/);}
  finally{await new Promise(r=>copy.close(r));await new Promise(r=>db.close(r));}
});
