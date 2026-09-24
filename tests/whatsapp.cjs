const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {WhatsAppSession: NativeWhatsAppSession, startBridge, phoneCandidates, normalizeBrowserMode, resolveBrowserMode, isFatalCacheStorageError, normalizeBrowserWSEndpoint, stopHiddenHeadedBrowser} = require('../electron/whatsapp');

// Unit tests must not launch a real Windows Chrome/PowerShell helper merely
// because the CI runner itself is Windows. Production still uses process.platform
// by default; tests inject a neutral platform. Dedicated pre-show tests opt back
// in with forcePreShowGuard:true and a fake launcher.
class WhatsAppSession extends NativeWhatsAppSession {
  constructor(dataDir, deps = {}) {
    super(dataDir, {platform:'linux', ...deps});
  }
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

  class Client extends EventEmitter {
    constructor(options) {
      super();
      this.options=options;
      this.info={wid:{user:'5500000000000'}};
      this.sent=0;
    }
    async initialize() {
      const auth=this.options?.authStrategy?.options;
      if(auth?.dataPath && auth?.clientId) fs.mkdirSync(path.join(auth.dataPath,`session-${auth.clientId}`),{recursive:true});
    }
    async destroy() {this.destroyed=true;}
    async getNumberId() {return {_serialized:'5500000000000@c.us'};}
    async sendMessage() {
      this.sent++;
      const msg={id:{_serialized:`test-message-${this.sent}`}};
      queueMicrotask(()=>this.emit('message_ack',msg,1));
      return msg;
    }
  }

  const session = new WhatsAppSession(dir,{
    library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
    qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},
    browser:'/test/browser',
    ackTimeoutMs:25,
    sendTimeoutMs:100,
    numberTimeoutMs:100,
    staleReadyMs:60_000
  });
  return session;
}

test('browser mode parser defaults to headed and keeps explicit diagnostic overrides',()=>{
 assert.equal(normalizeBrowserMode('headless'),'headless');
 assert.equal(normalizeBrowserMode('true'),'headless');
 assert.equal(normalizeBrowserMode('headed'),'headed');
 assert.equal(normalizeBrowserMode('false'),'headed');
 assert.equal(normalizeBrowserMode('garbage'),null);
 assert.equal(resolveBrowserMode({}),'headed');
 assert.equal(resolveBrowserMode({browserMode:'headless'}),'headless');
});

test('fatal CacheStorage detector ignores harmless persistence denial but catches the observed crash',()=>{
 assert.equal(isFatalCacheStorageError('[storage] storage bucket persistence denied (aquire-persistent-storage-denied)'),false);
 assert.equal(isFatalCacheStorageError("Failed to execute 'open' on 'CacheStorage': Unexpected internal error."),true);
 assert.equal(isFatalCacheStorageError('BackendEventBus: storage_initialization_error (storage-initialization-error)'),true);
 assert.equal(isFatalCacheStorageError("Failed to execute 'put' on 'Cache': Entry already exists."),true);
});

test('headed WhatsApp browser uses the proven pre-show Win32 guard on Windows',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp.js'),'utf8');
 const helper=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp-hidden-browser.ps1'),'utf8');
 assert.match(source,/launchHiddenHeadedBrowser/);
 assert.match(source,/const runtimePlatform = this\.deps\.platform \|\| process\.platform/);
 assert.match(source,/runtimePlatform === 'win32'/);
 assert.match(source,/browserWSEndpoint:hiddenBrowser\.endpoint/);
 assert.match(source,/browser\.pre-show-guard-ready/);
 assert.doesNotMatch(source,/browserArgs\.push\('--window-position=-32000,-32000'/);
 assert.match(helper,/CREATE_SUSPENDED/);
 assert.match(helper,/StartGuard\(\$launch\.ProcessId\)/);
 assert.match(helper,/Resume\(\$launch\)/);
 assert.match(helper,/EVENT_OBJECT_CREATE/);
 assert.match(helper,/EVENT_OBJECT_SHOW/);
 assert.match(helper,/WS_EX_TOOLWINDOW/);
 assert.match(helper,/WS_EX_APPWINDOW/);
 assert.match(helper,/taskbar\.DeleteTab\(hwnd\)/);
 assert.match(helper,/--remote-debugging-port=0/);
 assert.match(helper,/--user-data-dir=/);
 assert.doesNotMatch(helper,/'--no-startup-window'/);
 assert.match(helper,/--window-position=-30000,-30000/);
 assert.match(helper,/--new-window/);
 assert.match(helper,/about:blank/);
 assert.match(helper,/Remove-Item -LiteralPath \$devToolsFile -Force/);
 assert.match(helper,/function Get-ValidatedDevToolsEndpoint/);
 assert.match(helper,/json\/version/);
 assert.match(helper,/ClientWebSocket/);
 assert.match(helper,/Get-ValidatedDevToolsEndpoint \$candidatePort/);
 assert.doesNotMatch(helper,/--no-sandbox/);
});

