'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../renderer/compras-app.js'),'utf8');
function setup(api){
 const nodes={};
 const node=id=>nodes[id]??=( {value:'',textContent:'',isConnected:true,handlers:{},dataset:{},addEventListener(e,f){this.handlers[e]=f;},focus(){},querySelectorAll(){return [...this.innerHTML.matchAll(/data-contact-index="(\d+)"/g)].map(m=>{const b=node('result'+m[1]);b.dataset.contactIndex=m[1];return b;});},innerHTML:''});
 const map={suppliers:[],quotes:{item:{old:{price:'19',negotiated:'15'}}}};
 const c={activeMap:map,currentView:'map',sending:false,addingMapItems:false,removingMapItem:false,crypto:require('node:crypto'),$:s=>node(s),esc:s=>String(s??'').replaceAll('<','&lt;'),normalizedSearch:s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(),captureMap:()=>{},modal:()=>{},closeModal:()=>{c.closed=true;},renderMap:()=>{},markDirty:()=>{c.dirty=true;},window:{followup:{api}}};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function addSupplierDialog('),src.indexOf('function resultHtml(')),c);c.addSupplierDialog({result:{}});
 return {c,map,node,settle:()=>new Promise(r=>setImmediate(r)),fire:(id,event)=>node(id).handlers[event]({preventDefault(){}})};
}
test('search selects explicit supplier and phone, preserves quotes and permits editing',async()=>{
 const s=setup(async()=>({suppliers:[{name:'Água A',phone:'558511111111',contact:'Ana'},{name:'Água A',phone:'558522222222',contact:'Bia'}]}));await s.settle();
 s.node('#supplier-search').value='agua';s.fire('#supplier-search','input');assert.match(s.node('#supplier-search-status').textContent,/2 encontrados/);
 s.fire('result1','click');assert.equal(s.node('#supplier-add-phone').value,'558522222222');
 s.node('#supplier-add-phone').value='558533333333';s.fire('#supplier-add-form','submit');
 assert.equal(s.map.suppliers[0].name,'Água A');assert.equal(s.map.suppliers[0].phone,'558533333333');assert.equal(s.map.quotes.item.old.price,'19');assert.ok(s.c.dirty);
});
test('manual supplier remains available on lookup failure',async()=>{
 const s=setup(async()=>{throw Error('offline')});await s.settle();assert.match(s.node('#supplier-search-status').textContent,/manualmente/);
 s.node('#supplier-add-name').value='Novo';s.node('#supplier-add-phone').value='5585999999999';s.fire('#supplier-add-form','submit');assert.equal(s.map.suppliers[0].name,'Novo');
});
test('selection without phone clears previous number, typing a name never auto-selects',async()=>{
 const s=setup(async()=>({suppliers:[{name:'Sem telefone',phone:'',contact:''}]}));await s.settle();s.node('#supplier-add-phone').value='558500000000';s.node('#supplier-search').value='sem';s.fire('#supplier-search','input');assert.equal(s.node('#supplier-add-phone').value,'558500000000');s.fire('result0','click');assert.equal(s.node('#supplier-add-phone').value,'');
});
test('late lookup cannot overwrite manual fields and changed map cannot receive supplier',async()=>{
 let resolve;const s=setup(()=>new Promise(r=>resolve=r));s.node('#supplier-add-name').value='Manual';resolve({suppliers:[]});await s.settle();assert.equal(s.node('#supplier-add-name').value,'Manual');s.c.activeMap={suppliers:[]};s.fire('#supplier-add-form','submit');assert.equal(s.map.suppliers.length,0);
});
test('contact endpoint reads and writes only through the shared followup supplier source',async()=>{
 const main=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');const part=main.slice(main.indexOf('async function apiRequest('),main.indexOf("  if (String(route || '').startsWith('/whatsapp/'))"));
 const calls=[];const c={activeModule:'compras',workspaceServicesStarted:true,requestEngine:async(...a)=>{
  calls.push(a);
  if(a[1]==='POST')return {supplier_key:'key-a',display_name:'A',phone:'5585999999999',contact_name:'B',active:1};
  return {suppliers:[{supplier_key:'key-a',active:1,display_name:'A',phone:'123',contact_name:'B',order_items:7,secret:'omit'},{active:0,display_name:'Inactive'}]};
 }};
 vm.createContext(c);vm.runInContext(part+'throw new Error("Unsupported");}',c);
 const result=await c.apiRequest('GET','/supplier-contacts');
 assert.equal(result.suppliers.length,1);assert.equal(result.suppliers[0].supplier_key,'key-a');assert.equal(result.suppliers[0].order_items,7);assert.equal(result.suppliers[0].secret,undefined);
 assert.deepEqual(calls,[['followup','GET','/suppliers']]);
 const body={supplier_key:'key-a',display_name:'A',phone:'5585999999999',contact_name:'B',active:true};
 const saved=await c.apiRequest('POST','/supplier-contacts',body);
 assert.equal(saved.supplier.supplier_key,'key-a');assert.equal(saved.supplier.phone,'5585999999999');
 assert.deepEqual(calls[1],['followup','POST','/supplier',body]);
 await assert.rejects(c.apiRequest('PUT','/supplier-contacts',body));
 c.workspaceServicesStarted=false;
 await assert.rejects(c.apiRequest('GET','/supplier-contacts'));
 await assert.rejects(c.apiRequest('POST','/supplier-contacts',body));
});
