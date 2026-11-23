const profileEnabled=new URLSearchParams(location.search).get('profile')==='1';
let firstReadyRendered=false;
const $ = (s, root = document) => root.querySelector(s);
const paths = {
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 logout:'<path d="M9 4H4v16h5m6-12 4 4-4 4m-5-4h11"/>',
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 settings:'<path d="m9.6 3-.5 2.2-1.8 1-2.1-.6-2.4 4.2L4.4 11v2l-1.6 1.2 2.4 4.2 2.1-.6 1.8 1 .5 2.2h4.8l.5-2.2 1.8-1 2.1.6 2.4-4.2-1.6-1.2v-2l1.6-1.2-2.4-4.2-2.1.6-1.8-1L14.4 3Z"/><circle cx="12" cy="12" r="3"/>',
 left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 clipboard:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6m-6 5h6"/>',
 edit:'<path d="m15 5 4 4M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15Z"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8m-10 5h6"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>'
};
const icon = (name, size=18) => '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.clipboard)+'</svg>';
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data={mixtures:[],records:[],users:[]};
let stateETag=null,recordSearchIndex=null;
let ready=false,loadError='',refreshBusy=false,currentUser=null;
let setupMode=false;
function showLogin(message='',initialSetup=false){
 currentUser=null;ready=false;stateETag=null;recordSearchIndex=null;document.querySelector('#role-help')?.close();document.querySelector('.source-picker-modal')?.close();
 $('#application').hidden=true;$('#login-screen').hidden=false;
 if($('#editor').open)$('#editor').close();
 $('#login-form').reset();
 setupMode=initialSetup;
 const form=$('#login-form');
 $('#login-title').textContent=setupMode?'Регистрация keyuser':'Вход в систему';
 $('#login-description').textContent=setupMode?'Создайте первый аккаунт. Он получит роль keyuser и сможет управлять пользователями.':'Войдите в свою учётную запись.';
 for(const [id,name] of [['setup-name-field','name'],['setup-confirm-field','passwordConfirm']]){$('#'+id).hidden=!setupMode;form.elements[name].disabled=!setupMode;form.elements[name].required=setupMode;}
 form.elements.password.autocomplete=setupMode?'new-password':'current-password';form.elements.password.minLength=setupMode?4:1;
 $('button[type="submit"]',form).textContent=setupMode?'Создать аккаунт keyuser':'Войти';
 if(setupMode)form.elements.login.value='keyuser';
 $('#login-error').hidden=!message;$('#login-error').textContent=message;
}
function showApplication(user){
 currentUser=user;
 $('#login-screen').hidden=true;$('#application').hidden=false;
 $('.profile-avatar').textContent=user.name.slice(0,2).toUpperCase();
 $('.profile strong').textContent=user.name;
 $('.profile small').textContent=Access.roles[user.role];
 $('.signed-in').textContent=user.name+' · '+Access.roles[user.role];
 document.querySelectorAll('nav [data-tab]').forEach(button=>button.hidden=!Access.page(user,button.dataset.tab));
 refreshRoleHelp(user);
}

