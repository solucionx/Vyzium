const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../renderer/compras-app.js'),'utf8');
function setup(fault=false){
 const nodes={},calls=[];let inflight=0,max=0;
 const node=s=>nodes[s]??={value:'',disabled:false,textContent:'',handlers:{},innerHTML:''};
 const map={id:'m',suppliers:[{id:'a',name:'A',phone:'111'},{id:'b',name:'B',phone:'222'},{id:'c',name:'C',phone:''}]};
 const c={activeMap:map,sending:false,$:s=>s==='#quote-message'?(nodes[s]||null):node(s),esc:s=>String(s??''),modal:()=>{},whatsappPanel:()=>'',startWhatsAppPanel:()=>{},on:(el,e,f)=>el.handlers[e]=f,api:async(method,route,body)=>{
  if(method==='GET'){const sid=new URL('http://local'+route).searchParams.get('supplier');return {supplier:map.suppliers.find(s=>s.id===sid),message:'Original '+sid,fingerprint:'fp'+sid,revision:1};}
  calls.push(body);inflight++;max=Math.max(max,inflight);await new Promise(r=>setImmediate(r));inflight--;if(fault)throw Error('IPC timeout');return {status:'sent'};
 }};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function quoteDialog()'),source.indexOf('async function renderHistory()')),c);c.quoteDialog();
 return {calls,c,node,max:()=>max,select:async sid=>{node('#quote-supplier').value=sid;await node('#quote-supplier').handlers.change();delete nodes['#quote-message'];},edit:text=>{nodes['#quote-message']={value:text};},send:()=>node('#send-all-quotes').handlers.click(),one:()=>node('#send-quote').handlers.click()};
}
test('batch preserves per-supplier drafts, uses defaults for untouched suppliers and skips missing phone',async()=>{
 const s=setup();await s.select('a');s.edit('Somente item A');await s.select('b');s.edit('Sem observação B');await s.send();assert.deepEqual(s.calls.map(x=>x.message),['Somente item A','Sem observação B']);assert.equal(s.max(),1);assert.match(s.node('#quote-results').innerHTML,/sem WhatsApp/);await s.send();assert.equal(s.calls.length,2);
 const defaults=setup();await defaults.send();assert.deepEqual(defaults.calls.map(x=>x.message),['Original a','Original b']);
});
test('individual dispatch uses edited text and a subsequent batch skips its recipient',async()=>{
 const s=setup();await s.select('a');s.edit('Editada');await s.one();await s.send();assert.deepEqual(s.calls.map(x=>x.supplier_id),['a','b']);assert.equal(s.calls[0].message,'Editada');
});
test('empty edited message aborts batch before any send',async()=>{
 const s=setup();await s.select('b');s.edit('  ');await s.send();assert.equal(s.calls.length,0);assert.match(s.node('#quote-progress').textContent,/Revise/);
});
test('double click does not create concurrent batches; transport error stops remaining recipients',async()=>{
 const s=setup(true);await Promise.all([s.send(),s.send()]);assert.equal(s.calls.length,1);assert.match(s.node('#quote-progress').textContent,/interrompido/);assert.equal(s.c.sending,false);
});
