const { initialize } = require('./db.cjs');
initialize().then(async pool => {
  console.log('База DefectBatch подготовлена.');
  await pool.close();
}).catch(error => { console.error(error.message); process.exitCode = 1; });
