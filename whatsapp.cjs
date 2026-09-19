const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {WhatsAppSession, startBridge, phoneCandidates} = require('../electron/whatsapp');

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
    async initialize() {}
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

test('dedicated persistent profile, headless mode, QR, ready and session reuse',async t=>{
 const s=setup(t);s.connect();await s.starting;
 assert.equal(s.client.options.puppeteer.headless,true);
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