test('hidden browser guard keeps low idle cost without treating a root-PID handoff as browser death',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp-hidden-browser.ps1'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp.js'),'utf8');
 assert.match(helper,/SetWinEventHook\(EVENT_OBJECT_CREATE[^\n]+\(uint\)rootPid/);
 assert.match(helper,/SetWinEventHook\(EVENT_OBJECT_SHOW[^\n]+\(uint\)rootPid/);
 assert.match(helper,/new Timer\(SweepWindows, null, 0, 150\)/);
 assert.match(helper,/SetSweepInterval\(1500\)/);
 assert.match(helper,/if \(!force && !NeedsNormalization\(hwnd\)\)/);
 assert.match(helper,/public static bool HasLiveBrowserProcess\(\)/);
 assert.match(helper,/RefreshTargetPidSet\(\);[\s\S]*targetPids\.CopyTo\(snapshot\)/);
 assert.match(helper,/HasLiveBrowserProcess\(\)/);
 assert.match(helper,/Start-Sleep -Milliseconds 1500/);
 assert.doesNotMatch(helper,/new Timer\(SweepWindows, null, 0, 200\)/);
 assert.doesNotMatch(helper,/HasLiveRootProcess\(\)/);
 assert.doesNotMatch(helper,/Start-Sleep -Milliseconds 500/);
 // The three speculative 3.2.4 flags are deliberately rolled back: they were
 // not needed for the CPU gain and are not worth changing first-run behavior.
 for (const flag of ['--disable-extensions','--disable-sync','--disable-default-apps']) {
   assert.doesNotMatch(helper,new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   assert.equal(source.includes(flag),false);
 }
 // Reliability switches that were part of the stable headed setup stay intact.
 for (const flag of ['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']) {
   assert.ok(helper.includes(flag));
 }
});

test('hidden launcher never reuses a stale DevToolsActivePort and waits for a live CDP socket',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp-hidden-browser.ps1'),'utf8');
 const removeIndex=helper.indexOf("Remove-Item -LiteralPath $devToolsFile -Force");
 const launchIndex=helper.indexOf('LaunchSuspended($browser');
 const readyIndex=helper.indexOf('Get-ValidatedDevToolsEndpoint $candidatePort');
 const outputIndex=helper.indexOf('[Console]::Out.WriteLine');
 assert.ok(removeIndex>=0 && launchIndex>removeIndex,'stale DevToolsActivePort must be removed before launch');
 assert.ok(readyIndex>=0 && outputIndex>readyIndex,'CDP endpoint must pass /json/version and WebSocket validation before it is returned to Node');
});

test('CDP endpoint validation rejects PowerShell pipeline arrays and malformed URLs',()=>{
 assert.equal(normalizeBrowserWSEndpoint('ws://127.0.0.1:9222/devtools/browser/abc-123'),'ws://127.0.0.1:9222/devtools/browser/abc-123');
 assert.equal(normalizeBrowserWSEndpoint('  ws://localhost:9222/devtools/browser/test  '),'ws://localhost:9222/devtools/browser/test');
 assert.equal(normalizeBrowserWSEndpoint([{value:'unexpected'},'ws://127.0.0.1:9222/devtools/browser/test']),null);
 assert.equal(normalizeBrowserWSEndpoint('[object Object],ws://127.0.0.1:9222/devtools/browser/test'),null);
 assert.equal(normalizeBrowserWSEndpoint('http://127.0.0.1:9222/json/version'),null);
 assert.equal(normalizeBrowserWSEndpoint('ws://example.com:9222/devtools/browser/test'),null);
});

test('PowerShell CDP validator suppresses ConnectAsync output before returning the endpoint',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp-hidden-browser.ps1'),'utf8');
 assert.match(helper,/\$null\s*=\s*\$socket\.ConnectAsync\(\$uri,\s*\$cts\.Token\)\.GetAwaiter\(\)\.GetResult\(\)/);
 assert.match(helper,/\$candidateValues\s*=\s*@\(Get-ValidatedDevToolsEndpoint/);
 assert.match(helper,/\$candidateValues\.Count\s+-eq\s+1/);
});

test('pre-show launcher connects whatsapp-web.js to the same LocalAuth profile without switching to headless',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-preshow-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const launches=[];const stops=[];
 class Client extends EventEmitter{
  constructor(options){super();this.options=options;this.info={wid:{user:'5500000000000'}};}
  async initialize(){}
  async destroy(){}
 }
 const s=new WhatsAppSession(dir,{
  library:{Client,LocalAuth:class{constructor(options){this.options=options;}}},
  qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},
  browser:'/test/browser',
  forcePreShowGuard:true,
  launchHiddenHeadedBrowser:async options=>{launches.push(options);return {endpoint:'ws://127.0.0.1:9222/devtools/browser/test',pid:4242,stopFile:'/tmp/test-stop'};},
  stopHiddenHeadedBrowser:async hidden=>{stops.push(hidden);}
 });
 s.connect();await s.starting;
 assert.equal(launches.length,1);
 assert.equal(launches[0].userDataDir,path.join(dir,`session-${s.authClientId}`));
 assert.equal(s.client.options.puppeteer.headless,false);
 assert.equal(s.client.options.puppeteer.browserWSEndpoint,'ws://127.0.0.1:9222/devtools/browser/test');
 assert.equal(s.client.options.puppeteer.executablePath,undefined);
 assert.equal(s.client.options.authStrategy.options.dataPath,dir);
 await s.shutdown();
 assert.equal(stops.length,1);
});

