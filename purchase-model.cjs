const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../renderer/purchase-model');
const today='2026-09-18';
const item=(sci,company,needed,buyer='A')=>({sci,company,needed,buyer,description:'Item',article:'',maps:[],deadline_rule:'approval_12_days'});
test('one SCI per hotel, overdue precedence and no double counting',()=>{
 const r=model.summarize([item('1','Hotel A','2026-09-20'),item('1','Hotel A','2026-09-10'),item('2','Hotel A','2026-09-18'),item('1','Hotel B','2026-09-20'),item('3','Hotel B','')],today);
 assert.equal(r.total,4);assert.equal(r.overdue,1);assert.equal(r.on_time,2);assert.equal(r.none,1);assert.equal(r.hotels[0].total,2);
});
test('due day is on time; the following day is overdue',()=>{
 const i=item('1','A','2026-09-18');assert.equal(model.days(i,today),0);assert.equal(model.matches(i,{deadline:'on_time'},today),true);assert.equal(model.matches(i,{deadline:'overdue'},'2026-09-19'),true);
});
test('old necessity date never used as approval deadline',()=>{
 const i=item('1','A','2020-01-01');delete i.deadline_rule;assert.equal(model.days(i,today),null);
});
test('dashboard filters restrict buyer and hotel from imported rows',()=>{
 const rows=[item('1','X','2026-10-01','A'),item('2','X','2026-10-01','B'),item('3','Y','2026-10-01','A')];
 const filtered=rows.filter(i=>model.matches(i,{buyer:'A',company:'X'},today));assert.equal(model.summarize(filtered,today).total,1);
});
test('19 to 15 shows 21.05%; Brazilian decimal and blank negotiated supported',()=>{
 assert.equal(model.negotiation('19','15').percent.toFixed(2),'21.05');assert.equal(model.negotiation('19,00','15,00').saving,4);assert.equal(model.negotiation('19','').percent,0);assert.equal(model.negotiation('19','20').valid,false);
});
