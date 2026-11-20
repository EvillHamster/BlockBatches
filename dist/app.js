const $ = (s, root = document) => root.querySelector(s);
const paths = {
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
let ready=false,loadError='',refreshBusy=false,currentUser=null;
function showLogin(message=''){
 currentUser=null;ready=false;
 $('#application').hidden=true;$('#login-screen').hidden=false;
 if($('#editor').open)$('#editor').close();
 $('#login-form').reset();
 $('#login-error').hidden=!message;$('#login-error').textContent=message;
}
function showApplication(user){
 currentUser=user;
 $('#login-screen').hidden=true;$('#application').hidden=false;
 $('.profile-avatar').textContent=user.name.slice(0,2).toUpperCase();
 $('.profile strong').textContent=user.name;
 $('.profile small').textContent=user.role;
 $('.signed-in').textContent=user.name+' · '+user.role;
}

async function api(path, options={}){
 const response=await fetch('/api'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
 let body;try{body=await response.json();}catch{throw new Error('Сервер недоступен. Запустите npm start.');}
 if(!response.ok){
  if(response.status===401&&path!=='/auth/login')showLogin('Войдите в систему');
  const error=new Error(body.error||'Не удалось выполнить запрос');error.status=response.status;throw error;
 }
 return body;
}
async function refreshData(){
 const next=await api('/state');
 const changed=JSON.stringify(next)!==JSON.stringify(data);
 data=next;ready=true;loadError='';
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
const pageSize=8;
const titles={journal:'Журнал контроля',mixtures:'База смесей',users:'Пользователи',account:'Настройки аккаунта'};
const subtitles={journal:'Показатели смесей. Вся история — в одном месте.',mixtures:'Справочник производственных смесей.',users:'Управление сотрудниками, ролями и доступом.',account:'Персональные данные и настройки входа.'};
const eyebrow={journal:'CONTROL LOG',mixtures:'MIXTURE LIBRARY',users:'TEAM & ACCESS',account:'ACCOUNT SETTINGS'};
const roles={ADMIN:'Администратор',KEYUSER:'KEYUSER',QUALITY:'Контроль качества',EMPLOYER:'Сотрудник'};
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
 const mixture='<select id="mixture-filter" aria-label="Фильтр по смеси"><option value="">Все смеси</option>'+options(data.mixtures)+'</select>';
 const lines='<select id="line-filter" aria-label="Фильтр по линии"><option value="">Все линии</option><option>MB</option><option>FMF</option></select>';
 return '<div class="filter-controls">'+wrapFilter(dates,from||to,'dates','Очистить даты')+wrapFilter(mixture,mix,'mixture','Очистить смесь')+wrapFilter(lines,line,'line','Очистить линию')+clearAllButton()+'</div>';
}
const heading=()=>'<div class="page-heading"><div><div class="eyebrow">DEFECTBATCH / '+eyebrow[tab]+'</div><h1>'+titles[tab]+'<span class="heading-dot"></span></h1><p>'+subtitles[tab]+'</p></div>'+(['journal','mixtures'].includes(tab)?'<button class="button primary" data-action="new">'+icon('plus')+(tab==='journal'?'Новая запись':'Добавить смесь')+'</button>':'')+'</div>';
function filteredRecords(){return data.records.filter(r=>(r.sup+' '+nameOf(r.mixtureId)+' '+r.author).toLowerCase().includes(search.toLowerCase())&&(!mix||r.mixtureId===Number(mix))&&(!line||r.line===line)&&(!from||r.date>=from)&&(!to||r.date<=to)).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);}
function footer(total,label){
 const pages=Math.max(1,Math.ceil(total/pageSize));page=Math.min(page,pages);
 const forms=label==='смесей'?['смесь','смеси','смесей']:label==='пользователей'?['пользователь','пользователя','пользователей']:['запись','записи','записей'];
 return '<div class="table-footer"><span>'+total+' '+plural(total,forms)+'</span><div class="pagination"><span>Страница '+page+' из '+pages+'</span><button data-action="prev" aria-label="Предыдущая страница" '+(page===1?'disabled':'')+'>'+icon('left',14)+'</button><span class="page-number">'+page+'</span><button data-action="next" aria-label="Следующая страница" '+(page===pages?'disabled':'')+'>'+icon('right',14)+'</button></div></div>';
}
const actions=(type,id,extra='')=>'<div class="row-actions"><button data-action="edit" data-type="'+type+'" data-id="'+id+'" aria-label="Редактировать">'+icon('edit',16)+'</button>'+extra+'<button data-action="delete" data-type="'+type+'" data-id="'+id+'" aria-label="Удалить">'+icon('trash',16)+'</button></div>';
function journal(){
 const rows=filteredRecords();page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<section class="table-panel"><div class="table-panel-heading"><div><h2>Записи контроля <span id="record-count" aria-live="polite" aria-atomic="true">'+rows.length+'</span></h2><p>Данные о смесях и производственных партиях</p></div><button class="button secondary" data-action="export">'+icon('download',16)+'Экспорт CSV</button></div><div class="filter-bar">'+searchBox('Поиск по SUP, смеси или сотруднику…')+journalFilters()+'</div>'+
 '<div class="table-scroll"><table><thead><tr><th>Дата</th><th>SUP</th><th>Смесь</th><th>Линия</th><th>T факт, °C</th><th>T обор., °C</th><th>Сотрудник</th><th>Действия</th></tr></thead><tbody>'+rows.slice((page-1)*pageSize,page*pageSize).map(r=>'<tr><td class="date-cell">'+escapeHTML(r.date.split('-').reverse().join('.'))+'</td><td class="sup-cell">'+escapeHTML(r.sup)+'</td><td><span class="mixture-cell">'+escapeHTML(nameOf(r.mixtureId))+'</span></td><td>'+escapeHTML(r.line)+'</td><td class="fact">'+escapeHTML(r.actual)+'</td><td>'+escapeHTML(r.equipment)+'</td><td>'+escapeHTML(r.author)+'</td><td>'+actions('record',r.id)+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty('Записи не найдены','Измените фильтры или добавьте новую запись.'):'')+footer(rows.length,'записей')+'</section>';
}
function mixtures(){
 const rows=data.mixtures.filter(m=>m.archived===archived&&m.name.toLowerCase().includes(search.toLowerCase()));page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<section class="table-panel mixture-table"><div class="table-panel-heading"><div class="segment-tabs"><button data-action="active" class="'+(!archived?'selected':'')+'">В работе <span>'+data.mixtures.filter(m=>!m.archived).length+'</span></button><button data-action="archived" class="'+(archived?'selected':'')+'">Архив <span>'+data.mixtures.filter(m=>m.archived).length+'</span></button></div>'+'<div class="search-tools">'+searchBox('Поиск смеси…')+clearAllButton()+'</div></div><div class="table-scroll"><table><thead><tr><th>Название смеси</th><th>Записей</th><th>Статус</th><th>Действия</th></tr></thead><tbody>'+rows.slice((page-1)*pageSize,page*pageSize).map(m=>'<tr><td><span class="mixture-cell"><button class="text-button" data-action="edit" data-type="mixture" data-id="'+m.id+'">'+escapeHTML(m.name)+'</button></span></td><td>'+countOf(m.id)+'</td><td><span class="library-status '+(!archived?'live':'')+'">'+(archived?'В архиве':'В работе')+'</span></td><td>'+actions('mixture',m.id,'<button data-action="archive" data-id="'+m.id+'" aria-label="'+(archived?'Вернуть в работу':'В архив')+'">'+icon('archive',16)+'</button>')+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty(archived?'Архив пуст':'Смеси не найдены','Добавьте смесь или измените поисковый запрос.'):'')+footer(rows.length,'смесей')+'</section><div class="library-note">Справочник доступен при создании записей. Архивные смеси остаются в истории журнала.</div>';
}
function users(){
 const rows=data.users.filter(u=>(u.name+' '+u.login).toLowerCase().includes(search.toLowerCase()));page=Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize)));
 return '<section class="table-panel"><div class="table-panel-heading"><div><h2>Команда <span>'+data.users.length+'</span></h2><p>Персональные учётные записи и права доступа</p></div><button class="button primary" data-action="new">'+icon('plus',17)+'Добавить пользователя</button></div><div class="filter-bar">'+searchBox('Имя или логин')+clearAllButton()+'</div><div class="table-scroll"><table><thead><tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Действия</th></tr></thead><tbody>'+rows.slice((page-1)*pageSize,page*pageSize).map(u=>'<tr><td><span class="mixture-cell">'+icon('user',16)+escapeHTML(u.name)+'</span></td><td>'+escapeHTML(u.login)+'</td><td>'+(u.role==='ADMIN'?'<span class="role-label">'+icon('shield',14)+roles[u.role]+'</span>':roles[u.role])+'</td><td>'+actions('user',u.id)+'</td></tr>').join('')+'</tbody></table></div>'+(!rows.length?empty('Пользователи не найдены','Попробуйте другое имя или логин.'):'')+footer(rows.length,'пользователей')+'</section><div class="library-note">'+icon('shield')+' Список сотрудников и роли сохраняются в базе данных.</div>';
}
const field=(label,name,value='',type='text',extra='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+escapeHTML(value)+'" '+extra+' required></label>';
function account(){
 return '<div class="account-settings"><section class="auth-card"><h2>Мой аккаунт</h2><dl class="account-details"><div><dt>Имя</dt><dd>'+escapeHTML(currentUser.name)+'</dd></div><div><dt>Логин</dt><dd>'+escapeHTML(currentUser.login)+'</dd></div><div><dt>Роль</dt><dd>'+escapeHTML(roles[currentUser.role]||currentUser.role)+'</dd></div></dl></section><form class="auth-card account-form" id="password-form"><h2>Сменить пароль</h2><p>После изменения войдите с новым паролем.</p>'+field('Текущий пароль','current','','password','autocomplete="current-password"')+field('Новый пароль','next','','password','minlength="10" maxlength="128" autocomplete="new-password"')+field('Повторите новый пароль','confirm','','password','minlength="10" maxlength="128" autocomplete="new-password"')+'<p>От 10 до 128 символов.</p><div class="form-error" role="alert" hidden></div><button class="button primary">Сменить пароль</button></form></div>';
}
function empty(title,text){return '<div class="empty-state"><span class="empty-icon">'+icon(tab==='mixtures'?'database':'search',26)+'</span><h3>'+title+'</h3><p>'+text+'</p></div>';}
function render(){
 $('#page').dataset.view=tab;
 if(!ready){$('#page').innerHTML='<div class="empty-state"><h3>'+(loadError?'Не удалось загрузить данные':'Подключение к базе данных…')+'</h3><p>'+escapeHTML(loadError||'Загружаем записи, смеси и пользователей.')+'</p>'+(loadError?'<button type="button" class="button primary" data-action="retry-load">Повторить</button>':'')+'</div>';return;}
 $('#page').innerHTML=heading()+({journal,mixtures,users,account}[tab])();
 $('#breadcrumb').textContent=titles[tab];document.title='DefectBatch — '+titles[tab];
 document.querySelectorAll('nav [data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 if($('#mixture-filter'))$('#mixture-filter').value=mix;
 if($('#line-filter'))$('#line-filter').value=line;
 if($('#search'))$('#search').oninput=e=>{search=e.target.value;page=1;const pos=e.target.selectionStart;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);};
 if($('#mixture-filter'))$('#mixture-filter').onchange=e=>{mix=e.target.value;page=1;render();};
 if($('#line-filter'))$('#line-filter').onchange=e=>{line=e.target.value;page=1;render();};
 if($('#password-form'))$('#password-form').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,err=$('.form-error',f),button=$('button',f);
  if(f.elements.next.value!==f.elements.confirm.value){err.hidden=false;err.textContent='Новые пароли не совпадают';return;}
  button.disabled=true;err.hidden=true;
  try{await api('/auth/password',{method:'PUT',body:JSON.stringify({currentPassword:f.elements.current.value,password:f.elements.next.value})});showLogin('Пароль изменён. Войдите с новым паролем.');}
  catch(error){err.hidden=false;err.textContent=error.message;}
  finally{button.disabled=false;}
 };
}
function navigate(){tab=Object.hasOwn(titles,location.hash.slice(1))?location.hash.slice(1):'journal';search='';mix='';line='';from='';to='';page=1;archived=false;render();}
window.addEventListener('hashchange',navigate);
document.addEventListener('click',async e=>{
 const navigation=e.target.closest('[data-tab]');if(navigation){location.hash=navigation.dataset.tab;if(innerWidth<=700)setCollapsed(true);return;}
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action,id=Number(b.dataset.id);
 if(action==='retry-load'){await bootstrap();return;}
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
 if(action==='export')exportCSV();
 if(action==='close'&&!$('#editor form')?.dataset.saving)$('#editor').close();
});
function openEditor(type,id){
 const list=type==='record'?data.records:type==='mixture'?data.mixtures:data.users;
 const item=list.find(x=>x.id===id);
 const title=type==='record'?(item?'Редактировать запись':'Новая запись'):type==='mixture'?(item?'Редактировать смесь':'Новая смесь'):(item?'Редактировать пользователя':'Новый пользователь');
 let body='';
 if(type==='record'){
  const available=data.mixtures.filter(m=>!m.archived||m.id===item?.mixtureId);
  if(!available.length){notify('Сначала добавьте смесь в базу');return;}
  body='<div class="form-grid">'+field('Дата','date',item?.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date()),'date')+field('SUP','sup',item?.sup||'','text','maxlength="40"')+'</div><div class="form-grid"><label>Смесь<select name="mixtureId" required>'+options(available)+'</select></label><label>Линия<select name="line"><option>MB</option><option>FMF</option></select></label></div><div class="form-grid">'+field('T факт, °C','actual',item?.actual??'','number','step="0.1"')+field('T оборудования, °C','equipment',item?.equipment??'','number','step="0.1"')+'</div>'+field('Сотрудник','author',item?.author||currentUser.name,'text','maxlength="120"');
 }else if(type==='mixture'){body=field('Название смеси','name',item?.name||'','text','maxlength="100"');}
 else body=field('Имя','name',item?.name||'','text','maxlength="120"')+'<div class="form-grid">'+field('Логин','login',item?.login||'','text','minlength="3" maxlength="64" pattern="[A-Za-z0-9._-]+"')+'<label>Роль<select name="role"><option value="EMPLOYER">Сотрудник</option><option value="QUALITY">Контроль качества</option><option value="ADMIN">Администратор</option><option value="KEYUSER">KEYUSER</option></select></label></div>';
 if(type==='user')body+='<label>'+(item?'Новый пароль (необязательно)':'Начальный пароль')+'<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" '+(item?'':'required')+'></label>';
 const d=$('#editor');d.innerHTML='<form><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">'+icon('close',20)+'</button>'+'<h2 id="editor-title">'+title+'</h2><p class="modal-subtitle">'+(type==='mixture'?'Укажите название производственной смеси.':type==='record'?'Данные партии и фактические показатели.':'Имя, логин и роль сотрудника.')+'</p>'+body+'<div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Отмена</button><button class="button primary">Сохранить</button></div></form>';
 const f=$('form',d);
 if(type==='record'&&item){f.elements.mixtureId.value=item.mixtureId;f.elements.line.value=item.line;}
 if(type==='user'&&item)f.elements.role.value=item.role;
 f.onsubmit=async e=>{
  e.preventDefault();const values=Object.fromEntries(new FormData(f));const err=$('.form-error',f);
  for(const key of ['name','sup','author','login'])if(key in values)values[key]=values[key].trim();
  if(Object.entries(values).some(([k,v])=>!['active','password'].includes(k)&&!v)){err.hidden=false;err.textContent='Заполните все обязательные поля';return;}
  if(type==='record'){values.mixtureId=Number(values.mixtureId);values.actual=Number(values.actual);values.equipment=Number(values.equipment);}
  if(type==='user'){if(data.users.some(u=>u.id!==id&&u.login.toLowerCase()===values.login.toLowerCase())){err.hidden=false;err.textContent='Этот логин уже занят';return;}}
  if(type==='mixture'){if(data.mixtures.some(m=>m.id!==id&&m.name.toLowerCase()===values.name.toLowerCase())){err.hidden=false;err.textContent='Смесь с таким названием уже есть';return;}values.archived=item?.archived||false;}
  const resource={record:'records',mixture:'mixtures',user:'users'}[type];
  f.dataset.saving='true';
  const buttons=Array.from(f.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);
  err.hidden=true;
  try{
   await api('/'+resource+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:JSON.stringify({...values,...(item?{version:item.version}:{})})});
   d.close();await afterMutation('Сохранено');
  }catch(error){err.hidden=false;err.textContent=error.message;}
  finally{delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);}
 };d.showModal();
}
function confirmDelete(type,id){
 const list=type==='record'?data.records:type==='mixture'?data.mixtures:data.users;
 if(type==='mixture'&&countOf(id)){notify('Смесь используется в журнале. Её можно перенести в архив.');return;}
 const d=$('#editor');
 const item=list.find(x=>x.id===id);
 d.innerHTML='<form><h2 id="editor-title">Удалить '+(type==='record'?'запись':type==='mixture'?'смесь':'пользователя')+'?</h2><p class="modal-subtitle">Запись будет удалена из базы данных приложения.</p><div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close" autofocus>Отмена</button><button class="button danger">Удалить</button></div></form>';
 $('form',d).onsubmit=async e=>{
  e.preventDefault();
  const f=e.currentTarget,err=$('.form-error',f),buttons=Array.from(f.querySelectorAll('button'));
  f.dataset.saving='true';buttons.forEach(b=>b.disabled=true);err.hidden=true;
  try{
   await api('/'+{record:'records',mixture:'mixtures',user:'users'}[type]+'/'+id,{method:'DELETE',body:JSON.stringify({version:item.version})});
   d.close();await afterMutation('Удалено');
  }catch(error){err.hidden=false;err.textContent=error.message;}
  finally{delete f.dataset.saving;buttons.forEach(b=>b.disabled=false);}
 };d.showModal();
}
function exportCSV(){
 const rows=[['Дата','SUP','Смесь','Линия','T факт','T оборудования','Сотрудник'],...filteredRecords().map(r=>[r.date,r.sup,nameOf(r.mixtureId),r.line,r.actual,r.equipment,r.author])];
 const csv='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='DefectBatch.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Журнал экспортирован в CSV');
}
$('#editor').addEventListener('click',e=>{if($('#editor form')?.dataset.saving)return;if(e.target===$('#editor')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
$('#editor').addEventListener('cancel',e=>{if($('#editor form')?.dataset.saving)e.preventDefault();});
$('#login-form').onsubmit=async e=>{
 e.preventDefault();
 const f=e.currentTarget,button=$('button[type="submit"]',f),err=$('#login-error');
 button.disabled=true;err.hidden=true;
 try{
  const result=await api('/auth/login',{method:'POST',body:JSON.stringify({login:f.elements.login.value.trim(),password:f.elements.password.value})});
  f.reset();showApplication(result.user);await bootstrap();
 }catch(error){err.hidden=false;err.textContent=error.message;f.elements.password.value='';}
 finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{
 try{await api('/auth/logout',{method:'POST',body:'{}'});showLogin();}
 catch(error){notify(error.message);}
};
navigate();
bootstrap();
setInterval(async()=>{
 if(!ready||!currentUser||refreshBusy||document.hidden||$('#editor').open)return;
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
