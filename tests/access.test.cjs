const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto'),{once}=require('node:events');
const Access=require('../dist/permissions.js');
test('five roles enforce API permissions, key user protection, credentials and filtered bulk deletion',{timeout:180000},async()=>{
 const database='DefectBatch_Test_'+randomBytes(6).toString('hex');process.env.DB_NAME=database;
 const {initialize,connect}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),catalogs=require('../server/catalogs.cjs'),{createApp}=require('../server/server.cjs');let pool,server,created=false;
 try{
  pool=await initialize();created=true;
  const accounts={};for(const role of Object.keys(Access.roles)){const login=role.toLowerCase(),password='Access-Test-Password-'+role;const id=await repo.save(pool,'users',{name:role,login,role,password});accounts[role]={id,login,password};}
  const mixtureId=await repo.save(pool,'mixtures',{name:'Матрица',archived:false}),reason=await catalogs.add(pool,'reasons',{name:'Проверка прав'});
  const base={date:'2026-11-22',sup:'0011223',line:'MB',step:'MA',mixtureId,batchNumber:'1',palletNumber:'1',sampleNumber:'1',blockedWeight:1,reasonId:reason.id,description:'Общая запись',shift:1};
  const rootId=await repo.save(pool,'records',base);server=createApp(pool);server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  function client(){let cookie='';return async(path,method='GET',body)=>{const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const type=r.headers.get('content-type');return {status:r.status,body:type?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};};}
  const clients={};
  for(const [role,account]of Object.entries(accounts)){
   const api=clients[role]=client();assert.equal((await api('/auth/login','POST',account)).status,200);
   const user={role},state=(await api('/state')).body;assert.ok(state.records.length);assert.equal(state.users.length,Access.can(user,'users')?5:1);
   const create=await api('/records','POST',base);assert.equal(create.status,Access.can(user,'write')?201:403,role+' create');
   const root=state.records.find(r=>r.id===rootId);assert.equal((await api('/records/'+rootId,'PUT',root)).status,Access.can(user,'write')?200:403,role+' edit');
   assert.equal((await api('/records/999999','DELETE',{version:1})).status,Access.can(user,'delete')?409:403,role+' delete');
   assert.equal((await api('/records/bulk/preview','POST',{search:'none'})).status,Access.can(user,'bulk')?200:403,role+' bulk preview');
   assert.equal((await api('/records/bulk/commit','POST',{token:'fake'})).status,Access.can(user,'bulk')?400:403,role+' bulk commit');
   assert.equal((await api('/excel/records/export')).status,Access.can(user,'export')?200:403,role+' export');
   assert.equal((await api('/excel/records/preview','POST',{})).status,Access.can(user,'import')?415:403,role+' import');
   const mixture=await api('/mixtures','POST',{name:'Смесь '+role,archived:false});assert.equal(mixture.status,Access.can(user,'catalogs')?201:403,role+' mixtures');
   for(const kind of ['reasons','operators']){const entry=await api('/catalogs/'+kind,'POST',kind==='reasons'?{name:'Причина '+role}:{lastName:'Тест',firstName:role});assert.equal(entry.status,Access.can(user,'catalogs')?200:403,role+' '+kind);if(entry.status===200){assert.equal((await api('/catalogs/'+kind+'/'+entry.body.id,'PUT',{...entry.body,name:'Другая '+role,firstName:role+'2'})).status,200);const now=(await api('/state')).body[kind].find(r=>r.id===entry.body.id);assert.equal((await api('/catalogs/'+kind+'/'+now.id,'DELETE',{version:now.version})).status,200);}}
   const me=(await api('/auth/me')).body.user;
   assert.equal((await api('/auth/profile','PUT',{name:'Новое имя '+role,login:me.login,version:me.version,role:'KEYUSER'})).status,Access.can(user,'profile')?200:403,role+' profile');
   const ownAfter=(await api('/auth/me')).body.user;assert.equal(ownAfter.name,Access.can(user,'profile')?'Новое имя '+role:role);assert.equal(ownAfter.role,role);
   if(Access.can(user,'profile'))assert.equal((await api('/auth/profile','PUT',{name:'   ',version:ownAfter.version})).status,400);
   assert.equal((await api('/auth/password','PUT',{currentPassword:account.password,password:'Some-New-Password-1',passwordConfirm:'mismatch'})).status,Access.can(user,'profile')?400:403,role+' password');
   assert.equal((await api('/users','POST',{name:'New',login:'new_'+role,role:'EMPLOYER',password:'Role-New-Password-1',passwordConfirm:'bad'})).status,Access.can(user,'users')?400:403,role+' manage users');
   if(Access.can(user,'delete')&&create.status===201){const row=(await api('/state')).body.records.find(r=>r.id===create.body.id);assert.equal((await api('/records/'+row.id,'DELETE',{version:row.version})).status,200);}
  }
  const key=clients.KEYUSER,admin=clients.ADMIN;
  let state=(await key('/state')).body,keyUser=state.users.find(u=>u.role==='KEYUSER');
  for(const method of ['PUT','DELETE'])assert.equal((await admin('/users/'+keyUser.id,method,{...keyUser,login:'hijack',password:'New-Key-Password-1',passwordConfirm:'New-Key-Password-1'})).status,403);
  assert.equal((await key('/users/'+keyUser.id,'DELETE',{version:keyUser.version})).status,403);
  assert.equal((await key('/users/'+keyUser.id,'PUT',{...keyUser,role:'ADMIN'})).status,403);
  const duplicate=await Promise.all([key('/users','POST',{name:'Second',login:'secondkey1',role:'KEYUSER',password:'Password-Key-1',passwordConfirm:'Password-Key-1'}),admin('/users','POST',{name:'Second',login:'secondkey2',role:'KEYUSER',password:'Password-Key-2',passwordConfirm:'Password-Key-2'})]);assert.ok(duplicate.every(r=>r.status===403));
  await assert.rejects(repo.remove(pool,'users',keyUser.id,keyUser.version));
  const duplicateSql=await Promise.allSettled([repo.save(pool,'users',{name:'K2',login:'key2',role:'KEYUSER',password:'Password-Key-2'}),repo.save(pool,'users',{name:'K3',login:'key3',role:'KEYUSER',password:'Password-Key-3'})]);assert.ok(duplicateSql.every(r=>r.status==='rejected'));
  const newAdmin=await admin('/users','POST',{name:'Другой администратор',login:'admin2',role:'ADMIN',password:'4826',passwordConfirm:'4826'});assert.equal(newAdmin.status,201);
  const shortLogin=client();assert.equal((await shortLogin('/auth/login','POST',{login:'admin2',password:'4826'})).status,200);
  const other=(await admin('/state')).body.users.find(u=>u.id===newAdmin.body.id);assert.equal((await admin('/users/'+other.id,'PUT',{...other,role:'ENGINEER',password:'',passwordConfirm:''})).status,200);
  let editedAdmin=(await admin('/state')).body.users.find(u=>u.id===other.id);
  assert.equal((await admin('/users/'+other.id,'PUT',{...editedAdmin,password:'9876',passwordConfirm:'9876'})).status,200);
  const resetClient=client();assert.equal((await resetClient('/auth/login','POST',{login:other.login,password:'9876'})).status,200);
  const engineerUser=(await key('/state')).body.users.find(u=>u.role==='ENGINEER'&&u.id===accounts.ENGINEER.id);assert.equal((await key('/users/'+engineerUser.id,'PUT',{...engineerUser,role:'QUALITY',password:'',passwordConfirm:''})).status,200);assert.equal((await clients.ENGINEER('/records','POST',base)).status,403);
  for(let i=0;i<12;i++)await repo.save(pool,'records',{...base,description:'bulkflag '+i});
  let preview=(await key('/records/bulk/preview','POST',{search:'bulkflag'})).body;assert.equal(preview.count,12);assert.equal(preview.all,false);
  await repo.save(pool,'records',{...base,description:'bulkflag extra'});assert.equal((await key('/records/bulk/commit','POST',{token:preview.token})).status,409);
  preview=(await key('/records/bulk/preview','POST',{search:'bulkflag'})).body;assert.equal(preview.count,13);
  const both=await Promise.all([key('/records/bulk/commit','POST',{token:preview.token}),key('/records/bulk/commit','POST',{token:preview.token})]);assert.ok(both.every(r=>r.status===200));assert.ok(both.every(r=>r.body.deleted===13));
  assert.equal((await key('/state')).body.records.some(r=>r.description.includes('bulkflag')),false);
  const sourceReason=await catalogs.add(pool,'reasons',{name:'Произведено из заблокированного MB'});
  await repo.save(pool,'records',{...base,reasonId:sourceReason.id,sourceRecordId:rootId,description:'Зависимая запись'});
  const blocked=(await key('/records/bulk/preview','POST',{search:'Общая запись'})).body;assert.equal(blocked.blocked,true);assert.equal((await key('/records/bulk/commit','POST',{token:blocked.token})).status,409);
  preview=(await admin('/records/bulk/preview','POST',{})).body;assert.ok(preview.all);assert.ok(preview.count>0);assert.equal((await admin('/records/bulk/commit','POST',{token:preview.token})).status,400);
  assert.equal((await admin('/records/bulk/commit','POST',{token:preview.token,confirmation:'УДАЛИТЬ ВСЁ'})).status,200);assert.equal((await admin('/state')).body.records.length,0);
  const own=(await clients.QUALITY('/auth/me')).body.user;assert.equal((await clients.QUALITY('/auth/profile','PUT',{login:'quality_new',version:own.version})).status,200);
  assert.equal((await clients.QUALITY('/auth/password','PUT',{currentPassword:accounts.QUALITY.password,password:'1234',passwordConfirm:'1234'})).status,200);
  assert.equal((await clients.QUALITY('/state')).status,401);
  assert.equal((await clients.QUALITY('/auth/login','POST',{login:'quality_new',password:'1234'})).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.close();if(created){const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}delete process.env.DB_NAME;}
});
