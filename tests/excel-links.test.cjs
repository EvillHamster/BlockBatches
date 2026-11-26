const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{once}=require('node:events'),ExcelJS=require('exceljs');
const rules=require('../dist/record-rules.js');
test('HTTP Excel round trip restores both links, same-SUP sources and chains after full deletion',{timeout:180000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),catalogs=require('../server/catalogs.cjs'),{createApp}=require('../server/server.cjs'),{mime}=require('../server/excel.cjs');let pool,server,created=false,cookie='';
 try{
  pool=await initialize();created=true;await repo.save(pool,'users',{name:'Excel links',login:'excel_links',role:'KEYUSER',password:'Excel-Links-Test-1'});
  const m1=await repo.save(pool,'mixtures',{name:'Смесь 001',archived:false}),m2=await repo.save(pool,'mixtures',{name:'Смесь 002',archived:false}),reason=await catalogs.add(pool,'reasons',{name:'Отклонение'}),special=await catalogs.add(pool,'reasons',{name:'Произведено из заблокированного MB'});
  server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  async function api(path,method='GET',body,xlsx=false){const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':xlsx?mime:'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:xlsx?body:JSON.stringify(body)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};}
  assert.equal((await api('/auth/login','POST',{login:'excel_links',password:'Excel-Links-Test-1'})).status,200);
  const base={date:'2026-11-24',sup:'0011223',mixtureId:m1,line:'MB',step:'M1',batchNumber:'01-03',palletNumber:'001-004',sampleNumber:'',blockedWeight:120.25,reasonId:reason.id,description:'Источник A',shift:2};
  const a=await api('/records','POST',base),b=await api('/records','POST',{...base,mixtureId:m2,line:'FM',step:'FMF',palletNumber:'22',description:'Источник B'});assert.equal(a.status,201);assert.equal(b.status,201);
  const c=await api('/records','POST',{...base,sup:'0099999',line:'RW',description:'Две ссылки <проверка> & сохранение',reasonId:special.id,sourceRecordIds:[a.body.id,b.body.id]});assert.equal(c.status,201);
  const d=await api('/records','POST',{...base,sup:'0000004',description:'Цепочка',reasonId:special.id,sourceRecordIds:[c.body.id,b.body.id]});assert.equal(d.status,201);
  const before=(await api('/state')).body;
  const exported=await api('/excel/records/export');assert.equal(exported.status,200);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(exported.body);const sheet=wb.worksheets[0],headers=sheet.getRow(1).values;
  const idCol=headers.indexOf('ID записи'),sourcesCol=headers.indexOf('Исходные записи (ID)');assert.ok(idCol);assert.ok(sourcesCol);
  const twoLinks=sheet.getRows(2,4).find(row=>row.getCell(idCol).value===c.body.id);assert.deepEqual(twoLinks.getCell(sourcesCol).value.split(/;\s*/).map(Number),[a.body.id,b.body.id]);
  // Keep dependent records before their sources, as a normal newest-first export does.
  assert.equal(sheet.getCell(2,idCol).value,d.body.id);
  const preview=await api('/records/bulk/preview','POST',{});assert.equal(preview.status,200);assert.equal(preview.body.blocked,false);
  const removed=await api('/records/bulk/commit','POST',{token:preview.body.token,confirmation:'УДАЛИТЬ ВСЁ'});assert.equal(removed.status,200);assert.equal(removed.body.deleted,4);assert.equal((await api('/state')).body.records.length,0);
  const check=await api('/excel/records/preview','POST',exported.body,true);assert.equal(check.status,200);assert.equal(check.body.errorCount,0,JSON.stringify(check.body.errors));assert.equal(check.body.added,4);
  const imported=await api('/excel/records/import','POST',exported.body,true);assert.equal(imported.status,200);assert.deepEqual(imported.body,{added:4,skipped:0});
  const after=(await api('/state')).body;
  function graph(state){return state.records.map(row=>({fields:rules.fields.map(([key])=>key==='mixtureId'?state.mixtures.find(m=>m.id===row[key]).name:key==='reasonId'?row.reasonName:key==='operatorId'?row.operatorName:row[key]),sources:rules.sourceIds(row).map(id=>{const source=state.records.find(r=>r.id===id);assert.ok(source,'Every link has a target');return source.description;}).sort()})).sort((a,b)=>JSON.stringify(a.fields).localeCompare(JSON.stringify(b.fields)));}
  assert.deepEqual(graph(after),graph(before));assert.ok(after.records.every(row=>!before.records.some(old=>old.id===row.id)));
  assert.equal(after.records.find(row=>row.sup==='0099999').sourceRecordIds.length,2);
  const repeat=await api('/excel/records/import','POST',exported.body,true);assert.equal(repeat.status,200);assert.deepEqual(repeat.body,{added:0,skipped:4});
  const again=await api('/excel/records/export');assert.equal(again.status,200);const againPreview=await api('/excel/records/preview','POST',again.body,true);assert.equal(againPreview.body.errorCount,0);assert.equal(againPreview.body.skipped,4);
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
