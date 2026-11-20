const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { initialize, config } = require('./db.cjs');
const repository = require('./repository.cjs');
const auth = require('./auth.cjs');
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
        if (url.pathname === '/api/auth/login' && req.method === 'POST')
          return json(res,200,{user:await auth.login(pool,req,res,await bodyOf(req))});
        if (url.pathname === '/api/auth/logout' && req.method === 'POST'){
          await auth.logout(pool,req,res);
          return json(res,200,{ok:true});
        }
        const user=await auth.currentUser(pool,req);
        if(!user)throw new HttpError(401,'Войдите в систему');
        if(url.pathname === '/api/auth/me' && req.method === 'GET')
          return json(res,200,{user});
        if(url.pathname === '/api/auth/password' && req.method === 'PUT'){
          await auth.changePassword(pool,req,res,user,await bodyOf(req));
          return json(res,200,{ok:true});
        }
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, await repository.state(pool));
        if (url.pathname === '/api/import' && req.method === 'POST') {
          await repository.importLocal(pool, await bodyOf(req));
          return json(res, 201, await repository.state(pool));
        }
        const match = /^\/api\/(records|mixtures|users)(?:\/([1-9]\d*))?$/.exec(url.pathname);
        if (!match) throw new HttpError(404, 'Адрес не найден');
        const [, kind, idText] = match;
        const body = req.method === 'GET' ? null : await bodyOf(req);
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
      if (!res.headersSent) json(res, safe.status, { error:safe.message });
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
