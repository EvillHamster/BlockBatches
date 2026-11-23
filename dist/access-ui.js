(function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const eye=visible=>'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'+(visible?'<path d="m3 3 18 18"/>':'')+'</svg>';
 function enhance(){
  document.querySelectorAll('input[type="password"]:not([data-password-ready])').forEach(input=>{
   input.dataset.passwordReady='true';const label=input.closest('label');if(!input.hasAttribute('aria-label')&&label){const text=[...label.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join(' ').trim();if(text)input.setAttribute('aria-label',text);}
   const wrapper=document.createElement('span');wrapper.className='password-control';input.before(wrapper);wrapper.append(input);
   const button=document.createElement('button');button.type='button';button.className='password-toggle';button.setAttribute('aria-label','Показать пароль');button.setAttribute('aria-pressed','false');button.innerHTML=eye(false);
   button.onclick=()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.setAttribute('aria-label',visible?'Скрыть пароль':'Показать пароль');button.setAttribute('aria-pressed',String(visible));button.innerHTML=eye(visible);};wrapper.append(button);
  });
 }
 let pairSerial=0;
 window.bindPasswordPair=function(form,required){
  const password=form.elements.password,confirmation=form.elements.passwordConfirm;if(!password||!confirmation)return;
  const error=document.createElement('small');error.id='password-confirm-error-'+(++pairSerial);confirmation.setAttribute('aria-describedby',error.id);error.className='record-field-error';error.setAttribute('role','status');confirmation.closest('label').append(error);
  function check(){
   const started=required||password.value||confirmation.value;
   const message=started&&password.value!==confirmation.value?'Пароли не совпадают':started&&(password.value.length<4||password.value.length>128)?'Пароль: от 4 до 128 символов':'';
   error.textContent=message;confirmation.setAttribute('aria-invalid',String(Boolean(message)));
   const submit=form.querySelector('button[type="submit"],button.primary:not([type="button"])');if(submit)submit.disabled=Boolean(form.dataset.saving)||Boolean(message)||(required&&!password.value);
   return !message&&(!required||Boolean(password.value));
  }
  password.addEventListener('input',check);confirmation.addEventListener('input',check);form.passwordPairValid=check;check();
 };
 const helpContent=user=>{
  const can=p=>Access.can(user,p),sections=[['Журнал и анализ',['Откройте «Журнал контроля». Введите SUP, название смеси или описание в строку поиска.','Используйте «Все даты», «Все смеси» и «Все линии». Крестик очищает отдельный фильтр, «Очистить всё» — все фильтры.','Через «Столбцы» отметьте нужные данные. Выбор сохраняется в браузере.','Строка исходного образца рядом с причиной открывает его карточку. «Назад» возвращает по цепочке просмотров.']]];
  if(can('write'))sections.push(['Создание и редактирование',['Нажмите «Новая запись» либо карандаш в столбце «Действия». Можно редактировать любые записи журнала.','Заполните все обязательные поля; оператор и № образцов необязательны. SUP — ровно 7 цифр. Номера допускают диапазон, например 5-12.','Смесь, причина и оператор выбираются из существующих списков. Для причины «Произведено из заблокированного MB» выберите один или несколько исходных образцов. По умолчанию доступны последние 7 дней, старые — через «Показать за всё время».','Кнопка «Сохранить» доступна после корректного заполнения.']]);
  if(can('delete'))sections.push(['Удаление записи',['Нажмите корзину в строке и подтвердите удаление. Источник, на который ссылаются другие записи, удалить нельзя.']]);
  if(can('export'))sections.push(['Экспорт',['«Экспорт Excel» выгружает все результаты текущих фильтров, включая другие страницы. Скрытые столбцы тоже входят в файл.']]);
  if(can('import'))sections.push(['Импорт',['Используйте экспорт как шаблон. Нажмите «Импорт Excel», выберите .xlsx, затем «Проверить файл».','Проверьте количество новых строк и ошибки. После успешной проверки нажмите «Импортировать». Дубликаты пропускаются; существующие строки не перезаписываются.']]);
  if(can('catalogs'))sections.push(['Справочники',['В «Базе смесей» можно добавлять, редактировать, архивировать и удалять смеси. Архивные смеси сохраняются в истории.','Во вкладках «Операторы» и «Причины вылетов» используйте поиск, добавление, карандаш и корзину. Связанные с журналом значения удалить нельзя.']]);
  if(can('users'))sections.push(['Пользователи',['Во вкладке «Пользователи» нажмите «Добавить пользователя». Укажите имя, уникальный логин, роль, пароль и подтверждение.','Карандаш позволяет изменить роль, логин и установить новый пароль. Пустые поля нового пароля сохраняют текущий. Глаз показывает только вводимое значение.',user.role==='ADMIN'?'Изменять или удалять keyuser запрещено. Другими администраторами управлять можно.':'keyuser единственный: его нельзя удалить, создать второго или снять с него роль.']]);
  if(can('bulk'))sections.push(['Удаление по фильтрам',['Настройте поиск и фильтры, затем нажмите «Удалить по фильтрам». Операция охватывает все страницы.','Проверьте показанные фильтры и точное количество записей. Без фильтров удаляется весь журнал: введите «УДАЛИТЬ ВСЁ».','Если записи изменились, нажмите «Обновить предварительный просмотр» и подтвердите новый набор. Записи, связанные с образцами вне фильтра, не удаляются.']]);
  sections.push(['Аккаунт и помощь',[can('profile')?'В настройках аккаунта можно изменить имя и логин или сменить пароль с подтверждением. Смена пароля завершает текущие сеансы.':'Имя, логин и пароль сотрудника меняет администратор или keyuser.','Вход сохраняется до выхода. «Выйти» завершает сеанс в этом браузере.','F1 или «Помощь · F1» открывает эту справку. Escape закрывает её.']]);
  return '<button type="button" class="modal-close" aria-label="Закрыть справку">×</button><h2 id="role-help-title">Как работать с приложением</h2><p class="modal-subtitle">Ваша роль: '+esc(Access.roles[user.role])+'</p>'+sections.map(([title,steps])=>'<section class="help-section"><h3>'+title+'</h3><ol>'+steps.map(step=>'<li>'+step+'</li>').join('')+'</ol></section>').join('');
 };
 window.refreshRoleHelp=function(user){const dialog=document.querySelector('#role-help');if(!dialog?.open)return;dialog.innerHTML=helpContent(user);dialog.querySelector('button').onclick=()=>dialog.close();};
 window.openRoleHelp=function(user){if(!user)return;let dialog=document.querySelector('#role-help');if(!dialog){dialog=document.createElement('dialog');dialog.id='role-help';dialog.className='modal role-help-modal';dialog.setAttribute('aria-labelledby','role-help-title');document.body.append(dialog);}if(!dialog.open)dialog.showModal();refreshRoleHelp(user);};
 new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});enhance();
})();
