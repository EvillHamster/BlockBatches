const {sql}=require('./db.cjs');
const {HttpError,positive}=require('./validation.cjs');
const {normalizeName}=require('../dist/record-rules.js');
function details(kind,body){
 const clean=value=>typeof value==='string'?value.trim().replace(/\s+/gu,' '):'';
 let name=clean(body?.name),lastName=null,firstName=null;
 if(kind==='operators'){
  lastName=clean(body?.lastName);firstName=clean(body?.firstName);
  // Keep the existing inline add API: first word is surname, remaining words are given name.
  if(!lastName&&!firstName&&name.includes(' ')){const parts=name.split(' ');lastName=parts.shift();firstName=parts.join(' ');}
  if(!lastName||!firstName||lastName.length>100||firstName.length>100)throw new HttpError(400,'Укажите фамилию и имя оператора (до 100 символов каждое)');
  name=lastName+' '+firstName;
 }
 if(!name||name.length>200)throw new HttpError(400,'Введите текст от 1 до 200 символов');
 return {name,normalizedName:normalizeName(name),lastName,firstName};
}
async function save(pool,kind,body,id){
 const table=kind==='reasons'?'Reasons':kind==='operators'?'Operators':null;
 if(!table)throw new HttpError(404,'Справочник не найден');
 const value=details(kind,body);
 if(id!==undefined){positive(id);positive(body.version,'Версия');}
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  const req=tx.request().input('name',sql.NVarChar(200),value.name).input('normalized',sql.NVarChar(200),value.normalizedName);
  const duplicate=(await req.query(`SELECT id FROM dbo.[${table}] WITH(UPDLOCK,HOLDLOCK) WHERE normalizedName=@normalized`)).recordset[0];
  if(duplicate&&duplicate.id!==id){
   if(id!==undefined)throw new HttpError(409,'Такая запись уже есть в справочнике');
   const existing=(await tx.request().input('id',sql.Int,duplicate.id).query(`SELECT *,CONVERT(bit,0) AS created FROM dbo.[${table}] WHERE id=@id`)).recordset[0];
   await tx.commit();return existing;
  }
  if(kind==='operators')req.input('lastName',sql.NVarChar(100),value.lastName).input('firstName',sql.NVarChar(100),value.firstName);
  const operatorSet=kind==='operators'?',lastName=@lastName,firstName=@firstName':'';
  let result;
  if(id!==undefined){
   req.input('id',sql.Int,id).input('version',sql.Int,body.version);
   result=await req.query(`UPDATE dbo.[${table}] SET name=@name,normalizedName=@normalized${operatorSet},version=version+1 OUTPUT INSERTED.* WHERE id=@id AND version=@version`);
   if(!result.recordset.length)throw new HttpError(409,'Запись уже изменена. Обновите страницу и повторите.');
  }else result=await req.query(`INSERT INTO dbo.[${table}](name,normalizedName${kind==='operators'?',lastName,firstName':''}) OUTPUT INSERTED.* VALUES(@name,@normalized${kind==='operators'?',@lastName,@firstName':''})`);
  await tx.commit();return {...result.recordset[0],created:id===undefined};
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
async function remove(pool,kind,id,version){
 const table=kind==='reasons'?'Reasons':kind==='operators'?'Operators':null;
 if(!table)throw new HttpError(404,'Справочник не найден');
 positive(id);positive(version,'Версия');
 try{
  const result=await pool.request().input('id',sql.Int,id).input('version',sql.Int,version)
   .query(`DELETE FROM dbo.[${table}] OUTPUT DELETED.id WHERE id=@id AND version=@version`);
  if(!result.recordset.length)throw new HttpError(409,'Запись уже изменена или удалена. Обновите страницу.');
 }catch(error){
  const number=error.number||error.originalError?.info?.number||error.originalError?.number;
  if(number===547)throw new HttpError(409,'Запись используется в журнале контроля. Удаление недоступно, чтобы сохранить историю.');
  throw error;
 }
}
module.exports={add:(pool,kind,body)=>save(pool,kind,body),edit:save,remove};
