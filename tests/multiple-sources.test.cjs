const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const ExcelJS=require('exceljs');
test('multiple sources survive export, full deletion and import with new identities',{timeout:180000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect,sql}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),catalogs=require('../server/catalogs.cjs'),excel=require('../server/excel.cjs'),bulk=require('../server/bulk-delete.cjs');let pool,created=false;
 try{
  pool=await initialize();created=true;
  const userId=await repo.save(pool,'users',{name:'Tester',login:'tester',role:'KEYUSER',password:'Test-Sources-1'}),user={id:userId,role:'KEYUSER'};
  const mixtureId=await repo.save(pool,'mixtures',{name:'Круговой импорт',archived:false}),ordinary=await catalogs.add(pool,'reasons',{name:'Проверка'}),special=await catalogs.add(pool,'reasons',{name:'Произведено из заблокированного MB'});
  const base={date:'2026-11-23',sup:'0000001',line:'RW',step:'MA',mixtureId,batchNumber:'1',palletNumber:'2',sampleNumber:'',blockedWeight:12.5,reasonId:ordinary.id,description:'Источник',shift:1};
  const a=await repo.save(pool,'records',base),b=await repo.save(pool,'records',{...base,sup:'0000002',line:'FM'});
  const child=await repo.save(pool,'records',{...base,sup:'0000003',reasonId:special.id,sourceRecordIds:[b,a,a]});
  const grandchild=await repo.save(pool,'records',{...base,sup:'0000004',reasonId:special.id,sourceRecordIds:[child,b]});
  let state=await repo.state(pool),saved=state.records.find(r=>r.id===child);
  assert.deepEqual(saved.sourceRecordIds,[a,b]);assert.equal(saved.sampleNumber,null);
  await assert.rejects(repo.remove(pool,'records',b,1),e=>e.status===409);
  const blocked=await bulk.preview(pool,user,{search:'0000002'});assert.ok(blocked.blocked);
  await assert.rejects(bulk.commit(pool,user,{token:blocked.token}),e=>e.status===409);
  await assert.rejects(repo.save(pool,'records',{...state.records.find(r=>r.id===a),reasonId:special.id,sourceRecordIds:[grandchild]},a),e=>e.status===400);
  await assert.rejects(repo.save(pool,'records',{...base,reasonId:special.id,sourceRecordIds:[a,2147483647]}),e=>e.status===400);
  await assert.rejects(repo.save(pool,'records',{...base,sourceRecordIds:[a]}),e=>e.status===400);
  await assert.rejects(repo.save(pool,'records',{...base,reasonId:special.id,sourceRecordIds:'invalid'}),e=>e.status===400);
  await pool.request().input('mix',sql.Int,mixtureId).query("INSERT dbo.Records(date,sup,mixtureId,line,actual,equipment,author) VALUES('2020-01-01',N'OLD-00001',@mix,'FMF',111.25,120,N'История')");
  const buffer=Buffer.from((await excel.exportWorkbook(pool,'records')).buffer);
  let preview=await excel.previewImport(pool,'records',buffer);assert.equal(preview.errorCount,0,JSON.stringify(preview.errors));assert.equal(preview.skipped,5);
  const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const sheet=book.worksheets[0],headers=sheet.getRow(1).values;
  const idColumn=headers.indexOf('ID записи'),sourcesColumn=headers.indexOf('Исходные записи (ID)');assert.ok(idColumn);assert.ok(sourcesColumn);
  const rows=sheet.getRows(2,5).map(r=>r.values);sheet.spliceRows(2,5,...rows.reverse().map(r=>r.slice(1)));const shuffled=Buffer.from(await book.xlsx.writeBuffer());
  const plan=await bulk.preview(pool,user,{});assert.equal((await bulk.commit(pool,user,{token:plan.token,confirmation:'УДАЛИТЬ ВСЁ'})).deleted,5);
  preview=await excel.previewImport(pool,'records',shuffled);assert.equal(preview.errorCount,0,JSON.stringify(preview.errors));assert.equal(preview.added,5);
  assert.deepEqual(await excel.commitImport(pool,'records',shuffled),{added:5,skipped:0});
  state=await repo.state(pool);const bySup=new Map(state.records.map(r=>[r.sup,r]));
  assert.notEqual(bySup.get('0000001').id,a);
  assert.deepEqual(new Set(bySup.get('0000003').sourceRecordIds),new Set([bySup.get('0000001').id,bySup.get('0000002').id]));
  assert.deepEqual(new Set(bySup.get('0000004').sourceRecordIds),new Set([bySup.get('0000003').id,bySup.get('0000002').id]));
  assert.equal(bySup.get('OLD-00001').recordFormatVersion,1);assert.equal(bySup.get('OLD-00001').actual,111.25);assert.equal(bySup.get('OLD-00001').equipment,120);assert.equal(bySup.get('OLD-00001').author,'История');
  assert.deepEqual(await excel.commitImport(pool,'records',buffer),{added:0,skipped:5});
  // A partially restored journal also maps old exported source IDs to existing duplicates.
  await repo.remove(pool,'records',bySup.get('0000004').id,1);
  assert.deepEqual(await excel.commitImport(pool,'records',buffer),{added:1,skipped:4});
  // Missing references and cycles must reject the whole import, leaving the database intact.
  const invalid=new ExcelJS.Workbook();await invalid.xlsx.load(buffer);const badSheet=invalid.worksheets[0];
  const childRow=badSheet.getRows(2,5).find(r=>String(r.getCell(2).value)==='0000003');childRow.getCell(sourcesColumn).value='2147483647';
  let bad=Buffer.from(await invalid.xlsx.writeBuffer());assert.ok((await excel.previewImport(pool,'records',bad)).errorCount);await assert.rejects(excel.commitImport(pool,'records',bad),e=>e.status===400);assert.equal((await repo.state(pool)).records.length,5);
  childRow.getCell(sourcesColumn).value=String(childRow.getCell(idColumn).value);bad=Buffer.from(await invalid.xlsx.writeBuffer());assert.ok((await excel.previewImport(pool,'records',bad)).errorCount);await assert.rejects(excel.commitImport(pool,'records',bad),e=>e.status===400);
  // Removing one source persists, including after migrations run again.
  saved=(await repo.state(pool)).records.find(r=>r.sup==='0000004');await repo.save(pool,'records',{...saved,sourceRecordIds:[bySup.get('0000002').id]},saved.id);
  await pool.close();pool=await initialize();assert.deepEqual((await repo.state(pool)).records.find(r=>r.id===saved.id).sourceRecordIds,[bySup.get('0000002').id]);
 }finally{if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
