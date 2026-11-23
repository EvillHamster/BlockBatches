SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.AppState',N'initialSetupCompleted') IS NULL
 EXEC(N'ALTER TABLE dbo.AppState ADD initialSetupCompleted bit NOT NULL CONSTRAINT DF_AppState_setup DEFAULT 0');
EXEC(N'UPDATE dbo.AppState SET initialSetupCompleted=1 WHERE id=1 AND EXISTS(SELECT 1 FROM dbo.Users)');
COMMIT TRANSACTION;
