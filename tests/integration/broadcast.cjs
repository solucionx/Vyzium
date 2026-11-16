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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-broadcast-integration-'));
const ipc = new Map(), calls = [], httpCalls = [], errors = [], passed = [];
let loseStartResponse=false;
let server, browser, page, backendUrl, followupUrl, nextFault = null, hold = null, serverStderr = '';
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
    assert.ok([backendUrl, followupUrl].some(base=>String(url).startsWith(base + '/')), 'Only temporary backends may be contacted');
    const route = new URL(url).pathname;
    assert.ok(!['/send','/send-negotiation'].includes(route), 'Never send supplier messages in tests');
    const body = options.body ? JSON.parse(options.body) : null;
    const request = {route, module:String(url).startsWith(followupUrl+'/')?'followup':'compras', method:options.method, body};httpCalls.push(request);
    if (nextFault && nextFault.route===route) {const fault=nextFault;nextFault=null;throw Error(fault.message);}
    if (hold && hold.route===route && (!hold.additionOnly || body?.add_item_ids)) {hold.started=true;await hold.promise;}
    const response = await fetch(url, options);request.status=response.status;
    if (route === '/broadcast/start' && loseStartResponse) { loseStartResponse=false; await response.text(); throw Error('Synthetic lost response after commit'); }
    return response;
  }
});
vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, {filename:mainPath});
const token = vm.runInContext('engineToken', context);
const actualApi = (method, route, body) => ipc.get('api')({}, {method, route, body});
(async()=>{
  server=spawn(process.env.VYZIUM_TEST_PYTHON || (process.platform==='win32'?'python':'python3'), ['-u',path.join(__dirname,'broadcast_server.py')],{env:{...process.env,FOLLOWUP_API_TOKEN:token},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',chunk=>{serverStderr+=chunk.toString();});
  const setup=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Backend startup timeout: '+serverStderr)),45000);
    const lines=createInterface({input:server.stdout});
    lines.once('line',line=>{clearTimeout(timer);lines.close();try{resolve(JSON.parse(line));}catch(e){reject(e);}});
    server.once('error',e=>{clearTimeout(timer);reject(e);});
    server.once('exit',code=>{clearTimeout(timer);reject(Error('Backend exited '+code+': '+serverStderr));});
  });
  backendUrl=followupUrl='http://127.0.0.1:'+setup.port;context.followupUrl=followupUrl;
  vm.runInContext(`activeModule='followup';followupEngineUrl=followupUrl;workspaceServicesStarted=true;
    authManager={getState:()=>({authenticated:true,email:'synthetic@example.invalid'})};
    whatsapp={status:()=>({status:'ready'})};
    window={isDestroyed:()=>false,webContents:{setZoomFactor:()=>{}}};`,context);
  // Auth failure and method validation exercise the HTTP boundary, not a stubbed API.
  assert.equal((await fetch(followupUrl+'/broadcast/status')).status,401);
  await assert.rejects(actualApi('GET','/broadcast/start'));
  browser=await chromium.launch({headless:true});
  const bc=await browser.newContext({viewport:{width:1440,height:1000}});
  await bc.exposeBinding('__vyziumInvoke',async(_source,channel,...args)=>{
    assert.ok(ipc.has(channel),'Unknown IPC '+channel);return ipc.get(channel)({},...args);
  });
  await bc.addInitScript({content:`(()=>{const require=name=>({contextBridge:{exposeInMainWorld:(k,v)=>window[k]=v},ipcRenderer:{invoke:(...a)=>window.__vyziumInvoke(...a),on:()=>{},removeListener:()=>{},send:()=>{}}});${fs.readFileSync(path.join(root,'electron/preload.js'),'utf8')}})();`});
  page=await bc.newPage();page.on('pageerror',e=>errors.push(e.message));
  const unexpectedDialogs=[];page.on('dialog',async d=>{unexpectedDialogs.push(d.message());await d.dismiss();});
  await page.goto(pathToFileURL(path.join(root,'renderer/acompanhamento.html')).href);
  await page.locator('#op-body').waitFor({state:'attached',timeout:15000});
  assert.equal(await page.locator('[data-view="broadcast"] svg').count(),1,'Collapsed sidebar must retain a visible transmission icon');
  await page.locator('[data-view="broadcast"]').click();
  await page.waitForFunction(()=>document.getElementById('broadcast-fields')?.disabled===false);
  await page.locator('#broadcast-search').fill('agua');
  assert.equal(await page.locator('[data-key]').count(),1);
  await page.locator('#broadcast-all').click();
  assert.match(await page.locator('#broadcast-count').textContent(),/3 cadastrados/);
  await page.locator('#broadcast-name').fill('Manual');await page.locator('#broadcast-phone').fill('85988887777');await page.locator('#broadcast-add').click();
  await page.locator('#broadcast-name').fill('Duplicado');await page.locator('#broadcast-phone').fill('+55 (85) 99999-8888');await page.locator('#broadcast-add').click();
  await page.locator('#broadcast-message').fill('Nova cotação <teste> & comunicado.');
  await page.locator('#broadcast-review').click();await page.locator('#broadcast-confirm').waitFor();
  const preview=await page.locator('#broadcast-review-panel').textContent();
  assert.match(preview,/3 números únicos/);assert.match(preview,/repetido/);assert.match(preview,/ausente/);assert.match(preview,/SIMULAÇÃO/);
  assert.equal(await page.locator('#broadcast-fields').evaluate(fieldset=>fieldset.disabled),true);
  assert.equal(await page.locator('#broadcast-search').isDisabled(),true,'Reviewed form controls must be disabled');
  assert.equal(await page.locator('#broadcast-review-panel img').count(),0,'Supplier names must be escaped');
  const output=process.env.VYZIUM_TEST_OUTPUT_DIR||path.join(temp,'shots');fs.mkdirSync(output,{recursive:true});
  for(const width of [1440,1000]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(output,`broadcast-review-${width}.png`),fullPage:true});}
  loseStartResponse=true;
  await page.locator('#broadcast-confirm').click();await page.locator('#broadcast-retry').waitFor();
  assert.equal(await page.locator('#broadcast-fields').evaluate(fieldset=>fieldset.disabled),true,'Lost response must keep the fieldset locked');
  assert.equal(await page.locator('#broadcast-message').isDisabled(),true,'Lost response must not allow editing into a new batch');
  await page.locator('#broadcast-retry').click();
  await page.waitForFunction(()=>document.getElementById('broadcast-progress').textContent.includes('3 simulados'));
  const starts=httpCalls.filter(c=>c.route==='/broadcast/start');assert.equal(starts.length,2);assert.deepEqual(starts[0].body,starts[1].body);
  const history=await actualApi('GET','/history');assert.equal(history.history.length,3);assert.ok(history.history.every(r=>r.status==='simulated'));
  assert.equal((await actualApi('GET','/suppliers')).suppliers.length,3,'Manual recipients must not enter registry');
  await page.reload();await page.locator('#op-body').waitFor({state:'attached',timeout:15000});await page.locator('[data-view="broadcast"]').click();
  await page.waitForFunction(()=>document.getElementById('broadcast-progress')?.textContent.includes('3 simulados'));
  await page.screenshot({path:path.join(output,'broadcast-results.png'),fullPage:true});
  await page.locator('[data-view="history"]').click();await page.getByText('Transmissão',{exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedDialogs,[]);
  console.log('PASS broadcast: real renderer/preload/IPC/allowlist/HTTP/backend; auth, search, select-all, manual, dedupe, escaping, lost response, idempotency, history, reload; no real messages.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill();fs.rmSync(temp,{recursive:true,force:true});});