test('brand-new machine path auto-starts a provisional LocalAuth profile and reaches QR',async t=>{
 const metadata=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-clean-meta-'));
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-clean-runtime-'));
 t.after(()=>{fs.rmSync(metadata,{recursive:true,force:true});fs.rmSync(runtime,{recursive:true,force:true});});
 const launches=[];
 class Client extends EventEmitter {
  constructor(options){super();this.options=options;this.info={wid:{user:'5500000000000'}};}
  async initialize(){setTimeout(()=>this.emit('qr','clean-machine-qr'),5);}
  async destroy(){}
 }
 const s=new WhatsAppSession(metadata,{
  profileDataDir:runtime,
  library:{Client,LocalAuth:class{constructor(options){this.options=options;}}},
  qrCode:{toDataURL:async()=> 'data:image/png;base64,clean'},
  browser:'/test/browser',
  forcePreShowGuard:true,
  launchHiddenHeadedBrowser:async options=>{launches.push(options);return {endpoint:'ws://127.0.0.1:9222/devtools/browser/clean',pid:5151,stopFile:'/tmp/clean-stop'};},
  stopHiddenHeadedBrowser:async()=>{}
 });
 assert.equal(s.status().firstConnectionPending,true);
 s.autoStart();
 const deadline=Date.now()+1000;
 while(s.status().status!=='qr' && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
 assert.equal(s.status().status,'qr');
 assert.equal(s.status().qr,'data:image/png;base64,clean');
 assert.equal(launches.length,1);
 assert.equal(launches[0].userDataDir,path.join(runtime,`session-${s.authClientId}`));
 await s.shutdown();
});

test('startup audit is passive and never runs a CacheStorage probe before QR/ready',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp.js'),'utf8');
 assert.doesNotMatch(source,/scheduleStorageProbe/);
 assert.doesNotMatch(source,/__vyzium_cache_probe__/);
 assert.match(source,/activeStorageProbe:false/);
});

test('audit records the stable-bootstrap lifecycle exposed by the patched client',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp.js'),'utf8');
 assert.match(source,/client\.bootstrap-waiting/);
 assert.match(source,/client\.bootstrap-stable/);
 assert.match(source,/client\.bootstrap-timeout/);
});

test('default first-start watchdog allows the WhatsApp document time to stabilize', t=>{
 const s=setup(t);
 assert.equal(s.startupTimeoutMs,120000);
});

test('forced headless CacheStorage crash automatically restarts the same profile in headed mode', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-storage-fallback-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const instances=[];
 class FakePage extends EventEmitter {
   url(){return 'https://web.whatsapp.com/';}
   async evaluate(){return {ok:true};}
 }
 class Client extends EventEmitter {
   constructor(options){
     super();this.options=options;this.pupPage=new FakePage();instances.push(this);
   }
   async initialize(){
     if(this.options.puppeteer.headless){
       await new Promise(resolve=>{this.releaseInitialize=resolve;});
     }
   }
   async destroy(){this.destroyed=true;this.releaseInitialize?.();}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},
   browser:'/test/browser',
   browserMode:'headless',
   storageFallbackDelayMs:5,
   startupTimeoutMs:5000
 });
 s.connect();
 await new Promise(r=>setTimeout(r,140));
 assert.equal(instances.length,1);
 assert.equal(instances[0].options.puppeteer.headless,true);
 instances[0].pupPage.emit('console',{type:()=> 'error',text:()=> "Failed to execute 'open' on 'CacheStorage': Unexpected internal error."});
 const deadline=Date.now()+1500;
 while(instances.length<2 && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
 assert.equal(instances.length,2);
 assert.equal(instances[0].destroyed,true);
 assert.equal(instances[1].options.puppeteer.headless,false);
 assert.equal(instances[1].options.authStrategy.options.clientId,instances[0].options.authStrategy.options.clientId);
 assert.match(s.diagnostics().text,/browser\.storage-fallback-restart/);
 await s.shutdown();
});

test('first-connection headed storage crash gets one isolated compatibility retry without touching an established profile', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-first-storage-recovery-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const instances=[]; const launches=[];
 class FakePage extends EventEmitter { url(){return 'https://web.whatsapp.com/';} async evaluate(){return {ok:true};} }
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;this.pupPage=new FakePage();instances.push(this);}
   async initialize(){await new Promise(resolve=>{this.releaseInitialize=resolve;});}
   async destroy(){this.destroyed=true;this.releaseInitialize?.();}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'}, browser:'/test/browser',
   platform:'win32', forcePreShowGuard:true, storageFallbackDelayMs:5, startupTimeoutMs:5000,
   launchHiddenHeadedBrowser:async options=>{launches.push(options);return {endpoint:`ws://127.0.0.1:9222/devtools/browser/${launches.length}`,pid:5000+launches.length,stopFile:`/tmp/stop-${launches.length}`};},
   stopHiddenHeadedBrowser:async()=>{}
 });
 s.connect();
 const firstDeadline=Date.now()+1000; while(instances.length<1 && Date.now()<firstDeadline) await new Promise(r=>setTimeout(r,10));
 const firstId=instances[0].options.authStrategy.options.clientId;
 await new Promise(r=>setTimeout(r,140));
 instances[0].pupPage.emit('console',{type:()=> 'error',text:()=> "Failed to execute 'put' on 'Cache': Entry already exists."});
 const deadline=Date.now()+1500; while(instances.length<2 && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
 assert.equal(instances.length,2);
 assert.equal(instances[0].destroyed,true);
 assert.notEqual(instances[1].options.authStrategy.options.clientId,firstId);
 assert.equal(launches[0].disableStorageBuckets,false);
 assert.equal(launches[1].disableStorageBuckets,true);
 assert.equal(s.firstConnectionStorageRecoveryUsed,true);
 assert.equal(s.sessionState.activeClientId,null);
 assert.match(s.diagnostics().text,/browser\.first-connection-storage-recovery-restart/);
 await s.shutdown();
});

test('production source keeps destructive first-storage recovery single-use while preserving ordinary reconnects',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','electron','whatsapp.js'),'utf8');
 assert.match(source,/this\._hasEstablishedSession\(\) \|\| !this\.firstConnectionPending/);
 assert.match(source,/if \(this\.firstConnectionStorageRecoveryUsed\) return/);
 assert.match(source,/!this\.firstConnectionPending \|\| this\.firstConnectionStorageRecoveryUsed/);
 assert.match(source,/first-storage-retry/);
 assert.match(source,/--disable-features=StorageBuckets/);
});

