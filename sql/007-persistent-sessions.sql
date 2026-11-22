SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.Sessions') AND name=N'expiresAt' AND is_nullable=0)
 ALTER TABLE dbo.Sessions ALTER COLUMN expiresAt datetime2 NULL;
-- Keep expired sessions invalid; remove the time limit only from active sessions.
UPDATE dbo.Sessions SET expiresAt=NULL WHERE expiresAt>SYSUTCDATETIME();
COMMIT TRANSACTION;
