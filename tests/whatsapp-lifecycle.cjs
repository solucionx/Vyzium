'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WhatsAppSession}=require('../electron/whatsapp');
const tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(t, extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-lifecycle-'));
 const clients=[];
 class Client extends EventEmitter{
  constructor(options){super();this.options=options;clients.push(this);}
  async initialize(){}
  async destroy(){this.destroyed=true;}
 }
 const s=new WhatsAppSession(dir,{platform:'linux',browser:'/fake',library:{Client,LocalAuth:class{constructor(o){this.options=o;}}},qrCode:{toDataURL:async()=> 'qr'},...extra});
 t.after(async()=>{await s.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
 return {s,dir,clients};
}
test('late hidden launcher cannot replace the client after shutdown',async t=>{
 const launch=deferred();let stopped=0;
 const {s,clients}=fixture(t,{forcePreShowGuard:true,launchHiddenHeadedBrowser:()=>launch.promise,stopHiddenHeadedBrowser:async()=>{stopped++;}});
 const pending=s._connectInternal();await tick();await s.shutdown();
 launch.resolve({endpoint:'ws://127.0.0.1:1/devtools/browser/x',pid:42});await pending;
 assert.equal(clients.length,0);assert.equal(s.client,null);assert.equal(stopped,1);
});
test('pause during new QR disposal wins and preserves the selected profile',async t=>{
 const {s}=fixture(t);await s._connectInternal();const original=s.authClientId;
 const disposed=deferred();s.client.destroy=()=>disposed.promise;
 const pending=s.newQr();await tick();await s.pause();disposed.resolve();await pending;
 assert.equal(s.authClientId,original);assert.equal(s.state.status,'paused');
});
test('logout cleanup cannot overwrite a newer QR generation',async t=>{
 const {s}=fixture(t);await s._connectInternal();const old=s.client;
 const disposed=deferred();old.destroy=()=>disposed.promise;
 const cleanup=s._cleanupAfterLogout(old,s.generation);await tick();await s.newQr();
 const selected=s.authClientId;disposed.resolve();await cleanup;
 assert.equal(s.authClientId,selected);assert.equal(s.sessionState.pendingClientId,selected);
});
test('authenticated but unresolved initialize is bounded by its own watchdog',async t=>{
 const {s}=fixture(t,{authenticatedTimeoutMs:25});
 s.deps.library.Client.prototype.initialize=function(){queueMicrotask(()=>this.emit('authenticated'));return new Promise(()=>{});};
 s.connect();await tick();let recovered=0;
 s.restartConnection=async()=>{recovered++;};
 await new Promise(r=>setTimeout(r,65));assert.equal(recovered,1);
});
test('a profile that authenticated is never eligible for automatic quarantine',async t=>{
 const {s}=fixture(t);await s._connectInternal();s.client.emit('authenticated');
 assert.equal(s._canRepairPendingProfile('storage'),false);
});
test('failed ready metadata write still protects the live profile',async t=>{
 const {s}=fixture(t);await s._connectInternal();s._markSessionEstablished=()=>{throw new Error('EACCES');};
 s.client.emit('ready');s.state.status='starting';assert.equal(s._canRepairPendingProfile('storage'),false);
});
test('an old QR encoder rejection cannot change the new generation',async t=>{
 let reject;const {s}=fixture(t,{qrCode:{toDataURL:()=>new Promise((_,r)=>reject=r)}});
 await s._connectInternal();s.client.emit('qr','old');await s.newQr();
 reject(new Error('obsolete'));await tick();assert.equal(s.state.error,null);
});
test('repeated startup failures enter cooldown that survives process restart',async t=>{
 const {s,dir}=fixture(t,{maxRecoveryCycles:2,recoveryCooldownMs:60000});
 s._initializeWithRecovery=async()=>{throw new Error('blocked');};
 await assert.rejects(s._connectInternal());s._clearReconnectTimer();
 await assert.rejects(s._connectInternal());s._clearReconnectTimer();
 assert.ok(s.selfHeal.nextRetryAt>Date.now());
 const restarted=new WhatsAppSession(dir,{platform:'linux',browser:'/fake'});
 assert.ok(restarted.selfHeal.nextRetryAt>Date.now());await restarted.shutdown();
});

test('failed cross-volume profile copy never publishes a partial runtime profile', t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-profile-copy-'));
 const metadata=path.join(root,'metadata'),runtime=path.join(root,'runtime');
 fs.mkdirSync(path.join(metadata,'session-saved'),{recursive:true});fs.mkdirSync(runtime);
 fs.writeFileSync(path.join(metadata,'session-saved','credentials'),'preserved');
 fs.writeFileSync(path.join(metadata,'session-state.json'),JSON.stringify({schemaVersion:1,activeClientId:'saved',state:'established'}));
 const rename=fs.renameSync,cp=fs.cpSync;
 fs.renameSync=(from,to)=>{if(from===path.join(metadata,'session-saved'))throw new Error('EXDEV');return rename(from,to);};
 fs.cpSync=(from,to)=>{fs.mkdirSync(to,{recursive:true});fs.writeFileSync(path.join(to,'partial'),'incomplete');throw new Error('EACCES');};
 let s;
 try{s=new WhatsAppSession(metadata,{profileDataDir:runtime});}
 finally{fs.renameSync=rename;fs.cpSync=cp;}
 t.after(async()=>{await s.shutdown();fs.rmSync(root,{recursive:true,force:true});});
 assert.equal(fs.existsSync(path.join(runtime,'session-saved')),false);
 assert.equal(s.profileDataDir,metadata);
 assert.equal(fs.readFileSync(path.join(metadata,'session-saved','credentials'),'utf8'),'preserved');
});

test('dispose clears the audit timer even if initialize never resolves',async t=>{
 const {s}=fixture(t);s.deps.library.Client.prototype.initialize=()=>new Promise(()=>{});
 s.connect();await tick();const old=s.client;assert.ok(old.__vyziumAuditTimer);
 await s.pause();assert.equal(old.__vyziumAuditTimer,null);assert.equal(s.starting,null);
});

test('fatal storage rejection repairs a pending profile without needing a console event',async t=>{
 const {s,clients}=fixture(t);let attempts=0;
 s.deps.library.Client.prototype.initialize=async function(){if(++attempts===1)throw new Error('storage_initialization_error');this.emit('qr','repaired');};
 await s._connectInternal();await tick();assert.equal(clients.length,2);assert.equal(s.state.status,'qr');
 assert.equal(s.selfHeal.destructiveRecoveryUsed,true);
});

test('auth failure can retire a hung initialize and unblock recovery',async t=>{
 const {s}=fixture(t);s.deps.library.Client.prototype.initialize=()=>new Promise(()=>{});
 s.connect();await tick();s.sessionState.activeClientId=s.authClientId;
 const failed=s.client;failed.emit('auth_failure','temporary');await tick();
 assert.equal(failed.destroyed,true);assert.equal(s.starting,null);assert.ok(s.reconnectTimer);
});

test('network disconnect can retire a hung initialize and unblock recovery',async t=>{
 const {s}=fixture(t);s.deps.library.Client.prototype.initialize=()=>new Promise(()=>{});
 s.connect();await tick();const failed=s.client;failed.emit('disconnected','NETWORK');await tick();
 assert.equal(failed.destroyed,true);assert.equal(s.starting,null);assert.ok(s.reconnectTimer);
});

test('automatic queue polling does not bypass startup cooldown',async t=>{
 const {s}=fixture(t);const until=Date.now()+60000;
 s.selfHeal.nextRetryAt=until;s.state={status:'error',error:'cooldown'};
 await assert.rejects(s.waitReady(10));assert.equal(s.selfHeal.nextRetryAt,until);assert.equal(s.client,null);
});

test('late health response cannot override pause or count duplicate failures',async t=>{
 const {s}=fixture(t,{healthFailureThreshold:1});await s._connectInternal();s.client.emit('ready');
 const health=deferred();let calls=0;s.client.getState=()=>{calls++;return health.promise;};
 const first=s.backgroundHealthCheck(),second=s.backgroundHealthCheck();
 await s.pause();health.resolve('DISCONNECTED');await Promise.all([first,second]);
 assert.equal(calls,1);assert.equal(s.state.status,'paused');assert.equal(s.consecutiveHealthFailures,0);
});

test('shutdown promptly releases bridge callers waiting for readiness',async t=>{
 const {s}=fixture(t);const waiting=assert.rejects(s.waitReady(5000),/cancelada/);
 await tick();await s.shutdown();await waiting;
});
