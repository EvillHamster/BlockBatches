const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {sql}=require('./db.cjs');
async function ensure(pool){
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);let file;
 try{
  await tx.request().query("DECLARE @r int;EXEC @r=sp_getapplock @Resource=N'DefectBatch-users',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;IF @r<0 THROW 50004,'User lock unavailable',1;");
  const existing=await tx.request().query("SELECT id,login,passwordHash FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE role='KEYUSER'");
  if(existing.recordset[0]?.passwordHash){await tx.commit();return;}
  const password=crypto.randomBytes(18).toString('base64url'),hash=await require('./auth.cjs').hashPassword(password);
  const logins=(await tx.request().query('SELECT login FROM dbo.Users')).recordset.map(row=>row.login.toLowerCase());
  const login=existing.recordset[0]?.login||(logins.includes('keyuser')?'keyuser-'+crypto.randomBytes(4).toString('hex'):'keyuser');
  const request=tx.request().input('login',sql.NVarChar(64),login).input('hash',sql.NVarChar(256),hash);
  if(existing.recordset.length)await request.input('id',sql.Int,existing.recordset[0].id).query('UPDATE dbo.Users SET passwordHash=@hash,version=version+1 WHERE id=@id AND passwordHash IS NULL');
  else await request.query("INSERT INTO dbo.Users(name,login,role,passwordHash) VALUES(N'keyuser',@login,'KEYUSER',@hash)");
  await fs.mkdir(path.join(__dirname,'../.local'),{recursive:true});file=path.join(__dirname,'../.local/keyuser-bootstrap-'+Date.now()+'.txt');
  await fs.writeFile(file,'DefectBatch — первоначальная настройка\nЛогин: '+login+'\nПароль: '+password+'\n',{flag:'wx'});await tx.commit();console.log('Создан keyuser. Данные входа: '+file);
 }catch(error){await tx.rollback().catch(()=>{});if(file)await fs.unlink(file).catch(()=>{});throw error;}
}
module.exports={ensure};
