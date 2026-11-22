const { sql } = require('./db.cjs');
const { HttpError, normalize, positive } = require('./validation.cjs');
const {hashPassword} = require('./auth.cjs');
const {requiresSource}=require('../dist/record-rules.js');
const entities = {
  mixtures: { table: 'Mixtures', columns: { name: sql.NVarChar(100), archived: sql.Bit } },
  users: { table: 'Users', columns: { name: sql.NVarChar(120), login: sql.NVarChar(64), role: sql.VarChar(10) } },
  records: { table: 'Records', columns: { date: sql.VarChar(10), sup: sql.NVarChar(40), mixtureId: sql.Int, line: sql.VarChar(3),
    step:sql.NVarChar(16),batchNumber:sql.NVarChar(100),palletNumber:sql.NVarChar(100),sampleNumber:sql.NVarChar(100),
    blockedWeight:sql.Float,reasonId:sql.Int,description:sql.NVarChar(4000),shift:sql.TinyInt,operatorId:sql.Int,sourceRecordId:sql.Int,recordFormatVersion:sql.TinyInt } }
};
function entity(kind) {
  if (!Object.hasOwn(entities, kind)) throw new HttpError(404, 'Раздел не найден');
  return entities[kind];
}
async function state(pool) {
  const result = await pool.request().query(`
    SELECT id,name,archived,version FROM dbo.Mixtures ORDER BY name;
    SELECT id,name,login,role,version FROM dbo.Users ORDER BY id;
    SELECT r.id,CONVERT(varchar(10),r.date,23) AS date,r.sup,r.mixtureId,r.line,r.actual,r.equipment,r.author,r.version,
      r.step,r.batchNumber,r.palletNumber,r.sampleNumber,r.blockedWeight,r.reasonId,r.description,r.shift,r.operatorId,r.sourceRecordId,r.recordFormatVersion,
      reasons.name AS reasonName,operators.name AS operatorName
      FROM dbo.Records r LEFT JOIN dbo.Reasons reasons ON reasons.id=r.reasonId LEFT JOIN dbo.Operators operators ON operators.id=r.operatorId ORDER BY r.date DESC,r.id DESC;
    SELECT CONVERT(bit,1-CONVERT(int,browserImportCompleted)) AS canImport FROM dbo.AppState WHERE id=1;
    SELECT id,name,version FROM dbo.Reasons ORDER BY name;
    SELECT id,name,lastName,firstName,version FROM dbo.Operators ORDER BY name;
  `);
  return { mixtures: result.recordsets[0], users: result.recordsets[1], records: result.recordsets[2], canImport: result.recordsets[3][0].canImport,
    reasons:result.recordsets[4],operators:result.recordsets[5] };
}
async function save(pool, kind, body, id, options={}) {
  if(kind==='records'&&!(pool instanceof sql.Transaction)){
    const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{const result=await save(tx,kind,body,id,options);await tx.commit();return result;}
    catch(error){await tx.rollback().catch(()=>{});throw error;}
  }
  const { table, columns:baseColumns } = entity(kind);
  const values = normalize(kind, body);
  const columns={...baseColumns};
  if(kind==='records'){
    const reason=await pool.request().input('id',sql.Int,values.reasonId).query('SELECT name FROM dbo.Reasons WHERE id=@id');
    const needsSource=requiresSource(reason.recordset[0]?.name);
    let sourceError='';
    if(needsSource&&!values.sourceRecordId)sourceError='Выберите исходный заблокированный образец';
    if(values.sourceRecordId){
      if(!needsSource)sourceError='Связь с образцом доступна только для причины «Произведено из заблокированного MB»';
      else{
        const chain=await pool.request().input('source',sql.Int,values.sourceRecordId).input('self',sql.Int,id??null).query(`
          ;WITH chain AS (
            SELECT id,sourceRecordId,0 AS depth,CAST('/'+CAST(id AS varchar(11))+'/' AS varchar(max)) AS visited FROM dbo.Records WHERE id=@source
            UNION ALL SELECT r.id,r.sourceRecordId,c.depth+1,CAST(c.visited+CAST(r.id AS varchar(11))+'/' AS varchar(max))
            FROM dbo.Records r JOIN chain c ON r.id=c.sourceRecordId
            WHERE c.depth<100 AND c.visited NOT LIKE '%/'+CAST(r.id AS varchar(11))+'/%'
          ) SELECT id,depth FROM chain OPTION(MAXRECURSION 101)`);
        if(!chain.recordset.length)sourceError='Исходный образец уже удалён. Выберите другой';
        else if(chain.recordset.some(row=>row.id===id)||chain.recordset.some(row=>row.depth===100))sourceError='Нельзя создать циклическую связь образцов';
      }
    }
    if(sourceError){const error=new HttpError(400,sourceError);error.fields={sourceRecordId:sourceError};throw error;}
    for(const [key,table,label] of [['mixtureId','Mixtures','Смесь'],['reasonId','Reasons','Причина'],['operatorId','Operators','Оператор']]){
      if(values[key]===null)continue;
      const check=await pool.request().input('id',sql.Int,values[key]).query('SELECT id'+(key==='mixtureId'?',archived':'')+' FROM dbo.['+table+'] WHERE id=@id');
      if(key==='mixtureId'&&check.recordset[0]?.archived&&!options.allowArchivedMixture){const previous=id===undefined?null:(await pool.request().input('id',sql.Int,id).query('SELECT mixtureId FROM dbo.Records WHERE id=@id')).recordset[0];if(previous?.mixtureId!==values.mixtureId)throw new HttpError(400,'Выберите активную смесь. Архивная смесь доступна только в прежних записях.');}
      if(!check.recordset.length){const error=new HttpError(400,label+': выберите существующее значение');error.fields={[key]:error.message};throw error;}
    }
  }
  if(kind==='users'){
    if(id===undefined&&!body.password&&!options.allowPasswordless)throw new HttpError(400,'Укажите начальный пароль пользователя');
    if(body.password){
      values.passwordHash=await hashPassword(body.password);
      columns.passwordHash=sql.NVarChar(256);
    }
  }
  const request = pool.request();
  for (const [name, type] of Object.entries(columns)) request.input(name, type, values[name]);
  if (id !== undefined) {
    request.input('id', sql.Int, positive(id));
    request.input('version', sql.Int, positive(body.version, 'Версия'));
    const resetPassword=kind==='users'&&Boolean(values.passwordHash);
    const ownPasswordTransaction=resetPassword&&!(pool instanceof sql.Transaction);
    const result = await request.query((ownPasswordTransaction?'SET XACT_ABORT ON; BEGIN TRANSACTION; ':'')+(kind==='users'?'DECLARE @changed TABLE(id int); ':'')+'UPDATE dbo.[' + table + '] SET ' +
      Object.keys(columns).map(name => '[' + name + ']=@' + name).join(',') +
      ', version=version+1 OUTPUT INSERTED.id'+(kind==='users'?' INTO @changed':'')+' WHERE id=@id AND version=@version'+(kind==='users'?'; SELECT id FROM @changed;':'')+(resetPassword?'; IF @@ROWCOUNT>0 DELETE FROM dbo.Sessions WHERE userId=@id;'+(ownPasswordTransaction?' COMMIT TRANSACTION;':''):''));
    if (!result.recordset.length) throw new HttpError(409, 'Данные уже изменены или удалены. Обновите страницу и повторите.');
    return result.recordset[0].id;
  }
  const names = Object.keys(columns);
  const result = await request.query('INSERT INTO dbo.[' + table + '] (' + names.map(n => '[' + n + ']').join(',') +
    ') OUTPUT INSERTED.id VALUES (' + names.map(n => '@' + n).join(',') + '); UPDATE dbo.AppState SET browserImportCompleted=1 WHERE id=1;');
  return result.recordset[0].id;
}
async function remove(pool, kind, id, version) {
  const { table } = entity(kind);
  if(kind==='records'){
    const used=await pool.request().input('id',sql.Int,positive(id)).query('SELECT TOP(1) id FROM dbo.Records WHERE sourceRecordId=@id');
    if(used.recordset.length)throw new HttpError(409,'На этот образец ссылаются другие записи. Удаление недоступно.');
  }
  const result = await pool.request().input('id', sql.Int, positive(id)).input('version', sql.Int, positive(version, 'Версия'))
    .query((kind==='users'?'DECLARE @changed TABLE(id int); ':'')+'DELETE FROM dbo.[' + table + '] OUTPUT DELETED.id'+(kind==='users'?' INTO @changed':'')+' WHERE id=@id AND version=@version'+(kind==='users'?'; SELECT id FROM @changed;':''));
  if (!result.recordset.length) throw new HttpError(409, 'Данные уже изменены или удалены. Обновите страницу и повторите.');
}
async function importLocal(pool, body) {
  for (const key of ['users','mixtures','records']) {
    if (!Array.isArray(body?.[key]) || body[key].length > 10000) throw new HttpError(400, 'Некорректный файл переноса');
  }
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await tx.request().query("DECLARE @result int; EXEC @result=sp_getapplock @Resource=N'DefectBatch-import', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000; IF @result<0 THROW 50001, 'Import lock unavailable', 1;");
    const present = await tx.request().query('SELECT browserImportCompleted,(SELECT COUNT(*) FROM dbo.Users)+(SELECT COUNT(*) FROM dbo.Mixtures)+(SELECT COUNT(*) FROM dbo.Records) AS n FROM dbo.AppState WHERE id=1');
    if (present.recordset[0].n || present.recordset[0].browserImportCompleted) throw new HttpError(409, 'База уже инициализирована. Автоматический перенос отменён.');
    const mixtureIds = new Map();
    for (const mixture of body.mixtures) {
      positive(mixture.id);
      if (mixtureIds.has(mixture.id)) throw new HttpError(400, 'Повторный идентификатор смеси');
      mixtureIds.set(mixture.id, await save(tx, 'mixtures', mixture));
    }
    for (const user of body.users) await save(tx, 'users', user,undefined,{allowPasswordless:true});
    for (const record of body.records) {
      const mixtureId = mixtureIds.get(record.mixtureId);
      if (!mixtureId) throw new HttpError(400, 'В записи указана отсутствующая смесь');
      await save(tx, 'records', { ...record, mixtureId });
    }
    await tx.request().query('UPDATE dbo.AppState SET browserImportCompleted=1 WHERE id=1');
    await tx.commit();
  } catch (error) { await tx.rollback().catch(() => {}); throw error; }
}
function safeError(error) {
  if (error instanceof HttpError) return error;
  const number = error.number || error.originalError?.info?.number || error.originalError?.number;
  if(number===50003)return new HttpError(409,'Нельзя удалить keyuser, снять его роль или создать второго keyuser');
  if ([2601,2627].includes(number)) return new HttpError(409, 'Такое название смеси или логин уже существует');
  if (number === 547) return new HttpError(409, 'Проверьте смесь: она отсутствует или используется в журнале. Используемую смесь можно перенести в архив.');
  return new HttpError(503, 'Не удалось выполнить запрос к базе данных. Повторите попытку.');
}
module.exports = { state, save, remove, importLocal, safeError };