test('first-storage compatibility profile keeps retrying transient stalls without rotating profile again', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-storage-retry-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const instances=[]; const launches=[];
 class FakePage extends EventEmitter { url(){return 'https://web.whatsapp.com/';} async evaluate(){return {ok:true};} }
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;this.pupPage=new FakePage();instances.push(this);}
   async initialize(){await new Promise(resolve=>{this.releaseInitialize=resolve;});}
   async destroy(){this.destroyed=true;this.releaseInitialize?.();}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'}, browser:'/test/browser',
   platform:'win32', forcePreShowGuard:true, storageFallbackDelayMs:5, startupTimeoutMs:5000,
   reconnectBaseMs:20, reconnectMaxMs:40,
   launchHiddenHeadedBrowser:async options=>{launches.push(options);return {endpoint:`ws://127.0.0.1:9222/devtools/browser/${launches.length}`,pid:6000+launches.length,stopFile:`/tmp/stop-r-${launches.length}`};},
   stopHiddenHeadedBrowser:async()=>{}
 });
 s.connect();
 let deadline=Date.now()+1000; while(instances.length<1 && Date.now()<deadline) await new Promise(r=>setTimeout(r,5));
 await new Promise(r=>setTimeout(r,140));
 s.startupTimeoutMs=40;
 instances[0].pupPage.emit('console',{type:()=> 'error',text:()=> "Failed to execute 'put' on 'Cache': Entry already exists."});
 deadline=Date.now()+1500; while(instances.length<2 && Date.now()<deadline) await new Promise(r=>setTimeout(r,5));
 assert.equal(instances.length>=2,true);
 const compatibilityId=instances[1].options.authStrategy.options.clientId;
 assert.equal(launches[1].disableStorageBuckets,true);
 // Let the compatibility attempt stall. The watchdog must schedule an ordinary
 // retry using the same fresh profile instead of entering a terminal state.
 deadline=Date.now()+1500; while(instances.length<3 && Date.now()<deadline) await new Promise(r=>setTimeout(r,5));
 assert.equal(instances.length>=3,true);
 assert.equal(instances[2].options.authStrategy.options.clientId,compatibilityId);
 assert.equal(launches[2].disableStorageBuckets,true);
 assert.equal(s.requiresNewQr,false);
 assert.equal(s.firstConnectionStorageRecoveryUsed,true);
 assert.match(s.diagnostics().text,/watchdog\.first-connection-retryable/);
 await s.shutdown();
});

test('dedicated persistent profile, headed reliability mode, QR, ready and session reuse',async t=>{
 const s=setup(t);s.connect();await s.starting;
 assert.equal(s.client.options.puppeteer.headless,false);
 assert.equal(s.client.options.authStrategy.options.dataPath,s.dataDir);
 assert.equal(s.client.options.webVersionCache,undefined);
 s.client.emit('qr','secret-qr');await Promise.resolve();
 assert.equal(s.status().status,'qr');assert(s.status().qr);
 s.client.emit('authenticated');assert.equal(s.status().qr,null);
 s.client.emit('ready');assert.equal(s.status().status,'ready');
 const profile=s.client.options.authStrategy.options.dataPath;
 await s.pause();assert.equal(s.status().status,'paused');
 s.connect();await s.starting;assert.equal(s.client.options.authStrategy.options.dataPath,profile);
});

test('audit log exposes bootstrap events without storing raw QR or QR image',async t=>{
 const s=setup(t);s.connect();await s.starting;
 s.client.emit('qr','RAW-QR-SECRET-DO-NOT-LOG');
 await new Promise(resolve=>setTimeout(resolve,5));
 const report=s.diagnostics();
 assert.match(report.text,/client\.initialize-start/);
 assert.match(report.text,/client\.qr-received/);
 assert.doesNotMatch(report.text,/RAW-QR-SECRET-DO-NOT-LOG/);
 assert.doesNotMatch(report.text,/data:image\/png;base64,test/);
 const cleared=s.clearDiagnostics();
 assert.match(cleared.text,/audit\.cleared/);
 await s.shutdown();
});

test('never sends before ready; waits for readiness and records completed sendMessage as sent', async t=>{
 const s=setup(t);s.connect();await s.starting;
 assert.equal((await s.send('+5585999999999','test')).status,'failed');
 const wait=s.waitReady(1000);
 s.client.emit('ready');assert.equal((await wait).ready,true);
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,undefined);
 assert.equal(s.client.sent,1);
});

test('healthy long-lived ready session is reused instead of being restarted by age',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 const client=s.client;
 s.readyAt=Date.now()-24*60*60*1000;
 client.getState=async()=> 'CONNECTED';
 assert.equal((await s.waitReady(1000)).ready,true);
 assert.equal(s.client,client);
 assert.equal(client.destroyed,undefined);
});

test('QR wait times out without sending and can be paused',async t=>{
 const s=setup(t);s.connect();await s.starting;
 await assert.rejects(s.waitReady(10),/Conecte pelo QR/);
 assert.equal(s.client.sent,0);
 const pending=s.waitReady(1000);await s.pause();
 await assert.rejects(pending,/cancelada/);
});

test('lost response is uncertain and invalid numbers are rejected',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 assert.equal((await s.send('invalid','test')).status,'failed');
 s.client.sendMessage=async()=>{throw Error('response lost');};
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'uncertain');
 assert.equal(s.status().status,'ready');
});

test('completed sendMessage is recorded as sent even when ACK event is missed',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>{
   const msg={
     id:{_serialized:'reload-confirmed-message'},
     ack:0,
     async reload(){this.ack=2;return this;}
   };
   return msg;
 };
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,undefined);
 assert.equal(s.status().status,'ready');
});

