const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={window:{},URLSearchParams};
vm.runInNewContext(fs.readFileSync('renderer/purchase-history.js','utf8'),context);
const history=context.window.PurchaseHistory;
const candidate=(extra={})=>({article:'123',unit:'UN',unit_basis:'order',latest:{oc:'100',sort_date:'2026-10-22',order_price:12.3456,company:'Hotel B',supplier:'Fornecedor',date_basis:'order'},...extra});
test('uses history default scope, paginates fuzzy matches and preserves latest price',async()=>{
 const calls=[];
 const expected=candidate();
 const result=await history.latestForItem({article:'123',unit:'un',company:'Hotel A'},async(method,route)=>{
  calls.push(route);const p=new URLSearchParams(route.split('?')[1]);
  assert.equal(method,'GET');assert.equal(p.get('status'),'all');assert.equal(p.has('company'),false);
  return p.get('page')==='0'?{items:[candidate({article:'1234'})],page:0,page_size:1,total:2}:{items:[expected],page:1,page_size:1,total:2};
 });
 assert.equal(result,expected);assert.equal(calls.length,2);
 assert.match(history.referenceText(result).text,/12,3456/);
});
test('does not substitute another unit or a fuzzy description',async()=>{
 const api=async()=>({items:[candidate({unit:'CX'}),candidate({article:'',description:'Sabonete líquido extra'})],page:0,page_size:20,total:2});
 assert.equal(await history.latestForItem({article:'123',unit:'UN'},api),null);
 assert.equal(await history.latestForItem({description:'Sabonete líquido',unit:'UN'},api),null);
});
test('missing and conflicting prices stay unknown, cancellation stays visible',()=>{
 const item=candidate({latest:{oc:'2',order_price:null,price_source:'conflict',cancelled:true}});
 const reference=history.referenceText(item);
 assert.match(reference.text,/Não informado/);assert.match(reference.text,/cancelado/);
 assert.match(reference.title,/divergentes/);assert.doesNotMatch(reference.text,/0,00/);
});
test('no code uses exact normalized description; missing unit never queries',async()=>{
 const expected=candidate({article:'',description:'LÂMPADA LED'});
 assert.equal(await history.latestForItem({description:'lâmpada led',unit:'UN'},async()=>({items:[expected],page:0,page_size:20,total:1})),expected);
 assert.equal(await history.latestForItem({article:'123'},()=>{throw Error('must not query');}),null);
});
test('old detached map cannot receive async result',async()=>{
 let resolve;
 const element={isConnected:true,dataset:{lastPurchase:'x'},textContent:'loading'};
 const promise=history.fillMapReferences({querySelectorAll:()=>[element]},[{id:'x',article:'123',unit:'UN'}],()=>new Promise(r=>resolve=r));
 element.isConnected=false;resolve({items:[candidate()],page:0,page_size:20,total:1});await promise;
 assert.equal(element.textContent,'loading');
});
test('failed query is distinct from missing history',async()=>{
 const element={isConnected:true,dataset:{lastPurchase:'x'}};
 await history.fillMapReferences({querySelectorAll:()=>[element]},[{id:'x',article:'123',unit:'UN'}],async()=>{throw Error('offline');});
 assert.match(element.textContent,/indisponível/);
});
