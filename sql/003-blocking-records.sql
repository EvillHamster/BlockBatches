SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.Reasons',N'U') IS NULL
  CREATE TABLE dbo.Reasons(id int IDENTITY PRIMARY KEY,name nvarchar(200) NOT NULL,normalizedName nvarchar(200) NOT NULL UNIQUE);
IF OBJECT_ID(N'dbo.Operators',N'U') IS NULL
  CREATE TABLE dbo.Operators(id int IDENTITY PRIMARY KEY,name nvarchar(200) NOT NULL,normalizedName nvarchar(200) NOT NULL UNIQUE);
IF COL_LENGTH(N'dbo.Records',N'step') IS NULL
BEGIN
  ALTER TABLE dbo.Records ADD
    step nvarchar(16) NULL,
    batchNumber nvarchar(100) NULL,
    palletNumber nvarchar(100) NULL,
    sampleNumber nvarchar(100) NULL,
    blockedWeight float NULL,
    reasonId int NULL,
    description nvarchar(4000) NULL,
    shift tinyint NULL,
    operatorId int NULL,
    recordFormatVersion tinyint NOT NULL CONSTRAINT DF_Records_format DEFAULT 1;
  ALTER TABLE dbo.Records ALTER COLUMN actual decimal(10,2) NULL;
  ALTER TABLE dbo.Records ALTER COLUMN equipment decimal(10,2) NULL;
  ALTER TABLE dbo.Records ALTER COLUMN author nvarchar(120) NULL;
  ALTER TABLE dbo.Records DROP CONSTRAINT CK_Records_line;
  ALTER TABLE dbo.Records ADD CONSTRAINT CK_Records_line CHECK(line IN ('MB','FM','RW','FMF'));
  EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT FK_Records_Reasons FOREIGN KEY(reasonId) REFERENCES dbo.Reasons(id)');
  EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT FK_Records_Operators FOREIGN KEY(operatorId) REFERENCES dbo.Operators(id)');
  EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT CK_Records_weight CHECK(blockedWeight IS NULL OR blockedWeight>=0)');
  EXEC(N'ALTER TABLE dbo.Records ADD CONSTRAINT CK_Records_shift CHECK(shift IS NULL OR shift IN (1,2,3,4))');
END;
COMMIT TRANSACTION;
