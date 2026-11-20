// Compatibility entry point. The application now requires SQL Server.
require('./server/server.cjs').start().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