async function api(path, options={}){
 const response=await fetch('/api'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
 if(response.status===304&&path==='/state')return null;
 if(response.ok&&path==='/state')stateETag=response.headers.get('ETag');
 let body;try{body=await response.json();}catch{throw new Error('Сервер недоступен. Запустите npm start.');}
 if(!response.ok){
  if(response.status===401&&path!=='/auth/login')showLogin('Войдите в систему');
  const error=new Error(body.error||'Не удалось выполнить запрос');error.status=response.status;error.fields=body.fields;throw error;
 }
 return body;
}
async function refreshData(){
 const previousTag=stateETag;
 const next=await api('/state',{headers:stateETag?{'If-None-Match':stateETag}:{}});
 if(next===null){ready=true;loadError='';return false;}
 const changed=stateETag?stateETag!==previousTag||!ready:JSON.stringify(next)!==JSON.stringify(data);
 data=next;recordSearchIndex=RecordRules.buildRecordSearchIndex(data.records,data.mixtures);ready=true;loadError='';
 if(currentUser){const updated=data.users.find(u=>u.id===currentUser.id);if(updated)showApplication(updated);}
 return changed;
}
async function afterMutation(message){
 try{await refreshData();render();notify(message);}
 catch{ready=false;loadError='Изменение сохранено, но список не удалось обновить. Повторите загрузку.';render();}
}
async function bootstrap(){
 ready=false;loadError='';render();
 try{
  const setup=await api('/setup');if(setup.available){showLogin('',true);return;}
  const session=await api('/auth/me');showApplication(session.user);
  await refreshData();
  if(data.canImport&&!data.mixtures.length&&!data.users.length&&!data.records.length){
   let local;try{local=JSON.parse(localStorage.getItem('defectbatch.prototype.v1'));}catch{}
   if(local&&['mixtures','users','records'].every(k=>Array.isArray(local[k]))&&Object.values(local).some(v=>Array.isArray(v)&&v.length)){
    try{data=await api('/import',{method:'POST',body:JSON.stringify(local)});notify('Данные из браузера перенесены в SQL Server');}
    catch(error){await refreshData();if(!data.mixtures.length&&!data.users.length&&!data.records.length)throw new Error('Не удалось перенести данные из браузера: '+error.message);else notify('В SQL Server уже есть данные. Локальная копия сохранена в браузере.');}
   }
  }
  render();
 }catch(error){if(error.status===401){showLogin();return;}ready=false;loadError=error.message;render();}
}
let tab='journal', search='', mix='', line='', from='', to='', archived=false, page=1;
const columnPreferenceKey='defectbatch.journal.hiddenColumns.v1';
let hiddenJournalColumns=new Set(),columnsOpen=false;
try{const saved=JSON.parse(localStorage.getItem(columnPreferenceKey)||'[]');if(Array.isArray(saved))hiddenJournalColumns=new Set(saved.filter(key=>RecordRules.fields.some(([field])=>field===key)));}catch{}
if(hiddenJournalColumns.size===RecordRules.fields.length)hiddenJournalColumns.clear();
function columnAttributes(key){return ' data-column="'+key+'"'+(hiddenJournalColumns.has(key)?' hidden':'');}
function journalColumnSettings(){
 const visibleCount=RecordRules.fields.length-hiddenJournalColumns.size;
 return '<details class="journal-columns" '+(columnsOpen?'open':'')+'><summary class="button secondary">'+icon('settings',16)+'Столбцы <span>'+visibleCount+'/'+RecordRules.fields.length+'</span></summary><div class="journal-columns-menu"><strong>Показывать столбцы</strong><div class="journal-columns-options">'+RecordRules.fields.map(([key,label])=>'<label><input type="checkbox" aria-label="'+label+'" data-column-toggle="'+key+'" '+(!hiddenJournalColumns.has(key)?'checked':'')+' '+(visibleCount===1&&!hiddenJournalColumns.has(key)?'disabled':'')+'>'+label+'</label>').join('')+'</div><button type="button" class="text-button" data-action="columns-show-all">Показать все</button><small>Выбор сохраняется в этом браузере</small></div></details>';
}
function saveColumnSettings(){try{localStorage.setItem(columnPreferenceKey,JSON.stringify([...hiddenJournalColumns]));}catch{notify('Не удалось запомнить настройку в браузере');}}
const pageSize=8;
const titles={journal:'Журнал контроля',mixtures:'База смесей',users:'Пользователи',operators:'Операторы',reasons:'Причины вылетов',account:'Настройки аккаунта'};
const subtitles={journal:'Учёт блокировок производственных партий.',mixtures:'Справочник производственных смесей.',users:'Управление сотрудниками, ролями и доступом.',operators:'Справочник операторов производства.',reasons:'Справочник причин блокировки партий.',account:'Персональные данные и настройки входа.'};
const eyebrow={journal:'CONTROL LOG',mixtures:'MIXTURE LIBRARY',users:'TEAM & ACCESS',operators:'OPERATORS',reasons:'REASONS',account:'ACCOUNT SETTINGS'};
const roles=Access.roles;
const can=permission=>Access.can(currentUser,permission);
const nameOf=id=>data.mixtures.find(m=>m.id===Number(id))?.name||'—';
const countOf=id=>data.records.filter(r=>r.mixtureId===id).length;
const plural=(n,forms)=>forms[n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];

let toastTimer;
function notify(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
$('#header-date').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date());
const toggle=$('#sidebar-toggle');
function setCollapsed(value){
 document.body.classList.toggle('nav-collapsed',value);toggle.setAttribute('aria-expanded',String(!value));toggle.setAttribute('aria-label',value?'Показать навигацию':'Скрыть навигацию');
 $('#navigation').inert=value;
 try{localStorage.setItem('defectbatch.sidebar',String(value));}catch{}
}
let savedSidebar;try{savedSidebar=localStorage.getItem('defectbatch.sidebar');}catch{}
setCollapsed(savedSidebar===null?innerWidth<=700:savedSidebar==='true');
toggle.onclick=()=>setCollapsed(!document.body.classList.contains('nav-collapsed'));
const options=(rows,valueKey='id',labelKey='name')=>rows.map(r=>'<option value="'+escapeHTML(r[valueKey])+'">'+escapeHTML(r[labelKey])+'</option>').join('');
const hasFilters=()=>Boolean(search||mix||line||from||to);
const clearFilter=(key,label)=>'<button type="button" class="clear-filter" data-action="clear-filter" data-filter="'+key+'" aria-label="'+label+'" title="'+label+'">'+icon('close',14)+'</button>';
const clearAllButton=()=>hasFilters()?'<button type="button" class="button secondary clear-all" data-action="reset">Очистить всё</button>':'';
const wrapFilter=(content,active,key,label)=>'<div class="clearable-filter">'+content+(active?clearFilter(key,label):'')+'</div>';
const searchBox=(placeholder)=>'<label class="search">'+icon('search')+'<input id="search" aria-label="'+placeholder+'" placeholder="'+placeholder+'" value="'+escapeHTML(search)+'">'+(search?clearFilter('search','Очистить поиск'):'')+'</label>';
function journalFilters(){
 const dates='<div class="date-filter"><button type="button" class="filter-button" data-action="dates" aria-expanded="false" aria-controls="date-popover">'+icon('calendar',16)+(from||to?'Период выбран':'Все даты')+'</button><div id="date-popover" class="date-popover" hidden><label>С даты<input id="from" type="date" value="'+from+'"></label><label>По дату<input id="to" type="date" value="'+to+'"></label><button class="button primary" data-action="apply-dates">Применить</button></div></div>';
 const mixture='<div class="journal-mixture-filter" id="journal-mixture-filter"><button type="button" id="mixture-filter" class="filter-button mixture-filter-trigger" aria-label="Фильтр по смеси" aria-expanded="false" aria-controls="mixture-filter-popover"><span>'+escapeHTML(mix?nameOf(mix):'Все смеси')+'</span>'+icon('right',13)+'</button><div id="mixture-filter-popover" class="mixture-filter-popover" hidden><input type="text" id="mixture-filter-search" role="combobox" aria-label="Поиск смеси в фильтре" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="mixture-filter-options" placeholder="Поиск смеси…"><div id="mixture-filter-options" class="mixture-filter-options" role="listbox" aria-label="Смеси"></div></div></div>';
 const lines='<select id="line-filter" aria-label="Фильтр по линии"><option value="">Все линии</option><option>MB</option><option>FM</option><option>RW</option>'+(data.records.some(r=>r.line==='FMF')?'<option>FMF</option>':'')+'</select>';
 return '<div class="filter-controls">'+wrapFilter(dates,from||to,'dates','Очистить даты')+wrapFilter(mixture,mix,'mixture','Очистить смесь')+wrapFilter(lines,line,'line','Очистить линию')+clearAllButton()+'</div>';
}
const heading=()=>'<div class="page-heading"><div><div class="eyebrow">DEFECTBATCH / '+eyebrow[tab]+'</div><h1>'+titles[tab]+'<span class="heading-dot"></span></h1><p>'+subtitles[tab]+'</p></div>'+(['journal','mixtures'].includes(tab)&&(tab!=='journal'||can('write'))?'<button class="button primary" data-action="new">'+icon('plus')+(tab==='journal'?'Новая запись':'Добавить смесь')+'</button>':'')+'</div>';
function filteredRecords(){return RecordRules.filterRecords(data.records,data.mixtures,{search,mixture:mix,line,from,to},recordSearchIndex).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);}
function footer(total,label){
 const pages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,pages);
 const forms=label==='смесей'?['смесь','смеси','смесей']:label==='пользователей'?['пользователь','пользователя','пользователей']:['запись','записи','записей'];
 const countLabel=label==='записей'?'Всего записей: '+total:total+' '+plural(total,forms);
 return '<div class="table-footer"><span>'+countLabel+'</span><div class="pagination"><span>Страница '+page+' из '+pages+'</span><button data-action="prev" aria-label="Предыдущая страница" '+(page===1?'disabled':'')+'>'+icon('left',14)+'</button><span class="page-number">'+page+'</span><button data-action="next" aria-label="Следующая страница" '+(page===pages?'disabled':'')+'>'+icon('right',14)+'</button></div></div>';
}
const excelButtons=kind=>'<div class="transfer-actions">'+(can('import')?'<button type="button" class="button secondary" data-action="excel-import" data-kind="'+kind+'">'+icon('upload',16)+'Импорт Excel</button>':'')+(can('export')?'<button type="button" class="button secondary" data-action="excel-export" data-kind="'+kind+'">'+icon('download',16)+'Экспорт Excel</button>':'')+'</div>';
const actions=(type,id,extra='')=>type==='user'&&data.users.find(row=>row.id===id)?.role==='KEYUSER'?'<div class="row-actions"><button data-action="edit" data-type="user" data-id="'+id+'" aria-label="Редактировать">'+icon('edit',16)+'</button></div>':type==='record'?'<div class="row-actions">'+(can('write')?'<button data-action="edit" data-type="record" data-id="'+id+'" aria-label="Редактировать">'+icon('edit',16)+'</button>':'')+(can('delete')?'<button data-action="delete" data-type="record" data-id="'+id+'" aria-label="Удалить">'+icon('trash',16)+'</button>':'')+'</div>':'<div class="row-actions"><button data-action="edit" data-type="'+type+'" data-id="'+id+'" aria-label="Редактировать">'+icon('edit',16)+'</button>'+extra+'<button data-action="delete" data-type="'+type+'" data-id="'+id+'" aria-label="Удалить">'+icon('trash',16)+'</button></div>';
function recordDisplay(record,key){
 if(key==='mixtureId')return nameOf(record.mixtureId);
 if(key==='reasonId')return record.reasonName||data.reasons?.find(row=>row.id===record.reasonId)?.name||'—';
 if(key==='operatorId')return record.operatorName||data.operators?.find(row=>row.id===record.operatorId)?.name||'—';
 const value=record[key];
 if(value===null||value===undefined||value==='')return '—';
 if(key==='date')return value.split('-').reverse().join('.');
 if(key==='blockedWeight')return Number(value).toLocaleString('ru-RU',{maximumFractionDigits:20});
 return value;
}
function sourceRecordLink(record){
 return RecordRules.sourceIds(record).map(id=>{const source=data.records.find(row=>row.id===id);return source?'<a class="source-record-link" href="#record/'+source.id+'">'+escapeHTML(sourceRecordLabel(source,data))+' ↗</a>':'';}).join('');
}
let recordViewTrail=[];
function openRecordView(id){
 const d=$('#editor');if(d.open&&!d.dataset.recordView)return;
 const record=data.records.find(row=>row.id===id);
 if(d.dataset.recordView===String(id))return;
 if(d.dataset.recordView){const backIndex=recordViewTrail.lastIndexOf(id);if(backIndex>=0)recordViewTrail.splice(backIndex);else recordViewTrail.push(Number(d.dataset.recordView));}
 else{recordViewTrail=[];d.addEventListener('close',()=>{delete d.dataset.recordView;recordViewTrail=[];d.classList.remove('record-view-modal');if(/^#record\//.test(location.hash))history.replaceState(null,'','#journal');},{once:true});}
 d.dataset.recordView=String(id);d.classList.remove('blocking-record-modal');d.classList.add('record-view-modal');
 d.innerHTML='<button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><div class="record-view-navigation"><button type="button" class="button secondary" data-action="record-view-back">'+icon('left',16)+'Назад</button></div><h2 id="editor-title">'+(record?'Образец SUP '+escapeHTML(record.sup):'Образец не найден')+'</h2>'+(record?'<p class="modal-subtitle">Запись № '+record.id+' · просмотр</p><dl class="record-view-details">'+RecordRules.fields.map(([key,label])=>'<div><dt>'+label+'</dt><dd>'+escapeHTML(recordDisplay(record,key))+(key==='reasonId'?sourceRecordLink(record):'')+'</dd></div>').join('')+'</dl>':'<p>Запись удалена или недоступна.</p>')+'<div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Закрыть</button></div>';
 if(!d.open)d.showModal();d.scrollTop=0;
}
function journal(){
 const rows=filteredRecords();page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<section class="table-panel"><div class="table-panel-heading"><div><h2>Записи контроля <span id="record-count" aria-live="polite" aria-atomic="true">'+rows.length+'</span></h2><p>Блокировки производственных партий</p></div>'+'<div class="journal-table-tools">'+journalColumnSettings()+(can('bulk')?'<button type="button" class="button secondary" data-action="bulk-delete">'+icon('trash',16)+'Удалить по фильтрам</button>':'')+excelButtons('records')+'</div></div><div class="filter-bar">'+searchBox('Поиск по SUP, смеси или описанию…')+journalFilters()+'</div>'+
 '<div class="table-scroll"><table class="blocking-record-table" style="min-width:'+Math.max(440,1900-hiddenJournalColumns.size*135)+'px"><thead><tr>'+RecordRules.fields.map(([key,label])=>'<th'+columnAttributes(key)+'>'+label+'</th>').join('')+'<th'+(!can('write')&&!can('delete')?' hidden':'')+'>Действия</th></tr></thead><tbody>'+
 rows.slice((page-1)*pageSize,page*pageSize).map(record=>'<tr>'+RecordRules.fields.map(([key])=>'<td'+columnAttributes(key)+' class="'+(key==='description'?'record-description':key==='sup'?'sup-cell':key==='date'?'date-cell':'')+'">'+escapeHTML(recordDisplay(record,key))+(key==='reasonId'?sourceRecordLink(record):'')+'</td>').join('')+'<td'+(!can('write')&&!can('delete')?' hidden':'')+'>'+actions('record',record.id)+'</td></tr>').join('')+
 '</tbody></table></div>'+(!rows.length?empty('Записи не найдены','Измените фильтры или добавьте новую запись.'):'')+footer(rows.length,'записей')+'</section>';
}
function mixtures(){
 const rows=data.mixtures.filter(m=>m.archived===archived&&m.name.toLowerCase().includes(search.toLowerCase()));page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<div class="mixture-transfers">'+excelButtons('mixtures')+'</div><section class="table-panel mixture-table"><div class="table-panel-heading"><div class="segment-tabs"><button data-action="active" class="'+(!archived?'selected':'')+'">В работе <span>'+data.mixtures.filter(m=>!m.archived).length+'</span></button><button data-action="archived" class="'+(archived?'selected':'')+'">Архив <span>'+data.mixtures.filter(m=>m.archived).length+'</span></button></div>'+'<div class="search-tools">'+searchBox('Поиск смеси…')+'</div></div><div class="table-scroll"><table><thead><tr><th>Название смеси</th><th>Записей</th><th>Статус</th><th>Действия</th></tr></thead><tbody>'+rows.slice((page-1)*pageSize,page*pageSize).map(m=>'<tr><td><span class="mixture-cell"><button class="text-button" data-action="edit" data-type="mixture" data-id="'+m.id+'">'+escapeHTML(m.name)+'</button></span></td><td>'+countOf(m.id)+'</td><td><span class="library-status '+(!archived?'live':'')+'">'+(archived?'В архиве':'В работе')+'</span></td><td>'+actions('mixture',m.id,'<button data-action="archive" data-id="'+m.id+'" aria-label="'+(archived?'Вернуть в работу':'В архив')+'">'+icon('archive',16)+'</button>')+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty(archived?'Архив пуст':'Смеси не найдены','Добавьте смесь или измените поисковый запрос.'):'')+footer(rows.length,'смесей')+'</section><div class="library-note">Справочник доступен при создании записей. Архивные смеси остаются в истории журнала.</div>';
}
function users(){
 const rows=data.users.filter(u=>(u.name+' '+u.login).toLowerCase().includes(search.toLowerCase()));page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<section class="table-panel"><div class="table-panel-heading"><div><h2>Команда <span>'+data.users.length+'</span></h2><p>Персональные учётные записи и права доступа</p></div><button class="button primary" data-action="new">'+icon('plus',17)+'Добавить пользователя</button></div><div class="filter-bar">'+searchBox('Имя или логин')+'</div><div class="table-scroll"><table><thead><tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Действия</th></tr></thead><tbody>'+rows.slice((page-1)*pageSize,page*pageSize).map(u=>'<tr><td><span class="mixture-cell">'+icon('user',16)+escapeHTML(u.name)+'</span></td><td>'+escapeHTML(u.login)+'</td><td>'+(u.role==='ADMIN'?'<span class="role-label">'+icon('shield',14)+roles[u.role]+'</span>':roles[u.role])+'</td><td>'+(Access.manageUser(currentUser,u)?actions('user',u.id):'<span class="protected-account">Защищён</span>')+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty('Пользователи не найдены','Попробуйте другое имя или логин.'):'')+footer(rows.length,'пользователей')+'</section><div class="library-note">'+icon('shield')+' Список сотрудников и роли сохраняются в базе данных.</div>';
}
function catalogPage(kind){
 const rows=RecordRules.rankOptions(data[kind]||[],search,Infinity),operators=kind==='operators';
 return '<section class="table-panel catalog-table '+(operators?'operators-catalog':'')+'"><div class="table-panel-heading"><h2>'+titles[kind]+' <span>'+(data[kind]||[]).length+'</span></h2><button class="button primary" data-action="catalog-new" data-kind="'+kind+'">'+icon('plus',17)+(operators?'Добавить оператора':'Добавить причину')+'</button></div><div class="filter-bar">'+searchBox(operators?'Поиск оператора…':'Поиск причины…')+'</div><div class="table-scroll"><table><thead><tr>'+(operators?'<th>Фамилия</th><th>Имя</th>':'<th>Причина</th>')+'<th>Действия</th></tr></thead><tbody>'+rows.map(row=>'<tr>'+(operators?'<td>'+escapeHTML(row.lastName||row.name)+'</td><td>'+escapeHTML(row.firstName||'—')+'</td>':'<td>'+escapeHTML(row.name)+'</td>')+'<td><div class="row-actions"><button data-action="catalog-edit" data-kind="'+kind+'" data-id="'+row.id+'" aria-label="Редактировать">'+icon('edit',16)+'</button><button data-action="catalog-delete" data-kind="'+kind+'" data-id="'+row.id+'" aria-label="Удалить">'+icon('trash',16)+'</button></div></td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty('Ничего не найдено','Добавьте запись или измените поиск.'):'')+'</section>';
}
function confirmCatalogDelete(kind,id){
 const item=data[kind]?.find(row=>row.id===id);if(!item)return;
 const operators=kind==='operators',key=operators?'operatorId':'reasonId',used=data.records.some(row=>row[key]===id),d=$('#editor');
 d.innerHTML='<form><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><h2 id="editor-title">Удалить '+(operators?'оператора':'причину')+'?</h2><p class="modal-subtitle">«'+escapeHTML(item.name)+'» '+(operators?'будет удалён':'будет удалена')+' из справочника.</p>'+(used?'<div class="form-error">Запись используется в журнале контроля. Удаление недоступно, чтобы сохранить историю.</div>':'')+'<div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close" autofocus>Отмена</button><button type="submit" class="button danger" '+(used?'disabled':'')+'>'+icon('trash',16)+'Удалить</button></div></form>';
 const form=$('form',d);form.onsubmit=async e=>{
  e.preventDefault();if(used||form.dataset.saving)return;
  const buttons=Array.from(form.querySelectorAll('button')),error=$('[role="alert"]',form);form.dataset.saving='true';buttons.forEach(button=>button.disabled=true);error.hidden=true;
  try{await api('/catalogs/'+kind+'/'+id,{method:'DELETE',body:JSON.stringify({version:item.version})});d.close();await afterMutation('Удалено');}
  catch(err){error.textContent=err.message;error.hidden=false;}
  finally{delete form.dataset.saving;buttons.forEach(button=>button.disabled=false);}
 };d.showModal();
}
function openCatalogEditor(kind,id){
 const item=(data[kind]||[]).find(row=>row.id===id),operators=kind==='operators',d=$('#editor');
 const body=operators?field('Фамилия','lastName',item?.lastName||'','text','maxlength="100"')+field('Имя','firstName',item?.firstName||'','text','maxlength="100"'):field('Текст причины','name',item?.name||'','text','maxlength="200"');
 d.innerHTML='<form><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><h2 id="editor-title">'+(item?(operators?'Редактировать оператора':'Редактировать причину'):(operators?'Новый оператор':'Новая причина'))+'</h2><p class="modal-subtitle">'+(operators?'Укажите фамилию и имя.':'Укажите причину блокировки партии.')+'</p>'+body+'<div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Отмена</button><button type="submit" class="button primary">Сохранить</button></div></form>';
 const form=$('form',d),submit=$('[type="submit"]',form),error=$('.form-error',form);
 const valid=()=>Array.from(form.querySelectorAll('input')).every(input=>input.value.trim());
 form.oninput=()=>submit.disabled=!valid();form.oninput();
 form.onsubmit=async e=>{
  e.preventDefault();if(!valid())return;
  form.dataset.saving='true';const controls=Array.from(form.querySelectorAll('button,input'));const body=Object.fromEntries(new FormData(form));
  controls.forEach(control=>control.disabled=true);error.hidden=true;
  try{const result=await api('/catalogs/'+kind+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:JSON.stringify({...body,...(item?{version:item.version}:{})})});d.close();await afterMutation(result.created===false&&!item?'Такая запись уже есть в справочнике':'Сохранено');}
  catch(err){error.textContent=err.message;error.hidden=false;}
  finally{delete form.dataset.saving;controls.forEach(control=>control.disabled=false);form.oninput();}
 };d.showModal();
}
const field=(label,name,value='',type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+escapeHTML(value)+'" '+extra+' required></label>';
function account(){
 const details='<section class="auth-card"><h2>Мой аккаунт</h2><dl class="account-details"><div><dt>Имя</dt><dd>'+escapeHTML(currentUser.name)+'</dd></div><div><dt>Логин</dt><dd>'+escapeHTML(currentUser.login)+'</dd></div><div><dt>Роль</dt><dd>'+escapeHTML(roles[currentUser.role])+'</dd></div></dl></section>';
 if(!can('profile'))return '<div class="account-settings">'+details+'<section class="auth-card"><p>Имя, логин и пароль сотрудника меняет администратор или keyuser.</p></section></div>';
 return '<div class="account-settings">'+details+'<form class="auth-card" id="login-change-form"><h2>Изменить имя и логин</h2>'+field('Имя','name',currentUser.name,'text','maxlength="120"')+field('Новый логин','login',currentUser.login,'text','minlength="3" maxlength="64" pattern="[A-Za-z0-9._-]+"')+'<div class="form-error" role="alert" hidden></div><button type="submit" class="button primary">Сохранить данные</button></form><form class="auth-card account-form" id="password-form"><h2>Сменить пароль</h2><p>После изменения войдите с новым паролем.</p>'+field('Текущий пароль','current','','password','autocomplete="current-password"')+field('Новый пароль','password','','password','minlength="4" maxlength="128" autocomplete="new-password"')+field('Подтвердите новый пароль','passwordConfirm','','password','minlength="4" maxlength="128" autocomplete="new-password"')+'<p>От 4 до 128 символов.</p><div class="form-error" role="alert" hidden></div><button type="submit" class="button primary">Сменить пароль</button></form></div>';
}

function empty(title,text){return '<div class="empty-state"><span class="empty-icon">'+icon(tab==='mixtures'?'database':'search',26)+'</span><h3>'+title+'</h3><p>'+text+'</p></div>';}
function render(){
 const renderStarted=profileEnabled?performance.now():0;
 if(currentUser&&!Access.page(currentUser,tab)){tab='journal';history.replaceState(null,'','#journal');notify('Раздел недоступен для вашей роли');}
 $('#page').dataset.view=tab;
 if(!ready){$('#page').innerHTML='<div class="empty-state"><h3>'+(loadError?'Не удалось загрузить данные':'Подключение к базе данных…')+'</h3><p>'+escapeHTML(loadError||'Загружаем записи, смеси и пользователей.')+'</p>'+(loadError?'<button type="button" class="button primary" data-action="retry-load">Повторить</button>':'')+'</div>';return;}
 $('#page').innerHTML=heading()+({journal,mixtures,users,account,operators:()=>catalogPage('operators'),reasons:()=>catalogPage('reasons')}[tab])();
 $('#breadcrumb').textContent=titles[tab];document.title='DefectBatch — '+titles[tab];
 document.querySelectorAll('nav [data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if($('#journal-mixture-filter'))mountMixtureFilter({container:$('#journal-mixture-filter'),mixtures:data.mixtures,selected:mix,onChange:value=>{mix=value;page=1;render();$('#mixture-filter')?.focus();}});
 const columnMenu=$('.journal-columns');if(columnMenu){const fitMenu=()=>{columnMenu.querySelector('.journal-columns-menu').style.maxHeight=Math.max(160,innerHeight-columnMenu.querySelector('summary').getBoundingClientRect().bottom-24)+'px';};columnMenu.ontoggle=()=>{if(columnMenu.isConnected){columnsOpen=columnMenu.open;if(columnsOpen)fitMenu();}};if(columnsOpen)fitMenu();}
 if($('#line-filter'))$('#line-filter').value=line;
 if($('#search'))$('#search').oninput=e=>{search=e.target.value;page=1;const pos=e.target.selectionStart;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);};

 if($('#line-filter'))$('#line-filter').onchange=e=>{line=e.target.value;page=1;render();};
 if($('#login-change-form'))$('#login-change-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,button=$('button',f),error=$('.form-error',f);button.disabled=true;error.hidden=true;try{const result=await api('/auth/profile',{method:'PUT',body:JSON.stringify({name:f.elements.name.value.trim(),login:f.elements.login.value.trim(),version:currentUser.version})});showApplication(result.user);await afterMutation('Данные аккаунта сохранены');}catch(err){error.textContent=err.message;error.hidden=false;}finally{button.disabled=false;}};
 if($('#password-form'))bindPasswordPair($('#password-form'),true);
 if($('#password-form'))$('#password-form').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,err=$('.form-error',f),button=$('[type="submit"]',f);
  if(!f.passwordPairValid())return;
  button.disabled=true;err.hidden=true;
  try{await api('/auth/password',{method:'PUT',body:JSON.stringify({currentPassword:f.elements.current.value,password:f.elements.password.value,passwordConfirm:f.elements.passwordConfirm.value})});showLogin('Пароль изменён. Войдите с новым паролем.');}
  catch(error){err.hidden=false;err.textContent=error.message;}
  finally{button.disabled=false;}
 };
 showAddressedRecord();
 if(profileEnabled){
  const measuredPage=$('#page');measuredPage.dataset.renderMs=(performance.now()-renderStarted).toFixed(1);measuredPage.dataset.recordCount=String(data.records.length);
  if(!firstReadyRendered){measuredPage.dataset.readyMs=performance.now().toFixed(1);firstReadyRendered=true;}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(measuredPage.isConnected)measuredPage.dataset.paintMs=(performance.now()-renderStarted).toFixed(1);}));
 }
}
function showAddressedRecord(){const match=/^#record\/([1-9]\d*)$/.exec(location.hash);if(match&&ready)openRecordView(Number(match[1]));}
function navigate(){tab=Object.hasOwn(titles,location.hash.slice(1))?location.hash.slice(1):'journal';search='';mix='';line='';from='';to='';page=1;archived=false;render();}
window.addEventListener('hashchange',navigate);
document.addEventListener('keydown',e=>{
 if(e.key==='F1'&&currentUser){e.preventDefault();openRoleHelp(currentUser);return;}
 const menu=$('.journal-columns[open]');if(e.key==='Escape'&&menu){e.preventDefault();menu.open=false;columnsOpen=false;menu.querySelector('summary').focus();}
});
document.addEventListener('change',e=>{
 const key=e.target.dataset.columnToggle;if(!key)return;
 if(e.target.checked)hiddenJournalColumns.delete(key);else if(hiddenJournalColumns.size<RecordRules.fields.length-1)hiddenJournalColumns.add(key);
 saveColumnSettings();columnsOpen=true;render();document.querySelector('[data-column-toggle="'+key+'"]')?.focus();
});
document.addEventListener('click',async e=>{
 const columnMenu=$('.journal-columns[open]');if(columnMenu&&!e.target.closest('.journal-columns')){columnMenu.open=false;columnsOpen=false;}
 const navigation=e.target.closest('[data-tab]');if(navigation){location.hash=navigation.dataset.tab;if(innerWidth<=700)setCollapsed(true);return;}
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action,id=Number(b.dataset.id);
 if(action==='help'){openRoleHelp(currentUser);return;}
 if(action==='bulk-delete'){if(can('bulk'))openBulkDelete();return;}
 if(action==='record-view-back'){if(recordViewTrail.length)location.hash='record/'+recordViewTrail.at(-1);else $('#editor').close();return;}
 if(action==='columns-show-all'){hiddenJournalColumns.clear();saveColumnSettings();columnsOpen=true;render();$('[data-action="columns-show-all"]')?.focus();return;}
 if(action==='retry-load'){await bootstrap();return;}
 if(action==='catalog-delete'){if(!can('catalogs'))return;confirmCatalogDelete(b.dataset.kind,id);return;}
 if(action==='catalog-new'||action==='catalog-edit'){if(!can('catalogs'))return;openCatalogEditor(b.dataset.kind,action==='catalog-edit'?id:undefined);return;}
 if(action==='new')openEditor(tab==='journal'?'record':tab==='mixtures'?'mixture':'user');
 if(action==='edit')openEditor(b.dataset.type,id);
 if(action==='delete')confirmDelete(b.dataset.type,id);
 if(action==='archive'){
  const m=data.mixtures.find(m=>m.id===id);
  b.disabled=true;
  try{await api('/mixtures/'+id,{method:'PUT',body:JSON.stringify({...m,archived:!m.archived})});await afterMutation(m.archived?'Смесь возвращена в работу':'Смесь перенесена в архив');}
  catch(error){notify(error.message);b.disabled=false;}
 }
 if(action==='active'||action==='archived'){archived=action==='archived';page=1;render();}
 if(action==='prev'||action==='next'){page+=action==='prev'?-1:1;render();}
 if(action==='reset'){search='';mix='';line='';from='';to='';page=1;render();}
 if(action==='clear-filter'){
  e.preventDefault();
  const key=b.dataset.filter;
  if(key==='search')search='';
  if(key==='mixture')mix='';
  if(key==='line')line='';
  if(key==='dates'){from='';to='';}
  page=1;render();
  if(key==='search')$('#search')?.focus();
 }
 if(action==='dates'){const pop=$('#date-popover');pop.hidden=!pop.hidden;b.setAttribute('aria-expanded',String(!pop.hidden));}
 if(action==='apply-dates'){const f=$('#from').value,t=$('#to').value;if(f&&t&&f>t){notify('Начало периода должно быть раньше окончания');return;}from=f;to=t;page=1;render();}
 if(action==='excel-export'){
  b.disabled=true;try{await exportExcel(b.dataset.kind);}catch(error){notify(error.message);}finally{b.disabled=false;}
 }
 if(action==='excel-import')openExcelImport(b.dataset.kind);
 if(action==='excel-commit')await commitExcelImport();

 if(action==='close'&&!$('#editor form')?.dataset.saving)$('#editor').close();
});
function openEditor(type,id){
 const list=type==='record'?data.records:type==='mixture'?data.mixtures:data.users;
 const item=list.find(x=>x.id===id);
 if(type==='mixture'&&!can('catalogs'))return;
 if(type==='record'){if(!can('write'))return;openRecordForm({item,data,api,afterMutation,notify,canManageCatalogs:can('catalogs')});return;}
 if(type==='user'&&!Access.manageUser(currentUser,item))return;
 const title=type==='record'?(item?'Редактировать запись':'Новая запись'):type==='mixture'?(item?'Редактировать смесь':'Новая смесь'):(item?'Редактировать пользователя':'Новый пользователь');
 let body='';
 if(type==='mixture'){body=field('Название смеси','name',item?.name||'','text','maxlength="100"');}
 else body=field('Имя','name',item?.name||'','text','maxlength="120"')+'<div class="form-grid">'+field('Логин','login',item?.login||'','text','minlength="3" maxlength="64" pattern="[A-Za-z0-9._-]+"')+'<label>Роль<select name="role"><option value="EMPLOYER">Сотрудник</option><option value="ENGINEER">Инженер</option><option value="QUALITY">Контроль качества</option><option value="ADMIN">Администратор</option>'+(item?.role==='KEYUSER'?'<option value="KEYUSER">keyuser</option>':'')+'</select></label></div>';
 if(type==='user')body+='<label>'+(item?'Новый пароль (необязательно)':'Начальный пароль')+'<input name="password" type="password" autocomplete="new-password" minlength="4" maxlength="128" '+(item?'':'required')+'></label><label>Подтвердите новый пароль<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="4" maxlength="128" '+(item?'':'required')+'></label>';
 const d=$('#editor');d.innerHTML='<form><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button>'+'<h2 id="editor-title">'+title+'</h2><p class="modal-subtitle">'+(type==='mixture'?'Укажите название производственной смеси.':type==='record'?'Данные партии и фактические показатели.':'Имя, логин и роль сотрудника.')+'</p>'+body+'<div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Отмена</button><button class="button primary">Сохранить</button></div></form>';
 const f=$('form',d);
 if(type==='user'&&item){f.elements.role.value=item.role;if(item.role==='KEYUSER')f.elements.role.disabled=true;}
 if(type==='user')bindPasswordPair(f,!item);
 f.onsubmit=async e=>{
  e.preventDefault();if(type==='user'&&!f.passwordPairValid())return;const values=Object.fromEntries(new FormData(f));if(item?.role==='KEYUSER')values.role='KEYUSER';const err=$('.form-error',f);
  for(const key of ['name','sup','author','login'])if(key in values)values[key]=values[key].trim();
  if(Object.entries(values).some(([k,v])=>!['active','password','passwordConfirm'].includes(k)&&!v)){err.hidden=false;err.textContent='Заполните все обязательные поля';return;}
  if(type==='user'){if(data.users.some(u=>u.id!==id&&u.login.toLowerCase()===values.login.toLowerCase())){err.hidden=false;err.textContent='Этот логин уже занят';return;}}
  if(type==='mixture'){if(data.mixtures.some(m=>m.id!==id&&m.name.toLowerCase()===values.name.toLowerCase())){err.hidden=false;err.textContent='Смесь с таким названием уже есть';return;}values.archived=item?.archived||false;}
  const resource={record:'records',mixture:'mixtures',user:'users'}[type];
  f.dataset.saving='true';
  const buttons=Array.from(f.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);
  err.hidden=true;
  try{
   await api('/'+resource+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:JSON.stringify({...values,...(item?{version:item.version}:{})})});
   d.close();if(type==='user'&&item?.id===currentUser.id&&values.password){showLogin('Пароль изменён. Войдите с новым паролем.');return;}await afterMutation('Сохранено');
  }catch(error){err.hidden=false;err.textContent=error.message;}
  finally{delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);if(type==='user')f.passwordPairValid();}
 };d.showModal();
}
function confirmDelete(type,id){
 if(type==='record'&&!can('delete'))return;if(type==='mixture'&&!can('catalogs'))return;
 if(type==='user'){const target=data.users.find(row=>row.id===id);if(!Access.manageUser(currentUser,target)||target?.role==='KEYUSER')return;}
 const list=type==='record'?data.records:type==='mixture'?data.mixtures:data.users;

 const d=$('#editor');
 const item=list.find(x=>x.id===id);
 const inUse=type==='mixture'&&countOf(id)>0;
 const description=type==='mixture'?'Смесь «'+escapeHTML(item.name)+'» будет удалена. Если она используется в журнале, доступно только архивирование.':'Запись будет удалена из базы данных приложения.';
 d.innerHTML='<form><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><h2 id="editor-title">Удалить '+(type==='record'?'запись':type==='mixture'?'смесь':'пользователя')+'?</h2><p class="modal-subtitle">'+description+'</p><div class="form-error" role="alert" '+(inUse?'':'hidden')+'>'+(inUse?'Смесь используется в журнале. Архивируйте её вместо удаления.':'')+'</div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close" autofocus>Отмена</button><button class="button danger" '+(inUse?'disabled':'')+'>'+icon('trash',16)+'Удалить</button></div></form>';
 $('form',d).onsubmit=async e=>{
  e.preventDefault();if(inUse)return;
  const f=e.currentTarget,err=$('.form-error',f),buttons=Array.from(f.querySelectorAll('button'));
  f.dataset.saving='true';buttons.forEach(b=>b.disabled=true);err.hidden=true;
  try{
   await api('/'+{record:'records',mixture:'mixtures',user:'users'}[type]+'/'+id,{method:'DELETE',body:JSON.stringify({version:item.version})});
   d.close();await afterMutation('Удалено');
  }catch(error){err.hidden=false;err.textContent=error.message;}
  finally{delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);}
 };d.showModal();
}
async function openBulkDelete(){
 const d=$('#editor'),filters={search,mixture:mix,line,from,to};let plan=null,busy=false;
 d.innerHTML='<form id="bulk-delete-form"><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><h2 id="editor-title">Удалить по фильтрам</h2><p class="modal-subtitle">Операция охватывает все страницы журнала.</p><div id="bulk-preview" aria-live="polite">Подсчитываем записи…</div><label id="bulk-confirm-label" hidden>Для подтверждения введите УДАЛИТЬ ВСЁ<input name="confirmation" autocomplete="off" placeholder="УДАЛИТЬ ВСЁ"></label><div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Отмена</button><button type="button" class="button secondary" id="bulk-refresh">Обновить предварительный просмотр</button><button type="submit" class="button danger" disabled>Удалить</button></div></form>';
 const form=$('form',d),submit=$('[type="submit"]',form),error=$('.form-error',form),refresh=$('#bulk-refresh');
 const enabled=()=>{submit.disabled=busy||!plan||!plan.count||plan.blocked||(plan.all&&form.elements.confirmation.value!=='УДАЛИТЬ ВСЁ');refresh.disabled=busy;};
 async function preview(){
  if(busy)return;busy=true;plan=null;form.elements.confirmation.value='';error.hidden=true;enabled();
  try{
   plan=await api('/records/bulk/preview',{method:'POST',body:JSON.stringify(filters)});
   const labels={search:'Поиск',mixture:'Смесь',line:'Линия',from:'С даты',to:'По дату'};
   $('#bulk-preview').innerHTML=(plan.all?'<p class="bulk-all-warning">Будут удалены все записи журнала</p>':'<dl class="bulk-filters">'+Object.entries(plan.filters).filter(([,value])=>value).map(([key,value])=>'<div><dt>'+labels[key]+'</dt><dd>'+escapeHTML(key==='mixture'?nameOf(value):value)+'</dd></div>').join('')+'</dl>')+'<p>Будет удалено записей: <strong>'+plan.count+'</strong></p>'+(plan.blocked?'<p class="form-error">'+escapeHTML(plan.message)+'</p>':'');
   $('#bulk-confirm-label').hidden=!plan.all;
  }catch(err){error.textContent=err.message;error.hidden=false;}
  finally{busy=false;enabled();}
 }
 refresh.onclick=preview;form.elements.confirmation.oninput=enabled;
 form.onsubmit=async e=>{
  e.preventDefault();enabled();if(submit.disabled)return;busy=true;form.dataset.saving='true';enabled();error.hidden=true;
  try{const result=await api('/records/bulk/commit',{method:'POST',body:JSON.stringify({token:plan.token,confirmation:form.elements.confirmation.value})});d.close();await afterMutation('Удалено записей: '+result.deleted);}
  catch(err){plan=null;error.textContent=err.message;error.hidden=false;}
  finally{busy=false;delete form.dataset.saving;enabled();}
 };
 d.showModal();await preview();
}
let importContext=null;
async function exportExcel(kind){
 const query=new URLSearchParams();
 if(kind==='records'){
  if(search)query.set('search',search);
  if(mix)query.set('mixture',mix);
  if(line)query.set('line',line);
  if(from)query.set('from',from);
  if(to)query.set('to',to);
 }else{query.set('archived',String(archived));if(search)query.set('search',search);}
 const response=await fetch('/api/excel/'+kind+'/export?'+query,{cache:'no-store'});
 if(!response.ok){
  let body;try{body=await response.json();}catch{}
  if(response.status===401)showLogin();
  throw new Error(body?.error||'Не удалось выгрузить Excel');
 }
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');
 a.href=url;a.download=kind==='records'?'DefectBatch-journal.xlsx':'DefectBatch-mixtures.xlsx';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openExcelImport(kind){
 const d=$('#editor');
 importContext={kind,file:null,summary:null,busy:false};
 d.innerHTML='<form id="excel-import-form"><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button><h2 id="editor-title">Импорт Excel</h2><p class="modal-subtitle">'+(kind==='records'?'Журнал контроля':'База смесей')+'. Новые строки будут добавлены. Существующие данные не изменяются.</p><label>Файл Excel (.xlsx)<input id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><p class="import-help">Используйте экспорт этого раздела как шаблон. До 5 МБ и 5 000 строк. Точные дубликаты будут пропущены.</p><div id="excel-preview" aria-live="polite"></div><div class="form-error" id="excel-error" role="alert" hidden></div><div class="modal-buttons"><button class="button secondary" type="button" data-action="close">Отмена</button><button class="button primary" type="submit">Проверить файл</button><button class="button primary" type="button" data-action="excel-commit" hidden>Импортировать</button></div></form>';
 $('#excel-file').onchange=()=>{
  importContext.file=null;importContext.summary=null;
  $('#excel-preview').innerHTML='';$('#excel-error').hidden=true;
  $('[data-action="excel-commit"]',d).hidden=true;
  $('button[type="submit"]',d).hidden=false;
 };
 $('#excel-import-form').onsubmit=async e=>{
  e.preventDefault();
  const f=e.currentTarget,file=$('#excel-file').files[0],err=$('#excel-error');
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.xlsx')){err.hidden=false;err.textContent='Поддерживаются только файлы .xlsx';return;}
  if(file.size>5*1024*1024){err.hidden=false;err.textContent='Максимальный размер — 5 МБ';return;}
  importContext.busy=true;f.dataset.saving='true';
  const buttons=Array.from(f.querySelectorAll('button,input'));buttons.forEach(b=>b.disabled=true);err.hidden=true;
  try{
   const summary=await api('/excel/'+kind+'/preview',{method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:file});
   importContext.file=file;importContext.summary=summary;
   $('#excel-preview').innerHTML='<div class="import-summary"><span>Строк: <strong>'+summary.total+'</strong></span><span>Будет добавлено: <strong>'+summary.added+'</strong></span><span>Дубликатов: <strong>'+summary.skipped+'</strong></span><span>Ошибок: <strong>'+summary.errorCount+'</strong></span></div>'+
    (summary.errors.length?'<ul class="import-errors">'+summary.errors.map(error=>'<li>Строка '+error.row+': '+escapeHTML(error.message)+'</li>').join('')+'</ul>':'')+
    (summary.sample.length?'<div class="table-scroll import-sample"><table><thead><tr>'+summary.columns.map(name=>'<th>'+escapeHTML(name)+'</th>').join('')+'</tr></thead><tbody>'+summary.sample.map(row=>'<tr>'+row.map(value=>'<td>'+escapeHTML(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p class="import-help">Предпросмотр первых '+summary.sample.length+' новых строк.</p>':'');
   const canImport=summary.total>0&&summary.added>0&&!summary.errorCount;
   $('[data-action="excel-commit"]',d).hidden=!canImport;
   $('button[type="submit"]',d).hidden=canImport;
   if(!summary.total){err.hidden=false;err.textContent='В файле нет строк для импорта';}
   else if(!summary.errorCount&&!summary.added){err.hidden=false;err.textContent='Все строки уже есть в базе. Добавлять нечего.';}
   else if(summary.errorCount){err.hidden=false;err.textContent='Исправьте ошибки в файле и выберите его заново. При ошибках импорт не выполняется.';}
  }catch(error){err.hidden=false;err.textContent=error.message;}
  finally{importContext.busy=false;delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);}
 };
 d.showModal();
}
async function commitExcelImport(){
 if(!importContext?.file||importContext.busy||!importContext.summary||importContext.summary.errorCount)return;
 const d=$('#editor'),f=$('#excel-import-form'),err=$('#excel-error'),buttons=Array.from(f.querySelectorAll('button,input'));
 importContext.busy=true;f.dataset.saving='true';buttons.forEach(b=>b.disabled=true);err.hidden=true;
 try{
  const result=await api('/excel/'+importContext.kind+'/import',{method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:importContext.file});
  d.close();await afterMutation('Добавлено: '+result.added+'. Пропущено дубликатов: '+result.skipped);
 }catch(error){err.hidden=false;err.textContent=error.message;}
 finally{importContext.busy=false;delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);}
}
$('#editor').addEventListener('click',e=>{if($('#editor form')?.dataset.saving)return;if(e.target===$('#editor')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
$('#editor').addEventListener('cancel',e=>{if($('#editor form')?.dataset.saving)e.preventDefault();});
$('#login-form').onsubmit=async e=>{
 e.preventDefault();
 const f=e.currentTarget,button=$('button[type="submit"]',f),err=$('#login-error');
 button.disabled=true;err.hidden=true;
 try{
  const result=await api(setupMode?'/setup/register':'/auth/login',{method:'POST',body:JSON.stringify({login:f.elements.login.value.trim(),password:f.elements.password.value,...(setupMode?{name:f.elements.name.value.trim(),passwordConfirm:f.elements.passwordConfirm.value}:{})})});
  f.reset();showApplication(result.user);await bootstrap();
 }catch(error){if(setupMode&&error.status===409)showLogin(error.message);else{err.hidden=false;err.textContent=error.message;f.elements.password.value='';f.elements.passwordConfirm.value='';}}
 finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{
 try{await api('/auth/logout',{method:'POST',body:'{}'});showLogin();}
 catch(error){notify(error.message);}
};
navigate();
bootstrap();
setInterval(async()=>{
 if(!ready||!currentUser||refreshBusy||document.hidden||$('#editor').open||$('#mixture-filter-popover:not([hidden])')||$('.journal-columns[open]'))return;
 refreshBusy=true;
 try{
  const focused=document.activeElement;
  const id=focused?.id,position=focused?.selectionStart;
  if(await refreshData()){
   render();
   const input=id?document.getElementById(id):null;
   if(input){input.focus();if(typeof position==='number'&&input.setSelectionRange)input.setSelectionRange(position,position);}
  }
 }catch{notify('Нет связи с сервером. Изменения пока недоступны.');}
 finally{refreshBusy=false;}
},5000);
