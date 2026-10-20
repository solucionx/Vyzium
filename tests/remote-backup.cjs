'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  BUNDLE_MAGIC,
  ENVELOPE_MAGIC,
  RemoteBackupManager,
  buildBundleFile,
  sealBundleFile,
  unsealEnvelopeFile,
  extractBundleFile,
  sha256File,
  responseError
} = require('../electron/remote-backup');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-remote-backup-'));
}

function decryptEnvelope(blob, key, uid) {
  assert.deepEqual(blob.subarray(0, 4), ENVELOPE_MAGIC);
  const nonce = blob.subarray(4, 16);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(16, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from('vyzium-backup-v1|' + uid, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function parseBundle(buffer) {
  assert.deepEqual(buffer.subarray(0, 4), BUNDLE_MAGIC);
  const headerLength = buffer.readUInt32BE(4);
  const header = JSON.parse(buffer.subarray(8, 8 + headerLength).toString('utf8'));
  let offset = 8 + headerLength;
  const files = [];
  for (const entry of header.files) {
    const bytes = buffer.subarray(offset, offset + entry.size_bytes);
    files.push({entry, bytes});
    offset += entry.size_bytes;
  }
  assert.equal(offset, buffer.length);
  return {header, files};
}

test('VZB1 envelope matches the Android server reference contract exactly', async t => {
  const dir = tmpdir(); t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const source = path.join(dir, 'followup.db');
  fs.writeFileSync(source, Buffer.from('encrypted-sqlcipher-snapshot-test'));
  const sourceHash = await sha256File(source);
  const bundlePath = path.join(dir, 'bundle.vyb');
  const envelopePath = path.join(dir, 'bundle.vzb');
  const uid = 'testUid_123456';
  const key = crypto.randomBytes(32);

  const bundle = await buildBundleFile([{
    module:'followup', path:source, filename:'followup.db',
    size_bytes:fs.statSync(source).size, sha256:sourceHash, encrypted:true
  }], bundlePath, {uid, appVersion:'3.3.7'});

  const envelope = await sealBundleFile(bundlePath, envelopePath, key, uid);
  const blob = fs.readFileSync(envelopePath);
  assert.equal(blob.length, bundle.size_bytes + 32);
  assert.equal(envelope.id, crypto.createHash('sha256').update(blob).digest('hex'));

  const plaintext = decryptEnvelope(blob, key, uid);
  const parsed = parseBundle(plaintext);
  assert.equal(parsed.header.format, 'VYB1');
  assert.equal(parsed.header.workspace_id, uid);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].entry.module, 'followup');
  assert.equal(parsed.files[0].entry.sha256, sourceHash);
  assert.deepEqual(parsed.files[0].bytes, fs.readFileSync(source));
  key.fill(0);
});

test('combined backup uploads exact envelope bytes then verifies the object in server list', async t => {
  const dir = tmpdir(); t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const followup = path.join(dir, 'followup.db');
  const compras = path.join(dir, 'compras.sqlite3');
  fs.writeFileSync(followup, crypto.randomBytes(2048));
  fs.writeFileSync(compras, crypto.randomBytes(1024));
  const snapshots = [
    {module:'followup', path:followup, filename:'followup.db', size_bytes:2048, sha256:await sha256File(followup), encrypted:true},
    {module:'compras', path:compras, filename:'compras.sqlite3', size_bytes:1024, sha256:await sha256File(compras), encrypted:true}
  ];
  const uid = 'testUser_987654';
  const key = crypto.randomBytes(32);
  const calls = [];
  let stored = null;

  const requestFn = async args => {
    calls.push({method:args.method, route:args.route, bodyLength:args.bodyLength || 0});
    if (args.method === 'GET' && args.route === '/v1/access/status') {
      return {status:200, body:Buffer.from(JSON.stringify({state:'active',authorized:true}))};
    }
    if (args.method === 'PUT') {
      const body = fs.readFileSync(args.bodyPath);
      assert.equal(body.length, args.bodyLength);
      assert.deepEqual(body.subarray(0,4), ENVELOPE_MAGIC);
      const id = crypto.createHash('sha256').update(body).digest('hex');
      assert.equal(args.route, '/v1/backups/' + id);
      stored = {id, bytes:body.length};
      return {status:200, body:Buffer.from(JSON.stringify({status:'created',classification:'current',head_id:id}))};
    }
    if (args.method === 'GET' && args.route === '/v1/backups') {
      return {status:200, body:Buffer.from(JSON.stringify({
        head_id:stored?.id || null,
        retention:3,
        backups:stored?[{...stored,created_ms:12345,role:'current',parent_id:null}]:[]
      }))};
    }
    throw new Error('unexpected request');
  };

  const manager = new RemoteBackupManager({
    tempRoot:path.join(dir,'transfer'),
    getToken:async()=>'token-without-whitespace-1234567890',
    getUid:()=>uid,
    withBackupKey:async callback=>callback(key),
    requestFn
  });

  const result = await manager.upload(snapshots, {appVersion:'3.4.0-rc.1',deviceId:'device-test-87654321'});
  assert.equal(result.uploaded, true);
  assert.equal(result.modules.length, 2);
  assert.equal(result.id, stored.id);
  assert.equal(result.bytes, stored.bytes);
  assert.deepEqual(calls.map(call => call.method + ' ' + call.route.split('/').slice(0,3).join('/')), [
    'GET /v1/access',
    'GET /v1/backups',
    'PUT /v1/backups',
    'GET /v1/backups'
  ]);
  assert.equal(fs.readdirSync(path.join(dir,'transfer')).length, 0);
  key.fill(0);
});

test('3.4 refuses uploads to a server that does not advertise lineage retention', async t => {
  const dir=tmpdir();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'followup.db');fs.writeFileSync(source,crypto.randomBytes(256));
  const snapshot={module:'followup',path:source,filename:'followup.db',size_bytes:256,sha256:await sha256File(source),encrypted:true};
  let putCalled=false;
  const manager=new RemoteBackupManager({
    tempRoot:path.join(dir,'transfer'),
    getToken:()=> 'token-without-whitespace-1234567890',
    getUid:()=> 'legacyServerUser_123456',
    withBackupKey:async cb=>cb(crypto.randomBytes(32)),
    requestFn:async args=>{
      if(args.route==='/v1/access/status')return{status:200,body:Buffer.from(JSON.stringify({state:'active',authorized:true}))};
      if(args.route==='/v1/backups'&&args.method==='GET')return{status:200,body:Buffer.from(JSON.stringify({backups:[]}))};
      if(args.method==='PUT'){putCalled=true;throw new Error('must not upload');}
      throw new Error('unexpected');
    }
  });
  await assert.rejects(()=>manager.upload([snapshot],{appVersion:'3.4.0-rc.1',deviceId:'device-test-87654321'}),error=>error?.code==='BACKUP_SERVER_UPGRADE_REQUIRED');
  assert.equal(putCalled,false);
});

