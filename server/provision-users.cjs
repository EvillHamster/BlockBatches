const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { initialize,sql } = require('./db.cjs');
const { hashPassword } = require('./auth.cjs');

async function provision(){
  const pool=await initialize();
  const credentials=[];
  const tx=new sql.Transaction(pool);
  let outputFile;
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    await tx.request().query("DECLARE @result int; EXEC @result=sp_getapplock @Resource=N'DefectBatch-provision',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @result<0 THROW 50001,'Provision lock unavailable',1;");
    for(const [login,role] of [['keyuser','KEYUSER'],['quality','QUALITY'],['admin','ADMIN'],['employer','EMPLOYER']]){
      if(role==='KEYUSER'&&(await tx.request().query("SELECT id FROM dbo.Users WHERE role='KEYUSER'")).recordset.length)continue;
      const existing=await tx.request().input('login',sql.NVarChar(64),login).query('SELECT id,passwordHash FROM dbo.Users WHERE login=@login');
      if(existing.recordset[0]?.passwordHash)continue;
      const password=randomBytes(18).toString('base64url');
      const hash=await hashPassword(password);
      const request=tx.request().input('login',sql.NVarChar(64),login).input('role',sql.VarChar(10),role).input('hash',sql.NVarChar(256),hash);
      if(existing.recordset.length){
        request.input('id',sql.Int,existing.recordset[0].id);
        await request.query('UPDATE dbo.Users SET role=@role,passwordHash=@hash,version=version+1 WHERE id=@id AND passwordHash IS NULL');
      }else{
        await request.query('INSERT INTO dbo.Users(name,login,role,passwordHash) VALUES(@login,@login,@role,@hash); UPDATE dbo.AppState SET browserImportCompleted=1 WHERE id=1;');
      }
      credentials.push({login,password});
    }
    if(credentials.length){
      const directory=path.resolve(__dirname,'../.local');
      await fs.mkdir(directory,{recursive:true});
      let filename=path.join(directory,'initial-credentials.txt');
      try{await fs.access(filename);filename=path.join(directory,'initial-credentials-'+Date.now()+'.txt');}catch{}
      outputFile=filename;
      const content='DefectBatch — начальные пароли\nСозданы: '+new Date().toISOString()+'\n\n'+credentials.map(c=>c.login+'\t'+c.password).join('\n')+'\n\nПароли можно изменить в настройках своего аккаунта.\nФайл не включается в архив проекта.\n';
      await fs.writeFile(filename,content,{flag:'wx'});
      await tx.commit();
      console.log('Начальные пароли сохранены: '+path.relative(path.resolve(__dirname,'..'),filename));
    }else{await tx.commit();console.log('Учётные записи уже имеют пароли. Они не изменены.');}
  }catch(error){
    await tx.rollback().catch(()=>{});
    if(outputFile)await fs.unlink(outputFile).catch(()=>{});
    throw error;
  }finally{await pool.close();}
}
if(require.main===module)provision().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={provision};
