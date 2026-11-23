(function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.sourceRecordLabel=function(record,data){
  const mixture=data.mixtures.find(row=>row.id===record.mixtureId)?.name||'—';
  return [record.date.split('-').reverse().join('.'),record.sup,record.step||'—',mixture,record.batchNumber||'—',record.palletNumber||'—'].join(' | ');
 };
 window.chooseSourceRecord=function({data,excludeId,selectedIds=[]}){
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='modal source-picker-modal';dialog.setAttribute('aria-labelledby','source-picker-title');
   const closeIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
   const searchField=(id,label,placeholder)=>'<label class="source-search-label" for="'+id+'">'+label+'<span class="source-search-control"><input type="text" id="'+id+'" aria-label="'+label+'" autocomplete="off" placeholder="'+placeholder+'"><button type="button" class="clear-filter" data-clear-source="'+id+'" aria-label="Очистить '+(id==='source-mixture-search'?'поиск по смеси':'поиск образца')+'" hidden>'+closeIcon+'</button></span></label>';
   dialog.innerHTML='<button type="button" class="modal-close" aria-label="Закрыть выбор образцов">×</button><h2 id="source-picker-title">Исходные заблокированные образцы</h2><p class="modal-subtitle">Выберите одну или несколько записей. Доступны все линии.<br>Дата | SUP | Шаг | Смесь | № замеса | № паллеты</p><div class="source-search-fields">'+searchField('source-record-search','Поиск по SUP, линии или образцам','SUP, линия или номер образцов…')+searchField('source-mixture-search','Поиск по смеси','Название смеси…')+'</div><div class="source-period-controls"><span class="source-period-label"></span><button type="button" class="text-button" data-source-period>Показать за всё время</button></div><div class="source-record-results" aria-live="polite"></div><div class="modal-buttons"><span class="source-selected-count" role="status"></span><button type="button" class="button secondary" data-cancel>Отмена</button><button type="button" class="button primary" data-confirm>Выбрать</button></div>';
   document.body.append(dialog);
   const input=dialog.querySelector('#source-record-search'),mixtureInput=dialog.querySelector('#source-mixture-search'),results=dialog.querySelector('.source-record-results');
   const options=data.records.filter(row=>row.id!==excludeId).map(row=>({id:row.id,name:sourceRecordLabel(row,data)+' '+row.line+' '+(row.sampleNumber||''),record:row}));
   const selected=new Set(selectedIds);let allDates=false;const period=RecordRules.recentRecordWindow();
   const periodButton=dialog.querySelector('[data-source-period]');
   periodButton.onclick=()=>{allDates=!allDates;render();};
   function render(){
    const dated=allDates?options:options.filter(row=>row.record.date>=period.from&&row.record.date<=period.to);
    dialog.querySelector('.source-period-label').textContent=allDates?'За всё время':'Последние 7 дней · '+period.from.split('-').reverse().join('.')+' — '+period.to.split('-').reverse().join('.');
    periodButton.textContent=allDates?'Показать последние 7 дней':'Показать за всё время';
    dialog.querySelectorAll('[data-clear-source]').forEach(button=>button.hidden=!dialog.querySelector('#'+button.dataset.clearSource).value);
    const matchingMixtures=new Set(RecordRules.rankOptions(data.mixtures,mixtureInput.value,Infinity).map(row=>row.id));
    const filtered=mixtureInput.value.trim()?dated.filter(row=>matchingMixtures.has(row.record.mixtureId)):dated;
    const rows=RecordRules.rankOptions(filtered,input.value,Infinity);
    results.innerHTML=rows.length?'<div class="source-results-count">Найдено: '+rows.length+'</div>'+rows.slice(0,80).map(row=>'<button type="button" role="checkbox" aria-checked="'+selected.has(row.id)+'" class="source-record-option" data-source-id="'+row.id+'"><span class="source-choice-mark" aria-hidden="true">'+(selected.has(row.id)?'☑':'☐')+'</span> '+esc(sourceRecordLabel(row.record,data))+'</button>').join('')+(rows.length>80?'<p>Уточните поиск, чтобы увидеть остальные записи.</p>':''):'<p class="picker-empty">Ничего не найдено</p>';
    dialog.querySelector('.source-selected-count').textContent='Выбрано: '+selected.size;
   }
   dialog.querySelectorAll('[data-clear-source]').forEach(button=>button.onclick=()=>{const field=dialog.querySelector('#'+button.dataset.clearSource);field.value='';render();field.focus();});
   let chosen=null;
   input.oninput=render;mixtureInput.oninput=render;
   input.onkeydown=mixtureInput.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}};
   results.onkeydown=e=>{
    if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const buttons=[...results.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
   };
   results.onclick=e=>{const button=e.target.closest('[data-source-id]');if(button){const id=Number(button.dataset.sourceId);selected.has(id)?selected.delete(id):selected.add(id);render();results.querySelector('[data-source-id="'+id+'"]')?.focus();}};
   dialog.querySelectorAll(':scope>button,[data-cancel]').forEach(button=>button.onclick=()=>dialog.close());
   dialog.querySelector('[data-confirm]').onclick=()=>{chosen=[...selected];dialog.close();};
   dialog.addEventListener('close',()=>{dialog.remove();resolve(chosen);},{once:true});
   render();dialog.showModal();input.focus();
  });
 };
})();
