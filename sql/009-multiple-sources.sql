SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.RecordSources',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.RecordSources(
  recordId int NOT NULL,
  sourceId int NOT NULL,
  CONSTRAINT PK_RecordSources PRIMARY KEY(recordId,sourceId),
  CONSTRAINT FK_RecordSources_Record FOREIGN KEY(recordId) REFERENCES dbo.Records(id) ON DELETE CASCADE,
  CONSTRAINT FK_RecordSources_Source FOREIGN KEY(sourceId) REFERENCES dbo.Records(id),
  CONSTRAINT CK_RecordSources_Different CHECK(recordId<>sourceId)
 );
 CREATE INDEX IX_RecordSources_Source ON dbo.RecordSources(sourceId);
 INSERT dbo.RecordSources(recordId,sourceId) SELECT id,sourceRecordId FROM dbo.Records WHERE sourceRecordId IS NOT NULL;
END;
COMMIT TRANSACTION;
