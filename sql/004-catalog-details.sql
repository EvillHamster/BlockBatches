SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.Operators',N'lastName') IS NULL
BEGIN
 ALTER TABLE dbo.Operators ADD lastName nvarchar(100) NULL,firstName nvarchar(100) NULL;
 EXEC(N'UPDATE dbo.Operators SET lastName=LEFT(name,CHARINDEX('' '',name)-1),firstName=SUBSTRING(name,CHARINDEX('' '',name)+1,200) WHERE CHARINDEX('' '',name)>0 AND CHARINDEX('' '',name)<=101 AND LEN(name)-CHARINDEX('' '',name)<=100');
END;
IF COL_LENGTH(N'dbo.Operators',N'version') IS NULL
 ALTER TABLE dbo.Operators ADD version int NOT NULL CONSTRAINT DF_Operators_version DEFAULT 1;
IF COL_LENGTH(N'dbo.Reasons',N'version') IS NULL
 ALTER TABLE dbo.Reasons ADD version int NOT NULL CONSTRAINT DF_Reasons_version DEFAULT 1;
COMMIT TRANSACTION;