test('lineage metadata prevents a divergent upload from being reported as promoted', async t => {
  const dir=tmpdir();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'followup.db');fs.writeFileSync(source,crypto.randomBytes(512));
  const snapshot={module:'followup',path:source,filename:'followup.db',size_bytes:512,sha256:await sha256File(source),encrypted:true};
  const uid='lineageUser_123456',key=crypto.randomBytes(32);
  const head='a'.repeat(64),parent='b'.repeat(64);let candidate=null;
  const requestFn=async args=>{
    if(args.route==='/v1/access/status')return{status:200,body:Buffer.from(JSON.stringify({state:'active',authorized:true}))};
    if(args.method==='PUT'){
      assert.equal(args.extraHeaders['X-Vyzium-Parent'],parent);
      assert.match(args.extraHeaders['X-Vyzium-Device'],/^device-/);
      const body=fs.readFileSync(args.bodyPath);candidate=crypto.createHash('sha256').update(body).digest('hex');
      return{status:200,body:Buffer.from(JSON.stringify({status:'stored',classification:'divergent',head_id:head}))};
    }
    if(args.route==='/v1/backups')return{status:200,body:Buffer.from(JSON.stringify({head_id:head,retention:3,backups:[
      {id:head,bytes:999,created_ms:10,role:'current'},
      {id:candidate,bytes:fs.statSync(args._never||source).size,created_ms:11,role:'divergent',parent_id:parent}
    ]}))};
    throw new Error('unexpected');
  };
  // Candidate bytes in list must equal the generated envelope, so capture them.
  let candidateBytes=0;
  const wrappedRequest=async args=>{
    if(args.method==='PUT'){candidateBytes=args.bodyLength;const r=await requestFn(args);return r;}
    if(args.route==='/v1/backups'){
      return{status:200,body:Buffer.from(JSON.stringify({head_id:head,retention:3,backups:[
        {id:head,bytes:1000,created_ms:10,role:'current'},
        {id:candidate,bytes:candidateBytes,created_ms:11,role:'divergent',parent_id:parent}
      ]}))};
    }
    return requestFn(args);
  };
  const manager=new RemoteBackupManager({
    tempRoot:path.join(dir,'transfer'),getToken:()=> 'token-without-whitespace-1234567890',getUid:()=>uid,
    withBackupKey:async cb=>cb(key),requestFn:wrappedRequest
  });
  const result=await manager.upload([snapshot],{appVersion:'3.4.0-rc.1',parentId:parent,deviceId:'device-test-12345678'});
  assert.equal(result.classification,'divergent');
  assert.equal(result.promoted,false);
  assert.equal(result.head_id,head);
  key.fill(0);
});

