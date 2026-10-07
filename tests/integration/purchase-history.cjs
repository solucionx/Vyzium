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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-purchase-history-integration-'));
const ipc = new Map(), calls = [], httpCalls = [], errors = [], passed = [];
let server, browser, page, backendUrl, nextFault = null, hold = null;
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
    assert.ok(String(url).startsWith(backendUrl + '/'), 'Only the temporary backend may be contacted');
    const route = new URL(url).pathname;
    assert.ok(!['/send','/send-negotiation'].includes(route), 'Never send supplier messages in tests');
    const body = options.body ? JSON.parse(options.body) : null;
    const request = {route, method:options.method, body};httpCalls.push(request);
    if (nextFault && nextFault.route===route) {const fault=nextFault;nextFault=null;throw Error(fault.message);}
    if (hold && hold.route===route && (!hold.additionOnly || body?.add_item_ids)) {hold.started=true;await hold.promise;}
    const response = await fetch(url, options);request.status=response.status;return response;
  }
});
vm.runInContext(fs.readFileSync(mainPath, 'utf8'), context, {filename:mainPath});
const token = vm.runInContext('engineToken', context);
const actualApi = (method, route, body) => ipc.get('api')({}, {method, route, body});
async function check(name, fn) {await fn();passed.push(name);console.log('PASS: '+name);}
async function openMap(id) {
  await page.locator('[data-view="maps"]').click();
  await page.locator('[data-map-scope="'+(id==='archived-viewer'?'completed':'active')+'"]').click();
  await page.locator(`[data-open-map="${id}"]`).click();
  await page.locator('#save-map').waitFor();
}
function gate(route, additionOnly=false) {let release;const promise=new Promise(r=>release=r);hold={route,additionOnly,promise};return ()=>{hold=null;release();};}

