const {test} = require('node:test');
const assert = require('node:assert/strict');
const {FirebaseClient, encodeValue, decodeValue} = require('../electron/firebase-client');

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

test('Firebase client signs in with configured project API key without admin credentials', async () => {
  const calls = [];
  const client = new FirebaseClient({fetchImpl: async (url, opts) => {
    calls.push({url, opts});
    return response(200, {localId:'uid-1', idToken:'id-token', refreshToken:'refresh', expiresIn:'3600'});
  }});
  const result = await client.signIn({email:'USER@Example.com ', password:'secret'});
  assert.equal(result.localId, 'uid-1');
  assert.match(calls[0].url, /identitytoolkit\.googleapis\.com/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.email, 'user@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'serviceAccount'), false);
});

test('Firestore value codec preserves nested recovery envelope fields', () => {
  const source = {version:1, active:true, nested:{name:'Vyzium'}, list:['a', 2]};
  assert.deepEqual(decodeValue(encodeValue(source)), source);
});

test('unknown Firebase errors do not expose successful access', async () => {
  const client = new FirebaseClient({fetchImpl: async () => response(403, {error:{message:'PERMISSION_DENIED'}})});
  await assert.rejects(() => client.firestoreGet('users/x', 'bad-token'));
});

test('first workspace is deterministic from Firebase UID and recovery stays inside that workspace', async () => {
  const docs = new Map();
  const commits = [];
  const client = new FirebaseClient({fetchImpl: async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const marker = '/documents/';
    if (method === 'GET' && url.includes(marker)) {
      const path = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
      const fields = docs.get(path);
      return fields ? response(200, {name:path, fields}) : response(404, {error:{message:'NOT_FOUND'}});
    }
    if (url.endsWith('/documents:commit') && method === 'POST') {
      const body = JSON.parse(opts.body);
      commits.push(body);
      for (const write of body.writes || []) {
        const prefix = '/documents/';
        const name = write.update.name;
        const path = name.slice(name.indexOf(prefix) + prefix.length);
        const fields = {...write.update.fields};
        for (const transform of write.updateTransforms || []) {
          if (transform.setToServerValue === 'REQUEST_TIME') {
            fields[transform.fieldPath] = {timestampValue:'2026-09-19T22:00:00Z'};
          }
        }
        docs.set(path, fields);
      }
      return response(200, {writeResults:[]});
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }});

  const result = await client.ensureProfileAndWorkspace({
    uid:'uid-1', email:'USER@EXAMPLE.COM', displayName:'Levi', idToken:'token'
  });
  assert.equal(result.workspaceId, 'uid-1');
  assert.equal(docs.has('users/uid-1'), true);
  assert.equal(docs.has('workspaces/uid-1'), true);
  assert.equal(docs.has('workspaces/uid-1/members/uid-1'), true);

  const envelope = {
    version:1, algorithm:'AES-256-GCM', kdf:'scrypt-N16384-r8-p1',
    salt:'salt', iv:'iv', ciphertext:'ciphertext', tag:'tag'
  };
  await client.putRecoveryEnvelope('uid-1', envelope, 'token');
  assert.equal(docs.has('workspaces/uid-1/keyRecovery/current'), true);

  // Updating an existing document must carry an exists=true precondition so a
  // patch cannot accidentally turn into an implicit create.
  await client.putRecoveryEnvelope('uid-1', {...envelope, ciphertext:'ciphertext2'}, 'token');
  const lastWrite = commits.at(-1).writes[0];
  assert.deepEqual(lastWrite.currentDocument, {exists:true});
});
