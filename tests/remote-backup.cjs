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
      return {status:200, body:Buffer.from(JSON.stringify({status:'stored'}))};
    }
    if (args.method === 'GET' && args.route === '/v1/backups') {
      return {status:200, body:Buffer.from(JSON.stringify({backups:[{...stored,created_ms:12345}]}))};
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

  const result = await manager.upload(snapshots, {appVersion:'3.3.7'});
  assert.equal(result.uploaded, true);
  assert.equal(result.modules.length, 2);
  assert.equal(result.id, stored.id);
  assert.equal(result.bytes, stored.bytes);
  assert.deepEqual(calls.map(call => call.method + ' ' + call.route.split('/').slice(0,3).join('/')), [
    'GET /v1/access',
    'PUT /v1/backups',
    'GET /v1/backups'
  ]);
  assert.equal(fs.readdirSync(path.join(dir,'transfer')).length, 0);
  key.fill(0);
});

test('pending Poco approval returns safely without creating an upload request', async () => {
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
