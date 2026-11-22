(function(root,factory){
 const rules=factory();
 if(typeof module==='object'&&module.exports)module.exports=rules;
 else root.RecordRules=rules;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const lines=['MB','FM','RW'];
 const steps=['MA','M1','M2','M3','R1','R2','FMF','FMR','FMS','RW/WO','CL-BATCH'];
 const fields=[
  ['date','Дата'],['sup','SUP'],['line','Линия'],['step','Шаг'],['mixtureId','Смесь'],
  ['batchNumber','№ замеса'],['palletNumber','№ паллеты'],['sampleNumber','№ образцов'],
  ['blockedWeight','Вес блокировки'],['reasonId','Причина'],['description','Описание проблемы'],
  ['shift','Номер смены'],['operatorId','Оператор']
 ];
 const normalizeName=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/gu,' ').trim();
 const requiresSource=name=>normalizeName(name)===normalizeName('Произведено из заблокированного MB');
 function localDate(date=new Date()){
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
 }
 function recentRecordWindow(now=new Date()){
  const from=new Date(now);from.setDate(from.getDate()-6);
  return {from:localDate(from),to:localDate(now)};
 }
 function validate(input){
  const errors={},value={};
  const str=key=>typeof input[key]==='string'?input[key].trim():'';
  const date=str('date');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'1753-01-01'||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)errors.date='Укажите корректную дату';
  value.date=date;
  value.sup=str('sup');
  if(!/^[0-9]{7}$/.test(value.sup))errors.sup='SUP должен содержать ровно 7 цифр';
  value.line=str('line');
  if(!lines.includes(value.line))errors.line='Выберите линию MB, FM или RW';
  value.step=str('step')||null;
  if(input.step!==undefined&&input.step!==null&&input.step!==''&&typeof input.step!=='string')errors.step='Выберите шаг из списка';
  if(value.step&&!steps.includes(value.step))errors.step='Выберите шаг из списка';
  for(const key of ['mixtureId','reasonId','operatorId','sourceRecordId']){
   const raw=input[key],empty=raw===''||raw===null||raw===undefined;
   const number=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
   value[key]=empty?null:number;
   if((key==='mixtureId'&&empty)||(!empty&&(!Number.isSafeInteger(number)||number<1||number>2147483647)))errors[key]=key==='mixtureId'?'Выберите смесь из списка':'Выберите значение из справочника';
  }
  for(const key of ['batchNumber','palletNumber','sampleNumber']){
   const raw=str(key);value[key]=raw||null;
   if(input[key]!==undefined&&input[key]!==null&&input[key]!==''&&typeof input[key]!=='string'){errors[key]='Введите номер или диапазон текстом';continue;}
   if(!raw)continue;
   if(raw.length>100||!/^\d+(-\d+)?$/.test(raw))errors[key]='Введите целое число или диапазон, например 5-12';
   else{const parts=raw.split('-');if(parts.length===2&&BigInt(parts[0])>BigInt(parts[1]))errors[key]='Начало диапазона должно быть не больше конца';}
  }
  const rawWeight=input.blockedWeight;
  if(rawWeight===''||rawWeight===null||rawWeight===undefined)value.blockedWeight=null;
  else{
   const raw=typeof rawWeight==='number'?String(rawWeight):typeof rawWeight==='string'?rawWeight.trim():'';
   const weight=Number(raw.replace(',','.'));
   if((typeof rawWeight!=='number'&&!/^\d+(?:[.,]\d+)?$/.test(raw))||!Number.isFinite(weight)||weight<0)errors.blockedWeight='Введите неотрицательный вес, например 125 или 125,5';
   value.blockedWeight=weight;
  }
  const shift=input.shift;
  value.shift=shift===''||shift===null||shift===undefined?null:Number(shift);
  if(value.shift!==null&&(![1,2,3,4].includes(value.shift)||!['1','2','3','4',1,2,3,4].includes(shift)))errors.shift='Выберите номер смены от 1 до 4';
  if(input.description!==undefined&&input.description!==null&&typeof input.description!=='string')errors.description='Введите текст описания';
  value.description=typeof input.description==='string'&&input.description.trim()?input.description:null;
  if(value.description?.length>4000)errors.description='Описание должно быть не длиннее 4000 символов';
  for(const [key,label] of fields){
   if(key!=='operatorId'&&(value[key]===null||value[key]===undefined||value[key]==='')&&!errors[key])errors[key]='Заполните поле «'+label+'»';
  }
  return {value,errors,valid:!Object.keys(errors).length};
 }
 function recordSearchText(record,names){return (record.sup+' '+(names.get(record.mixtureId)||'—')+' '+(record.reasonName||'')+' '+(record.operatorName||'')+' '+(record.description||'')).toLowerCase();}
 function buildRecordSearchIndex(records,mixtures){const names=new Map(mixtures.map(row=>[row.id,row.name]));return new Map(records.map(row=>[row.id,recordSearchText(row,names)]));}
 function filterRecords(records,mixtures,f={},searchIndex){
  const names=new Map(mixtures.map(row=>[row.id,row.name])),search=String(f.search||'').toLowerCase(),mixture=f.mixture||f.mix;
  return records.filter(r=>(!mixture||r.mixtureId===Number(mixture))&&(!f.line||r.line===f.line)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to)&&(!search||(searchIndex?.get(r.id)??recordSearchText(r,names)).includes(search)));
 }

 function distance(a,b){
  let previous=Array.from({length:b.length+1},(_,i)=>i),beforePrevious=null;
  for(let i=1;i<=a.length;i++){
   const current=[i];
   for(let j=1;j<=b.length;j++){
    current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])current[j]=Math.min(current[j],beforePrevious[j-2]+1);
   }
   beforePrevious=previous;previous=current;
  }
  return previous[b.length];
 }
 function rankOptions(options,query,limit=40){
  const q=normalizeName(query),tokens=q.split(' ').filter(Boolean);
  return options.map(option=>{
   const name=normalizeName(option.name);let score=Infinity;
   if(!q)score=0;
   else if(name===q)score=0;
   else if(name.startsWith(q))score=10;
   else if(name.includes(q))score=20;
   else if(tokens.every(token=>name.includes(token)))score=30;
   else{
    const words=name.split(/[\s/\-_]+/).filter(Boolean);
    const costs=tokens.map(token=>{
     if(name.includes(token))return 0;
     // Digit-bearing codes must retain their digits, even for fuzzy results.
     const digits=token.match(/\d+/g)?.join('|')||'';
     const candidates=words.filter(word=>(word.match(/\d+/g)?.join('|')||'')===digits);
     return Math.min(Infinity,...candidates.map(word=>distance(token,word)));
    });
    if(costs.every((cost,i)=>cost<=(tokens[i].length<4?0:tokens[i].length<8?1:2)))score=40+costs.reduce((a,b)=>a+b,0);
   }
   return {...option,score};
  }).filter(option=>Number.isFinite(option.score)).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name,'ru')).slice(0,limit);
 }
 return {lines,steps,fields,normalizeName,requiresSource,localDate,recentRecordWindow,buildRecordSearchIndex,filterRecords,validate,rankOptions};
});
