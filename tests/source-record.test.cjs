const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const ExcelJS=require('exceljs');
const rules=require('../dist/record-rules.js');
test('source links persist across lines, reject invalid links and preserve history and Excel',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repository=require('../server/repository.cjs'),catalogs=require('../server/catalogs.cjs'),excel=require('../server/excel.cjs');let pool,created=false;
 try{
  pool=await initialize();created=true;
  const mixtureId=await repository.save(pool,'mixtures',{name:'Смесь источника',archived:false});
  const reason=await catalogs.add(pool,'reasons',{name:'Другая причина'}),special=await catalogs.add(pool,'reasons',{name:'Произведено из заблокированного MB'});
  assert.ok(rules.requiresSource('  произведено   из ЗАБЛОКИРОВАННОГО mb '));
  const base={date:'2026-11-22',sup:'0000001',line:'RW',step:'MA',mixtureId,batchNumber:'1',palletNumber:'1',sampleNumber:'1',blockedWeight:1,reasonId:reason.id,description:'Источник',shift:1};
  const sourceId=await repository.save(pool,'records',base);
  const child={...base,sup:'0000002',line:'FM',reasonId:special.id};
  await assert.rejects(repository.save(pool,'records',child),e=>e.status===400&&Boolean(e.fields.sourceRecordId));
  await assert.rejects(repository.save(pool,'records',{...child,sourceRecordId:2147483647}),e=>e.status===400);
  const childId=await repository.save(pool,'records',{...child,sourceRecordId:sourceId});
  let state=await repository.state(pool),source=state.records.find(row=>row.id===sourceId),saved=state.records.find(row=>row.id===childId);
  assert.equal(saved.sourceRecordId,sourceId);assert.equal(source.line,'RW');
  await assert.rejects(repository.save(pool,'records',{...saved,sourceRecordId:childId,sourceRecordIds:[childId]},childId),e=>e.status===400);
  await assert.rejects(repository.save(pool,'records',{...source,reasonId:special.id,sourceRecordId:childId,sourceRecordIds:[childId]},sourceId),e=>e.status===400);
  await assert.rejects(repository.remove(pool,'records',sourceId,source.version),e=>e.status===409);
  const exported=await excel.exportWorkbook(pool,'records');const wb=new ExcelJS.Workbook();await wb.xlsx.load(exported.buffer);
  assert.equal(wb.worksheets[0].getCell('N1').value,'Исходная запись (ID)');
  const preview=await excel.previewImport(pool,'records',Buffer.from(exported.buffer));assert.equal(preview.errorCount,0);assert.equal(preview.skipped,2);
  await pool.close();pool=await initialize();state=await repository.state(pool);assert.equal(state.records.find(row=>row.id===childId).sourceRecordId,sourceId);
  saved=state.records.find(row=>row.id===childId);await repository.save(pool,'records',{...saved,reasonId:reason.id,sourceRecordId:null,sourceRecordIds:[]},childId);
  await repository.remove(pool,'records',sourceId,source.version);
 }finally{
  if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;
 }
});