test('downloaded VZB1 is authenticated and extracted only after hashes validate', async t => {
  const dir=tmpdir();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'followup.db');fs.writeFileSync(source,crypto.randomBytes(900));
  const bundlePath=path.join(dir,'source.vyb'),envelopePath=path.join(dir,'source.vzb');
  const uid='restoreUser_123456',key=crypto.randomBytes(32);
  const bundle=await buildBundleFile([{module:'followup',path:source,filename:'followup.db',size_bytes:900,sha256:await sha256File(source),encrypted:true}],bundlePath,{uid,appVersion:'3.4.0-rc.1'});
  const envelope=await sealBundleFile(bundlePath,envelopePath,key,uid);
  const manager=new RemoteBackupManager({
    tempRoot:path.join(dir,'transfer'),getToken:()=> 'token-without-whitespace-1234567890',getUid:()=>uid,
    withBackupKey:async cb=>cb(key),
    requestFn:async args=>{
      if(args.route==='/v1/access/status')return{status:200,body:Buffer.from(JSON.stringify({state:'active',authorized:true}))};
      if(args.route==='/v1/backups')return{status:200,body:Buffer.from(JSON.stringify({head_id:envelope.id,retention:3,backups:[{id:envelope.id,bytes:envelope.size_bytes,created_ms:1,role:'current'}]}))};
      throw new Error('unexpected');
    },
    downloadFn:async ({outputPath,expectedId})=>{
      assert.equal(expectedId,envelope.id);fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.copyFileSync(envelopePath,outputPath);
      return{path:outputPath,id:envelope.id,bytes:envelope.size_bytes};
    }
  });
  const restored=await manager.downloadExtract(envelope.id);
  assert.equal(restored.files.length,1);
  assert.deepEqual(fs.readFileSync(restored.files[0].path),fs.readFileSync(source));
  assert.equal(fs.existsSync(path.join(restored.dir,envelope.id+'.vzb')),false);
  await manager.cleanupExtracted(restored.dir);
  key.fill(0);
});

test('tampered VZB1 fails authenticated decryption before any database can be restored', async t => {
  const dir=tmpdir();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bundle=path.join(dir,'b.vyb'),env=path.join(dir,'e.vzb'),out=path.join(dir,'out.vyb');
  fs.writeFileSync(bundle,Buffer.from('VYB1-not-a-real-bundle-but-encryption-test'));
  const key=crypto.randomBytes(32),uid='tamperUser_123456';
  await sealBundleFile(bundle,env,key,uid);
  const blob=fs.readFileSync(env);blob[20]^=0xff;fs.writeFileSync(env,blob);
  await assert.rejects(()=>unsealEnvelopeFile(env,out,key,uid),/autenticação criptográfica/i);
  key.fill(0);
});

test('pending server approval returns safely without creating an upload request', async () => {
  const calls = [];
  const manager = new RemoteBackupManager({
    tempRoot:os.tmpdir(),
    getToken:()=> 'token-without-whitespace-1234567890',
    getUid:()=> 'pendingUser_123456',
    withBackupKey:async callback=>callback(crypto.randomBytes(32)),
    requestFn:async args => {
      calls.push(args);
      return {status:200, body:Buffer.from(JSON.stringify({state:'pending',authorized:false}))};
    }
  });
  const result = await manager.upload([{module:'followup',path:'never-used'}]);
  assert.equal(result.uploaded, false);
  assert.equal(result.state, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, '/v1/access/status');
});

test('RC4 409 diagnostics preserve server code and request correlation id', () => {
  const error = responseError(409, Buffer.from(JSON.stringify({
    error:'Backup rejected (BACKUP_CHECKSUM_MISMATCH)',
    code:'BACKUP_CHECKSUM_MISMATCH',
    request_id:'request-123'
  })));
  assert.equal(error.status, 409);
  assert.equal(error.code, 'BACKUP_CHECKSUM_MISMATCH');
  assert.equal(error.requestId, 'request-123');
  assert.match(error.message, /servidor rejeitou/i);
});

