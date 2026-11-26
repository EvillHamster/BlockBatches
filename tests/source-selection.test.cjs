const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../dist/source-selection.js'),rules=require('../dist/record-rules.js');
test('source selection excludes self and every dependent across multiple and legacy links',()=>{
 const records=[{id:1},{id:2},{id:3,sourceRecordIds:[1,2]},{id:4,sourceRecordId:3},{id:5,sourceRecordIds:[2]},{id:6,sourceRecordIds:[4,5]}];
 const model=create(records,1);
 for(const id of [1,3,4,6]){assert.ok(model.reason(id));assert.equal(model.toggle(id),false);}
 for(const id of [2,5]){assert.equal(model.reason(id),'');assert.equal(model.toggle(id),true);}
 assert.deepEqual(model.ids(),[2,5]);assert.ok(model.valid());assert.ok(model.reason(999));assert.equal(model.toggle(999),false);
});
test('selection is a separate draft, keeps hidden records and can remove missing initial sources',()=>{
 const records=Array.from({length:20},(_,i)=>({id:i+1,sup:String(i+1),date:'2026-11-24',mixtureId:1,line:i%2?'FM':'MB'}));
 const initial=[1,10,1],model=create(records,undefined,initial);
 assert.deepEqual(model.ids(),[1,10]);model.toggle(20);
 const filtered=rules.filterRecords(records,[{id:1,name:'Смесь'}],{line:'FM',search:'20'});
 assert.deepEqual(filtered.map(r=>r.id),[20]);assert.deepEqual(model.ids(),[1,10,20]);
 model.remove(1);assert.deepEqual(initial,[1,10,1]);assert.deepEqual(model.ids(),[10,20]);
 model.toggle(10);model.toggle(10);assert.deepEqual(model.ids(),[20,10]);
 model.clear();assert.equal(model.valid(),false);
 const missing=create(records,undefined,[999,2]);assert.equal(missing.valid(),false);missing.remove(999);assert.ok(missing.valid());
 const cancel=create(records,undefined,initial);cancel.clear();assert.deepEqual(initial,[1,10,1]);
});