test('completed sendMessage remains sent when an ACK is already present',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>({id:{_serialized:'already-confirmed-message'},ack:1});
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,undefined);
 assert.equal(s.status().status,'ready');
});

test('message id without server ACK is recorded as sent when sendMessage completed',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>({id:{_serialized:'ghost-message'}});
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.message_id,'ghost-message');
 assert.equal(s.status().status,'ready');
});

test('completed sendMessage is kept as sent without waiting for a later ACK',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>{
   const msg={id:{_serialized:'rejected-message'}};
   queueMicrotask(()=>s.client.emit('message_ack',msg,-1));
   return msg;
 };
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(s.status().status,'ready');
});

test('message without stable id is sent when sendMessage completes',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>({
   ack:0,
   async reload(){this.ack=1;return this;}
 });
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,undefined);
 assert.equal(result.message_id,null);
 assert.equal(s.status().status,'ready');
});

test('missing ACK does not delay the next supplier',async t=>{
 const s=setup(t);s.ackTimeoutMs=8;s.connect();await s.starting;s.client.emit('ready');
 s.client.getState=async()=> 'CONNECTED';
 let count=0;
 s.client.sendMessage=async()=>{
   count++;
   if(count===1) return {id:{_serialized:'no-ack-1'},ack:0};
   const msg={id:{_serialized:'ok-2'},ack:1};
   return msg;
 };
 const first=await s.send('+5585999999999','first');
 assert.equal(first.status,'sent');
 assert.equal(s.status().status,'ready');
 const second=await s.send('+5585999999998','second');
 assert.equal(second.status,'sent');
 assert.equal(count,2);
});

test('concurrent sends rejected',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 let release;
 s.client.getNumberId=()=>new Promise(resolve=>release=resolve);
 const first=s.send('+5585999999999','test');
 assert.equal((await s.send('+5585999999999','test')).status,'failed');
 release({_serialized:'test@c.us'});
 assert.equal((await first).status,'sent');
});


test('first launch preserves legacy LocalAuth and migrates it non-destructively into session-state', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-first-migrate-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'session-vyzium'),{recursive:true});
 fs.writeFileSync(path.join(dir,'session-vyzium','stale-session'),'old');
 fs.writeFileSync(path.join(dir,'session-vyzium-old'), 'legacy-file');
 fs.writeFileSync(path.join(dir,'auth-profile.json'),JSON.stringify({clientId:'vyzium'}));
 fs.writeFileSync(path.join(dir,'connection-preference.json'),JSON.stringify({paused:false}));
 fs.writeFileSync(path.join(dir,'unrelated.txt'),'keep');
 class Client extends EventEmitter {constructor(options){super();this.options=options;} async initialize(){} async destroy(){}}
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser'
 });
 assert.equal(s.status().firstConnectionPending,false);
 assert.equal(fs.existsSync(path.join(dir,'session-vyzium')),true);
 assert.equal(fs.existsSync(path.join(dir,'session-vyzium-old')),true);
 assert.equal(fs.existsSync(path.join(dir,'auth-profile.json')),true);
 assert.equal(fs.existsSync(path.join(dir,'connection-preference.json')),true);
 assert.equal(fs.existsSync(path.join(dir,'unrelated.txt')),true);
 assert.equal(s.authClientId,'vyzium');
 const state=JSON.parse(fs.readFileSync(path.join(dir,'session-state.json'),'utf8'));
 assert.equal(state.activeClientId,'vyzium');
 assert.equal(state.state,'legacy_unverified');
 await s.shutdown();
});

test('closing before first ready preserves the provisional profile and resumes the same pending client', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-first-pending-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 class Client extends EventEmitter {constructor(options){super();this.options=options;} async initialize(){} async destroy(){}}
 const deps={
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser'
 };
 const first=new WhatsAppSession(dir,deps);
 first.connect();await first.starting;
 const provisionalId=first.authClientId;
 const provisionalDir=path.join(dir,`session-${provisionalId}`);
 fs.mkdirSync(provisionalDir,{recursive:true});
 fs.writeFileSync(path.join(provisionalDir,'provisional'),'temp');
 await first.shutdown();
 const second=new WhatsAppSession(dir,deps);
 assert.equal(second.status().firstConnectionPending,true);
 assert.equal(fs.existsSync(provisionalDir),true);
 assert.equal(second.authClientId,provisionalId);
 const state=JSON.parse(fs.readFileSync(path.join(dir,'session-state.json'),'utf8'));
 assert.equal(state.pendingClientId,provisionalId);
 await second.shutdown();
});

test('new QR is transactional: active LocalAuth survives until pending profile reaches ready', async t=>{
 const s=setup(t);
 s.connect();await s.starting;s.client.emit('ready');
 const oldClient=s.client;
 const oldClientId=s.authClientId;
 const oldAuthDir=path.join(s.dataDir,`session-${oldClientId}`);
 assert.equal(fs.existsSync(oldAuthDir),true);
 const result=await s.newQr();
 assert.equal(oldClient.destroyed,true);
 assert.notEqual(s.authClientId,oldClientId);
 assert.match(s.authClientId,/^vyzium-[a-z0-9]+-[a-z0-9]+$/i);
 assert.equal(s.status().firstConnectionPending,false,'active committed profile still exists while QR is pending');
 const pendingId=s.authClientId;
 let state=JSON.parse(fs.readFileSync(path.join(s.dataDir,'session-state.json'),'utf8'));
 assert.equal(state.activeClientId,oldClientId);
 assert.equal(state.pendingClientId,pendingId);
 assert.equal(fs.existsSync(oldAuthDir),true,'old active profile must not be deleted before pending ready');
 await new Promise(r=>setTimeout(r,20));
 assert.notEqual(s.client,oldClient);
 assert.equal(s.client.options.authStrategy.options.clientId,pendingId);
 assert.ok(['starting','offline'].includes(result.status) || ['starting','offline'].includes(s.status().status));
 s.client.emit('ready');
 state=JSON.parse(fs.readFileSync(path.join(s.dataDir,'session-state.json'),'utf8'));
 assert.equal(state.activeClientId,pendingId);
 assert.equal(state.pendingClientId,null);
 assert.equal(state.previousClientId,oldClientId);
 assert.equal(fs.existsSync(oldAuthDir),true,'one rollback profile is kept until the new active profile proves ready again');
 const saved=JSON.parse(fs.readFileSync(path.join(s.dataDir,'auth-profile.json'),'utf8'));
 const marker=JSON.parse(fs.readFileSync(path.join(s.dataDir,'session-established.json'),'utf8'));
 assert.equal(saved.clientId,pendingId);
 assert.equal(marker.clientId,pendingId);
 await s.shutdown();
});

