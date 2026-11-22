window.mountMixtureFilter=function({container,mixtures,selected,onChange}){
 const button=container.querySelector('.mixture-filter-trigger');
 const popup=container.querySelector('.mixture-filter-popover');
 const input=popup.querySelector('input'),list=popup.querySelector('[role="listbox"]');
 let options=[],active=-1;
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function highlight(){
  const buttons=list.querySelectorAll('[role="option"]');
  buttons.forEach((option,index)=>{option.classList.toggle('highlighted',index===active);option.setAttribute('aria-selected',String(index===active));});
  if(active>=0){input.setAttribute('aria-activedescendant','filter-mixture-option-'+active);buttons[active]?.scrollIntoView({block:'nearest'});}
  else input.removeAttribute('aria-activedescendant');
 }
 function results(){
  options=RecordRules.rankOptions(mixtures,input.value);
  if(!input.value.trim())options.unshift({id:'',name:'Все смеси'});
  active=-1;
  list.innerHTML=options.length?options.map((option,index)=>'<button type="button" role="option" id="filter-mixture-option-'+index+'" data-index="'+index+'">'+esc(option.name)+(option.archived?' <small>Архив</small>':'')+'</button>').join(''):'<div class="picker-empty">Смеси не найдены</div>';
  highlight();
 }
 function close(restore=false){popup.hidden=true;button.setAttribute('aria-expanded','false');input.setAttribute('aria-expanded','false');if(restore)button.focus();}
 function open(){popup.hidden=false;button.setAttribute('aria-expanded','true');input.setAttribute('aria-expanded','true');input.value='';results();input.focus();}
 function choose(index){if(!options[index])return;close();onChange(String(options[index].id));}
 button.onclick=()=>popup.hidden?open():close();
 input.oninput=results;
 input.onkeydown=e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();const count=options.length;
   if(count){active=e.key==='ArrowDown'?(active+1)%count:(active<=0?count-1:active-1);highlight();}
  }else if(e.key==='Enter'){e.preventDefault();choose(active<0?0:active);}
  else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
 };
 list.onpointerdown=e=>{if(e.target.closest('button'))e.preventDefault();};
 list.onclick=e=>{const option=e.target.closest('[data-index]');if(option)choose(Number(option.dataset.index));};
 container.onfocusout=()=>setTimeout(()=>{if(!container.contains(document.activeElement))close();},0);
 if(selected)button.title=mixtures.find(row=>String(row.id)===String(selected))?.name||'Все смеси';
};
