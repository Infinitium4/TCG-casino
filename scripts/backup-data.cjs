const sqlite3=require('sqlite3'),fs=require('node:fs'),path=require('node:path');
async function backupDatabase(source,destination){
  if(fs.existsSync(destination))throw Error('Backup destination already exists: '+destination);
  const db=await new Promise((resolve,reject)=>{const connection=new sqlite3.Database(source,sqlite3.OPEN_READONLY,error=>error?reject(error):resolve(connection));});
  db.configure('busyTimeout',5000);
  try{
    // SQLite produces a consistent snapshot while the source remains open for players.
    await new Promise((resolve,reject)=>db.run('VACUUM INTO ?',[destination],error=>error?reject(error):resolve()));
  }finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));}
}
async function main(){
  if(!process.argv[2])throw Error('Usage: node scripts/backup-data.cjs NEW_BACKUP_DIRECTORY');
  const source=path.resolve(process.env.DATA_DIR||path.join(__dirname,'..')),destination=path.resolve(process.argv[2]);
  if(!fs.existsSync(path.join(source,'database.sqlite')))throw Error('Source database not found. Set DATA_DIR.');
  fs.mkdirSync(destination); // Never overwrite a previous backup.
  for(const name of ['database.sqlite','sessions.sqlite'])if(fs.existsSync(path.join(source,name)))await backupDatabase(path.join(source,name),path.join(destination,name));
  console.log('SQLite snapshots saved to '+destination);
}
module.exports={backupDatabase};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
