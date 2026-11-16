'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const main=fs.readFileSync(require('node:path').join(__dirname,'../electron/main.js'),'utf8');
function setup(){
 const calls=[];
 const c={activeModule:'followup',workspaceServicesStarted:true,engineToken:'synthetic-token',AbortSignal, startEngine:async()=> 'http://test.invalid',fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true})}}};
 vm.createContext(c);
 vm.runInContext(main.slice(main.indexOf('const ROUTES ='),main.indexOf('\nfunction pathInside',main.indexOf('const ROUTES ='))),c);
 vm.runInContext(main.slice(main.indexOf('async function apiRequest('),main.indexOf('\nasync function comprasOverview')),c);
 return {c,calls};
}
test('broadcast IPC permits only its three authenticated followup routes',async()=>{
 const {c,calls}=setup();
 await c.apiRequest('POST','/broadcast/preview',{message:'Teste'});
 await c.apiRequest('POST','/broadcast/start',{request_id:'test'});
 await c.apiRequest('GET','/broadcast/status?job_id=test');
 assert.equal(calls.length,3);
 assert.equal(calls[0].options.headers['X-FollowUp-Token'],'synthetic-token');
 assert.deepEqual(JSON.parse(calls[0].options.body),{message:'Teste'});
 for(const [method,route] of [['GET','/broadcast/start'],['POST','/broadcast/status'],['POST','/broadcast/delete']])await assert.rejects(c.apiRequest(method,route));
 c.activeModule='compras';await assert.rejects(c.apiRequest('POST','/broadcast/start',{}));
 assert.equal(calls.length,3);
});
