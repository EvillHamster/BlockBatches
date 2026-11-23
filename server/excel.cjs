const ExcelJS=require('exceljs');
const {sql}=require('./db.cjs');
const repository=require('./repository.cjs');
const {HttpError,normalize,normalizeLegacy,positive}=require('./validation.cjs');
const recordRules=require('../dist/record-rules.js');
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const maxFileSize=5*1024*1024;
const maxRows=5000;
const definitions={
 records:{sheet:'Журнал контроля',file:'DefectBatch-journal.xlsx',columns:recordRules.fields.map(([key,label])=>[({mixtureId:'mixtureName',reasonId:'reasonName',operatorId:'operatorName'}[key]||key),label,key==='description'?50:24]).concat([['sourceRecordId','Исходная запись (ID)',24],['exportId','ID записи',16],['sourceRecordIds','Исходные записи (ID)',28],['recordFormatVersion','Версия записи',16],['actual','Т факт (история)',20],['equipment','Т оборудования (история)',24],['author','Сотрудник (история)',24]])},
 mixtures:{sheet:'База смесей',file:'DefectBatch-mixtures.xlsx',columns:[
  ['name','Название смеси',32],['archived','Статус',18],['recordCount','Записей',14]
 ]}
};
const nameKey=value=>String(value).trim().toLocaleLowerCase('ru-RU');
const headerKey=value=>nameKey(value).replace(/[.,°()]/g,'').replace(/\s+/g,' ');
function definition(kind){if(!Object.hasOwn(definitions,kind))throw new HttpError(404,'Excel доступен только для журнала и базы смесей');return definitions[kind];}
function selectRows(state,kind,query=new URLSearchParams()){
 definition(kind);
 const search=nameKey(query.get('search')||'');
 if(kind==='mixtures'){
  const archived=query.get('archived');
  return state.mixtures.filter(m=>(archived===null||m.archived===(archived==='true'))&&nameKey(m.name).includes(search))
   .map(m=>({...m,recordCount:state.records.filter(r=>r.mixtureId===m.id).length}));
 }
 const names=new Map(state.mixtures.map(m=>[m.id,m.name]));
 return state.records.map(r=>({...r,mixtureName:names.get(r.mixtureId)||''}))
  .filter(r=>nameKey(r.sup+' '+r.mixtureName+' '+(r.reasonName||'')+' '+(r.operatorName||'')+' '+(r.description||'')).includes(search)&&
   (!query.get('mixture')||r.mixtureId===Number(query.get('mixture')))&&
   (!query.get('line')||r.line===query.get('line'))&&
   (!query.get('from')||r.date>=query.get('from'))&&(!query.get('to')||r.date<=query.get('to')));
}
async function exportWorkbook(pool,kind,query){
 const def=definition(kind),state=await repository.state(pool),rows=selectRows(state,kind,query);
 const workbook=new ExcelJS.Workbook();
 workbook.creator='DefectBatch';
 const sheet=workbook.addWorksheet(def.sheet,{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=def.columns.map(([key,header,width])=>({key,header,width}));
 for(const row of rows){
  const values={...row};
  if(kind==='records'){values.date=new Date(row.date+'T00:00:00Z');values.exportId=row.id;values.sourceRecordIds=recordRules.sourceIds(row).join('; ');}
  if(kind==='mixtures')values.archived=row.archived?'В архиве':'В работе';
  sheet.addRow(values);
 }
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 sheet.getRow(1).height=26;
 sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2563EB'}};
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:def.columns.length}};
 if(kind==='records'){
  sheet.getColumn('date').numFmt='dd.mm.yyyy';
  sheet.getColumn('sup').numFmt='@';
  sheet.getColumn('blockedWeight').numFmt='0.###############';
  for(const column of ['batchNumber','palletNumber','sampleNumber'])sheet.getColumn(column).numFmt='@';
 }
 sheet.eachRow((row,index)=>{row.alignment={vertical:'middle'};if(index>1)row.height=23;});
 return {buffer:await workbook.xlsx.writeBuffer(),filename:def.file};
}
// Bound expanded ZIP size before handing the workbook to ExcelJS.
function validateArchive(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<22)throw new HttpError(400,'Выберите корректный файл .xlsx');
 if(buffer.length>maxFileSize)throw new HttpError(413,'Максимальный размер файла — 5 МБ');
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){
  if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 }
 if(end<0)throw new HttpError(400,'Файл не является таблицей .xlsx');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);
 if(count===65535||count>1000||offset>=buffer.length)throw new HttpError(400,'Слишком сложная книга Excel');
 let current=offset,expanded=0,hasWorkbook=false;
 for(let i=0;i<count;i++){
  if(current+46>buffer.length||buffer.readUInt32LE(current)!==0x02014b50)throw new HttpError(400,'Повреждён файл Excel');
  expanded+=buffer.readUInt32LE(current+24);
  const nameLength=buffer.readUInt16LE(current+28),extraLength=buffer.readUInt16LE(current+30),commentLength=buffer.readUInt16LE(current+32);
  const name=buffer.subarray(current+46,current+46+nameLength).toString('utf8');
  if(name==='xl/workbook.xml')hasWorkbook=true;
  if(/vbaProject\.bin$/i.test(name))throw new HttpError(400,'Файлы с макросами не поддерживаются');
  if(expanded>40*1024*1024)throw new HttpError(413,'Слишком большой объём данных внутри Excel-файла');
  current+=46+nameLength+extraLength+commentLength;
 }
 if(!hasWorkbook)throw new HttpError(400,'Файл не является книгой Excel .xlsx');
}
function cellValue(cell){
 const value=cell.value;
 if(value===null||value===undefined)return '';
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value instanceof Date)return value;
 if(value.formula||value.sharedFormula)throw new Error('Формулы не поддерживаются: вставьте значения');
 if(Array.isArray(value.richText))return value.richText.map(p=>p.text).join('');
 throw new Error('Ячейка содержит неподдерживаемое значение');
}
function dateValue(value,date1904){
 if(value instanceof Date)return value.toISOString().slice(0,10);
 if(typeof value==='number'){
  if(!Number.isInteger(value)||value<1||value>2958465)throw new Error('Некорректная дата Excel');
  return new Date(Date.UTC(1899,11,30)+(value+(date1904?1462:0))*86400000).toISOString().slice(0,10);
 }
 const text=String(value).trim(),match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
 return match?match[3]+'-'+match[2]+'-'+match[1]:text;
}
function numeric(value){
 if(value==='')return null;
 if(typeof value==='number')return value;
 const text=String(value).trim().replace(',','.');
 if(!/^-?\d+(?:\.\d+)?$/.test(text))return null;
 return Number(text);
}
function status(value){
 const text=nameKey(value);
 if(['','в работе','активна','false','0'].includes(text))return false;
 if(['в архиве','архив','true','1'].includes(text))return true;
 throw new Error('Статус смеси: «В работе» или «В архиве»');
}
async function parseWorkbook(kind,buffer){
 const def=definition(kind);
 validateArchive(buffer);
 const workbook=new ExcelJS.Workbook();
 try{await workbook.xlsx.load(buffer);}catch{throw new HttpError(400,'Не удалось прочитать Excel. Используйте формат .xlsx без пароля.');}
 const sheet=workbook.getWorksheet(def.sheet)||(workbook.worksheets.length===1?workbook.worksheets[0]:null);
 if(!sheet)throw new HttpError(400,'В книге должен быть лист «'+def.sheet+'»');
 if(sheet.rowCount>maxRows+1||sheet.columnCount>50)throw new HttpError(400,'Допускается не более '+maxRows+' строк и 50 столбцов');
 const aliases={};
 for(const [key,title] of def.columns)aliases[headerKey(title)]=key;
 if(kind==='mixtures')aliases[headerKey('Смесь')]='name';
 const columns={};
 try{
  sheet.getRow(1).eachCell((cell,index)=>{
   const key=aliases[headerKey(cellValue(cell))];
   if(key){if(columns[key])throw new HttpError(400,'Повторный столбец: '+cell.text);columns[key]=index;}
  });
 }catch(error){throw new HttpError(400,error.message);}
 const required=kind==='mixtures'?['name']:['date','sup','line','mixtureName'];
 for(const key of required)if(!columns[key])throw new HttpError(400,'Отсутствует столбец «'+def.columns.find(c=>c[0]===key)[1]+'». Используйте экспорт как шаблон.');
 const rows=[],errors=[];let total=0,errorCount=0;
 for(let number=2;number<=sheet.rowCount;number++){
  const row=sheet.getRow(number);
  if(!Object.values(columns).some(column=>{const value=row.getCell(column).value;return value!==null&&value!==undefined&&value!=='';}))continue;
  total++;
  try{
   const values={};
   for(const [key,index] of Object.entries(columns))if(key!=='recordCount')values[key]=cellValue(row.getCell(index));
   let normalized;
   if(kind==='mixtures')normalized=normalize('mixtures',{name:String(values.name),archived:status(values.archived??'')});
   else{
    if(typeof values.sup==='number'&&(!Number.isSafeInteger(values.sup)||Math.abs(values.sup)>=1e15))throw new Error('SUP нужно записать текстом, чтобы не потерять цифры');
    const sourceRecordIds=String(values.sourceRecordIds??'').trim()?String(values.sourceRecordIds).trim().split(/[;,\s]+/).map(value=>positive(Number(value),'Исходные записи')):values.sourceRecordId? [positive(Number(values.sourceRecordId),'Исходная запись')]:[];
    const base={
     date:dateValue(values.date,workbook.properties.date1904),sup:String(values.sup),mixtureId:1,
     line:String(values.line).trim().toUpperCase(),step:values.step===undefined?'':String(values.step).trim(),
     batchNumber:String(values.batchNumber??''),palletNumber:String(values.palletNumber??''),sampleNumber:String(values.sampleNumber??''),
     blockedWeight:values.blockedWeight??null,sourceRecordIds,reasonId:String(values.reasonName??'').trim()?1:null,operatorId:null,description:values.description===undefined?'':String(values.description),shift:values.shift??null,
     recordFormatVersion:Number(values.recordFormatVersion||2),actual:numeric(values.actual??''),equipment:numeric(values.equipment??''),author:values.author?String(values.author):null
    };
    normalized={...(base.recordFormatVersion===1?normalizeLegacy(base):normalize('records',base)),exportId:values.exportId?positive(Number(values.exportId),'ID записи'):null,mixtureName:String(values.mixtureName).trim(),
     reasonName:String(values.reasonName??'').trim(),operatorName:String(values.operatorName??'').trim()};
    if(!normalized.mixtureName)throw new Error('Укажите смесь');
   }
   rows.push({number,value:normalized});
  }catch(error){errorCount++;if(errors.length<50)errors.push({row:number,message:error.message});}
 }
 return {rows,errors,total,errorCount};
}
function recordKey(row){
 return JSON.stringify([...recordRules.fields.map(([key])=>{const value=row[key];return typeof value==='string'?nameKey(value):value??null;}),[...recordRules.sourceIds(row)].sort((a,b)=>a-b),row.recordFormatVersion===1?[row.actual??null,row.equipment??null,row.author??null]:null]);
}
function makePlan(kind,parsed,state){
 const candidates=[],errors=[...parsed.errors],catalog=new Map(state.mixtures.map(m=>[nameKey(m.name),m]));
 const seen=new Map(state.records.map(row=>[recordKey(row),row.id])),prepared=[];
 let skipped=0,errorCount=parsed.errorCount;
 for(const row of parsed.rows){
  if(kind==='mixtures'){
   const key=nameKey(row.value.name);
   if(catalog.has(key)){skipped++;continue;}
   catalog.set(key,row.value);candidates.push(row);continue;
  }
  const mixture=catalog.get(nameKey(row.value.mixtureName));
  if(!mixture){errorCount++;if(errors.length<50)errors.push({row:row.number,message:'Смесь «'+row.value.mixtureName+'» отсутствует в базе. Сначала импортируйте базу смесей.'});continue;}
  const value={...row.value,mixtureId:mixture.id};
  let missing=false;
  for(const [idKey,nameKeyField,catalog,label] of [['reasonId','reasonName',state.reasons,'Причина'],['operatorId','operatorName',state.operators,'Оператор']]){
   const name=value[nameKeyField];
   if(!name){value[idKey]=null;continue;}
   const option=(catalog||[]).find(option=>recordRules.normalizeName(option.name)===recordRules.normalizeName(name));
   if(!option){errorCount++;missing=true;if(errors.length<50)errors.push({row:row.number,message:label+' «'+name+'» отсутствует в справочнике. Добавьте значение из формы записи.'});}
   else value[idKey]=option.id;
  }
  if(!missing){
   const reason=(state.reasons||[]).find(row=>row.id===value.reasonId),needsSource=recordRules.requiresSource(reason?.name);
   if((needsSource&&!value.sourceRecordIds.length)||(value.sourceRecordIds.length&&!needsSource)){
    errorCount++;missing=true;if(errors.length<50)errors.push({row:row.number,message:'Проверьте исходные образцы для причины «Произведено из заблокированного MB»'});
   }
  }
  if(missing)continue;
  prepared.push({...row,value});
 }
 if(kind==='records'){
  const exported=new Map(),resolved=new Map(),existing=new Set(state.records.map(row=>row.id));
  const fail=(row,message)=>{errorCount++;if(errors.length<50)errors.push({row:row.number,message});};
  for(const row of parsed.rows)if(row.value.exportId){if(exported.has(row.value.exportId))fail(row,'Повторный ID записи в файле');exported.set(row.value.exportId,row);}
  let pending=prepared;
  while(pending.length){
   const waiting=[];let progressed=false;
   for(const row of pending){
    const ids=row.value.sourceRecordIds;
    if(ids.some(id=>exported.has(id)&&!resolved.has(id))){waiting.push(row);continue;}
    if(ids.some(id=>!exported.has(id)&&!existing.has(id))){fail(row,'Исходный образец отсутствует. Включите его в файл вместе с ID записи. Старый файл без ID записей не позволяет восстановить удалённые связи.');progressed=true;continue;}
    const value={...row.value,sourceRecordIds:[...new Set(ids.map(id=>exported.has(id)?resolved.get(id):id))].sort((a,b)=>a-b)};value.sourceRecordId=value.sourceRecordIds[0]??null;
    const key=recordKey(value),temporaryId=seen.get(key)??-row.number;
    if(seen.has(key))skipped++;else{seen.set(key,temporaryId);candidates.push({...row,value,temporaryId});}
    if(row.value.exportId)resolved.set(row.value.exportId,temporaryId);
    progressed=true;
   }
   if(!progressed){for(const row of waiting)fail(row,'Циклическая связь или исходный образец содержит ошибку. Проверьте ID исходных записей.');break;}
   pending=waiting;
  }
 }
 return {candidates,summary:{total:parsed.total,added:candidates.length,skipped,errorCount,errors,
  columns:definitions[kind].columns.filter(c=>c[0]!=='recordCount').map(c=>c[1]),
  sample:candidates.slice(0,5).map(row=>kind==='mixtures'?[row.value.name,row.value.archived?'В архиве':'В работе']:definitions.records.columns.map(([key])=>row.value[key]??''))}};
}
async function previewImport(pool,kind,buffer){
 const parsed=await parseWorkbook(kind,buffer);
 return makePlan(kind,parsed,await repository.state(pool)).summary;
}
async function commitImport(pool,kind,buffer){
 const parsed=await parseWorkbook(kind,buffer),tx=new sql.Transaction(pool);
 await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await tx.request().query("DECLARE @result int; EXEC @result=sp_getapplock @Resource=N'DefectBatch-excel-import',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000; IF @result<0 THROW 50001,'Import lock unavailable',1;");
  const plan=makePlan(kind,parsed,await repository.state(tx));
  if(plan.summary.errorCount)throw new HttpError(400,'Импорт отменён. Строка '+plan.summary.errors[0].row+': '+plan.summary.errors[0].message);
  if(!parsed.total)throw new HttpError(400,'В файле нет строк для импорта');
  const inserted=new Map();
  for(const row of plan.candidates){
   const value=kind==='records'?{...row.value,sourceRecordIds:row.value.sourceRecordIds.map(id=>id<0?inserted.get(id):id)}:row.value;
   if(kind==='records')value.sourceRecordId=value.sourceRecordIds[0]??null;
   const id=await repository.save(tx,kind,value,undefined,{allowArchivedMixture:true,allowLegacy:true});
   if(kind==='records')inserted.set(row.temporaryId,id);
  }
  await tx.commit();
  return {added:plan.candidates.length,skipped:plan.summary.skipped};
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
module.exports={mime,maxFileSize,exportWorkbook,previewImport,commitImport,parseWorkbook,selectRows};