async function exportFixture(t) {
  const dir = tmpdir(); t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const uid = 'exportUser_123456', key = crypto.randomBytes(32);
  const source = path.join(dir, 'live.db');
  const original = crypto.randomBytes(1024); fs.writeFileSync(source, original);
  await buildBundleFile([{module:'followup',path:source,encrypted:true}], path.join(dir,'bundle'), {uid});
  const envelope = await sealBundleFile(path.join(dir,'bundle'), path.join(dir,'object'), key, uid);
  const bytes = fs.readFileSync(envelope.path);
  const current = {id:envelope.id,bytes:bytes.length,created_ms:100,role:'current'};
  const payload = {head_id:current.id,retention:3,backups:[{id:'f'.repeat(64),bytes:64,created_ms:999,role:'divergent'},current]};
  const calls = [];
  const manager = new RemoteBackupManager({tempRoot:path.join(dir,'temp'),getUid:()=>uid,getToken:()=> 'token-export',
    withBackupKey:fn=>fn(key),requestFn:async args=>{calls.push(args);return {status:200,body:Buffer.from(JSON.stringify(payload))};},
    downloadFn:async args=>{calls.push(args);assert.equal(args.expectedId,envelope.id);fs.writeFileSync(args.outputPath,bytes);return {path:args.outputPath,bytes:bytes.length};}});
  return {dir,source,original,key,bytes,current,payload,calls,manager,destination:path.join(dir,'downloads')};
}

test('download latest exports validated HEAD, ignores newer divergent candidate and preserves live data and previous copies', async t => {
  const f = await exportFixture(t);
  const first = await f.manager.downloadLatest(f.destination);
  const second = await f.manager.downloadLatest(f.destination);
  assert.equal(first.path,second.path);
  assert.equal(second.reused,true);
  assert.deepEqual(fs.readFileSync(first.path),f.bytes);
  assert.deepEqual(fs.readFileSync(second.path),f.bytes);
  assert.deepEqual(fs.readFileSync(f.source),f.original);
  assert.equal(fs.readdirSync(f.destination).length,1);
  assert.deepEqual(fs.readdirSync(path.dirname(first.path)),[f.current.id+'.vzb']);
  assert.ok(f.calls.every(c=>!c.method || c.method==='GET'));
});

test('modern catalog without HEAD never promotes a divergent file through timestamp fallback', async t => {
  const f = await exportFixture(t); f.payload.head_id=null; f.payload.backups=[f.payload.backups[0]];
  await assert.rejects(f.manager.downloadLatest(f.destination),{code:'BACKUP_CURRENT_MISSING'});
  assert.equal(f.calls.length,1);
  assert.equal(fs.existsSync(f.destination),false);
});

test('download fails closed when HEAD is missing from listing', async t => {
  const f = await exportFixture(t); f.payload.head_id='a'.repeat(64);
  await assert.rejects(f.manager.downloadLatest(f.destination),{code:'BACKUP_CURRENT_MISSING'});
});

test('corrupt, truncated and wrong-key downloads leave no published copy and preserve live data', async t => {
  for (const mode of ['corrupt','truncated','key','offline']) {
    const f = await exportFixture(t);
    if (mode==='key') f.key.fill(0);
    else f.manager.downloadFn=async args=>{
      if (mode==='offline') throw new Error('offline');
      const data=Buffer.from(f.bytes);data[20]^=1;
      fs.writeFileSync(args.outputPath,mode==='truncated'?data.subarray(0,40):data);
    };
    await assert.rejects(f.manager.downloadLatest(f.destination));
    assert.deepEqual(fs.readdirSync(f.destination),[]);
    assert.deepEqual(fs.readFileSync(f.source),f.original);
  }
});

test('GET downloader never removes an existing destination', async t => {
  const {requestRemoteToFile}=require('../electron/remote-backup');
  const f=await exportFixture(t);
  await assert.rejects(requestRemoteToFile({route:'/v1/backups/'+f.current.id,token:'token-export',expectedId:f.current.id,outputPath:f.source}),{code:'EEXIST'});
  assert.deepEqual(fs.readFileSync(f.source),f.original);
});

