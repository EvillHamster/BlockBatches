const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { initialize, config } = require('./db.cjs');
const repository = require('./repository.cjs');
const auth = require('./auth.cjs');
const initialSetup=require('./initial-setup.cjs');
const excel = require('./excel.cjs');
const catalogs=require('./catalogs.cjs');
const Access=require('../dist/permissions.js'),userManagement=require('./user-management.cjs'),bulk=require('./bulk-delete.cjs');
const { HttpError } = require('./validation.cjs');
const root = path.resolve(__dirname, '../dist');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(body));
}
async function bodyOf(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Требуется JSON');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Некорректный JSON'); }
}
function createApp(pool) {
  let snapshot=null,pendingSnapshot=null;
  async function stateSnapshot(revision){
    if(snapshot?.revision===revision)return snapshot.value;
    if(pendingSnapshot?.revision===revision)return pendingSnapshot.promise;
    const pending={revision,promise:repository.state(pool)};pendingSnapshot=pending;
    try{const value=await pending.promise;if(pendingSnapshot===pending)snapshot={revision,value};return value;}
    finally{if(pendingSnapshot===pending)pendingSnapshot=null;}
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!['GET','POST','PUT','DELETE'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');
        if (req.method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host)
            throw new HttpError(403, 'Запрос разрешён только с сайта приложения');
          if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Запрос разрешён только с сайта приложения');
        }
        if (url.pathname === '/api/health' && req.method === 'GET') {
          await pool.request().query('SELECT 1 AS ok');
          return json(res, 200, { ok:true, database:config().database, node:process.versions.node });
        }
        if(url.pathname==='/api/setup'&&req.method==='GET')return json(res,200,{available:await initialSetup.available(pool)});
        if(url.pathname==='/api/setup/register'&&req.method==='POST'){
          auth.throttle(req,'initial-setup');const body=await bodyOf(req);
          await initialSetup.register(pool,body);
          return json(res,201,{user:await auth.login(pool,req,res,body)});
        }
        if (url.pathname === '/api/auth/login' && req.method === 'POST')
          return json(res,200,{user:await auth.login(pool,req,res,await bodyOf(req))});
        if (url.pathname === '/api/auth/logout' && req.method === 'POST'){
          await auth.logout(pool,req,res);
          return json(res,200,{ok:true});
        }
        const user=await auth.currentUser(pool,req,res);
        if(!user)throw new HttpError(401,'Войдите в систему');
        const requirePermission=permission=>{if(!Access.can(user,permission))throw new HttpError(403,'Недостаточно прав для этого действия');};
        if(url.pathname === '/api/auth/me' && req.method === 'GET')
          return json(res,200,{user});
        if(url.pathname === '/api/auth/password' && req.method === 'PUT'){
          requirePermission('profile');
          await auth.changePassword(pool,req,res,user,await bodyOf(req));
          return json(res,200,{ok:true});
        }
        if(url.pathname === '/api/auth/profile' && req.method === 'PUT'){requirePermission('profile');return json(res,200,{user:await auth.changeProfile(pool,user,await bodyOf(req))});}
        if (url.pathname === '/api/state' && req.method === 'GET'){
          requirePermission('read');
          const revision=await repository.revision(pool),etag='"'+revision+'-'+user.id+'-'+user.role+'"';
          res.setHeader('ETag',etag);
          if(req.headers['if-none-match']===etag){res.writeHead(304,{'Cache-Control':'no-store'});return res.end();}
          const full=await stateSnapshot(revision);
          const state=Access.can(user,'users')?full:{...full,users:full.users.filter(row=>row.id===user.id)};
          return json(res,200,state);
        }
        if(/^\/api\/records\/bulk\/(preview|commit)$/.test(url.pathname)&&req.method==='POST'){
          requirePermission('bulk');const body=await bodyOf(req);return json(res,200,await (url.pathname.endsWith('/preview')?bulk.preview:bulk.commit)(pool,user,body));
        }
        const catalogMatch=/^\/api\/catalogs\/(reasons|operators)(?:\/([1-9]\d*))?$/.exec(url.pathname);
        if(catalogMatch){
          requirePermission('catalogs');
          if(req.method==='POST'&&!catalogMatch[2])return json(res,200,await catalogs.add(pool,catalogMatch[1],await bodyOf(req)));
          if(req.method==='PUT'&&catalogMatch[2])return json(res,200,await catalogs.edit(pool,catalogMatch[1],await bodyOf(req),Number(catalogMatch[2])));
          if(req.method==='DELETE'&&catalogMatch[2]){await catalogs.remove(pool,catalogMatch[1],Number(catalogMatch[2]),(await bodyOf(req)).version);return json(res,200,{ok:true});}
          throw new HttpError(405,'Метод не поддерживается');
        }
        const excelMatch=/^\/api\/excel\/(records|mixtures)\/(export|preview|import)$/.exec(url.pathname);
        if(excelMatch){
          const [,kind,action]=excelMatch;
          requirePermission(action==='export'?'export':'import');if(kind==='mixtures')requirePermission('catalogs');
          if(action==='export'&&req.method==='GET'){
            const result=await excel.exportWorkbook(pool,kind,url.searchParams);
            res.writeHead(200,{'Content-Type':excel.mime,'Content-Disposition':'attachment; filename="'+result.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            return res.end(Buffer.from(result.buffer));
          }
          if(['preview','import'].includes(action)&&req.method==='POST'){
            if(!(req.headers['content-type']||'').startsWith(excel.mime))throw new HttpError(415,'Выберите файл .xlsx');
            let size=0;const chunks=[];
            for await(const chunk of req){size+=chunk.length;if(size>excel.maxFileSize)throw new HttpError(413,'Максимальный размер файла — 5 МБ');chunks.push(chunk);}
            const buffer=Buffer.concat(chunks);
            return json(res,200,await (action==='preview'?excel.previewImport:excel.commitImport)(pool,kind,buffer));
          }
          throw new HttpError(405,'Метод не поддерживается');
        }
        if (url.pathname === '/api/import' && req.method === 'POST') {
          requirePermission('users');if(user.role!=='KEYUSER')throw new HttpError(403,'Перенос начальных данных доступен только keyuser');
          await repository.importLocal(pool, await bodyOf(req));
          return json(res, 201, await repository.state(pool));
        }
        const match = /^\/api\/(records|mixtures|users)(?:\/([1-9]\d*))?$/.exec(url.pathname);
        if (!match) throw new HttpError(404, 'Адрес не найден');
        const [, kind, idText] = match;
        requirePermission(kind==='records'?(req.method==='DELETE'?'delete':req.method==='GET'?'read':'write'):kind==='users'?'users':'catalogs');
        const body = req.method === 'GET' ? null : await bodyOf(req);
        if(kind==='users'){
          if(req.method==='POST'&&!idText)return json(res,201,{id:await userManagement.mutate(pool,user,'POST',body)});
          if(['PUT','DELETE'].includes(req.method)&&idText){await userManagement.mutate(pool,user,req.method,body,Number(idText));return json(res,200,{ok:true});}
          throw new HttpError(405,'Метод не поддерживается');
        }
        if (req.method === 'POST' && !idText) {
          const id = await repository.save(pool, kind, body);
          return json(res, 201, { id });
        }
        if (req.method === 'PUT' && idText) {
          await repository.save(pool, kind, body, Number(idText));
          return json(res, 200, { ok:true });
        }
        if (req.method === 'DELETE' && idText) {
          if(kind==='users'&&Number(idText)===user.id)throw new HttpError(400,'Нельзя удалить свою учётную запись во время работы');
          await repository.remove(pool, kind, Number(idText), body.version);
          return json(res, 200, { ok:true });
        }
        throw new HttpError(405, 'Метод не поддерживается');
      }
      if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405, 'Метод не поддерживается');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Некорректный адрес'); }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new HttpError(403, 'Доступ запрещён');
      let content;
      try { content = await fs.readFile(file); } catch { throw new HttpError(404, 'Файл не найден'); }
      res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const safe = repository.safeError(error);
      if (!(error instanceof HttpError)) console.error('Ошибка запроса:', error.message);
      if (!res.headersSent) json(res, safe.status, { error:safe.message,...(safe.fields?{fields:safe.fields}:{}) });
      else res.end();
    }
  });
}
async function start() {
  const pool = await initialize();
  const server = createApp(pool);
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 5173);
  server.on('error', async error => { console.error(error.message); await pool.close(); process.exitCode = 1; });
  server.listen(port, host, () => {
    console.log('DefectBatch: http://' + host + ':' + port);
    console.log('SQL Server: ' + config().server + ' / ' + config().database);
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(async () => { await pool.close(); process.exit(0); }));
  return { server, pool };
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createApp, start };