test('LocalAuth profile is reused after ready through the atomic session-state', async t=>{
 const s=setup(t);
 const dir=s.dataDir;
 const SameClient=s.deps.library.Client;
 const LocalAuth=s.deps.library.LocalAuth;
 const firstProfile=s.authClientId;
 s.connect();await s.starting;
 s.client.emit('ready');
 assert.equal(fs.existsSync(path.join(dir,'session-state.json')),true);
 const same=new WhatsAppSession(dir,{
   library:{Client:SameClient,LocalAuth},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser'
 });
 assert.equal(same.status().firstConnectionPending,false);
 assert.equal(same.authClientId,firstProfile);
 same.connect();await same.starting;
 assert.equal(same.client.options.authStrategy.options.clientId,firstProfile);
 await same.shutdown();
 await s.shutdown();
});


test('stale 3.1.20 metadata is migrated without claiming a directory proves authentication', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-marker-repair-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const oldId='vyzium-old';
 const freshId='vyzium-fresh';
 fs.writeFileSync(path.join(dir,'auth-profile.json'),JSON.stringify({clientId:freshId}));
 fs.writeFileSync(path.join(dir,'session-established.json'),JSON.stringify({established:true,clientId:oldId,establishedAt:'2026-09-20T00:00:00.000Z'}));
 fs.mkdirSync(path.join(dir,`session-${freshId}`),{recursive:true});
 fs.writeFileSync(path.join(dir,`session-${freshId}`,'Local State'),'{}');
 const SameClient=class extends EventEmitter { async destroy(){} };
 const s=new WhatsAppSession(dir,{
   library:{Client:SameClient,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser'
 });
 assert.equal(s.status().firstConnectionPending,false);
 assert.equal(s.authClientId,freshId);
 assert.equal(fs.existsSync(path.join(dir,`session-${freshId}`)),true);
 const state=JSON.parse(fs.readFileSync(path.join(dir,'session-state.json'),'utf8'));
 assert.equal(state.activeClientId,freshId);
 assert.equal(state.state,'legacy_unverified');
 const marker=JSON.parse(fs.readFileSync(path.join(dir,'session-established.json'),'utf8'));
 assert.equal(marker.clientId,oldId,'legacy marker is not rewritten until this exact profile reaches ready');
});

test('hidden browser shutdown gives Chrome a graceful profile-flush window before forcing the stop flag', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-stop-grace-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const stopFile=path.join(dir,'stop.flag');
 const helper=new EventEmitter();
 helper.exitCode=null;helper.killed=false;
 helper.kill=()=>{helper.killed=true;};
 const hidden={helper,stopFile};
 const closing=stopHiddenHeadedBrowser(hidden,250,200);
 await new Promise(r=>setTimeout(r,40));
 assert.equal(fs.existsSync(stopFile),false);
 helper.exitCode=0;helper.emit('exit',0);
 await closing;
 assert.equal(fs.existsSync(stopFile),false);
 assert.equal(helper.killed,false);
});

test('bridge requires secret and does not expose QR or session',async t=>{
 const s=setup(t);const {server,url}=await startBridge(s,'test-secret');
 t.after(()=>{server.closeAllConnections();server.close();});
 const denied=await fetch(url+'/send',{method:'POST',body:'{}'});assert.equal(denied.status,401);
 const hidden=await fetch(url+'/status',{headers:{'X-FollowUp-Token':'test-secret'}});assert.equal(hidden.status,404);
});


test('repairs legacy Brazilian mobile candidate without changing landlines',()=>{
 assert.deepEqual(phoneCandidates('+558599216923'), ['558599216923','5585999216923']);
 assert.deepEqual(phoneCandidates('+558532321234'), ['558532321234']);
});

test('tries repaired Brazilian mobile when the saved legacy number is not registered',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 const checked=[];
 s.client.getNumberId=async number=>{
   checked.push(number);
   return number==='5585999216923'?{_serialized:'5585999216923@c.us'}:null;
 };
 const result=await s.send('+558599216923','test');
 assert.equal(result.status,'sent');
 assert.equal(result.resolved_phone,'+5585999216923');
 assert.deepEqual(checked,['558599216923','5585999216923']);
});

test('pause preference survives restart and auto monitor stays stopped until resumed', async t=>{
 const s=setup(t);
 await s.pause();
 assert.equal(s.status().status,'paused');
 const s2=setup(t);
 // setup() creates a new temp dir, so create an explicit session on the same profile.
 const {EventEmitter}=require('node:events');
 class Client extends EventEmitter {async initialize(){} async destroy(){}}
 const same=new WhatsAppSession(s.dataDir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser',
   healthIntervalMs:10,reconnectBaseMs:5,reconnectMaxMs:10
 });
 assert.equal(same.status().status,'paused');
 same.autoStart();
 await new Promise(r=>setTimeout(r,20));
 assert.equal(same.client,null);
 same.connect();
 await same.starting;
 assert.notEqual(same.status().status,'paused');
 await same.shutdown();
 await s2.shutdown();
});

