const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { normalize } = require('../server/validation.cjs');

test('validation rejects invalid dates, numbers and user roles', () => {
  const record = { step:'MA',batchNumber:'1',palletNumber:'1',sampleNumber:'1',reasonId:1,description:'Проверка',shift:1,date:'2026-11-21',sup:'0011223',mixtureId:1,line:'MB',blockedWeight:120.5 };
  for (const change of [{date:'2026-02-30'},{blockedWeight:-1},{blockedWeight:'12x'},{blockedWeight:Infinity},{mixtureId:0},{line:'other'},{sup:'   '}])
    assert.throws(() => normalize('records', {...record,...change}));
  assert.equal(normalize('records',record).blockedWeight,120.5);
  assert.throws(() => normalize('users',{name:'Имя',login:'admin',role:'OWNER'}));
});

test('password length boundaries are 4 to 128 characters',()=>{
 const {passwordValid}=require('../server/auth.cjs');
 for(const length of [4,128])assert.equal(passwordValid('a'.repeat(length)).length,length);
 for(const length of [0,3,129])assert.throws(()=>passwordValid('a'.repeat(length)),error=>error.status===400);
});

test('SQL Server API: migration, CRUD, persistence and conflict protection', {timeout:120000}, async () => {
  const database = 'DefectBatch_Test_' + randomBytes(6).toString('hex');
  assert.match(database,/^DefectBatch_Test_[0-9a-f]{12}$/);
  process.env.DB_NAME = database;
  const { initialize, connect } = require('../server/db.cjs');
  const { createApp } = require('../server/server.cjs');
  let pool, server, created = false;
  try {
    pool = await initialize(); created = true;
    server = createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    let sessionCookie='';
    const request = async (path,method='GET',body,extra={}) => {
      const response = await fetch(origin + '/api' + path, {method,headers:{'Content-Type':'application/json',...(sessionCookie?{Cookie:sessionCookie}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      const setCookie=response.headers.get('set-cookie');if(setCookie)sessionCookie=setCookie.split(';')[0];
      return { status:response.status, body:await response.json(),cookie:response.headers.get('set-cookie') };
    };
    assert.equal((await request('/health')).body.ok,true);
    assert.equal((await request('/state')).status,401);
    const legacy = {
      mixtures:[{id:27,name:'Тестовая смесь',archived:false}],
      users:[{id:10,name:'Иван',login:'ivan',role:'ADMIN',password:'Initial-Test-Password-1'}],
      records:[{id:5,date:'2026-11-21',sup:'0011223',mixtureId:27,line:'MB',blockedWeight:120.5,step:'MA',batchNumber:'1',palletNumber:'1',sampleNumber:'1',reasonId:1,description:'Проверка',shift:1}]
    };
    const repository=require('../server/repository.cjs');
    await require('../server/catalogs.cjs').add(pool,'reasons',{name:'Проверка'});
    await repository.importLocal(pool,legacy);
    let result=await request('/auth/login','POST',{login:'ivan',password:'wrong'});
    assert.equal(result.status,401);
    result=await request('/auth/login','POST',{login:'ivan',password:'Initial-Test-Password-1'});
    assert.equal(result.status,200);
    assert.ok(sessionCookie.startsWith('defectbatch_session='));
    assert.match(result.cookie,/Max-Age=34560000/);assert.match(result.cookie,/HttpOnly/);
    const activeSessions=(await pool.request().query('SELECT expiresAt FROM dbo.Sessions')).recordset;
    assert.equal(activeSessions.length,1);assert.equal(activeSessions[0].expiresAt,null);
    await pool.request().query('UPDATE dbo.Sessions SET createdAt=DATEADD(day,-500,SYSUTCDATETIME())');
    const oldSession=await request('/auth/me');assert.equal(oldSession.status,200);assert.match(oldSession.cookie,/Max-Age=34560000/);
    const previousSecure=process.env.COOKIE_SECURE;process.env.COOKIE_SECURE='true';
    try{assert.match((await request('/auth/me')).cookie,/; Secure(?:;|$)/);}finally{if(previousSecure===undefined)delete process.env.COOKIE_SECURE;else process.env.COOKIE_SECURE=previousSecure;}
    let state=(await request('/state')).body;
    assert.equal('passwordHash' in state.users[0],false);
    for(const [login,role] of [['keyuser','KEYUSER'],['quality','QUALITY'],['admin','ADMIN'],['employer','EMPLOYER'],['engineer','ENGINEER']]){
      await repository.save(pool,'users',{name:login,login,role,password:'Role-Test-Password-'+login});
      const auth=await request('/auth/login','POST',{login,password:'Role-Test-Password-'+login});
      assert.equal(auth.status,200);assert.equal(auth.body.user.role,role);
      assert.equal((await request('/auth/logout','POST',{})).status,200);
      assert.equal((await request('/state')).status,401);
    }
    await request('/auth/login','POST',{login:'ivan',password:'Initial-Test-Password-1'});
    assert.equal(state.records[0].mixtureId,state.mixtures[0].id);
    assert.equal(state.records[0].date,'2026-11-21');
    assert.equal((await request('/import','POST',legacy)).status,403);
    result = await request('/mixtures','POST',{name:"Смесь '); DROP TABLE Users;--",archived:false});
    assert.equal(result.status,201);
    const extraMixture = result.body.id;
    result = await request('/users','POST',{name:"О'Коннор",login:'oconnor',role:'ADMIN',password:'New-User-Password-1',passwordConfirm:'New-User-Password-1'});
    assert.equal(result.status,201);
    const extraUser = result.body.id;
    assert.equal((await request('/users','POST',{name:'Дубликат',login:'oconnor',role:'ADMIN',password:'New-User-Password-1',passwordConfirm:'New-User-Password-1'})).status,409);
    assert.equal((await request('/users','POST',{name:'X',login:'xxx',role:'OWNER'})).status,400);
    assert.equal((await request('/users','POST',{name:'X',login:'xxx',role:'ADMIN'},{Origin:'https://example.org'})).status,403);
    assert.equal((await request('/records','POST',{...legacy.records[0],mixtureId:2147483647})).status,400);
    assert.equal((await request('/records','POST',{...legacy.records[0],date:'2026-02-30'})).status,400);
    state = (await request('/state')).body;
    const mixture = state.mixtures.find(m=>m.id===extraMixture);
    assert.equal((await request('/mixtures/'+extraMixture,'PUT',{...mixture,archived:true})).status,200);
    assert.equal((await request('/mixtures/'+extraMixture,'PUT',{...mixture,archived:false})).status,409);
    const record = state.records[0];
    assert.equal((await request('/records/'+record.id,'PUT',{...record,blockedWeight:133.2})).status,200);
    assert.equal((await request('/records/'+record.id,'DELETE',{version:record.version})).status,409);
    assert.equal((await request('/mixtures/'+record.mixtureId,'DELETE',{version:1})).status,409);
    const user = state.users.find(u=>u.id===extraUser);
    assert.equal((await request('/users/'+extraUser,'PUT',{...user,name:'Новое имя',role:'ENGINEER'})).status,200);
    await new Promise(resolve=>server.close(resolve));server=null;await pool.close();
    pool=await connect(database);
    server=createApp(pool);server.listen(Number(new URL(origin).port),'127.0.0.1');await once(server,'listening');
    state=(await request('/state')).body;
    assert.equal(state.records[0].blockedWeight,133.2);
    assert.equal(state.users.find(u=>u.id===extraUser).name,'Новое имя');
    assert.equal(state.users.find(u=>u.id===extraUser).role,'ENGINEER');
    assert.equal(state.mixtures.find(m=>m.id===extraMixture).archived,true);
    assert.equal((await request('/records/'+record.id,'DELETE',{version:state.records[0].version})).status,200);
    assert.equal((await request('/users/'+extraUser,'DELETE',{version:state.users.find(u=>u.id===extraUser).version})).status,200);
    assert.equal((await request('/mixtures/'+extraMixture,'DELETE',{version:state.mixtures.find(m=>m.id===extraMixture).version})).status,200);
    const me=(await request('/auth/me')).body.user;
    assert.equal((await request('/users/'+me.id,'DELETE',{version:me.version})).status,400);
    assert.equal((await request('/auth/password','PUT',{currentPassword:'wrong',password:'Changed-Password-2',passwordConfirm:'Changed-Password-2'})).status,400);
    assert.equal((await request('/auth/password','PUT',{currentPassword:'Initial-Test-Password-1',password:'Changed-Password-2',passwordConfirm:'Changed-Password-2'})).status,200);
    assert.equal((await request('/state')).status,401);
    assert.equal((await request('/auth/login','POST',{login:'ivan',password:'Initial-Test-Password-1'})).status,401);
    assert.equal((await request('/auth/login','POST',{login:'ivan',password:'Changed-Password-2'})).status,200);
    const changedState=(await request('/state')).body;
    for(const user of changedState.users)if(user.role!=='KEYUSER')await repository.remove(pool,'users',user.id,user.version);
    assert.equal((await request('/state')).status,401);
    state=await repository.state(pool);
    assert.equal(state.users.length,1);
    await repository.remove(pool,'mixtures',record.mixtureId,1);
    state=await repository.state(pool);
    assert.equal(state.records.length+state.mixtures.length,0);
    assert.equal(state.canImport,false);
    await assert.rejects(repository.importLocal(pool,legacy),error=>error.status===409);
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(pool)await pool.close();
    if(created){
      const master=await connect('master');
      try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}
      finally{await master.close();}
    }
    delete process.env.DB_NAME;
  }
});
