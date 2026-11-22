const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{once}=require('node:events');
const rules=require('../dist/record-rules.js');
test('indexed search preserves filtering and follows rebuilt data',()=>{
 const mixtures=[{id:1,name:'Смесь 101'},{id:2,name:'EPDM'}];
 const records=[{id:1,mixtureId:1,sup:'0000123',description:'Проверка',date:'2026-11-22',line:'MB'},{id:2,mixtureId:2,sup:'0000124',reasonName:'Дефект',operatorName:'Иванов',date:'2026-11-21',line:'FM'}];
 for(const f of [{},{search:'123'},{search:'СМЕСЬ'},{search:'иванов'},{search:'дефект',line:'FM'},{search:'проверка',mixture:2},{from:'2026-11-22'},{to:'2026-11-21',mixture:2}])assert.deepEqual(rules.filterRecords(records,mixtures,f,rules.buildRecordSearchIndex(records,mixtures)),rules.filterRecords(records,mixtures,f));
 records[0].description='Изменено';mixtures[0].name='Другая';
 const index=rules.buildRecordSearchIndex(records,mixtures);
 assert.equal(rules.filterRecords(records,mixtures,{search:'изменено'},index).length,1);
 assert.equal(rules.filterRecords(records,mixtures,{search:'смесь'},index).length,0);
});
test('conditional state is authenticated, account-specific and invalidated by mutations',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),catalogs=require('../server/catalogs.cjs'),{createApp}=require('../server/server.cjs');let pool,server,created=false;
 try{
  pool=await initialize();created=true;
  const password='Cache-Test-Password';
  await repo.save(pool,'users',{name:'Key',login:'key',role:'KEYUSER',password});
  const employeeId=await repo.save(pool,'users',{name:'Employee',login:'employee',role:'EMPLOYER',password});
  server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  async function login(login){const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
  const key=await login('key'),employee=await login('employee');
  async function state(cookie,etag){const r=await fetch(origin+'/api/state',{headers:{...(cookie?{Cookie:cookie}:{}),...(etag?{'If-None-Match':etag}:{})}});const text=await r.text();return {status:r.status,etag:r.headers.get('etag'),body:text?JSON.parse(text):null,text};}
  let previous=await state(key);assert.equal(previous.status,200);assert.ok(previous.etag);
  const unchanged=await state(key,previous.etag);assert.equal(unchanged.status,304);assert.equal(unchanged.text,'');
  assert.equal((await state(null,previous.etag)).status,401);
  const restricted=await state(employee,previous.etag);assert.equal(restricted.status,200);assert.equal(restricted.body.users.length,1);assert.equal(restricted.body.users[0].id,employeeId);assert.notEqual(restricted.etag,previous.etag);
  assert.equal((await state(key)).body.users.length,2);
  async function changed(mutate){await mutate();const next=await state(key,previous.etag);assert.equal(next.status,200);assert.notEqual(next.etag,previous.etag);previous=next;return next.body;}
  let mixtureId,reason,recordId;
  await changed(async()=>{mixtureId=await repo.save(pool,'mixtures',{name:'Тест',archived:false});});
  await changed(async()=>{reason=await catalogs.add(pool,'reasons',{name:'Проверка'});});
  await changed(()=>catalogs.add(pool,'operators',{lastName:'Иванов',firstName:'Иван'}));
  const base={date:'2026-11-22',sup:'0011223',line:'MB',step:'MA',mixtureId,batchNumber:'1',palletNumber:'1',sampleNumber:'1',blockedWeight:1,reasonId:reason.id,description:'Проверка',shift:1};
  await changed(async()=>{recordId=await repo.save(pool,'records',base);});
  let row=previous.body.records.find(r=>r.id===recordId);
  await changed(()=>repo.save(pool,'records',{...row,description:'Исправлено'},recordId));
  row=previous.body.records.find(r=>r.id===recordId);
  await changed(()=>repo.remove(pool,'records',recordId,row.version));
  const user=previous.body.users.find(u=>u.id===employeeId);
  await changed(()=>repo.save(pool,'users',{...user,name:'Quality',role:'QUALITY'},employeeId));
  const newRole=await state(employee,restricted.etag);assert.equal(newRole.status,200);assert.equal(newRole.body.users[0].role,'QUALITY');assert.equal(newRole.body.users.length,1);
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