test('LOGOUT closes the browser before profile cleanup and directs the user to a fresh QR', async t=>{
 const s=setup(t);
 s.reconnectBaseMs=5;s.reconnectMaxMs=10;
 s.connect();await s.starting;s.client.emit('ready');
 const loggedOutClient=s.client;
 loggedOutClient.emit('disconnected','LOGOUT');
 assert.equal(s.status().status,'offline');
 assert.match(s.status().error,/Gerar novo QR Code/);
 await new Promise(r=>setTimeout(r,25));
 assert.equal(s.client,null);
 assert.equal(loggedOutClient.destroyed,true);
 const oldId=s.authClientId;
 await s.newQr();
 assert.notEqual(s.authClientId,oldId);
 assert.notEqual(s.client,loggedOutClient);
 await s.shutdown();
});

test('background monitor restores a dropped session unless user paused it', async t=>{
 const s=setup(t);
 s.healthIntervalMs=10;
 s.reconnectBaseMs=5;
 s.reconnectMaxMs=10;
 s.connect(); await s.starting; s.client.emit('ready');
 const first=s.client;
 s.startMonitoring();
 first.emit('disconnected','NETWORK');
 await new Promise(r=>setTimeout(r,25));
 assert.notEqual(s.client,first);
 await s.pause();
 const pausedClient=s.client;
 await new Promise(r=>setTimeout(r,25));
 assert.equal(s.status().status,'paused');
 assert.equal(s.client,pausedClient);
 await s.shutdown();
});

test('single transient health failure does not tear down a ready session', async t=>{
 const s=setup(t);s.healthFailureThreshold=3;s.connect();await s.starting;s.client.emit('ready');
 let calls=0;
 s.client.getState=async()=>{calls++;return calls===1?'DISCONNECTED':'CONNECTED';};
 const first=await s.backgroundHealthCheck();
 assert.equal(first.healthy,false);
 assert.equal(s.status().status,'ready');
 const second=await s.backgroundHealthCheck();
 assert.equal(second.healthy,true);
 assert.equal(s.status().status,'ready');
 assert.equal(s.status().healthFailures,0);
 await s.shutdown();
});

test('bridge health endpoint is authenticated and never exposes QR material',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.getState=async()=> 'CONNECTED';
 const {server,url}=await startBridge(s,'health-secret');
 t.after(()=>{server.closeAllConnections();server.close();});
 const response=await fetch(url+'/health',{method:'POST',headers:{'X-FollowUp-Token':'health-secret'}});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.healthy,true);
 assert.equal('qr' in body,false);
 await s.shutdown();
});

test('execution-context loss during initialization is retried without deleting LocalAuth data', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-retry-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'session-vyzium'),{recursive:true});
 fs.writeFileSync(path.join(dir,'session-vyzium','preserve-auth'),'keep');
 fs.writeFileSync(path.join(dir,'auth-profile.json'),JSON.stringify({clientId:'vyzium'}));
 fs.writeFileSync(path.join(dir,'session-established.json'),JSON.stringify({established:true,clientId:'vyzium'}));
 let initializes=0;
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;}
   async initialize(){
     initializes++;
     if(initializes < 3) throw new Error('Protocol error (Runtime.callFunctionOn): Execution context was destroyed.');
   }
   async destroy(){this.destroyed=true;}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},browser:'/test/browser'
 });
 s.connect();
 await s.starting;
 assert.equal(initializes,3);
 assert.equal(fs.existsSync(path.join(dir,'session-vyzium','preserve-auth')),true);
 assert.equal(s.status().status,'starting');
 await s.shutdown();
});

test('stalled new-QR startup is watchdog-recovered with one fresh profile retry', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-watchdog-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const clients=[];
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;clients.push(this);}
   async initialize(){
     if(clients.length===1) return new Promise(()=>{});
     setTimeout(()=>this.emit('qr','fresh-qr'),5);
   }
   async destroy(){this.destroyed=true;}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,watchdog'},browser:'/test/browser',
   startupTimeoutMs:35
 });
 const firstId=s.authClientId;
 await s.newQr();
 const firstQrProfile=s.authClientId;
 assert.notEqual(firstQrProfile,firstId);
 await new Promise(r=>setTimeout(r,130));
 assert.equal(clients.length,2);
 assert.equal(clients[0].destroyed,true);
 assert.notEqual(s.authClientId,firstQrProfile);
 assert.equal(s.status().status,'qr');
 assert.equal(s.status().qr,'data:image/png;base64,watchdog');
 await s.shutdown();
});

test('explicit new QR cancels a stuck starting generation without waiting for initialize to finish', async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-cancel-start-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const clients=[];
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;clients.push(this);}
   async initialize(){
     if(clients.length===1) return new Promise(()=>{});
     setTimeout(()=>this.emit('qr','manual-retry'),5);
   }
   async destroy(){this.destroyed=true;}
 }
 const s=new WhatsAppSession(dir,{
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,manual'},browser:'/test/browser',
   startupTimeoutMs:5000
 });
 s.connect();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(s.status().status,'starting');
 const before=Date.now();
 await s.newQr();
 assert.ok(Date.now()-before < 500, 'newQr should not wait seconds for the stale initialize promise');
 await new Promise(r=>setTimeout(r,30));
 assert.equal(clients[0].destroyed,true);
 assert.equal(s.status().status,'qr');
 await s.shutdown();
});