(async()=>{
  server = spawn(process.env.VYZIUM_TEST_PYTHON || (process.platform==='win32'?'python':'python3'),
    ['-u', path.join(__dirname, 'purchase_history_server.py')],
    {env:{...process.env,FOLLOWUP_API_TOKEN:token},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',chunk=>process.stderr.write(chunk));
  const lines=createInterface({input:server.stdout});
  const [line]=await once(lines,'line');const setup=JSON.parse(line);lines.close();
  backendUrl='http://127.0.0.1:'+setup.port;
  context.backendUrl=backendUrl;
  vm.runInContext(`activeModule='compras';comprasEngineUrl=backendUrl;workspaceServicesStarted=true;
    authManager={getState:()=>({authenticated:true,email:'synthetic@example.invalid'})};
    whatsapp={status:()=>({status:'ready'})};
    window={isDestroyed:()=>false,webContents:{setZoomFactor:()=>{}}};`,context);
  const launch={headless:true};
  if(process.env.VYZIUM_TEST_CHROMIUM)launch.executablePath=process.env.VYZIUM_TEST_CHROMIUM;
  if(process.env.VYZIUM_TEST_SERVERLESS_CHROMIUM==='1'){
    const mod=require('@sparticuz/chromium');launch.args=(mod.default||mod).args;
  }
  browser=await chromium.launch(launch);
  const browserContext=await browser.newContext({viewport:{width:1440,height:1050}});
  await browserContext.exposeBinding('__vyziumInvoke',async (_source,channel,...args)=>{
    calls.push({channel,args});assert.ok(ipc.has(channel),'Unknown IPC channel '+channel);
    return await ipc.get(channel)({},...args);
  });
  await browserContext.addInitScript({content:`(() => {
    const require = name => {
      if (name !== 'electron') throw Error('Unexpected preload import');
      return {contextBridge:{exposeInMainWorld:(key,value)=>window[key]=value},
        ipcRenderer:{invoke:(...args)=>window.__vyziumInvoke(...args),on:()=>{},removeListener:()=>{},send:()=>{}}};
    };
    ${fs.readFileSync(path.join(root,'electron/preload.js'),'utf8')}
  })();`});
  page=await browserContext.newPage();page.on('pageerror',error=>errors.push(error.message));
  let confirms=true;page.on('dialog',d=>confirms?d.accept():d.dismiss());
  await page.goto(pathToFileURL(path.join(root,'renderer/compras.html')).href);
  await page.locator('#catalog-summary .summary-grid').waitFor();
  const original=await actualApi('GET','/map?id='+setup.map_id);
  const shots=async name=>{if(process.env.VYZIUM_TEST_OUTPUT_DIR){fs.mkdirSync(process.env.VYZIUM_TEST_OUTPUT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,name+'.png')});}};
  const ready=()=>page.locator('#ph-results[aria-busy="false"]').waitFor();
  const search=async q=>{await page.locator('#ph-search').fill(q);await page.waitForFunction(()=>document.querySelector('#ph-count').textContent!=='Pesquisando…'&&document.querySelector('#ph-results').getAttribute('aria-busy')==='false');};
  const item=()=>page.locator('[data-ph-item]').filter({hasText:'Artigo 0090 · UN'});
  const choose=async()=>{await item().click();await page.locator('#ph-detail[aria-busy="false"] [data-ph-order]').first().waitFor();};
  const getOrders=()=>page.locator('[data-ph-order] h3').allTextContents();
  const posts=()=>httpCalls.filter(r=>r.method==='POST').length;
  const waitRequest=async()=>{const deadline=Date.now()+5000;while(!hold?.started){assert.ok(Date.now()<deadline,'Expected held request to start');await new Promise(resolve=>setTimeout(resolve,20));}};
  await check('sidebar uses real IPC/allowlist/backend and paginates a 14,000-row import',async()=>{
    const before=posts();const started=Date.now();await page.locator('[data-view="purchases"]').click();await ready();
    assert.ok(Date.now()-started<15000,'Initial history must remain practical on a large import');
    assert.equal(await page.locator('[data-ph-item]').count(),20);
    assert.match(await page.locator('#ph-source').textContent(),/BASE SCI.xlsx/);
    assert.equal(posts(),before);assert.ok(httpCalls.some(r=>r.route==='/purchase-history'));
    await page.locator('[data-ph-page="results"][data-page="1"]').click();await ready();
    assert.equal(await page.locator('[data-ph-item]').count(),20);assert.match(await page.locator('.ph-pagination').textContent(),/Página 2/);
  });
  await check('text search selects article identity before calculating latest OC and count',async()=>{
    await search('lampada');assert.equal(await page.locator('[data-ph-item]').count(),2);
    assert.match(await item().textContent(),/3 OCs/);
    assert.match(await item().textContent(),/15,00/);
    await choose();
    assert.deepEqual(await getOrders(),['OC 202','OC 201','OC 200']);
    const orders=page.locator('[data-ph-order]');
    assert.match(await orders.nth(0).locator('.ph-values').textContent(),/R\$.*15,00/);
    assert.match(await orders.nth(0).locator('.ph-receipts').textContent(),/Não informado/);
    assert.match(await orders.nth(0).locator('.ph-receipts').textContent(),/CX/);
    assert.match(await orders.nth(1).locator('.ph-receipts').textContent(),/15,25/);
    assert.match(await orders.nth(1).locator('.ph-receipts').textContent(),/Calculado: total ÷ quantidade/);
    assert.equal(await orders.nth(2).locator('[data-ph-receipt]').count(),1);
    assert.equal(await page.locator('.purchase-history img,.purchase-history script').count(),0);
    assert.match(await orders.nth(0).textContent(),/Fornecedor B <img src=x onerror=alert\(1\)>/);
    await shots('purchase-history-details');
  });
  await check('hotel/supplier filters constrain both search and order details',async()=>{
    await page.locator('#ph-company').selectOption('MAGNA PRAIA');await ready();await choose();
    assert.deepEqual(await getOrders(),['OC 201','OC 200']);
    await page.locator('#ph-supplier').selectOption('Fornecedor A');await ready();await choose();
    assert.deepEqual(await getOrders(),['OC 201','OC 200']);
  });
  await check('cancelled items are excluded by default and visibly marked when requested',async()=>{
    await page.locator('#ph-status').selectOption('all');await ready();await choose();
    assert.deepEqual(await getOrders(),['OC 203','OC 201','OC 200']);
    assert.equal(await page.locator('.ph-cancelled').count(),1);
    await page.locator('#ph-status').selectOption('received');await ready();await choose();
    assert.deepEqual(await getOrders(),['OC 201','OC 200']);
  });
  await check('zero, literal HTML and a missing OC date remain faithful to the source',async()=>{
    await search('SPECIAL');await page.locator('[data-ph-item]').click();await page.locator('[data-ph-order]').waitFor();
    assert.match(await page.locator('#ph-detail').textContent(),/Detergente <b>concentrado<\/b> & neutro/);
    assert.match(await page.locator('.ph-values').textContent(),/0,00/);
    assert.match(await page.locator('.ph-order-head').textContent(),/Data da entrada · OC sem data/);
    assert.equal(await page.locator('#ph-detail b').count(),0);
  });
  await check('empty results and GET failures provide a retry without writing anything',async()=>{
    await search('item que nao existe');assert.equal(await page.locator('[data-ph-item]').count(),0);
    assert.match(await page.locator('#ph-results').textContent(),/Nenhum item encontrado/);
    nextFault={route:'/purchase-history',message:'Falha simulada na consulta'};
    await search('0090');await page.locator('.ph-error').waitFor();
    await page.locator('.ph-error button').click();await ready();assert.equal(await page.locator('[data-ph-item]').count(),3);
  });
  await check('older asynchronous results cannot overwrite a newer search or another view',async()=>{
    const release=gate('/purchase-history');await page.locator('#ph-search').fill('SPECIAL');
    await waitRequest();
    await page.locator('#ph-search').fill('0090');release();await ready();
    assert.equal(await page.locator('[data-ph-item]').count(),3);
    const releaseAgain=gate('/purchase-history');await page.locator('#ph-search').fill('SPECIAL');
    await waitRequest();
    await page.locator('[data-view="maps"]').click();await page.locator('#new-from-items').waitFor();releaseAgain();
    assert.equal(await page.locator('.purchase-history').count(),0);
  });
  await check('unsaved map guard still cancels navigation and preserves edited values',async()=>{
    await openMap(setup.map_id);await page.locator('[data-item="c1"][data-price="s1"]').fill('12');
    await page.locator('[data-view="purchases"]').click();await page.locator('[data-leave-action="cancel"]').click();
    assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'12');
    assert.equal(await page.locator('.purchase-history').count(),0);
    await page.locator('[data-view="purchases"]').click();await page.locator('[data-leave-action="discard"]').click();await ready();
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,original.map.revision);
  });
  await check('responsive history page fits the content area and requests are strictly read-only',async()=>{
    await search('0090');await choose();await page.setViewportSize({width:780,height:720});
    assert.ok(await page.locator('.purchase-history').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await shots('purchase-history-small');await page.setViewportSize({width:1440,height:1050});
    assert.equal(posts(),0);await assert.rejects(actualApi('POST','/purchase-history',{}));
    assert.equal(posts(),0);assert.deepEqual(errors,[]);
  });
  console.log(JSON.stringify({passed:passed.length,checks:passed,httpCalls:httpCalls.length}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(hold)hold=null;await browser?.close();server?.kill();fs.rmSync(temp,{recursive:true,force:true});
});
