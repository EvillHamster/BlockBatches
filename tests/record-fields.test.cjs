const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {once}=require('node:events');
const rules=require('../dist/record-rules.js');
const base={date:'2026-11-21',sup:'0011223',line:'MB',step:'MA',mixtureId:1,batchNumber:'1',palletNumber:'1',sampleNumber:'1',blockedWeight:0,reasonId:1,description:'Проверка',shift:1};
test('record rules preserve SUP and ranges, require all fields except operator',()=>{
 for(const sup of ['0011223','1111111'])assert.equal(rules.validate({...base,sup}).value.sup,sup);
 for(const sup of ['123456','12345678','１２３４５６７','12A4567','123-456'])assert.ok(rules.validate({...base,sup}).errors.sup);
 for(const batchNumber of ['0','5','5-12','001-012'])assert.equal(rules.validate({...base,batchNumber}).value.batchNumber,batchNumber);
 for(const batchNumber of ['12-5','-1','1-2-3','1.5','5-а','1 - 2'])assert.ok(rules.validate({...base,batchNumber}).errors.batchNumber);
 for(const value of ['0','12','12,75','12.75',0,12.75])assert.equal(rules.validate({...base,blockedWeight:value}).value.blockedWeight,Number(String(value).replace(',','.')));
 for(const value of ['-1','1-2','abc','1.2.3','1,2.3','1e3','1.','',Infinity]){
  if(value==='')assert.equal(rules.validate({...base,blockedWeight:value}).value.blockedWeight,null);
  else assert.ok(rules.validate({...base,blockedWeight:value}).errors.blockedWeight);
 }
 for(const line of rules.lines)assert.ok(rules.validate({...base,line}).valid);
 for(const step of rules.steps)assert.ok(rules.validate({...base,step}).valid);
 assert.equal(rules.validate(base).value.operatorId,null);
 assert.equal(rules.validate(base).value.reasonId,1);
 assert.equal(rules.validate(base).value.shift,1);
 for(const [key] of rules.fields){if(key!=='operatorId')assert.ok(rules.validate({...base,[key]:''}).errors[key],key);}
 assert.equal(rules.validate({...base,description:'   '}).valid,false);
 assert.equal(rules.localDate(new Date(2026,10,21,23,30)),'2026-11-21');
 assert.deepEqual(rules.recentRecordWindow(new Date(2026,0,3,12)),{from:'2025-12-28',to:'2026-01-03'});
});
test('search normalizes spaces and ё, ranks exact codes, supports word order and typos',()=>{
 const names=[{id:1,name:'Ёлкин Иван'},{id:2,name:'EPDM 70-01'},{id:3,name:'EPDM 70-02'},{id:4,name:'Иван Петров'}];
 assert.equal(rules.rankOptions(names,'  иВАН   еЛКИН ')[0].id,1);
 assert.equal(rules.rankOptions(names,'елкни')[0].id,1);
 assert.equal(rules.rankOptions(names,'EPDM 70-01')[0].id,2);
 assert.equal(rules.rankOptions(names,'EPDM 70-01').some(row=>row.id===3),false);
 assert.equal(rules.normalizeName(' ЁЛКИН  Иван '),rules.normalizeName('елкин Иван'));
});
test('record references persist, normalize duplicates and preserve legacy rows',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect,sql}=require('../server/db.cjs'),repository=require('../server/repository.cjs');
 const {createApp}=require('../server/server.cjs');let pool,server,created=false;
 try{
  pool=await initialize();created=true;
  const mixtureId=await repository.save(pool,'mixtures',{name:'EPDM test',archived:false});
  await repository.save(pool,'users',{name:'Tester',login:'tester',role:'KEYUSER',password:'Record-Test-Password-1'});
  await pool.request().input('mixture',sql.Int,mixtureId).query("INSERT INTO dbo.Records(date,sup,mixtureId,line,actual,equipment,author) VALUES('2026-11-20','10002843',@mixture,'FMF',111,116,N'История')");
  server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;let cookie='';
  const request=async(path,method='GET',body)=>{
   const response=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
   return {status:response.status,body:await response.json()};
  };
  assert.equal((await request('/catalogs/reasons','POST',{name:'Причина'})).status,401);
  await request('/auth/login','POST',{login:'tester',password:'Record-Test-Password-1'});
  let reason=await request('/catalogs/reasons','POST',{name:' Ёлка   тест '});
  assert.equal(reason.status,200);
  const reasonId=reason.body.id;
  reason=await request('/catalogs/reasons','POST',{name:'елка тест'});
  assert.equal(reason.body.id,reasonId);assert.equal(reason.body.created,false);
  const both=await Promise.all([request('/catalogs/operators','POST',{name:'Ёлкин Иван'}),request('/catalogs/operators','POST',{name:'  елкин   иван '})]);
  assert.equal(both[0].body.id,both[1].body.id);
  const operatorId=both[0].body.id;
  assert.equal((await request('/catalogs/operators','POST',{name:'ТолькоФамилия'})).status,400);
  assert.equal((await request('/catalogs/reasons','POST',{name:'   '})).status,400);
  let refs=(await request('/state')).body;
  const operator=refs.operators[0];
  assert.equal((await request('/catalogs/operators/'+operatorId,'PUT',{lastName:'Петров',firstName:'Иван',version:operator.version})).status,200);
  assert.equal((await request('/catalogs/operators/'+operatorId,'PUT',{lastName:'Петров',firstName:'Иван',version:operator.version})).status,409);
  const other=await request('/catalogs/operators','POST',{lastName:'Сидоров',firstName:'Пётр'});
  assert.equal((await request('/catalogs/operators/'+other.body.id,'PUT',{lastName:' петров ',firstName:'ИВАН',version:other.body.version})).status,409);
  assert.equal((await request('/catalogs/reasons/'+reasonId,'PUT',{name:'Ёлка тест новая',version:refs.reasons[0].version})).status,200);
  assert.equal((await request('/catalogs/reasons','POST',{name:'елка   тест НОВАЯ'})).body.id,reasonId);
  const record={...base,mixtureId,step:'RW/WO',batchNumber:'001-012',palletNumber:'0',sampleNumber:'7-7',blockedWeight:'125,75',reasonId,description:'Первая строка\nВторая строка',shift:4,operatorId};
  let result=await request('/records','POST',record);assert.equal(result.status,201);
  const id=result.body.id;
  assert.equal((await request('/catalogs/operators/'+operatorId,'DELETE',{version:2})).status,409);
  assert.equal((await request('/catalogs/reasons/'+reasonId,'DELETE',{version:2})).status,409);
  assert.equal((await request('/catalogs/operators/'+other.body.id,'DELETE',{version:99})).status,409);
  assert.equal((await request('/catalogs/operators/'+other.body.id,'DELETE',{version:other.body.version})).status,200);
  const unusedReason=await request('/catalogs/reasons','POST',{name:'Удаляемая причина'});
  assert.equal((await request('/catalogs/reasons/'+unusedReason.body.id,'DELETE',{version:unusedReason.body.version})).status,200);
  assert.equal((await request('/catalogs/reasons/'+unusedReason.body.id,'DELETE',{version:unusedReason.body.version})).status,409);
  assert.equal((await request('/records','POST',{...record,operatorId:null})).status,201);
  const invalid=await request('/records','POST',{...record,sup:'12345678',batchNumber:'12-5',blockedWeight:'-1'});
  assert.equal(invalid.status,400);assert.ok(invalid.body.fields.sup);assert.ok(invalid.body.fields.batchNumber);assert.ok(invalid.body.fields.blockedWeight);
  assert.equal((await request('/records','POST',{...record,reasonId:2147483647})).status,400);
  let state=(await request('/state')).body;
  const saved=state.records.find(row=>row.id===id);
  assert.equal(saved.blockedWeight,125.75);assert.equal(saved.batchNumber,'001-012');assert.equal(saved.reasonName,'Ёлка тест новая');
  assert.equal((await request('/records/'+id,'PUT',{...saved,operatorId:null,description:'Изменено'})).status,200);
  await new Promise(resolve=>server.close(resolve));server=null;await pool.close();
  pool=await initialize();
  state=await repository.state(pool);
  assert.equal(state.reasons.length,1);assert.equal(state.operators.length,1);
  const edited=state.records.find(row=>row.id===id);assert.equal(edited.operatorId,null);assert.equal(edited.description,'Изменено');
  const legacy=state.records.find(row=>row.recordFormatVersion===1);
  assert.equal(legacy.sup,'10002843');assert.equal(legacy.line,'FMF');assert.equal(legacy.actual,111);assert.equal(legacy.author,'История');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.close();
  if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}
  delete process.env.DB_NAME;
 }
});
