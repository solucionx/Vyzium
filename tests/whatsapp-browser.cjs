'use strict';
// Real Puppeteer + real installed/patched Client.inject, synthetic WhatsApp modules.
// requestAnimationFrame is deliberately suspended to reproduce hidden-window waits.
// No WhatsApp network, accounts, credentials or messages are used.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const {Client} = require('whatsapp-web.js');
const {SOCKET_STATE_PROBE_SOURCE} = require('../scripts/patch-whatsapp-web');
let browser;
before(async () => {
  if (!process.env.VYZIUM_TEST_CHROMIUM) throw new Error('Defina VYZIUM_TEST_CHROMIUM com o executável de Chromium de teste.');
  browser = await puppeteer.launch({executablePath:process.env.VYZIUM_TEST_CHROMIUM,headless:true,
    // Linux CI sandbox exception is TEST ONLY; production launcher is unchanged.
    args:process.platform === 'linux' ? ['--no-sandbox','--disable-gpu','--disable-background-timer-throttling'] : []});
});
after(async () => {await browser?.close();});
async function setup(t, restored = false) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.evaluate(restored => {
    window.requestAnimationFrame = () => 1;
    const eventSource = data => Object.assign(data, {handlers:{},on(name,fn){(this.handlers[name] ||= []).push(fn);},
      off(name,fn){this.handlers[name]=(this.handlers[name]||[]).filter(x=>x!==fn);}});
    const Socket = eventSource({state:'OPENING',hasSynced:restored});
    const Conn = eventSource({ref:'synthetic-ref'});
    window.__modules = {WAWebSocketModel:{Socket},WAWebConnModel:{Conn},WAWebCmd:{Cmd:eventSource({})}};
    window.require = name => {if(!window.__modules[name])throw Error('Module not ready');return window.__modules[name];};
    if(restored)window.WWebJS = {};
    setTimeout(()=>{window.Debug={VERSION:'synthetic-version'};},150);
    setTimeout(()=>{Socket.state=restored?'CONNECTED':'UNPAIRED';},400);
    setTimeout(()=>Object.assign(window.__modules, {
      WAWebSignalStoreApi:{waSignalStore:{getRegistrationInfo:async()=>({identityKeyPair:{pubKey:'identity'}})}},
      WAWebUserPrefsInfoStore:{waNoiseInfo:{get:async()=>({staticKeyPair:{pubKey:'noise'}})}},
      WABase64:{encodeB64:value=>btoa(value)},
      WAWebUserPrefsMultiDevice:{getADVSecretKey:async()=>'synthetic-secret'},
      WAWebCompanionRegClientUtils:{DEVICE_PLATFORM:'DESKTOP'}
    }),650);
  },restored);
  return page;
}
test('control: RAF polling stalls after socket state becomes ready', async t => {
  const page = await setup(t);
  const probe = vm.runInNewContext(`(${SOCKET_STATE_PROBE_SOURCE})`);
  await assert.rejects(page.waitForFunction(probe,{timeout:1200}), /Waiting failed/);
  assert.equal(await page.evaluate(()=>window.__modules.WAWebSocketModel.Socket.state),'UNPAIRED');
});
test('patched inject emits and renews QR with RAF stopped and delayed modules', async t => {
  const page = await setup(t);
  const client = new Client({authTimeoutMs:3000});client.pupPage=page;
  const qrs=[],stages=[];
  client.on('qr',qr=>qrs.push(qr));client.on('vyzium_inject_stage',x=>stages.push(x.stage));
  await client.inject();
  await page.waitForFunction(()=>Boolean(window.onAppStateHasSyncedEvent),{polling:200,timeout:1000});
  assert.equal(qrs.length,1);
  assert.ok(qrs[0].startsWith('synthetic-ref,'));
  assert.deepEqual(stages,['debug-wait','debug-ready','socket-wait','socket-ready','qr-modules-wait','qr-build','qr-listener-ready']);
  await page.evaluate(()=>window.__modules.WAWebConnModel.Conn.handlers['change:ref'].forEach(fn=>fn(null,'renewed-ref')));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(qrs.length,2);assert.ok(qrs[1].startsWith('renewed-ref,'));
});
test('restored synchronized session reaches ready with RAF stopped', async t => {
  const page = await setup(t,true);
  const client=new Client({authTimeoutMs:3000});client.pupPage=page;
  let ready=0,qr=0;client.on('ready',()=>ready++);client.on('qr',()=>qr++);
  await client.inject();await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(ready,1);assert.equal(qr,0);
});
test('numeric polling survives replacement of the document execution context', async t => {
  const page=await browser.newPage();t.after(()=>page.close());
  await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>1;setTimeout(()=>{window.Debug={VERSION:'after-reload'};},300);});
  await page.evaluate(()=>{window.requestAnimationFrame=()=>1;});
  const waiting=page.waitForFunction('window.Debug?.VERSION != undefined',{polling:200,timeout:3000});
  await page.goto('data:text/html,<body>replacement</body>');
  const handle=await waiting;assert.equal(await handle.jsonValue(),true);await handle.dispose();
});
test('closed page cancels the real bootstrap barrier immediately', async t => {
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(path.dirname(require.resolve('whatsapp-web.js/package.json')),'src/Client.js'),'utf8');
  const start=source.indexOf('        const vyziumBootstrapDeadline');
  const end=source.indexOf('        // VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V7: navigation recovery',start);
  assert.ok(start>=0 && end>start);
  const barrier=vm.runInNewContext(`(async function(page){${source.slice(start,end)}})`,{setTimeout});
  const page=await browser.newPage();await page.close();
  await assert.rejects(barrier.call({emit(){}},page),error=>error.code==='VYZIUM_STARTUP_CANCELLED');
});
