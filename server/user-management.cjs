const {sql}=require('./db.cjs');
const repository=require('./repository.cjs');
const {HttpError,positive}=require('./validation.cjs');
const Access=require('../dist/permissions.js');
function confirmPassword(body,required=false){
 const password=body?.password,confirmation=body?.passwordConfirm;
 const empty=value=>value===undefined||value===null||value==='';
 if(!required&&empty(password)&&empty(confirmation))return;
 if(typeof password!=='string'||!password||password!==confirmation){const error=new HttpError(400,'Пароли должны совпадать');error.fields={passwordConfirm:'Пароли должны совпадать'};throw error;}
 require('./auth.cjs').passwordValid(password);
}
async function mutate(pool,actor,method,body,id){
 if(!Access.can(actor,'users'))throw new HttpError(403,'Управление пользователями недоступно');
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  // Serialize role changes and re-read the trusted actor within the mutation.
  await tx.request().query("DECLARE @r int;EXEC @r=sp_getapplock @Resource=N'DefectBatch-users',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;IF @r<0 THROW 50004,'User lock unavailable',1;");
  const fresh=(await tx.request().input('id',sql.Int,actor.id).query('SELECT id,role FROM dbo.Users WHERE id=@id')).recordset[0];
  if(!Access.can(fresh,'users'))throw new HttpError(403,'Управление пользователями недоступно');
  let target;
  if(id!==undefined){positive(id);target=(await tx.request().input('id',sql.Int,id).query('SELECT id,role FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE id=@id')).recordset[0];if(!target)throw new HttpError(409,'Пользователь уже удалён');}
  if(target&&!Access.manageUser(fresh,target))throw new HttpError(403,'Администратор не может изменять keyuser');
  if(method==='DELETE'){
   if(target.role==='KEYUSER')throw new HttpError(403,'Единственного keyuser нельзя удалить');
   if(id===actor.id)throw new HttpError(400,'Нельзя удалить собственную учётную запись');
   await repository.remove(tx,'users',id,body.version);
  }else{
   if((body.role==='KEYUSER'&&target?.role!=='KEYUSER')||(target?.role==='KEYUSER'&&body.role!=='KEYUSER'))throw new HttpError(403,'Нельзя создать второго keyuser или снять эту роль');
   confirmPassword(body,id===undefined);
   id=await repository.save(tx,'users',body,id);
  }
  await tx.commit();return id;
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
module.exports={mutate,confirmPassword};
