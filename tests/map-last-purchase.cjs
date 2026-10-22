const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={window:{},URLSearchParams,setTimeout};
vm.runInNewContext(fs.readFileSync('renderer/purchase-history.js','utf8'),context);
const history=context.window.PurchaseHistory;
const item={article:'0910430',unit:'UND',latest:{oc:'100998',sort_date:'2026-09-16',order_price:'763.44',company:'CARMEL CUMBUCO',supplier:'Fornecedor',date_basis:'order'}};
const found={status:'found',item};
function fixture(count,duplicate=false){
 const items=Array.from({length:count},(_,i)=>({id:String(i),description:duplicate?'GAS REFRIGERANTE EOS R 404A':`Item ${i}`,unit:'UND'}));
 const elements=items.map(i=>({isConnected:true,dataset:{lastPurchase:i.id},textContent:'consultando'}));
 return {items,elements,container:{querySelectorAll:()=>elements}};
}
test('paints first, batches 100 items and never queries per item',async()=>{
 const f=fixture(100),calls=[];
 const promise=history.fillMapReferences(f.container,f.items,async(method,route)=>{
  assert.equal(method,'GET');assert.ok(route.length<6500);calls.push(route);
  const refs=JSON.parse(new URLSearchParams(route.split('?')[1]).get('references'));
  assert.ok(refs.length<=50);return {references:refs.map(()=>found)};
 });
 assert.equal(calls.length,0);await promise;
 assert.equal(calls.length,2);assert.ok(f.elements.every(e=>e.textContent.includes('763,44')));
});
test('deduplicates repeated items and shares requests during rerender',async()=>{
 const a=fixture(100,true),b=fixture(100,true);let calls=0,resolve;
 const api=()=>{calls++;return new Promise(r=>resolve=r);};
 const first=history.fillMapReferences(a.container,a.items,api),second=history.fillMapReferences(b.container,b.items,api);
 await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);
 resolve({references:[found]});await Promise.all([first,second]);
 assert.ok(b.elements.every(e=>e.textContent.includes('763,44')));
});
test('completed results are refreshed on next opening',async()=>{
 const f=fixture(1);let calls=0;
 const api=async()=>{calls++;return {references:[found]};};
 await history.fillMapReferences(f.container,f.items,api);await history.fillMapReferences(f.container,f.items,api);
 assert.equal(calls,2);
});
test('detached map gets no stale result and stops queued batches',async()=>{
 const f=fixture(100);let resolve,calls=0;
 const promise=history.fillMapReferences(f.container,f.items,()=>{calls++;return new Promise(r=>resolve=r);});
 await new Promise(r=>setTimeout(r,10));f.elements.forEach(e=>e.isConnected=false);
 resolve({references:Array(50).fill(found)});await promise;
 assert.equal(calls,1);assert.ok(f.elements.every(e=>e.textContent==='consultando'));
});
test('ambiguity, failure and absent references are distinct',async()=>{
 const f=fixture(3);
 await history.fillMapReferences(f.container,f.items,async()=>({references:[{status:'ambiguous'},{status:'missing',item:null},{status:'incomplete'}]}));
 assert.match(f.elements[0].textContent,/ambígua/);assert.match(f.elements[1].textContent,/sem referência/);assert.match(f.elements[2].textContent,/insuficientes/);
 await history.fillMapReferences(f.container,f.items,async()=>{throw Error('offline');});assert.match(f.elements[0].textContent,/indisponível/);
});
test('unknown and cancelled prices are preserved without zero substitution',()=>{
 const display=history.referenceText({...item,latest:{...item.latest,order_price:null,price_source:'conflict',cancelled:true}});
 assert.match(display.text,/Não informado.*cancelado/);assert.match(display.title,/divergentes/);assert.doesNotMatch(display.text,/0,00/);
});
