const { sql } = require('./db.cjs');
const { HttpError, normalize, positive } = require('./validation.cjs');
const {hashPassword} = require('./auth.cjs');
const entities = {
  mixtures: { table: 'Mixtures', columns: { name: sql.NVarChar(100), archived: sql.Bit } },
  users: { table: 'Users', columns: { name: sql.NVarChar(120), login: sql.NVarChar(64), role: sql.VarChar(10) } },
  records: { table: 'Records', columns: { date: sql.VarChar(10), sup: sql.NVarChar(40), mixtureId: sql.Int, line: sql.VarChar(3), actual: sql.Decimal(10,2), equipment: sql.Decimal(10,2), author: sql.NVarChar(120) } }
};
function entity(kind) {
  if (!Object.hasOwn(entities, kind)) throw new HttpError(404, 'Раздел не найден');
  return entities[kind];
}
async function state(pool) {
  const result = await pool.request().query(`
    SELECT id,name,archived,version FROM dbo.Mixtures ORDER BY name;
    SELECT id,name,login,role,version FROM dbo.Users ORDER BY id;
    SELECT id,CONVERT(varchar(10),date,23) AS date,sup,mixtureId,line,actual,equipment,author,version
      FROM dbo.Records ORDER BY date DESC,id DESC;
    SELECT CONVERT(bit,1-CONVERT(int,browserImportCompleted)) AS canImport FROM dbo.AppState WHERE id=1;
  `);
  return { mixtures: result.recordsets[0], users: result.recordsets[1], records: result.recordsets[2], canImport: result.recordsets[3][0].canImport };
}
async function save(pool, kind, body, id, options={}) {
  const { table, columns:baseColumns } = entity(kind);
  const values = normalize(kind, body);
  const columns={...baseColumns};
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
    const result = await request.query((resetPassword?'SET XACT_ABORT ON; BEGIN TRANSACTION; ':'')+'UPDATE dbo.[' + table + '] SET ' +
      Object.keys(columns).map(name => '[' + name + ']=@' + name).join(',') +
      ', version=version+1 OUTPUT INSERTED.id WHERE id=@id AND version=@version'+(resetPassword?'; IF @@ROWCOUNT>0 DELETE FROM dbo.Sessions WHERE userId=@id; COMMIT TRANSACTION;':''));
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
  const result = await pool.request().input('id', sql.Int, positive(id)).input('version', sql.Int, positive(version, 'Версия'))
    .query('DELETE FROM dbo.[' + table + '] OUTPUT DELETED.id WHERE id=@id AND version=@version');
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
  if ([2601,2627].includes(number)) return new HttpError(409, 'Такое название смеси или логин уже существует');
  if (number === 547) return new HttpError(409, 'Проверьте смесь: она отсутствует или используется в журнале. Используемую смесь можно перенести в архив.');
  return new HttpError(503, 'Не удалось выполнить запрос к базе данных. Повторите попытку.');
}
module.exports = { state, save, remove, importLocal, safeError };
