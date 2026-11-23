const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{once}=require('node:events');
test('first-run registration is atomic, creates one keyuser and stays closed after restart',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),{createApp}=require('../server/server.cjs');let pool,server,created=false;
 try{
  pool=await initialize();created=true;
  async function listen(){server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
  let origin=await listen();
  async function request(path,body,headers={}){const r=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const account={name:'Первый keyuser',login:'firstkey',password:'4826',passwordConfirm:'4826',role:'EMPLOYER'};
  assert.equal((await request('/setup')).body.available,true);
  assert.equal((await request('/state')).status,401);
  assert.equal((await request('/setup/register',{...account,passwordConfirm:'different'})).status,400);
  assert.equal((await request('/setup/register',{...account,password:'123',passwordConfirm:'123'})).status,400);
  assert.equal((await request('/setup/register',{...account,login:'!'})).status,400);
  assert.equal((await request('/setup/register',account,{Origin:'https://other.example'})).status,403);
  assert.equal((await request('/setup')).body.available,true);
  const results=await Promise.all([request('/setup/register',account),request('/setup/register',{...account,login:'secondkey'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winner=results.find(r=>r.status===201);assert.equal(winner.body.user.role,'KEYUSER');assert.ok(winner.cookie);assert.equal(winner.body.user.passwordHash,undefined);
  const state=await request('/state',undefined,{Cookie:winner.cookie});assert.equal(state.status,200);assert.equal(state.body.users.length,1);
  assert.equal((await request('/setup')).body.available,false);
  assert.equal((await request('/setup/register',{...account,login:'thirdkey'})).status,409);
  await new Promise(r=>server.close(r));server=null;await pool.close();pool=await initialize();origin=await listen();
  assert.equal((await request('/setup')).body.available,false);
  assert.equal((await request('/state',undefined,{Cookie:winner.cookie})).status,200);
  assert.equal((await request('/auth/login',{login:winner.body.user.login,password:'4826'})).status,200);
  const sqlState=await pool.request().query('SELECT initialSetupCompleted FROM dbo.AppState;SELECT COUNT(*) n FROM dbo.Users');assert.equal(sqlState.recordsets[0][0].initialSetupCompleted,true);assert.equal(sqlState.recordsets[1][0].n,1);
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
test('existing accounts permanently disable initial registration without resetting credentials',{timeout:120000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),setup=require('../server/initial-setup.cjs'),auth=require('../server/auth.cjs');let pool,created=false;
 try{
  pool=await initialize();created=true;await repo.save(pool,'users',{name:'Existing',login:'existing',role:'KEYUSER',password:'Existing-Password-1'});
  // Simulate an old installation before migration 010 runs.
  await pool.request().query('UPDATE dbo.AppState SET initialSetupCompleted=0');
  assert.equal(await setup.available(pool),false);
  await pool.close();pool=await initialize();
  const before=(await pool.request().query('SELECT id,login,passwordHash,version FROM dbo.Users')).recordset[0];
  assert.equal(await setup.available(pool),false);assert.ok(await auth.verifyPassword('Existing-Password-1',before.passwordHash));
  await assert.rejects(setup.register(pool,{name:'Other',login:'other',password:'1234',passwordConfirm:'1234'}),e=>e.status===409);
  const after=(await pool.request().query('SELECT id,login,passwordHash,version FROM dbo.Users')).recordset[0];assert.deepEqual(after,before);
  // A latched installation cannot reopen registration even if users are removed externally.
  await pool.request().query('DISABLE TRIGGER dbo.TR_Users_ProtectKeyUser ON dbo.Users; DELETE dbo.Users; ENABLE TRIGGER dbo.TR_Users_ProtectKeyUser ON dbo.Users');
  assert.equal(await setup.available(pool),false);
 }finally{if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
