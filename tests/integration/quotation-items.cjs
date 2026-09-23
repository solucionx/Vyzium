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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-quotation-integration-'));
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
    ['-u', path.join(__dirname, 'quotation_items_server.py')],
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

  await check('button opens current backend catalog through real preload, IPC handler and route allowlist',async()=>{
    const count=httpCalls.length;await picker();
    assert.ok(httpCalls.slice(count).some(r=>r.method==='GET'&&r.route==='/items'&&r.status===200));
    assert.ok(calls.some(r=>r.channel==='api'&&r.args[0].route==='/items'));
    assert.equal(await selected('m1').count(),0);assert.equal(await selected('locked').count(),0);
    assert.equal(await page.locator('#confirm-add-items').isDisabled(),true);
    assert.equal(await page.locator('#add-items-buyer').inputValue(),'Teste');
    assert.equal(await page.locator('[data-add-map-item]').count(),50);
    if(process.env.VYZIUM_TEST_OUTPUT_DIR){
      fs.mkdirSync(process.env.VYZIUM_TEST_OUTPUT_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,'quotation-items-picker.png')});
    }
    await cancel();
  });

  await check('filters, pagination, select-page, clear and cancel retain pending map edits without saving',async()=>{
    await page.locator('[data-item="c1"][data-price="s1"]').fill('12');
    const before=httpCalls.filter(r=>r.method==='POST').length;await picker();
    await page.locator('#add-items-next').click();
    await page.waitForFunction(()=>document.querySelector('#add-items-page').textContent.includes('2/2'));
    await page.locator('#add-items-select-page').click();
    const countOnSecond=await page.locator('[data-add-map-item]').count();
    assert.ok(countOnSecond>0&&countOnSecond<50);
    assert.equal(await page.locator('[data-add-map-item]:checked').count(),countOnSecond);
    await page.locator('#add-items-prev').click();
    await page.waitForFunction(()=>document.querySelector('#add-items-page').textContent.includes('1/2'));
    assert.match(await page.locator('#add-items-count').textContent(),new RegExp('^'+countOnSecond+' '));
    await page.locator('#add-items-clear').click();assert.equal(await page.locator('#confirm-add-items').isDisabled(),true);
    await page.locator('#add-items-buyer').selectOption('Outro comprador');
    await page.locator('#add-items-hotel').selectOption('CARMEL TAÍBA');
    await search('especial');await selected('special').waitFor();
    assert.equal(await page.locator('[data-add-map-item]').count(),1);
    assert.ok((await page.locator('#add-items-table').textContent()).includes('Peça <especial> & "teste"'));
    assert.equal(await page.locator('#add-items-table img').count(),0);
    await selected('special').check();await cancel();
    assert.equal(httpCalls.filter(r=>r.method==='POST').length,before);
    assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'12');
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,original.map.revision);
  });

  await check('failed catalog request leaves the add button retryable and the map intact',async()=>{
    nextFault={route:'/items',message:'Falha de conexão simulada'};
    await page.locator('#add-map-items').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Falha de conexão simulada'));
    assert.equal(await page.locator('#add-map-items').isEnabled(),true);
    assert.equal(await page.locator('#order-modal').isHidden(),true);
  });

  await check('invalid price returns backend error without adding items or losing inputs/selections',async()=>{
    await page.locator('[data-item="c1"][data-price="s1"]').fill('5');
    await picker();await search('Peça a1');await selected('a1').check();
    const revision=(await actualApi('GET','/map?id='+setup.map_id)).map.revision;
    await page.locator('#confirm-add-items').click();
    await page.locator('#add-items-error:not(.hidden)').waitFor();
    assert.match(await page.locator('#add-items-error').textContent(),/preço negociado/);
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,revision);
    assert.equal(await selected('a1').isChecked(),true);assert.equal(await page.locator('#confirm-add-items').isEnabled(),true);
    await cancel();assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'5');
    await page.locator('[data-item="c1"][data-price="s1"]').fill('12');
  });

  await check('double submit, Escape, import and module navigation are blocked while adding',async()=>{
    await picker();await search('Peça a1');await selected('a1').check();
    const release=gate('/maps/save',true),before=httpCalls.filter(r=>r.body?.add_item_ids).length;
    await page.locator('#confirm-add-items').click();
    await page.waitForFunction(()=>addingMapItems);
    await page.evaluate(()=>document.querySelector('#add-map-items-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(httpCalls.filter(r=>r.body?.add_item_ids).length,before+1);
    assert.equal(await page.evaluate(()=>window.vyziumBeforeNavigateAway({type:'module',target:'followup'})),false);
    await assert.rejects(ipc.get('switch-module')({},'followup'),/operação atual/);
    const imports=calls.filter(r=>r.channel==='choose-workbook').length;
    await page.evaluate(()=>document.querySelector('#import-button').click());
    assert.equal(calls.filter(r=>r.channel==='choose-workbook').length,imports);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#order-modal').isVisible(),true);
    assert.equal(await page.locator('#modal-close').isDisabled(),true);
    release();await page.locator('#order-modal').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelectorAll('.quote-item-row').length===5);
    assert.equal(vm.runInContext('activeRequests',context),0);
  });

  await check('addition persists prior prices, choices, legacy discounts and current edits; new row starts blank',async()=>{
    const saved=await actualApi('GET','/map?id='+setup.map_id);
    assert.equal(saved.map.quotes.c1.s1.price,'12');
    assert.deepEqual(saved.map.quotes.m1,original.map.quotes.m1);
    assert.deepEqual(saved.map.awards,original.map.awards);assert.deepEqual(saved.map.suppliers,original.map.suppliers);
    assert.equal(saved.result.unquoted,1);
    assert.equal(await page.locator('[data-item="a1"][data-price="s1"]').inputValue(),'');
    assert.deepEqual(await page.locator('.origin-cell strong').allTextContents(),['CARMEL CUMBUCO','CARMEL CUMBUCO','CARMEL TAÍBA','MAGNA PRAIA','MAGNA PRAIA']);
    await page.reload();await page.locator('#catalog-summary .summary-grid').waitFor();await openMap(setup.map_id);
    assert.equal(await page.locator('.quote-item-row').count(),5);
    assert.equal(await page.locator('[data-item="c1"][data-price="s1"]').inputValue(),'12');
  });

  await check('new item can be priced, saved, previewed and exported through existing backend buttons',async()=>{
    const field=page.locator('[data-item="a1"][data-price="s1"]');await field.fill('10');
    await page.locator('#save-map').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Mapa salvo e comparação atualizada.');
    const saved=await actualApi('GET','/map?id='+setup.map_id);
    assert.equal(saved.result.lines.find(l=>l.id==='a1').chosen.net,'30.00');
    await page.locator('#request-quote').click();await page.locator('#quote-supplier').selectOption('s1');
    await page.locator('.message-preview').waitFor();
    assert.ok((await page.locator('.message-preview').textContent()).includes('Peça a1'));
    await page.locator('#modal-close').click();await page.locator('#order-modal').waitFor({state:'hidden'});
    await page.locator('#export-map').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Mapa exportado.');
    assert.ok(fs.statSync(path.join(temp,'map.xls')).size>100);
    assert.ok(httpCalls.some(r=>r.route==='/export'&&r.status===200));
  });

  await check('item claimed in another map after opening is rejected atomically and selection can be canceled',async()=>{
    await picker();await page.locator('#add-items-buyer').selectOption('Outro comprador');await search('Peça a2');await selected('a2').check();
    const other=await actualApi('GET','/map?id='+setup.other_id);
    await actualApi('POST','/maps/save',{...other.map,add_item_ids:['a2']});
    const before=await actualApi('GET','/map?id='+setup.map_id);
    await page.locator('#confirm-add-items').click();await page.locator('#add-items-error:not(.hidden)').waitFor();
    assert.match(await page.locator('#add-items-error').textContent(),/outro mapa ativo/);
    assert.deepEqual((await actualApi('GET','/map?id='+setup.map_id)).map,before.map);
    await cancel();await picker();await page.locator('#add-items-buyer').selectOption('');
    assert.equal(await selected('a2').count(),0);await cancel();
  });

  await check('remove from one existing map and add to another using both real buttons',async()=>{
    await openMap(setup.other_id);
    await page.locator('[data-remove-item="locked"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-remove-item="locked"]'));
    await openMap(setup.map_id);await picker();await search('Peça locked');await selected('locked').check();
    await page.locator('#confirm-add-items').click();await page.locator('#order-modal').waitFor({state:'hidden'});
    await page.locator('[data-item="locked"][data-price="s1"]').waitFor();
    const source=await actualApi('GET','/map?id='+setup.other_id),target=await actualApi('GET','/map?id='+setup.map_id);
    assert.equal(source.map.items.some(i=>i.id==='locked'),false);assert.ok(target.map.items.some(i=>i.id==='locked'));
    assert.deepEqual(target.map.quotes.m1,original.map.quotes.m1);
  });

  await check('network failure leaves selection retryable without losing pending work',async()=>{
    await picker();await search('Peça page-00');await selected('page-00').check();
    const before=(await actualApi('GET','/map?id='+setup.map_id)).map.revision;
    nextFault={route:'/maps/save',message:'Falha de rede simulada'};
    await page.locator('#confirm-add-items').click();await page.locator('#add-items-error:not(.hidden)').waitFor();
    assert.equal(await selected('page-00').isChecked(),true);
    assert.equal((await actualApi('GET','/map?id='+setup.map_id)).map.revision,before);
    await page.locator('#confirm-add-items').click();await page.locator('#order-modal').waitFor({state:'hidden'});
    assert.ok((await actualApi('GET','/map?id='+setup.map_id)).map.items.some(i=>i.id==='page-00'));
  });

  await check('multiple items selected across different filters are added together in one save',async()=>{
    await picker();await search('Peça page-02');await selected('page-02').check();
    await page.locator('#add-items-buyer').selectOption('Outro comprador');
    await search('especial');await selected('special').check();
    assert.match(await page.locator('#add-items-count').textContent(),/^2 /);
    const before=httpCalls.filter(r=>r.body?.add_item_ids).length;
    await page.locator('#confirm-add-items').click();await page.locator('#order-modal').waitFor({state:'hidden'});
    const saves=httpCalls.filter(r=>r.body?.add_item_ids).slice(before);
    assert.equal(saves.length,1);assert.deepEqual(saves[0].body.add_item_ids,['page-02','special']);
    assert.equal(saves[0].status,200);
    const saved=await actualApi('GET','/map?id='+setup.map_id);
    for(const id of ['page-02','special'])assert.equal(saved.map.items.filter(i=>i.id===id).length,1);
    assert.deepEqual(saved.map.quotes.m1,original.map.quotes.m1);
  });

  await check('stale revision is returned by HTTP and keeps the local selection editable',async()=>{
    await picker();await search('Peça page-01');await selected('page-01').check();
    const latest=await actualApi('GET','/map?id='+setup.map_id);
    await actualApi('POST','/maps/save',{...latest.map,name:'Nome atualizado em outra tela'});
    await page.locator('#confirm-add-items').click();await page.locator('#add-items-error:not(.hidden)').waitFor();
    assert.match(await page.locator('#add-items-error').textContent(),/outra tela/);
    assert.equal(await selected('page-01').isChecked(),true);await cancel();
    await openMap(setup.map_id);
    assert.equal(await page.locator('#edit-name').inputValue(),'Nome atualizado em outra tela');
  });

  await check('closing a modal and changing views during catalog loading does not open it on the wrong view',async()=>{
    const release=gate('/items');await page.locator('#add-map-items').click();
    const pending=httpCalls.filter(r=>r.route==='/items').at(-1);
    await page.locator('[data-view="maps"]').click();await page.locator('#map-library-grid').waitFor();
    release();
    const limit=Date.now()+5000;
    while(!pending.status&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(pending.status,200);
    await page.waitForFunction(()=>currentView==='maps');
    assert.equal(await page.locator('#order-modal').isHidden(),true);
    await page.locator(`[data-open-map="${setup.map_id}"]`).click();await page.locator('#add-map-items').waitFor();
  });

  await check('completed maps expose no add button and backend also rejects inclusion',async()=>{
    await page.locator('[data-view="maps"]').click();await page.locator('[data-map-scope="completed"]').click();
    await page.locator(`[data-open-map="${setup.archived_id}"]`).click();await page.locator('#save-map').waitFor();
    assert.equal(await page.locator('#add-map-items').count(),0);
    const archived=await actualApi('GET','/map?id='+setup.archived_id);
    await assert.rejects(actualApi('POST','/maps/save',{...archived.map,add_item_ids:['page-01']}),/concluído/);
    assert.equal(await page.locator('#export-map').isEnabled(),true);
  });

  await check('empty availability produces an informative dialog with addition disabled',async()=>{
    const catalog=await actualApi('GET','/items');const free=catalog.items.filter(i=>!i.maps.length).map(i=>i.id);
    if(free.length)await actualApi('POST','/maps/create',{name:'Reserva dos itens de teste',ids:free});
    await page.locator('[data-view="maps"]').click();await page.locator('[data-map-scope="active"]').click();
    await page.locator(`[data-open-map="${setup.map_id}"]`).click();await picker();
    assert.equal(await page.locator('[data-add-map-item]').count(),0);
    assert.match(await page.locator('#add-items-table').textContent(),/Nenhum item disponível/);
    assert.equal(await page.locator('#confirm-add-items').isDisabled(),true);await cancel();
  });
  assert.deepEqual(errors,[],'No unhandled browser exceptions');
  assert.equal(vm.runInContext('activeRequests',context),0);
  const report={passed:passed.length,scenarios:passed,browser:browser.version(),httpRequests:httpCalls.length,
    ipcCalls:calls.length,successfulSaves:httpCalls.filter(r=>r.route==='/maps/save'&&r.status===200).length,
    rejectedSaves:httpCalls.filter(r=>r.route==='/maps/save'&&r.status===400).length,unhandledErrors:errors};
  if(process.env.VYZIUM_TEST_OUTPUT_DIR){
    fs.mkdirSync(process.env.VYZIUM_TEST_OUTPUT_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,'quotation-items-result.json'),JSON.stringify(report,null,2));
    await page.screenshot({path:path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,'quotation-items-map.png'),fullPage:true});
  }
  console.log(JSON.stringify(report,null,2));
})().catch(async error=>{
  if(page&&process.env.VYZIUM_TEST_OUTPUT_DIR){
    fs.mkdirSync(process.env.VYZIUM_TEST_OUTPUT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.VYZIUM_TEST_OUTPUT_DIR,'failure.png'),fullPage:true}).catch(()=>{});
  }
  console.error(error);process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close();
  if(server){server.kill();await once(server,'exit').catch(()=>{});}
  fs.rmSync(temp,{recursive:true,force:true});
});
