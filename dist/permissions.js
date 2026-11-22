(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.Access=value;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const roles={KEYUSER:'keyuser',ADMIN:'Администратор',ENGINEER:'Инженер',QUALITY:'Контроль качества',EMPLOYER:'Сотрудник'};
 const matrix={
  KEYUSER:['read','write','delete','bulk','import','export','catalogs','users','profile'],
  ADMIN:['read','write','delete','bulk','import','export','catalogs','users','profile'],
  ENGINEER:['read','write','delete','import','export','catalogs','profile'],
  QUALITY:['read','export','profile'],EMPLOYER:['read','write']
 };
 const can=(user,permission)=>Boolean(matrix[user?.role]?.includes(permission));
 const page=(user,tab)=>tab==='journal'||tab==='account'?can(user,'read'):tab==='users'?can(user,'users'):['mixtures','operators','reasons'].includes(tab)&&can(user,'catalogs');
 const manageUser=(actor,target)=>can(actor,'users')&&(target?.role!=='KEYUSER'||actor.role==='KEYUSER');
 return {roles,can,page,manageUser};
});
