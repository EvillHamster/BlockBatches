const {sql}=require('./db.cjs'),repository=require('./repository.cjs');
const {HttpError}=require('./validation.cjs'),{confirmPassword}=require('./user-management.cjs');
async function available(pool){
 const result=await pool.request().query('SELECT initialSetupCompleted,(SELECT COUNT(*) FROM dbo.Users) AS users FROM dbo.AppState WHERE id=1');
 const state=result.recordset[0];return Boolean(state&&!state.initialSetupCompleted&&!state.users);
}
async function register(pool,body){
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await tx.request().query("DECLARE @r int;EXEC @r=sp_getapplock @Resource=N'DefectBatch-users',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;IF @r<0 THROW 50004,'Setup lock unavailable',1;");
  if(!await available(tx))throw new HttpError(409,'Первоначальный аккаунт уже создан. Войдите в систему.');
  confirmPassword(body,true);
  // The role is assigned here, never trusted from an unauthenticated request.
  const id=await repository.save(tx,'users',{name:body?.name,login:body?.login,password:body?.password,role:'KEYUSER'});
  await tx.request().query('UPDATE dbo.AppState SET initialSetupCompleted=1 WHERE id=1');
  await tx.commit();return id;
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
module.exports={available,register};
