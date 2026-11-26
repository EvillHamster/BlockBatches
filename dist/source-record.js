(function(){
 window.sourceRecordShortLabel=function(record,data){
  const mixture=data.mixtures.find(row=>row.id===record.mixtureId)?.name||'—';
  return 'SUP '+record.sup+' | '+(record.step||'—')+' | '+mixture+' | палл. '+(record.palletNumber||'—');
 };
 window.sourceRecordLabel=function(record,data){
  const mixture=data.mixtures.find(row=>row.id===record.mixtureId)?.name||'—';
  return [record.date.split('-').reverse().join('.'),record.sup,record.step||'—',mixture,record.batchNumber||'—',record.palletNumber||'—'].join(' | ');
 };
})();
