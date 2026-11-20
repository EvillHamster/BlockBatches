const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { sql } = require('./db.cjs');
const { HttpError } = require('./validation.cjs');
const scrypt = promisify(crypto.scrypt);
const cookieName = 'defectbatch_session';
const lifetime = 8 * 60 * 60;
const attempts = new Map();
const parameters = {N:32768,r:8,p:1,maxmem:64*1024*1024};
const dummyHash = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);

function passwordValid(password) {
  if(typeof password !== 'string' || password.length < 10 || password.length > 128)
    throw new HttpError(400,'Пароль должен содержать от 10 до 128 символов');
  return password;
}
async function hashPassword(password) {
  passwordValid(password);
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=await scrypt(password,salt,64,parameters);
  return 'scrypt$'+salt+'$'+derived.toString('hex');
}
async function verifyPassword(password,encoded) {
  const valid = typeof encoded === 'string' && /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(encoded);
  const [,salt,expected]=(valid?encoded:dummyHash).split('$');
  const supplied=typeof password==='string'&&password.length<=128?password:'';
  const derived=await scrypt(supplied,salt,64,parameters);
  return crypto.timingSafeEqual(Buffer.from(expected,'hex'),derived)&&valid;
}
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
function tokenOf(req){
  const parts=(req.headers.cookie||'').split(';').map(p=>p.trim());
  const entry=parts.find(p=>p.startsWith(cookieName+'='));
  const token=entry?.slice(cookieName.length+1);
  return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
function cookie(req,value,maxAge){
  return cookieName+'='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(req.socket.encrypted?'; Secure':'');
}
function publicUser(user){return {id:user.id,name:user.name,login:user.login,role:user.role,version:user.version};}
async function currentUser(pool,req){
  const token=tokenOf(req);
  if(!token)return null;
  const result=await pool.request().input('token',sql.Char(64),digest(token)).query(`
    SELECT u.id,u.name,u.login,u.role,u.version FROM dbo.Sessions s JOIN dbo.Users u ON u.id=s.userId
    WHERE s.tokenHash=@token AND s.expiresAt>SYSUTCDATETIME()
  `);
  return result.recordset[0]?publicUser(result.recordset[0]):null;
}
function throttle(req,login){
  const now=Date.now();
  for(const [key,v] of attempts)if(v.until<=now)attempts.delete(key);
  const key=(req.socket.remoteAddress||'local')+'|'+String(login).toLowerCase();
  let value=attempts.get(key);
  if(!value){if(attempts.size>=10000)throw new HttpError(429,'Слишком много попыток. Повторите позже.');value={count:0,until:now+15*60*1000};attempts.set(key,value);}
  if(++value.count>10)throw new HttpError(429,'Слишком много попыток входа. Повторите через 15 минут.');
  return key;
}
async function login(pool,req,res,body){
  const login=typeof body?.login==='string'?body.login.trim():'';
  const throttleKey=throttle(req,login);
  const row=await pool.request().input('login',sql.NVarChar(64),login.slice(0,64))
    .query('SELECT id,name,login,role,version,passwordHash FROM dbo.Users WHERE login=@login');
  const user=login.length<=64?row.recordset[0]:null;
  if(!await verifyPassword(body?.password,user?.passwordHash))throw new HttpError(401,'Неверный логин или пароль');
  const token=crypto.randomBytes(32).toString('base64url');
  const old=tokenOf(req);
  const request=pool.request().input('token',sql.Char(64),digest(token)).input('id',sql.Int,user.id)
    .input('expectedHash',sql.NVarChar(256),user.passwordHash)
    .input('expires',sql.DateTime2,new Date(Date.now()+lifetime*1000));
  if(old)await pool.request().input('token',sql.Char(64),digest(old)).query('DELETE FROM dbo.Sessions WHERE tokenHash=@token');
  const inserted=await request.query('DELETE FROM dbo.Sessions WHERE expiresAt<=SYSUTCDATETIME(); INSERT INTO dbo.Sessions(tokenHash,userId,expiresAt) OUTPUT INSERTED.userId SELECT @token,@id,@expires FROM dbo.Users WHERE id=@id AND passwordHash=@expectedHash');
  if(!inserted.recordset.length)throw new HttpError(401,'Неверный логин или пароль');
  attempts.delete(throttleKey);
  res.setHeader('Set-Cookie',cookie(req,token,lifetime));
  return publicUser(user);
}
async function logout(pool,req,res){
  const token=tokenOf(req);
  if(token)await pool.request().input('token',sql.Char(64),digest(token)).query('DELETE FROM dbo.Sessions WHERE tokenHash=@token');
  res.setHeader('Set-Cookie',cookie(req,'',0));
}
async function changePassword(pool,req,res,user,body){
  const next=passwordValid(body?.password);
  const row=await pool.request().input('id',sql.Int,user.id).query('SELECT passwordHash FROM dbo.Users WHERE id=@id');
  if(!await verifyPassword(body?.currentPassword,row.recordset[0]?.passwordHash))throw new HttpError(400,'Текущий пароль неверен');
  if(await verifyPassword(next,row.recordset[0].passwordHash))throw new HttpError(400,'Новый пароль должен отличаться от текущего');
  const hash=await hashPassword(next);
  await pool.request().input('id',sql.Int,user.id).input('hash',sql.NVarChar(256),hash)
    .input('oldHash',sql.NVarChar(256),row.recordset[0].passwordHash).query(`
      SET XACT_ABORT ON; BEGIN TRANSACTION;
      UPDATE dbo.Users SET passwordHash=@hash,version=version+1 WHERE id=@id AND passwordHash=@oldHash;
      IF @@ROWCOUNT=0 BEGIN ROLLBACK TRANSACTION; THROW 50002,'Credentials already changed',1; END;
      DELETE FROM dbo.Sessions WHERE userId=@id;
      COMMIT TRANSACTION;
    `);
  res.setHeader('Set-Cookie',cookie(req,'',0));
}
module.exports={hashPassword,verifyPassword,passwordValid,currentUser,login,logout,changePassword};
