SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.Records',N'sourceRecordId') IS NULL
BEGIN
 ALTER TABLE dbo.Records ADD sourceRecordId int NULL;
 EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT FK_Records_Source FOREIGN KEY(sourceRecordId) REFERENCES dbo.Records(id)');
 EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT CK_Records_Source CHECK(sourceRecordId IS NULL OR sourceRecordId<>id)');
 EXEC(N'CREATE INDEX IX_Records_Source ON dbo.Records(sourceRecordId) WHERE sourceRecordId IS NOT NULL');
END;
COMMIT TRANSACTION;
