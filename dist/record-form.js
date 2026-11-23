(function(){
 'use strict';
 const rules=RecordRules;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function picker(container,{key,label,items,selected,add,changed}){
  const trigger=container.querySelector('.record-picker-trigger'),caption=trigger.querySelector('span'),popup=container.querySelector('.record-picker-popup');
  const input=popup.querySelector('input'),hidden=container.querySelector('input[type="hidden"]'),list=popup.querySelector('[role="listbox"]');
  let catalog=items,choices=[],active=-1,busy=false;
  function close(restore=false){popup.hidden=true;trigger.setAttribute('aria-expanded','false');input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');if(restore)trigger.focus();}
  function choose(option){hidden.value=option.id;caption.textContent=option.name;close(true);changed();}
  function highlight(){
   const buttons=list.querySelectorAll('[role="option"]');buttons.forEach((button,i)=>{button.classList.toggle('highlighted',i===active);button.setAttribute('aria-selected',String(i===active));});
   if(active>=0){input.setAttribute('aria-activedescendant',key+'-option-'+active);buttons[active]?.scrollIntoView({block:'nearest'});}
   else input.removeAttribute('aria-activedescendant');
  }
  function results(){
   choices=rules.rankOptions(catalog,input.value);
   const query=input.value.trim(),canAdd=add&&query&&!catalog.some(row=>rules.normalizeName(row.name)===rules.normalizeName(query));
   list.innerHTML=choices.map((option,i)=>'<button type="button" role="option" id="'+key+'-option-'+i+'" data-index="'+i+'">'+esc(option.name)+'</button>').join('')+
    (canAdd?'<button type="button" role="option" class="picker-add" id="'+key+'-option-'+choices.length+'" data-add="true">Добавить «'+esc(query)+'»</button>':'');
   if(!choices.length)list.insertAdjacentHTML('afterbegin','<div class="picker-empty">Ничего не найдено</div>');
   active=-1;highlight();
  }
  function open(){if(busy)return;popup.hidden=false;trigger.setAttribute('aria-expanded','true');input.setAttribute('aria-expanded','true');input.value='';results();input.focus();}
  async function activate(index){
   if(busy||index<0)return;
   if(index<choices.length){choose(choices[index]);return;}
   const query=input.value.trim();if(!add||!query)return;
   busy=true;changed();input.disabled=true;list.innerHTML='<div class="picker-empty">Сохраняем…</div>';
   try{const option=await add(query);if(!catalog.some(row=>row.id===option.id))catalog.push(option);choose(option);}
   catch(error){container.querySelector('.picker-status').textContent=error.message;}
   finally{busy=false;input.disabled=false;if(!popup.hidden)results();changed();}
  }
  trigger.onclick=()=>popup.hidden?open():close();
  trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}};
  input.oninput=()=>{container.querySelector('.picker-status').textContent='';results();};
  input.onkeydown=e=>{
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();const count=list.querySelectorAll('[role="option"]').length;
    if(count){active=e.key==='ArrowDown'?(active+1)%count:(active<=0?count-1:active-1);highlight();}
   }
   if(e.key==='Enter'){e.preventDefault();activate(active<0?0:active);}
  };
  list.onpointerdown=e=>{if(e.target.closest('button'))e.preventDefault();};
  list.onclick=e=>{const button=e.target.closest('button[role="option"]');if(button)activate(button.dataset.add?choices.length:Number(button.dataset.index));};
  container.querySelector('.record-picker-clear').onclick=()=>{hidden.value='';caption.textContent=key==='mixtureId'?'Выберите смесь':'Не выбран';changed();trigger.focus();};
  container.onfocusout=()=>setTimeout(()=>{if(!container.contains(document.activeElement)){close();changed(true);}},0);
  if(selected){hidden.value=selected.id;caption.textContent=selected.name;}
  return {close,busy:()=>busy,focus:()=>trigger.focus()};
 }
 window.openRecordForm=function({item,data,api,afterMutation,notify,canManageCatalogs=false}){
  const d=document.querySelector('#editor'),initial={...item};
  if(!item){initial.date=rules.localDate();initial.line='';}
  const pickerKeys={mixtureId:['mixtures','Смесь'],reasonId:['reasons','Причина'],operatorId:['operators','Оператор']};
  const required=new Set(rules.fields.filter(([key])=>!['operatorId','sampleNumber'].includes(key)).map(([key])=>key));
  const inputField=(key,type='text',extra='')=>'<input id="record-'+key+'" name="'+key+'" type="'+type+'" value="'+esc(initial[key]??'')+'" '+extra+'>';
  function markup(key,label){
   let control='',wide=['mixtureId','reasonId','description'].includes(key);
   if(key==='date')control=inputField(key,'date');
   else if(key==='sup')control=inputField(key,'text','inputmode="numeric" maxlength="7" autocomplete="off" placeholder="7 цифр"');
   else if(['line','step','shift'].includes(key)){
    const options=key==='line'?rules.lines:key==='step'?rules.steps:[1,2,3,4];
    const legacy=initial[key]&&!options.map(String).includes(String(initial[key]))?'<option value="'+esc(initial[key])+'" selected>'+esc(initial[key])+' (старая запись)</option>':'';
    control='<select id="record-'+key+'" name="'+key+'"><option value="">Не выбран</option>'+legacy+options.map(value=>'<option value="'+esc(value)+'" '+(String(initial[key]??'')===String(value)?'selected':'')+'>'+esc(value)+'</option>').join('')+'</select>';
   }
   else if(pickerKeys[key]){
    control='<div class="record-picker" data-picker="'+key+'"><input name="'+key+'" type="hidden" value="'+esc(initial[key]??'')+'"><div class="record-picker-selection"><button id="record-'+key+'" type="button" class="record-picker-trigger" aria-labelledby="label-'+key+'" aria-haspopup="listbox" aria-expanded="false" aria-controls="'+key+'-list"><span>'+(key==='mixtureId'?'Выберите смесь':'Не выбран')+'</span><svg class="record-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" class="record-picker-clear" aria-label="Очистить '+label.toLowerCase()+'" title="Очистить выбор"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="record-picker-popup" hidden><div class="record-picker-search"><span aria-hidden="true">⌕</span><input type="text" role="combobox" aria-label="Поиск: '+label+'" autocomplete="off" aria-autocomplete="list" aria-expanded="false" aria-controls="'+key+'-list" placeholder="'+(key==='operatorId'?'Фамилия и имя…':'Поиск…')+'"></div><div role="listbox" id="'+key+'-list" aria-label="'+esc(label)+'" class="picker-list"></div><div class="picker-status" role="status"></div></div></div>';
   }else if(key==='description')control='<textarea id="record-description" name="description" rows="3" maxlength="4000">'+esc(initial.description??'')+'</textarea>';
   else control=inputField(key,'text',key==='blockedWeight'?'inputmode="decimal" placeholder="Например, 125,5"':'inputmode="numeric" maxlength="100" placeholder="Например, 5 или 5-12"');
   return '<div class="record-field '+(wide?'record-span-2':'')+'" data-record-field="'+key+'"><label id="label-'+key+'" for="record-'+key+'">'+label+(required.has(key)?' <span class="required" aria-hidden="true">*</span>':' <small>(необязательно)</small>')+'</label>'+control+(key==='sup'?'<small class="record-field-hint" id="sup-hint">Введите ровно 7 цифр</small>':'')+'<small class="record-field-error" id="error-'+key+'" role="status"></small></div>';
  }
  d.classList.add('blocking-record-modal');
  d.innerHTML='<form id="blocking-record-form" novalidate><button type="button" class="modal-close" data-action="close" aria-label="Закрыть">×</button><h2 id="editor-title">'+(item?'Редактировать запись':'Новая запись')+'</h2><p class="modal-subtitle">№ образцов и оператор — необязательные поля. Заполните отмеченные поля.</p>'+
   (item?.recordFormatVersion===1?'<p class="record-legacy-note">Старая запись сохранена без преобразований. Для сохранения изменений заполните обязательные поля по текущим правилам.</p>':'')+
   '<div class="record-fields">'+rules.fields.map(([key,label])=>markup(key,label)+(key==='reasonId'?'<div class="record-field record-span-2" id="record-source-section" hidden><label for="record-source-select">Исходные образцы <span aria-hidden="true">*</span></label><div class="selected-source-records"></div><button type="button" class="button secondary" id="record-source-select">Выбрать образцы</button><small id="error-sourceRecordId" class="record-field-error" role="status"></small></div>':'')).join('')+'</div><div class="form-error" role="alert" hidden></div><div class="modal-buttons"><button type="button" class="button secondary" data-action="close">Отмена</button><button type="submit" class="button primary" disabled>Сохранить</button></div></form>';
  const form=d.querySelector('form'),pickers={},touched=new Set(),submit=form.querySelector('[type="submit"]');
  let selectedSources=[...rules.sourceIds(initial)];
  const values=()=>({...Object.fromEntries(new FormData(form)),sourceRecordIds:selectedSources});
  const sourceSection=d.querySelector('#record-source-section'),sourceButton=d.querySelector('#record-source-select');
  const needsSource=()=>rules.requiresSource(data.reasons?.find(row=>String(row.id)===String(form.elements.reasonId.value))?.name);
  function validate(){const result=rules.validate(values());if(needsSource()&&!result.value.sourceRecordId)result.errors.sourceRecordId='Выберите исходный образец';result.valid=!Object.keys(result.errors).length;return result;}
  function updateSource(){
   sourceSection.hidden=!needsSource();
   sourceSection.querySelector('.selected-source-records').innerHTML=selectedSources.map(id=>{const source=data.records.find(row=>row.id===id);return '<div class="selected-source-row"><a class="source-record-link" target="_blank" rel="noopener" href="#record/'+id+'">'+esc(source?sourceRecordLabel(source,data):'Образец недоступен')+' ↗</a><button type="button" class="button secondary" data-remove-source="'+id+'" aria-label="Убрать исходный образец '+id+'">×</button></div>';}).join('');
   sourceButton.textContent=selectedSources.length?'Изменить выбор образцов':'Выбрать образцы';
  }
  async function selectSource(){
   const selected=await chooseSourceRecord({data,excludeId:item?.id,selectedIds:selectedSources});
   if(selected!==null)selectedSources=selected;update();
  }
  sourceButton.onclick=selectSource;
  sourceSection.onclick=e=>{const button=e.target.closest('[data-remove-source]');if(button){selectedSources=selectedSources.filter(id=>id!==Number(button.dataset.removeSource));update();}};
  function showErrors(errors,all=false){
   for(const [key] of rules.fields){
    const field=d.querySelector('[data-record-field="'+key+'"]'),input=d.querySelector('#record-'+key),invalid=Boolean(errors[key]);
    const empty=values()[key]===''||values()[key]===undefined;
    const message=invalid?(empty?'Обязательное поле':errors[key]):'';
    field.querySelector('.record-field-error').textContent=message;
    input.setAttribute('aria-invalid',String(invalid));input.setAttribute('aria-required',String(required.has(key)));
    input.setAttribute('aria-describedby','error-'+key+(key==='sup'?' sup-hint':''));
    const clear=field.querySelector('.record-picker-clear');if(clear)clear.hidden=empty;
   }
   updateSource();d.querySelector('#error-sourceRecordId').textContent=errors.sourceRecordId||'';sourceButton.setAttribute('aria-invalid',String(Boolean(errors.sourceRecordId)));
   submit.disabled=Boolean(form.dataset.saving)||Object.values(pickers).some(p=>p.busy())||Object.keys(errors).length>0;
  }
  let lastReason=String(initial.reasonId??'');
  const update=()=>{
   const reason=String(form.elements.reasonId.value),changed=reason!==lastReason;lastReason=reason;
   if(changed)selectedSources=[];
   showErrors(validate().errors);
   if(changed&&needsSource())selectSource();
  };
  for(const [key,[catalog,label]] of Object.entries(pickerKeys)){
   const staticItems=['lines','steps'].includes(catalog);
   if(!staticItems&&!data[catalog])data[catalog]=[];
   let items=staticItems?rules[catalog].map(name=>({id:name,name})):catalog==='mixtures'?data.mixtures.filter(m=>!m.archived||m.id===item?.mixtureId):data[catalog];
   // Historical values stay visible; current validation still requires an allowed line.
   const selected=items.find(row=>String(row.id)===String(item?.[key]))||(item?.[key]?{id:item[key],name:item[key]}:null);
   pickers[key]=picker(d.querySelector('[data-picker="'+key+'"]'),{key,label,items,selected,
    add:catalog==='operators'&&canManageCatalogs?async name=>{
     const option=await api('/catalogs/'+catalog,{method:'POST',body:JSON.stringify({name})});
     if(!data[catalog].some(row=>row.id===option.id))data[catalog].push(option);
     notify(option.created?'Добавлено в справочник':'Выбрано существующее значение');return option;
    }:null,
    changed:()=>{touched.add(key);update();}
   });
  }
  const sup=d.querySelector('#record-sup');
  sup.addEventListener('input',()=>{const pos=sup.selectionStart,clean=sup.value.replace(/[^0-9]/g,'').slice(0,7);if(clean!==sup.value){sup.value=clean;sup.setSelectionRange(Math.min(pos,clean.length),Math.min(pos,clean.length));}});
  sup.addEventListener('paste',e=>{e.preventDefault();const paste=(e.clipboardData.getData('text')||'').replace(/[^0-9]/g,'');const start=sup.selectionStart,end=sup.selectionEnd;sup.value=(sup.value.slice(0,start)+paste+sup.value.slice(end)).slice(0,7);sup.setSelectionRange(Math.min(start+paste.length,7),Math.min(start+paste.length,7));sup.dispatchEvent(new Event('input',{bubbles:true}));});
  form.addEventListener('input',e=>{if(e.target.name)touched.add(e.target.name);update();});
  form.addEventListener('focusout',e=>{if(e.target.name){touched.add(e.target.name);update();}});
  form.addEventListener('change',update);
  form.onsubmit=async e=>{
   e.preventDefault();if(form.dataset.saving||Object.values(pickers).some(p=>p.busy()))return;const result=validate();showErrors(result.errors,true);
   if(!result.valid){const key=Object.keys(result.errors)[0];(pickers[key]||d.querySelector(key==='sourceRecordId'?'#record-source-select':'#record-'+key))?.focus();return;}
   const controls=Array.from(form.querySelectorAll('button,input,select,textarea')),err=form.querySelector('.form-error');
   form.dataset.saving='true';controls.forEach(control=>control.disabled=true);err.hidden=true;
   try{await api('/records'+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:JSON.stringify({...result.value,...(item?{version:item.version}:{})})});d.close();await afterMutation('Сохранено');}
   catch(error){if(error.fields)showErrors(error.fields,true);err.hidden=false;err.textContent=error.message;}
   finally{delete form.dataset.saving;controls.forEach(control=>control.disabled=false);update();}
  };
  d.addEventListener('close',()=>{d.classList.remove('blocking-record-modal');Object.values(pickers).forEach(p=>p.close());},{once:true});
  update();d.showModal();d.scrollTop=0;
 };
})();
