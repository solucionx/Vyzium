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

test('never sends before ready; waits for readiness and requires server ACK', async t=>{
 const s=setup(t);s.connect();await s.starting;
 assert.equal((await s.send('+5585999999999','test')).status,'failed');
 const wait=s.waitReady(1000);
 s.client.emit('ready');assert.equal((await wait).ready,true);
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,1);
 assert.equal(s.client.sent,1);
 assert.ok(s.status().lastAckAt);
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
 assert.equal(s.status().status,'error');
});

test('delivery is confirmed by reloading the sent message when message_ack event is missed',async t=>{
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
 assert.equal(result.ack,2);
 assert.equal(s.status().status,'ready');
 assert.ok(s.status().lastAckAt);
});

test('delivery is confirmed immediately when sendMessage already returns ACK',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>({id:{_serialized:'already-confirmed-message'},ack:1});
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'sent');
 assert.equal(result.ack,1);
 assert.equal(s.status().status,'ready');
});

test('message id without server ACK is never recorded as sent',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>({id:{_serialized:'ghost-message'}});
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'uncertain');
 assert.match(result.error,/não confirmado/i);
 assert.equal(s.status().status,'error');
});

test('negative ACK is treated as uncertain and connection is reset',async t=>{
 const s=setup(t);s.connect();await s.starting;s.client.emit('ready');
 s.client.sendMessage=async()=>{
   const msg={id:{_serialized:'rejected-message'}};
   queueMicrotask(()=>s.client.emit('message_ack',msg,-1));
   return msg;
 };
 const result=await s.send('+5585999999999','test');
 assert.equal(result.status,'uncertain');
 assert.equal(s.status().status,'error');
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
