SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.AppState', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppState (
    id int NOT NULL PRIMARY KEY CONSTRAINT CK_AppState_id CHECK (id=1),
    browserImportCompleted bit NOT NULL
  );
  INSERT INTO dbo.AppState(id,browserImportCompleted) VALUES (1,0);
END;
IF OBJECT_ID(N'dbo.Mixtures', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Mixtures (
    id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name nvarchar(100) NOT NULL,
    archived bit NOT NULL CONSTRAINT DF_Mixtures_archived DEFAULT 0,
    version int NOT NULL CONSTRAINT DF_Mixtures_version DEFAULT 1,
    createdAt datetime2 NOT NULL CONSTRAINT DF_Mixtures_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Mixtures_name UNIQUE(name),
    CONSTRAINT CK_Mixtures_name CHECK (LEN(LTRIM(RTRIM(name))) > 0)
  );
END;
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Users (
    id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    name nvarchar(120) NOT NULL,
    login nvarchar(64) NOT NULL,
    role varchar(10) NOT NULL,
    version int NOT NULL CONSTRAINT DF_Users_version DEFAULT 1,
    createdAt datetime2 NOT NULL CONSTRAINT DF_Users_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Users_login UNIQUE(login),
    CONSTRAINT CK_Users_role CHECK (role IN ('EMPLOYEE','ADMIN','KEYUSER')),
    CONSTRAINT CK_Users_name CHECK (LEN(LTRIM(RTRIM(name))) > 0),
    CONSTRAINT CK_Users_login CHECK (LEN(login) >= 3)
  );
END;
IF OBJECT_ID(N'dbo.Records', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Records (
    id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    date date NOT NULL,
    sup nvarchar(40) NOT NULL,
    mixtureId int NOT NULL,
    line varchar(3) NOT NULL,
    actual decimal(10,2) NOT NULL,
    equipment decimal(10,2) NOT NULL,
    author nvarchar(120) NOT NULL,
    version int NOT NULL CONSTRAINT DF_Records_version DEFAULT 1,
    createdAt datetime2 NOT NULL CONSTRAINT DF_Records_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Records_Mixtures FOREIGN KEY (mixtureId) REFERENCES dbo.Mixtures(id),
    CONSTRAINT CK_Records_line CHECK (line IN ('MB','FMF')),
    CONSTRAINT CK_Records_sup CHECK (LEN(LTRIM(RTRIM(sup))) > 0),
    CONSTRAINT CK_Records_author CHECK (LEN(LTRIM(RTRIM(author))) > 0)
  );
  CREATE INDEX IX_Records_date ON dbo.Records(date DESC, id DESC);
  CREATE INDEX IX_Records_mixture ON dbo.Records(mixtureId);
END;
IF EXISTS(SELECT 1 FROM dbo.Mixtures) OR EXISTS(SELECT 1 FROM dbo.Users) OR EXISTS(SELECT 1 FROM dbo.Records)
  UPDATE dbo.AppState SET browserImportCompleted=1 WHERE id=1;
COMMIT TRANSACTION;
