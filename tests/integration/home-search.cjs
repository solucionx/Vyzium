/* Run with Playwright installed in a separate QA environment. No production dependencies are added.
 * Actual renderer + preload + full main.js IPC handler/allowlist + real Python HTTP backend.
 * Electron window/OS/bootstrap services are doubles; actual Windows packaging is outside this test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {once} = require('node:events');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const mainPath = path.join(root, 'electron/main.js');
const requireMain = createRequire(mainPath);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-home-search-integration-'));
const ipc = new Map(), calls = [], httpCalls = [], errors = [], passed = [];
let server, browser, page, backendUrl, followupUrl, nextFault = null, hold = null, navigation;
const context = vm.createContext({
  require: name => name === 'electron' ? {
    app: {requestSingleInstanceLock:()=>true, setAppUserModelId:()=>{}, on:()=>{}, whenReady:()=>new Promise(()=>{}),
      getPath:()=>temp, getVersion:()=>requireMain('../package.json').version},
    ipcMain: {handle:(name, fn)=>ipc.set(name, fn)},
    dialog: {showSaveDialog:async()=>({canceled:false,filePath:path.join(temp,'map.xls')})},
    BrowserWindow: function(){}, safeStorage:{}, clipboard:{}, shell:{}
  } : requireMain(name),
  __dirname:path.dirname(mainPath), process, Buffer, console, setTimeout, clearTimeout,
  setInterval, clearInterval, AbortSignal,
  fetch:async (url, options) => {
    assert.ok([backendUrl,followupUrl].some(base=>String(url).startsWith(base + '/')), 'Only the temporary backend may be contacted');
    const route = new URL(url).pathname;
    assert.ok(!['/send','/send-negotiation'].includes(route), 'Never send supplier messages in tests');
    const body = options.body ? JSON.parse(options.body) : null;
    const request = {route, method:options.method, body};httpCalls.push(request);
    if (nextFault && nextFault.route===route) {const fault=nextFault;nextFault=null;throw Error(fault.message);}
    if (hold && hold.route===route && (!hold.additionOnly || body?.add_item_ids)) await hold.promise;
    const response = await fetch(url, options);request.status=response.status;return response;
  }
});
vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, {filename:mainPath});
const token = vm.runInContext('engineToken', context);
const actualApi = (method, route, body) => ipc.get('api')({}, {method, route, body});
async function check(name, fn) {await fn();passed.push(name);console.log('PASS: '+name);}
const output=process.env.VYZIUM_TEST_OUTPUT_DIR;
async function screenshot(name){if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}}
async function waitUntil(fn){const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error('Timed out waiting for navigation');await new Promise(r=>setTimeout(r,20));}}
async function goHome(){vm.runInContext("activeModule='home';overviewCache=null;comprasEngineUrl=backendUrl;followupEngineUrl=followupUrl;",context);await page.goto(pathToFileURL(path.join(root,'renderer/index.html')).href);await page.locator('#global-search').waitFor();}
async function searchHome(query){await page.locator('#global-search').fill(query);await page.waitForFunction(()=>!document.querySelector('#global-search-status').textContent.includes('Pesquisando'));}
async function openResult(kind,title){navigation=null;await page.locator('.home-search-result').filter({has:page.locator('small',{hasText:kind})}).filter({hasText:title}).first().click();await waitUntil(()=>navigation);const url=pathToFileURL(navigation.file);url.search=new URLSearchParams(navigation.options?.query||{}).toString();await page.goto(url.href);}
(async()=>{
 server=spawn(process.env.VYZIUM_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),['-u',path.join(__dirname,'home_search_server.py')],{env:{...process.env,FOLLOWUP_API_TOKEN:token},stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',c=>process.stderr.write(c));
 const lines=createInterface({input:server.stdout});const [line]=await once(lines,'line');const setup=JSON.parse(line);lines.close();
 backendUrl='http://127.0.0.1:'+setup.compras;followupUrl='http://127.0.0.1:'+setup.followup;
 Object.assign(context,{backendUrl,followupUrl,captureNavigation:(file,options)=>{navigation={file,options};}});
 vm.runInContext(`activeModule='home';comprasEngineUrl=backendUrl;followupEngineUrl=followupUrl;workspaceServicesStarted=true;
 authManager={getState:()=>({authenticated:true,email:'synthetic@example.invalid'})};
 whatsapp={status:()=>({status:'ready'})};stopComprasEngine=async()=>{};
 window={isDestroyed:()=>false,loadFile:async(file,options)=>captureNavigation(file,options),webContents:{setZoomFactor:()=>{}}};`,context);
 const launch={headless:true,...(process.env.VYZIUM_TEST_CHROMIUM?{executablePath:process.env.VYZIUM_TEST_CHROMIUM}:{})};
 if(process.env.VYZIUM_TEST_SERVERLESS_CHROMIUM==='1')launch.args=require('@sparticuz/chromium').args;
 browser=await chromium.launch(launch);
 const bc=await browser.newContext({viewport:{width:1440,height:1050}});
 await bc.exposeBinding('__vyziumInvoke',async(_source,channel,...args)=>{calls.push({channel,args});assert.ok(ipc.has(channel),channel);return await ipc.get(channel)({},...args);});
 await bc.addInitScript({content:`(()=>{const require=()=>({contextBridge:{exposeInMainWorld:(key,value)=>window[key]=value},ipcRenderer:{invoke:(...args)=>window.__vyziumInvoke(...args),on:()=>{},removeListener:()=>{},send:()=>{}}});${fs.readFileSync(path.join(root,'electron/preload.js'),'utf8')}})();`});
 page=await bc.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await goHome();
 await check('home search reaches both authenticated backends without sending messages',async()=>{
   await searchHome('lampada');assert.ok(await page.locator('.home-search-result').count()>0);
   assert.ok(httpCalls.some(c=>c.route==='/search'));await screenshot('home-search');
   assert.equal(await page.locator('#global-search').count(),1);
 });
 await check('item result opens exact item without changing saved filters or interpreting HTML',async()=>{
   await searchHome('especial');await openResult('Item / SCI','especial');
   await page.locator('#modal-title').waitFor({state:'visible'});
   assert.match(await page.locator('#modal-title').textContent(),/Peça <especial> & teste/);
   assert.equal(await page.locator('#global-search').count(),0);
   const settings=await actualApi('GET','/settings');assert.deepEqual(settings.filters,{buyer:'Teste',search:'Cabo'});
 });
 await check('shared supplier result navigates to the exact supplier',async()=>{
   await goHome();await searchHome('agua');await openResult('Fornecedor','Água');
   await page.locator('tr.search-destination').waitFor();assert.equal(await page.locator('tr.search-destination').getAttribute('data-key'),setup.supplier_key);
 });
 await check('order result opens the correct OC and supplier',async()=>{
   await goHome();await searchHome('123');await openResult('Pedido / SCI','123');
   await page.locator('#order-modal').waitFor({state:'visible'});assert.match(await page.locator('#modal-content').textContent(),/123/);
 });
 await check('map urgency saves, sorts first and survives reopening',async()=>{
   await goHome();await searchHome('Cotação por hotel');await openResult('Mapa de compra','Cotação por hotel');
   await page.locator('#map-urgent').check();await page.locator('#save-map').click();
   await page.waitForFunction(()=>document.querySelector('#save-note').textContent.startsWith('Salvo'));
   assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.urgent,true);
   await page.locator('[data-view="maps"]').click();await page.locator('.map-urgent-badge').waitFor();
   assert.equal(await page.locator('[data-open-map]').first().getAttribute('data-open-map'),setup.map_id);
   await page.locator(`[data-open-map="${setup.map_id}"]`).click();assert.equal(await page.locator('#map-urgent').isChecked(),true);await screenshot('map-urgent');
 });
 await check('map completion preserves quotes and suppliers and opens completed maps',async()=>{
   const before=(await actualApi('GET','/map?id='+setup.map_id)).map;
   await page.locator('#complete-map').click();await page.locator('.complete-map-modal').waitFor();await screenshot('complete-map-confirmation');
   await page.locator('[data-complete-action="cancel"]').click();assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.archived,false);
   await page.locator('#complete-map').click();await page.locator('[data-complete-action="confirm"]').click();
   await page.locator(`[data-open-map="${setup.map_id}"]`).waitFor();
   const after=(await actualApi('GET','/map?id='+setup.map_id)).map;assert.equal(after.archived,true);assert.deepEqual(after.quotes,before.quotes);assert.deepEqual(after.suppliers,before.suppliers);
 });
 await check('rapid edits and empty input cannot leave stale results',async()=>{
   await goHome();await page.locator('#global-search').fill('lampada');await page.locator('#global-search').fill('zzzz-absent');await page.waitForFunction(()=>document.querySelector('#global-search-status').textContent.includes('Nenhum'));assert.equal(await page.locator('.home-search-result').count(),0);
   await page.locator('#global-search').fill('');assert.equal(await page.locator('.home-search-result').count(),0);
 });
 assert.deepEqual(errors,[]);console.log(`PASS: ${passed.length} integration checks; real renderer/preload/main IPC and both Python HTTP backends.`);
})().catch(async error=>{console.error(error);console.error('UI errors:',errors);console.error('Last HTTP calls:',httpCalls.slice(-8));if(page){await screenshot('failure');console.error((await page.locator('body').innerText()).slice(-5000));}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill();fs.rmSync(temp,{recursive:true,force:true});});
