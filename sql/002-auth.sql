SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH(N'dbo.Users',N'passwordHash') IS NULL
  ALTER TABLE dbo.Users ADD passwordHash nvarchar(256) NULL;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name=N'CK_Users_role' AND definition NOT LIKE N'%QUALITY%')
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_role;
  UPDATE dbo.Users SET role='EMPLOYER' WHERE role='EMPLOYEE';
  ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_role CHECK(role IN ('KEYUSER','QUALITY','ADMIN','EMPLOYER'));
END;
IF OBJECT_ID(N'dbo.Sessions',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Sessions (
    tokenHash char(64) NOT NULL PRIMARY KEY,
    userId int NOT NULL,
    expiresAt datetime2 NOT NULL,
    createdAt datetime2 NOT NULL CONSTRAINT DF_Sessions_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Sessions_Users FOREIGN KEY(userId) REFERENCES dbo.Users(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_Sessions_user ON dbo.Sessions(userId);
  CREATE INDEX IX_Sessions_expiry ON dbo.Sessions(expiresAt);
END;
COMMIT TRANSACTION;