test('stream downloader validates persisted bytes and cleans up interrupted transfers', async t => {
  const https=require('node:https');
  const {Readable}=require('node:stream');
  const {EventEmitter}=require('node:events');
  const {requestRemoteToFile}=require('../electron/remote-backup');
  const f=await exportFixture(t);
  for (const mode of ['valid','truncated','corrupt','interrupted','unauthorized']) {
    const data=Buffer.from(f.bytes);if(mode==='corrupt')data[20]^=1;
    const response= mode==='interrupted' ? Readable.from((async function*(){yield data.subarray(0,20);throw new Error('disconnect');})()) : Readable.from([mode==='truncated'?data.subarray(0,20):data]);
    response.statusCode=mode==='unauthorized'?403:200;
    response.headers={'content-length':String(data.length)};
    const mock=t.mock.method(https,'request',(_opts,callback)=>{
      const req=new EventEmitter();req.end=()=>callback(response);req.destroy=()=>{};return req;
    });
    const outputPath=path.join(f.dir,mode+'.vzb');
    const run=requestRemoteToFile({route:'/v1/backups/'+f.current.id,token:'token-export',expectedId:f.current.id,outputPath});
    if(mode==='valid'){await run;assert.deepEqual(fs.readFileSync(outputPath),f.bytes);}
    else {await assert.rejects(run);assert.equal(fs.existsSync(outputPath),false);}
    mock.mock.restore();
  }
});

test('simultaneous download clicks share one transfer and one copy', async t=>{
  const f=await exportFixture(t);
  const results=await Promise.all([f.manager.downloadLatest(f.destination),f.manager.downloadLatest(f.destination)]);
  assert.equal(results[0].path,results[1].path);
  assert.equal(f.calls.filter(c=>c.outputPath).length,1);
});

test('retention keeps three verified downloads and preserves unknown and corrupt files',async t=>{
  const {pruneDownloads,downloadedCopies}=require('../electron/storage-retention');
  const f=await exportFixture(t);fs.mkdirSync(f.destination);
  const paths=[];
  for(let i=0;i<5;i++) {
    const data=Buffer.concat([Buffer.from('VZB1'),crypto.randomBytes(50)]);
    const id=crypto.createHash('sha256').update(data).digest('hex');
    const dir=path.join(f.destination,`backup-${i}-${'a'.repeat(24)}`);fs.mkdirSync(dir);
    const file=path.join(dir,id+'.vzb');fs.writeFileSync(file,data);fs.utimesSync(file,i+1,i+1);paths.push(file);
  }
  const odd=path.join(f.destination,'my-database.db');fs.writeFileSync(odd,'keep');
  const badDir=path.join(f.destination,'backup-7-'+ 'b'.repeat(24));fs.mkdirSync(badDir);
  const bad=path.join(badDir,'c'.repeat(64)+'.vzb');fs.writeFileSync(bad,Buffer.alloc(40));
  await pruneDownloads(f.destination,paths[4]);
  assert.equal((await downloadedCopies(f.destination)).length,3);
  assert.equal(fs.existsSync(paths[0]),false);assert.equal(fs.existsSync(paths[4]),true);
  assert.equal(fs.readFileSync(odd,'utf8'),'keep');assert.equal(fs.existsSync(bad),true);
});

test('partial cleanup removes only stale recognized download files, preserving recent and unknown files',async t=>{
  const {cleanDownloadPartials}=require('../electron/storage-retention');
  const f=await exportFixture(t);fs.mkdirSync(f.destination);
  for(const suffix of ['old123','new123','odd123']){
    const dir=path.join(f.destination,'.partial-'+suffix);fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,suffix==='odd123'?'database.db':'workspace.vyb'),'keep');
    if(suffix!=='new123')fs.utimesSync(dir,1,1);
  }
  await cleanDownloadPartials(f.destination);
  assert.equal(fs.existsSync(path.join(f.destination,'.partial-old123')),false);
  assert.equal(fs.existsSync(path.join(f.destination,'.partial-new123')),true);
  assert.equal(fs.existsSync(path.join(f.destination,'.partial-odd123','database.db')),true);
});

test('a failed replacement preserves existing downloads and does not trigger retention',async t=>{
  const f=await exportFixture(t);
  const first=await f.manager.downloadLatest(f.destination);
  f.payload.head_id='d'.repeat(64);
  f.payload.backups=[{id:f.payload.head_id,bytes:80,created_ms:200,role:'current'}];
  f.manager.downloadFn=async()=>{throw new Error('network unavailable');};
  await assert.rejects(f.manager.downloadLatest(f.destination));
  assert.deepEqual(fs.readFileSync(first.path),f.bytes);
  assert.equal(fs.readdirSync(f.destination).length,1);
});
