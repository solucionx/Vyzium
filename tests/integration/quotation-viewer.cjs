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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-viewer-integration-'));
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
    if (hold && hold.route===route && (!hold.additionOnly || body?.add_item_ids)) await hold.promise;
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
async function picker() {await page.locator('#add-map-items').click();await page.locator('#add-map-items-form').waitFor({state:'visible'});}
async function cancel() {await page.locator('#cancel-add-items').click();await page.locator('#order-modal').waitFor({state:'hidden'});}
const selected = iid => page.locator(`[data-add-map-item="${iid}"]`);
async function search(text) {await page.locator('#add-items-search').fill(text);await page.waitForFunction(text=>document.querySelector('#add-items-search').value===text,text);}
function gate(route, additionOnly=false) {let release;const promise=new Promise(r=>release=r);hold={route,additionOnly,promise};return ()=>{hold=null;release();};}

(async()=>{
  server = spawn(process.env.VYZIUM_TEST_PYTHON || (process.platform==='win32'?'python':'python3'),
    ['-u', path.join(__dirname, 'quotation_viewer_server.py')],
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
  await openMap(setup.map_id);
  const original=await actualApi('GET','/map?id='+setup.map_id);

  const viewer = page.locator('dialog.quotation-viewer');
  const show = async()=>{await page.locator('#view-map-detail').click();await viewer.waitFor({state:'visible'});};
  const close = async()=>{await page.locator('#qv-close').click();await viewer.waitFor({state:'detached'});};
  const shots = async name=>{if(process.env.VYZIUM_TEST_OUTPUT_DIR){fs.mkdirSync(process.env.VYZIUM_TEST_OUTPUT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,name+'.png')});}};
  await check('viewer opens read-only through real preload and GET without a save or WhatsApp request',async()=>{
    const posts=httpCalls.filter(r=>r.method==='POST').length;
    await show();assert.equal(await page.locator('#qv-title').textContent(),'Manut · 0210');
    assert.match(await viewer.textContent(),/Urgente/);
    assert.equal(await page.locator('.qv-sheet tbody tr').count(),original.map.items.length);
    assert.equal(await page.locator('.qv-supplier-head').count(),original.map.suppliers.length);
    assert.equal(await page.locator('[data-qv-tab]').count(),0);
    assert.equal(await page.locator('.qv-metrics').count(),0);
    assert.equal(httpCalls.filter(r=>r.method==='POST').length,posts);
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,original.map.revision);
    assert.equal(await page.locator('#qv-save').count(),0);await shots('viewer-sheet');
  });
  await check('manual award, financial best, tie, unquoted and legacy discounts remain separate',async()=>{
    const item=page.locator('[data-qv-item="c1"]');
    assert.match(await item.textContent(),/Entrega imediata <especial>/);
    assert.equal(await item.locator('.qv-price-cell.is-chosen').count(),1);
    assert.ok(await item.locator('.qv-price-cell.is-best').count()>=1);
    assert.match(await page.locator('[data-qv-item="m1"]').textContent(),/Empate/);
    assert.equal(await page.locator('[data-qv-item="m1"] .qv-price-cell.is-chosen').count(),0);
    assert.match(await page.locator('[data-qv-item="m2"]').textContent(),/Sem cotação/);
    assert.equal(await viewer.locator('img,script').count(),0);await shots('viewer-values');
  });
  await check('search supports accents and filters keep full-map totals explicitly labelled',async()=>{
    await page.locator('#qv-search').fill('lampada');assert.equal(await page.locator('.qv-sheet tbody tr:visible').count(),1);
    await page.locator('#qv-search').fill('');await page.locator('#qv-hotel').selectOption('MAGNA PRAIA');
    assert.equal(await page.locator('.qv-sheet tbody tr:visible').count(),2);
    await page.locator('#qv-state').selectOption('unquoted');assert.equal(await page.locator('.qv-sheet tbody tr:visible').count(),1);
    assert.match(await page.locator('#qv-count').textContent(),/1 de 4 itens exibidos/);
    await page.locator('#qv-search').fill('não existe');assert.match(await page.locator('#qv-sheet-host').textContent(),/Nenhum item corresponde/);
  });
  await check('supplier coverage and assigned totals match the backend without interpreting absent quotes as zero',async()=>{
    await page.locator('#qv-search').fill('');
    await page.locator('#qv-hotel').selectOption('');
    await page.locator('#qv-state').selectOption('');
    assert.equal(await page.locator('.qv-supplier-head').count(),2);
    await page.evaluate(detail=>window.__viewerDetail=detail,original);
    const model=await page.evaluate(()=>QuotationViewer.createModel(window.__viewerDetail));
    for(const supplier of original.result.suppliers){const actual=model.suppliers.find(s=>s.id===supplier.id);assert.equal(actual.net,Number(supplier.net));assert.equal(actual.saving,Number(supplier.saving));}
    assert.equal(model.defined,2);assert.equal(model.suppliers[0].coverage,3);
    assert.match(await page.locator('.qv-supplier-head').first().textContent(),/3\/4 itens cotados/);
    assert.match(await page.locator('.qv-sheet tfoot').textContent(),/3\/4 itens/);
  });
  await shots('viewer-suppliers');await close();
  await check('Escape returns focus and preserves dirty inputs and map revision',async()=>{
    await page.locator('[data-item="c1"][data-price="s1"]').fill('12');const posts=httpCalls.filter(r=>r.method==='POST').length;
    await show();await page.locator('#qv-save').waitFor();assert.match(await viewer.textContent(),/última comparação salva/);
    await page.keyboard.press('Escape');await viewer.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'12');
    assert.equal(httpCalls.filter(r=>r.method==='POST').length,posts);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'view-map-detail');
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,original.map.revision);
  });
  await check('explicit save handles failure, prevents double submission and refreshes the viewer once',async()=>{
    await show();nextFault={route:'/maps/save',message:'Falha simulada ao salvar'};await page.locator('#qv-save').click();
    await page.locator('.qv-error:not(.hidden)').waitFor();assert.equal(await page.locator('#qv-save').isEnabled(),true);
    assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'12');
    const release=gate('/maps/save');const before=httpCalls.filter(r=>r.method==='POST'&&r.route==='/maps/save').length;
    await page.locator('#qv-save').click();await page.waitForFunction(()=>document.querySelector('#qv-save').disabled);
    await page.keyboard.press('Escape');assert.equal(await viewer.isVisible(),true);assert.equal(await page.locator('#qv-close').isDisabled(),true);
    await page.evaluate(()=>document.querySelector('#qv-save').click());release();
    await page.locator('#qv-save').waitFor({state:'detached'});
    assert.equal(httpCalls.filter(r=>r.method==='POST'&&r.route==='/maps/save').length,before+1);
    assert.ok((await actualApi('GET','/map?id='+setup.map_id)).map.revision>original.map.revision);await close();
  });
  await check('failed GET leaves the button usable and dirty map inputs intact',async()=>{
    nextFault={route:'/map',message:'Falha simulada ao abrir'};await page.locator('#view-map-detail').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Falha simulada ao abrir'));
    assert.equal(await page.locator('#view-map-detail').isEnabled(),true);assert.equal(await viewer.count(),0);
  });
  await check('completed maps can be viewed without enabling save or WhatsApp actions',async()=>{
    await openMap(setup.archived_id);assert.equal(await page.locator('#view-map-detail').isEnabled(),true);await show();
    assert.match(await viewer.textContent(),/Mapa concluído/);assert.equal(await page.locator('#qv-save').count(),0);await close();
  });
  await check('60 items and 10 suppliers render, filter and close without horizontal dialog overflow',async()=>{
    await openMap(setup.large_id);await show();assert.equal(await page.locator('.qv-sheet tbody tr:visible').count(),60);
    assert.equal(await page.locator('.qv-supplier-head').count(),10);
    await page.locator('#qv-search').fill('Peça de manutenção 59');assert.equal(await page.locator('.qv-sheet tbody tr:visible').count(),1);
    await shots('viewer-large');await close();
    await page.setViewportSize({width:780,height:720});await show();
    const fits=await viewer.evaluate(el=>el.scrollWidth<=el.clientWidth+1);assert.ok(fits,'Dialog must not overflow horizontally');
    await shots('viewer-small');await close();
    await page.setViewportSize({width:1440,height:900});
  });
  assert.deepEqual(errors,[],'No renderer errors');console.log(JSON.stringify({passed:passed.length,checks:passed,httpCalls:httpCalls.length}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(hold)hold=null;await browser?.close();server?.kill();fs.rmSync(temp,{recursive:true,force:true});
});
