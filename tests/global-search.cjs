'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {searchNavigation}=require('../electron/search-navigation');
test('navigation accepts only typed destinations and passes raw identity as encoded query values',()=>{
 assert.deepEqual(searchNavigation('followup',{module:'followup',kind:'order',oc:'123&456',supplier_key:'Água / Luz'}),{open_oc:'123&456',open_supplier:'Água / Luz'});
 assert.deepEqual(searchNavigation('compras',{module:'compras',kind:'item',item_id:'3|1|100'}),{open_item:'3|1|100'});
 assert.equal(searchNavigation('compras',undefined),undefined);
 for(const target of [{module:'followup',kind:'map',map_id:'123'},{module:'compras',kind:'url',url:'https://example.com'},{module:'compras',kind:'map',map_id:''},{module:'compras',kind:'map',map_id:'x\nq'}])assert.throws(()=>searchNavigation('compras',target));
});
const source=fs.readFileSync(require.resolve('../electron/main.js'),'utf8');
function harness(){
 const c={ipcMain:{handle:(_name,fn)=>c.search=fn},workspaceServicesStarted:true,activeModule:'home',updating:false,navigationBusy:false,activeRequests:0,Promise,encodeURIComponent,
 requestEngine:async m=>({results:[{kind:m}],has_more:m==='compras'})};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf("ipcMain.handle('global-search'"),source.indexOf("\n});",source.indexOf("ipcMain.handle('global-search'"))+4),c);return c;
}
test('home search aggregates modules, reports partial failure and always releases its navigation lock',async()=>{
 const c=harness();let release;const pause=new Promise(r=>release=r);c.requestEngine=async m=>{await pause;if(m==='compras')throw Error('unavailable');return {results:[{kind:'order'}]};};
 const waiting=c.search({},'lampada');assert.equal(c.activeRequests,1);release();const r=await waiting;
 assert.equal(r.results.length,1);assert.equal(r.errors[0],'Compras indisponível');assert.equal(c.activeRequests,0);
});
test('search cannot run outside home, unauthenticated or with invalid query',async()=>{
 const c=harness();let calls=0;c.requestEngine=async()=>{calls++;return {results:[]};};
 await c.search({},'a');assert.equal(calls,0);
 await assert.rejects(c.search({},'a'.repeat(101)));
 c.activeModule='compras';await assert.rejects(c.search({},'teste'));
 c.activeModule='home';c.workspaceServicesStarted=false;await assert.rejects(c.search({},'teste'));assert.equal(calls,0);
});
