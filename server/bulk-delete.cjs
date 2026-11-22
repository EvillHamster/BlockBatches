const crypto=require('node:crypto');
const {sql}=require('./db.cjs'),repository=require('./repository.cjs'),{HttpError}=require('./validation.cjs');
const rules=require('../dist/record-rules.js'),Access=require('../dist/permissions.js');
const secret=crypto.randomBytes(32),receipts=new Map();
function filtersOf(body){
 const f={};for(const key of ['search','mixture','line','from','to']){const value=body?.[key]??'';if(typeof value!=='string'||value.length>1000)throw new HttpError(400,'Некорректные фильтры');f[key]=value;}
 if(f.mixture&&!/^[1-9]\d*$/.test(f.mixture))throw new HttpError(400,'Некорректная смесь');
 if(f.line&&!['MB','FM','RW','FMF'].includes(f.line))throw new HttpError(400,'Некорректная линия');
 for(const key of ['from','to'])if(f[key]&&!/^\d{4}-\d{2}-\d{2}$/.test(f[key]))throw new HttpError(400,'Некорректная дата');
 if(f.from&&f.to&&f.from>f.to)throw new HttpError(400,'Некорректный период');return f;
}
const digest=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(row=>[row.id,row.version]).sort((a,b)=>a[0]-b[0]))).digest('hex');
const sign=value=>crypto.createHmac('sha256',secret).update(value).digest('base64url');
function pack(value){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return data+'.'+sign(data);}
function unpack(token){
 if(typeof token!=='string'||token.length>10000)throw new HttpError(400,'Повторите предварительный просмотр');const [data,signature]=token.split('.');const expected=sign(data||'');
 if(!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new HttpError(400,'Недействительное подтверждение');
 let plan;try{plan=JSON.parse(Buffer.from(data,'base64url').toString());}catch{throw new HttpError(400,'Недействительное подтверждение');}
 if(plan.expires<Date.now())throw new HttpError(409,'Подтверждение истекло. Повторите предварительный просмотр');return plan;
}
async function preview(pool,user,body){
 const filters=filtersOf(body),state=await repository.state(pool),rows=rules.filterRecords(state.records,state.mixtures,filters);
 const all=!Object.values(filters).some(Boolean),count=rows.length;
 const ids=new Set(rows.map(row=>row.id));
 const blocked=state.records.some(row=>ids.has(row.sourceRecordId)&&!ids.has(row.id));
 return {count,all,filters,blocked,message:blocked?'На часть выбранных образцов ссылаются записи вне фильтра. Удаление невозможно без нарушения истории.':'',token:pack({userId:user.id,filters,digest:digest(rows),count,all,expires:Date.now()+10*60*1000,nonce:crypto.randomBytes(16).toString('hex')})};
}
async function commit(pool,user,body){
 const plan=unpack(body?.token);if(plan.userId!==user.id)throw new HttpError(403,'Чужое подтверждение');
 if(plan.all&&body.confirmation!=='УДАЛИТЬ ВСЁ')throw new HttpError(400,'Введите УДАЛИТЬ ВСЁ');
 for(const [key,value]of receipts)if(value.until<Date.now())receipts.delete(key);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await tx.request().query("DECLARE @r int;EXEC @r=sp_getapplock @Resource=N'DefectBatch-bulk-delete',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;IF @r<0 THROW 50004,'Bulk lock unavailable',1;");
  const state=await repository.state(tx),fresh=state.users.find(row=>row.id===user.id);if(!Access.can(fresh,'bulk'))throw new HttpError(403,'Массовое удаление недоступно');
  const receipt=receipts.get(plan.nonce);if(receipt){await tx.commit();return {deleted:receipt.deleted,repeated:true};}
  const rows=rules.filterRecords(state.records,state.mixtures,plan.filters);
  if(rows.length!==plan.count||digest(rows)!==plan.digest)throw new HttpError(409,'Состав или содержимое записей изменились. Обновите предварительный просмотр и подтвердите снова.');
  if(!rows.length)throw new HttpError(400,'Нет записей для удаления');
  const ids=new Set(rows.map(row=>row.id));
  if(state.records.some(row=>ids.has(row.sourceRecordId)&&!ids.has(row.id)))throw new HttpError(409,'На выбранные образцы ссылаются записи вне фильтра. Измените фильтры.');
  const pending=new Map(rows.map(row=>[row.id,row]));
  // Delete dependants before sources, preserving the existing foreign key.
  while(pending.size){const referenced=new Set([...pending.values()].map(row=>row.sourceRecordId));const leaves=[...pending.keys()].filter(id=>!referenced.has(id));if(!leaves.length)throw new HttpError(409,'Обнаружена циклическая связь образцов');for(let offset=0;offset<leaves.length;offset+=1000){const request=tx.request(),batch=leaves.slice(offset,offset+1000);batch.forEach((id,index)=>request.input('id'+index,sql.Int,id));await request.query('DELETE FROM dbo.Records WHERE id IN ('+batch.map((_,index)=>'@id'+index).join(',')+')');batch.forEach(id=>pending.delete(id));}}
  await tx.commit();receipts.set(plan.nonce,{deleted:rows.length,until:Date.now()+10*60*1000});return {deleted:rows.length};
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
module.exports={preview,commit};
