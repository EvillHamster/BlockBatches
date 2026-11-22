SET XACT_ABORT ON;
IF (SELECT COUNT(*) FROM dbo.Users WHERE role='KEYUSER')>1
 THROW 50003,N'Обнаружено несколько keyuser. Требуется выбрать единственную учётную запись перед обновлением.',1;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.Users') AND name=N'UX_Users_SingleKeyUser')
 CREATE UNIQUE INDEX UX_Users_SingleKeyUser ON dbo.Users(role) WHERE role='KEYUSER';
EXEC(N'CREATE OR ALTER TRIGGER dbo.TR_Users_ProtectKeyUser ON dbo.Users AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d WHERE d.role=''KEYUSER'' AND NOT EXISTS(SELECT 1 FROM inserted i WHERE i.id=d.id AND i.role=''KEYUSER''))
  THROW 50003,N''Нельзя удалить единственного keyuser или снять с него роль.'',1;
END');
