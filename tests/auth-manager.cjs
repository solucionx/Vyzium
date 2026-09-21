'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AuthManager } = require('../electron/auth-manager');
const { FirebaseError } = require('../electron/firebase-client');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`dpapi:${value}`, 'utf8'),
  decryptString: buffer => {
    const value = buffer.toString('utf8');
    if (!value.startsWith('dpapi:')) throw new Error('invalid protected value');
    return value.slice(6);
  }
};

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-auth-')); }

function loginFirebase({verified = true} = {}) {
  return {
    signIn: async () => ({localId:'uid-1', idToken:'id-token', refreshToken:'refresh-secret', expiresIn:'3600'}),
    lookup: async () => ({email:'user@example.com', emailVerified:verified}),
    refresh: async () => ({user_id:'uid-1', id_token:'new-id-token', refresh_token:'refresh-secret', expires_in:'3600'}),
    ensureProfileAndWorkspace: async () => ({workspaceId:'uid-1'})
  };
}

test('Firebase refresh token is persisted only through safeStorage protection', async () => {
  const dir = tempDir();
  try {
    const manager = new AuthManager({firebase:loginFirebase(), safeStorage, userDataDir:dir});
    await manager.login({email:'user@example.com', password:'A-password-123!'});
    const raw = fs.readFileSync(path.join(dir, 'security', 'firebase-session.json'), 'utf8');
    assert.doesNotMatch(raw, /refresh-secret/);
    assert.match(raw, /ZHBhcGk6cmVmcmVzaC1zZWNyZXQ=/); // base64 of protected blob
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('unverified account cannot create or attach a workspace', async () => {
  const dir = tempDir();
  try {
    let called = false;
    const firebase = loginFirebase({verified:false});
    firebase.ensureProfileAndWorkspace = async () => { called = true; return {workspaceId:'uid-1'}; };
    const manager = new AuthManager({firebase, safeStorage, userDataDir:dir});
    const state = await manager.login({email:'user@example.com', password:'A-password-123!'});
    assert.equal(state.emailVerified, false);
    await assert.rejects(() => manager.ensureWorkspace(), /Confirme seu e-mail/);
    assert.equal(called, false);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('verified cached session may restore only through bounded offline grace', async () => {
  const dir = tempDir();
  try {
    const online = new AuthManager({firebase:loginFirebase({verified:true}), safeStorage, userDataDir:dir});
    await online.login({email:'user@example.com', password:'A-password-123!'});

    const offlineFirebase = loginFirebase({verified:true});
    offlineFirebase.refresh = async () => { throw new FirebaseError('offline', 'NETWORK_ERROR'); };
    const offline = new AuthManager({firebase:offlineFirebase, safeStorage, userDataDir:dir});
    const state = await offline.restore();
    assert.equal(state.authenticated, true);
    assert.equal(state.emailVerified, true);
    assert.equal(state.offline, true);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('weak password is rejected locally before Firebase registration', async () => {
  const dir = tempDir();
  try {
    let called = false;
    const firebase = loginFirebase();
    firebase.signUp = async () => { called = true; throw new Error('should not be called'); };
    const manager = new AuthManager({firebase, safeStorage, userDataDir:dir});
    await assert.rejects(() => manager.register({displayName:'User', email:'user@example.com', password:'123456'}), /12 caracteres/);
    assert.equal(called, false);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
