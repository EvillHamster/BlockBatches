(function(root,factory){
 const rules=typeof module==='object'&&module.exports?require('./record-rules.js'):root.RecordRules;
 const api=factory(rules);if(typeof module==='object'&&module.exports)module.exports=api;else root.SourceSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(rules){
 function create(records,excludeId,initial=[]){
  const byId=new Map(records.map(row=>[row.id,row])),children=new Map(),blocked=new Set();
  for(const row of records)for(const source of rules.sourceIds(row)){if(!children.has(source))children.set(source,[]);children.get(source).push(row.id);}
  const pending=excludeId?[excludeId]:[];
  while(pending.length){const id=pending.pop();if(blocked.has(id))continue;blocked.add(id);pending.push(...(children.get(id)||[]));}
  const selected=new Set(initial);
  function reason(id){return !byId.has(id)?'Запись удалена или недоступна':id===excludeId?'Нельзя связать запись с самой собой':blocked.has(id)?'Связь создаст цикл: эта запись уже зависит от редактируемой':'';}
  return {selected,reason,toggle(id){if(reason(id))return false;selected.has(id)?selected.delete(id):selected.add(id);return true;},remove(id){selected.delete(id);},clear(){selected.clear();},valid(){return selected.size>0&&[...selected].every(id=>!reason(id));},ids(){return [...selected];}};
 }
 return {create};
});