test('renderer keeps Generate new QR available while startup is stuck',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','renderer/whatsapp.js'),'utf8');
 assert.match(source,/newQrButton\.disabled = data\.busy \|\| \['qr','authenticated'\]\.includes\(data\.status\)/);
 assert.doesNotMatch(source,/newQrButton\.disabled[^\n]*\['starting'/);
});

test('the WhatsApp panel exists once and is shared by both modules',()=>{
 const root=path.join(__dirname,'..');
 assert.equal(fs.existsSync(path.join(root,'renderer/compras-whatsapp.js')),false,
   'renderer/compras-whatsapp.js era uma cópia byte a byte de renderer/whatsapp.js');
 for(const page of ['renderer/acompanhamento.html','renderer/compras.html']){
   assert.match(fs.readFileSync(path.join(root,page),'utf8'),/<script src="whatsapp\.js"><\/script>/);
 }
});

test('o histórico oferece a liberação manual de um envio sem confirmação',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','renderer/app.js'),'utf8');
 // O listener de .review-followup existia, mas nenhuma linha do histórico
 // gerava o botão: um fornecedor marcado como "uncertain" ficava bloqueado
 // para sempre pela regra anti-spam, sem caminho de liberação na interface.
 assert.match(source,/class="button small secondary review-followup" data-id=/);
 assert.match(source,/uncertain: 'Conferir no WhatsApp'/);
 assert.doesNotMatch(source,/uncertain:'Enviado'/);
});

test('o lote expõe a fase de espera pela conexão',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','renderer/app.js'),'utf8');
 assert.match(source,/state\.phase === 'waiting'/);
});

test('separate local runtime directory is used only for Chromium LocalAuth profile', async t=>{
 const metadata=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-metadata-'));
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-runtime-'));
 t.after(()=>fs.rmSync(metadata,{recursive:true,force:true}));
 t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
 class Client extends EventEmitter {
   constructor(options){super();this.options=options;this.info={wid:{user:'5500000000000'}};}
   async initialize(){}
   async destroy(){}
 }
 const s=new WhatsAppSession(metadata,{
   profileDataDir:runtime,
   library:{Client,LocalAuth:class {constructor(options){this.options=options;}}},
   qrCode:{toDataURL:async()=> 'data:image/png;base64,test'},
   browser:'/test/browser'
 });
 s.connect(); await s.starting;
 assert.equal(s.client.options.authStrategy.options.dataPath,runtime);
 assert.equal(s.dataDir,metadata);
 assert.equal(s.profileDataDir,runtime);
 assert.match(s.diagnostics().text,/browser\.profile-storage/);
 await s.shutdown();
});

test('boot never destructively purges LocalAuth profiles merely because metadata is incomplete', t=>{
 const metadata=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-preserve-meta-'));
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-preserve-runtime-'));
 t.after(()=>fs.rmSync(metadata,{recursive:true,force:true}));
 t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
 fs.mkdirSync(path.join(metadata,'session-old-roaming'),{recursive:true});
 fs.mkdirSync(path.join(runtime,'session-old-local'),{recursive:true});
 fs.writeFileSync(path.join(metadata,'auth-profile.json'),JSON.stringify({clientId:'old'}));
 fs.writeFileSync(path.join(metadata,'keep.txt'),'keep');
 fs.writeFileSync(path.join(runtime,'keep-runtime.txt'),'keep');
 const s=new WhatsAppSession(metadata,{
   profileDataDir:runtime,
   library:{Client:class extends EventEmitter{},LocalAuth:class{}},
   qrCode:{toDataURL:async()=>''},browser:'/test/browser'
 });
 assert.equal(fs.existsSync(path.join(metadata,'session-old-roaming')),true);
 assert.equal(fs.existsSync(path.join(runtime,'session-old-local')),true);
 assert.equal(fs.existsSync(path.join(metadata,'auth-profile.json')),true);
 assert.equal(fs.readFileSync(path.join(metadata,'keep.txt'),'utf8'),'keep');
 assert.equal(fs.readFileSync(path.join(runtime,'keep-runtime.txt'),'utf8'),'keep');
 assert.equal(fs.existsSync(path.join(metadata,'session-state.json')),true);
 assert.ok(['old-roaming','old-local'].includes(s.authClientId));
});

test('established roaming LocalAuth profile migrates once to the local runtime root', t=>{
 const metadata=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-migrate-meta-'));
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-wa-migrate-runtime-'));
 t.after(()=>fs.rmSync(metadata,{recursive:true,force:true}));
 t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
 const id='vyzium-established';
 fs.writeFileSync(path.join(metadata,'auth-profile.json'),JSON.stringify({clientId:id}));
 fs.writeFileSync(path.join(metadata,'session-established.json'),JSON.stringify({established:true,clientId:id}));
 fs.mkdirSync(path.join(metadata,`session-${id}`),{recursive:true});
 fs.writeFileSync(path.join(metadata,`session-${id}`,'token'),'preserve');
 const s=new WhatsAppSession(metadata,{
   profileDataDir:runtime,
   library:{Client:class extends EventEmitter{},LocalAuth:class{}},
   qrCode:{toDataURL:async()=>''},browser:'/test/browser'
 });
 assert.equal(s.firstConnectionPending,false);
 assert.equal(s.authClientId,id);
 assert.equal(fs.existsSync(path.join(metadata,`session-${id}`)),false);
 assert.equal(fs.readFileSync(path.join(runtime,`session-${id}`,'token'),'utf8'),'preserve');
 assert.match(s.diagnostics().text,/profile\.runtime-migrated/);
});


