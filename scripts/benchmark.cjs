// Explicit, isolated performance check. Never connects to the production database.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomBytes}=require('node:crypto'),{once}=require('node:events');
const {performance,monitorEventLoopDelay}=require('node:perf_hooks');
const database='DefectBatch_Test_Perf_'+randomBytes(6).toString('hex');
process.env.DB_NAME=database;
const {initialize,connect,sql}=require('../server/db.cjs'),repo=require('../server/repository.cjs'),{createApp}=require('../server/server.cjs');
const rules=require('../dist/record-rules.js');
const args=process.argv.slice(2),hold=args.includes('--hold');
const output=path.join(__dirname,'../.local/performance');
let pool,server,created=false,cleaning=false;
async function cleanup(){if(cleaning)return;cleaning=true;if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.close();if(created){if(!/^DefectBatch_Test_Perf_[0-9a-f]{12}$/.test(database))throw Error('Unexpected database name');const master=await connect('master');try{await master.request().query('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+database+'];');}finally{await master.close();}}await fs.unlink(path.join(output,'login.json')).catch(()=>{});}
const rounded=n=>Math.round(n*10)/10;
function stats(values){const sorted=[...values].sort((a,b)=>a-b);return {medianMs:rounded(sorted[Math.floor(sorted.length/2)]),p95Ms:rounded(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]),maxMs:rounded(sorted.at(-1))};}
async function main(){
 await fs.mkdir(output,{recursive:true});pool=await initialize();created=true;
 await pool.request().query(`
 ;WITH n AS(SELECT TOP(250) ROW_NUMBER()OVER(ORDER BY (SELECT NULL)) n FROM sys.all_objects)
 INSERT dbo.Mixtures(name) SELECT 'PERF MIX '+RIGHT('000'+CAST(n AS varchar(3)),3) FROM n;
 INSERT dbo.Reasons(name,normalizedName) VALUES(N'Проверка производительности',N'проверка производительности');
 ;WITH n AS(SELECT TOP(100) ROW_NUMBER()OVER(ORDER BY (SELECT NULL)) n FROM sys.all_objects)
 INSERT dbo.Operators(name,normalizedName,lastName,firstName) SELECT N'Оператор '+CAST(n AS nvarchar(10)),N'оператор '+CAST(n AS nvarchar(10)),N'Оператор',CAST(n AS nvarchar(10)) FROM n;
 `);
 const password=randomBytes(18).toString('base64url');await repo.save(pool,'users',{name:'Проверка скорости',login:'loadtester',role:'KEYUSER',password});
 server=createApp(pool);server.listen(hold?5175:0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:'loadtester',password})});if(login.status!==200)throw Error('Login failed');const cookie=login.headers.get('set-cookie').split(';')[0];
 await fs.writeFile(path.join(output,'login.json'),JSON.stringify({login:'loadtester',password,origin,database}));
 let latestState;const delay=monitorEventLoopDelay({resolution:20});delay.enable();
 const report={testedAt:new Date().toISOString(),environment:{node:process.versions.node,platform:process.platform,cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemoryGB:rounded(os.totalmem()/1024**3)},workload:'Synthetic records, same machine for SQL/API/client, 5 parallel authenticated reads',stages:[]};
 async function read(){const start=performance.now();const response=await fetch(origin+'/api/state',{headers:{Cookie:cookie}});const buffer=Buffer.from(await response.arrayBuffer());if(response.status!==200)throw Error('State status '+response.status);latestState=JSON.parse(buffer.toString());return {ms:performance.now()-start,bytes:buffer.length,etag:response.headers.get('etag')};}
 for(const count of [1000,10000,50000]){
  const startSeed=performance.now();await pool.request().input('target',sql.Int,count).query(`
   DECLARE @present int=(SELECT COUNT(*) FROM dbo.Records);
   ;WITH numbers AS(SELECT TOP(@target-@present) ROW_NUMBER()OVER(ORDER BY (SELECT NULL))+@present n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
   INSERT dbo.Records(date,sup,mixtureId,line,step,batchNumber,palletNumber,sampleNumber,blockedWeight,reasonId,description,shift,operatorId,recordFormatVersion)
   SELECT DATEADD(day,-(n%365),CAST('2026-11-22' AS date)),RIGHT('0000000'+CAST(n AS varchar(10)),7),1+(n%250),CASE n%3 WHEN 0 THEN 'MB' WHEN 1 THEN 'FM' ELSE 'RW' END,'M1',CAST(n%1000 AS nvarchar(100)),CAST(n%100 AS nvarchar(100)),'1-3',125.5,1,
   N'Синтетическая запись проверки скорости: партия '+CAST(n AS nvarchar(10))+N'. Описание отклонения на производстве.',1+(n%4),1+(n%100),2 FROM numbers;
  `);
  const seedMs=performance.now()-startSeed;
  delay.reset();const cold=await read(),sequential=[];for(let i=0;i<5;i++)sequential.push((await read()).ms);
  const parallel=await Promise.all(Array.from({length:5},read));
  const notModified=[];let conditionalBytes=0;
  for(let i=0;i<5;i++){const begin=performance.now();const response=await fetch(origin+'/api/state',{headers:{Cookie:cookie,'If-None-Match':cold.etag||''}});conditionalBytes+=(await response.arrayBuffer()).byteLength;if(response.status!==304)throw Error('Conditional state did not return 304');notModified.push(performance.now()-begin);}
  const conditionalParallel=await Promise.all(Array.from({length:5},async()=>{const begin=performance.now();const response=await fetch(origin+'/api/state',{headers:{Cookie:cookie,'If-None-Match':cold.etag}});await response.arrayBuffer();if(response.status!==304)throw Error('Conditional state failed');return performance.now()-begin;}));
  const indexStart=performance.now(),searchIndex=rules.buildRecordSearchIndex(latestState.records,latestState.mixtures),searchIndexMs=performance.now()-indexStart;
  const filtering={};for(const [name,filters]of Object.entries({sup:{search:'0010000'},mixture:{mixture:'25'},combined:{line:'FM',search:'партия',from:'2026-10-01'}})){
   const times=[];let matches=0;for(let i=0;i<10;i++){const begin=performance.now();const rows=rules.filterRecords(latestState.records,latestState.mixtures,filters,searchIndex).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);matches=rows.length;times.push(performance.now()-begin);}filtering[name]={...stats(times),matches};
  }
  let exported;const beforeExport=performance.now();const exportResponse=await fetch(origin+'/api/excel/records/export',{headers:{Cookie:cookie}});const excelBytes=(await exportResponse.arrayBuffer()).byteLength;exported={ms:rounded(performance.now()-beforeExport),bytes:excelBytes,status:exportResponse.status};if(exportResponse.status!==200)throw Error('Export failed');
  const stage={records:count,seedMs:rounded(seedMs),initialMs:rounded(cold.ms),responseMB:rounded(cold.bytes/1024**2),sequential:stats(sequential),parallel5:stats(parallel.map(row=>row.ms)),unchanged:{...stats(notModified),bodyBytes:conditionalBytes,status:304},unchangedParallel5:stats(conditionalParallel),searchIndexMs:rounded(searchIndexMs),filtering,export:exported,eventLoopP95Ms:rounded(delay.percentile(95)/1e6),eventLoopMaxMs:rounded(delay.max/1e6),memoryMB:rounded(process.memoryUsage().rss/1024**2)};
  report.stages.push(stage);console.log(JSON.stringify(stage));await fs.writeFile(path.join(output,'backend-report.json'),JSON.stringify(report,null,2));
 }
 delay.disable();console.log('REPORT: '+path.join(output,'backend-report.json'));
 if(hold){console.log('BROWSER QA: '+origin);return;}await cleanup();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>cleanup().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);}));
main().catch(async error=>{console.error(error.stack);await cleanup();process.exitCode=1;});
