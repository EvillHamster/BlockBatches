const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');
const ExcelJS=require('exceljs');
const excel=require('../server/excel.cjs');
const headers=require('../dist/record-rules.js').fields.map(([,label])=>label);
const recordRow=(date,sup,mixture,line,weight)=>[date,sup,line,'MA',mixture,'1','1','1',weight,'Проверка','Проверка',1,''];
async function book(columns,rows,name='Лист1'){
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet(name);
 sheet.addRow(columns);for(const row of rows)sheet.addRow(row);
 return Buffer.from(await wb.xlsx.writeBuffer());
}
test('Excel parser preserves codes and dates, validates rows and rejects formulas',async()=>{
 let buffer=await book(headers,[recordRow(new Date('2026-11-21T00:00:00Z'),'0011234','Смесь','MB','120,5')]);
 let parsed=await excel.parseWorkbook('records',buffer);
 assert.equal(parsed.errorCount,0);
 assert.equal(parsed.rows[0].value.date,'2026-11-21');
 assert.equal(parsed.rows[0].value.sup,'0011234');
 assert.equal(parsed.rows[0].value.blockedWeight,120.5);
 buffer=await book(headers,[recordRow('21.11.2026','0011223','Смесь','FM',{formula:'1+1',result:2}),recordRow('2026-02-30','0011223','Смесь','MB',120)]);
 parsed=await excel.parseWorkbook('records',buffer);
 assert.equal(parsed.errorCount,2);assert.equal(parsed.errors[0].row,2);
 assert.match(parsed.errors[0].message,/Формулы/);
 await assert.rejects(excel.parseWorkbook('records',await book(['Дата'],[])),e=>e.status===400);
 await assert.rejects(excel.parseWorkbook('mixtures',Buffer.from('not excel')),e=>e.status===400);
 assert.equal((await excel.parseWorkbook('mixtures',await book(['Название смеси'],[]))).total,0);
 await assert.rejects(excel.parseWorkbook('users',buffer),e=>e.status===404);
});

test('Excel API: all roles, preview, atomic validation, duplicates and round trip',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');
 process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repository=require('../server/repository.cjs');
 const {createApp}=require('../server/server.cjs');
 let pool,server,created=false,cookie='';
 try{
  pool=await initialize();created=true;
  for(const [login,role] of [['keyuser','KEYUSER'],['quality','QUALITY'],['admin','ADMIN'],['employer','EMPLOYER'],['engineer','ENGINEER']])
   await repository.save(pool,'users',{name:login,login,role,password:'Excel-Test-Password-'+login});
  await require('../server/catalogs.cjs').add(pool,'reasons',{name:'Проверка'});
  const originalId=await repository.save(pool,'mixtures',{name:'Тест 01',archived:false});
  server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const request=async(path,method='GET',body,isExcel=false)=>{
   const response=await fetch(origin+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':isExcel?excel.mime:'application/json'},...(body!==undefined?{body:isExcel?body:JSON.stringify(body)}:{})});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
   const binary=response.headers.get('content-type')?.startsWith(excel.mime);
   return {status:response.status,body:binary?Buffer.from(await response.arrayBuffer()):await response.json()};
  };
  assert.equal((await request('/excel/records/export')).status,401);
  const sample=await book(['Название смеси','Статус'],[['Тест 01','В работе']]);
  for(const login of ['keyuser','quality','admin','employer','engineer']){
   assert.equal((await request('/auth/login','POST',{login,password:'Excel-Test-Password-'+login})).status,200);
   assert.equal((await request('/excel/records/export')).status,login==='employer'?403:200);
   assert.equal((await request('/excel/mixtures/export')).status,['quality','employer'].includes(login)?403:200);
   assert.equal((await request('/excel/mixtures/preview','POST',sample,true)).status,['quality','employer'].includes(login)?403:200);
   assert.equal((await request('/excel/mixtures/import','POST',sample,true)).status,['quality','employer'].includes(login)?403:200);
  }
  await request('/auth/login','POST',{login:'engineer',password:'Excel-Test-Password-engineer'});
  assert.equal((await request('/excel/users/export')).status,404);
  let buffer=await book(['Название смеси','Статус'],[['Новая 01','В работе'],['Ошибка','Непонятно']]);
  let result=await request('/excel/mixtures/preview','POST',buffer,true);
  assert.equal(result.body.errorCount,1);assert.equal(result.body.errors[0].row,3);
  assert.equal((await request('/excel/mixtures/import','POST',buffer,true)).status,400);
  assert.equal((await repository.state(pool)).mixtures.length,1);
  buffer=await book(['Название смеси','Статус'],[['Тест 01','В архиве'],['Новая 01','В архиве'],['новая 01','В работе'],['=2+2','В работе']]);
  result=await request('/excel/mixtures/preview','POST',buffer,true);
  assert.equal(result.body.added,2);assert.equal(result.body.skipped,2);
  assert.equal((await repository.state(pool)).mixtures.length,1);
  result=await request('/excel/mixtures/import','POST',buffer,true);
  assert.deepEqual(result.body,{added:2,skipped:2});
  let state=await repository.state(pool);
  assert.equal(state.mixtures.find(m=>m.id===originalId).archived,false);
  const exportedMix=await request('/excel/mixtures/export');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exportedMix.body);
  const formulaName=workbook.worksheets[0].getColumn(1).values.find(v=>v==='=2+2');
  assert.equal(formulaName,'=2+2');
  result=await request('/excel/mixtures/preview','POST',exportedMix.body,true);
  assert.equal(result.body.added,0);assert.equal(result.body.skipped,3);
  buffer=await book(headers,[recordRow('21.11.2026','0000001','Тест 01','MB',120.5),recordRow('21.11.2026','0000002','Нет такой смеси','MB',120)]);
  assert.equal((await request('/excel/records/import','POST',buffer,true)).status,400);
  assert.equal((await repository.state(pool)).records.length,0);
  const row=recordRow('21.11.2026','0000001','Тест 01','MB',120.5);
  buffer=await book(headers,[row,row,recordRow('2026-11-20','0000002','Новая 01','FM','122,5')]);
  result=await request('/excel/records/preview','POST',buffer,true);
  assert.equal(result.body.added,2);assert.equal(result.body.skipped,1);
  assert.equal((await repository.state(pool)).records.length,0);
  result=await request('/excel/records/import','POST',buffer,true);
  assert.deepEqual(result.body,{added:2,skipped:1});
  assert.deepEqual((await request('/excel/records/import','POST',buffer,true)).body,{added:0,skipped:3});
  const exported=await request('/excel/records/export?line=MB');
  const journal=new ExcelJS.Workbook();await journal.xlsx.load(exported.body);
  assert.equal(journal.worksheets[0].rowCount,2);
  assert.equal(journal.worksheets[0].getCell('B2').value,'0000001');
  assert.equal(journal.worksheets[0].getCell('I2').value,120.5);
  result=await request('/excel/records/preview','POST',exported.body,true);
  assert.equal(result.body.added,0);assert.equal(result.body.skipped,1);
  const concurrent=await book(headers,[recordRow('21.11.2026','0000003','Тест 01','MB',120)]);
  const both=await Promise.all([request('/excel/records/import','POST',concurrent,true),request('/excel/records/import','POST',concurrent,true)]);
  assert.equal(both[0].body.added+both[1].body.added,1);
  assert.equal((await repository.state(pool)).records.length,3);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(pool)await pool.close();
  if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}
  delete process.env.DB_NAME;
 }
});
