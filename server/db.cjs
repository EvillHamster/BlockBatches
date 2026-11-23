const sql = require('mssql/msnodesqlv8');
const fs = require('node:fs/promises');
const path = require('node:path');

function config(database = process.env.DB_NAME || 'DefectBatch') {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database)) throw new Error('Некорректное имя базы данных');
  return {
    server: process.env.DB_SERVER || 'localhost\\MIXCONTROL',
    database,
    driver: process.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server',
    options: { trustedConnection: true, trustServerCertificate: true },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 10000,
    requestTimeout: 15000
  };
}
async function connect(database) {
  const pool = new sql.ConnectionPool(config(database));
  pool.on('error', error => console.error('SQL Server:', error.message));
  return pool.connect();
}
async function initialize() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Для DefectBatch требуется Node.js 24');
  const database = config().database;
  const master = await connect('master');
  try {
    await master.request().input('name', sql.NVarChar(128), database)
      .query('IF DB_ID(@name) IS NULL CREATE DATABASE [' + database + ']');
  } finally { await master.close(); }
  const pool = await connect(database);
  try {
    for(const file of ['001-schema.sql','002-auth.sql','003-blocking-records.sql','004-catalog-details.sql','005-source-record.sql','006-engineer-role.sql','007-persistent-sessions.sql','008-keyuser-guard.sql','009-multiple-sources.sql','010-initial-setup.sql']){
      const schema = await fs.readFile(path.join(__dirname, '../sql',file), 'utf8');
      await pool.request().batch(schema);
    }
    return pool;
  } catch (error) { await pool.close(); throw error; }
}
module.exports = { sql, config, connect, initialize };
