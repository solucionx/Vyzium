'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SecurityManager } = require('../electron/security-manager');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-security-manager-'));
  const userData = path.join(root, 'userData');
  const appData = path.join(root, 'appData');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });

  let offline = false;
  const authState = {
    authenticated: true,
    uid: 'uid-test-123',
    email: 'user@example.com',
    emailVerified: true,
    workspaceId: 'uid-test-123'
  };
  const auth = {
    getState: () => ({ ...authState, offline }),
    ensureWorkspace: async () => ({ workspaceId: authState.uid }),
    getIdToken: async () => {
      if (offline) throw new Error('offline');
      return 'id-token';
    }
  };

  const envelopes = new Map();
  const firebase = {
    putRecoveryEnvelope: async (workspaceId, envelope) => {
      envelopes.set(workspaceId, JSON.parse(JSON.stringify(envelope)));
      return { ok: true };
    },
    getRecoveryEnvelope: async workspaceId => envelopes.get(workspaceId) || null
  };

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: buffer => {
      const value = buffer.toString('utf8');
      if (!value.startsWith('protected:')) throw new Error('DPAPI blob invalid');
      return value.slice('protected:'.length);
    }
  };

  const app = {
    getPath(name) {
      if (name === 'userData') return userData;
      if (name === 'appData') return appData;
      throw new Error(`unexpected path ${name}`);
    }
  };

  const securityCalls = [];
  const runSecurityTool = async args => {
    securityCalls.push([...args]);
    if (args[0] === 'security-check') return { available: true, cipher_version: '4.test' };
    if (args[0] === 'migrate-db') return { migrated: true };
    if (args[0] === 'validate-db') return { ok: true };
    throw new Error('unexpected security tool call');
  };

  const manager = new SecurityManager({ app, safeStorage, firebase, auth, runSecurityTool });
  return {
    root,
    manager,
    envelopes,
    securityCalls,
    setOffline(value) { offline = value; },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test('interrupted first-run always reissues a recovery code before activation', async () => {
  const f = fixture();
  try {
    const first = await f.manager.prepare();
    assert.match(first.recoveryCode, /^VYZIUM-/);
    const firstModuleKey = f.manager.getModuleKeyHex('followup');

    // Simulate closing the app after the recovery code is displayed but before
    // finalization. The next preparation must never silently skip the code.
    const second = await f.manager.prepare();
    assert.match(second.recoveryCode, /^VYZIUM-/);
    assert.notEqual(second.recoveryCode, first.recoveryCode);
    assert.equal(f.manager.getModuleKeyHex('followup'), firstModuleKey);
    assert.equal(fs.existsSync(f.manager.recoveryEnvelopePath('uid-test-123')), true);
  } finally {
    f.cleanup();
  }
});

test('prepare reports visible setup stages instead of a generic endless spinner', async () => {
  const f = fixture();
  try {
    const events = [];
    f.manager.reportProgress = payload => events.push(payload);
    const result = await f.manager.prepare();
    assert.ok(result.recoveryCode);
    const stages = events.map(item => item.stage);
    assert.ok(stages.includes('workspace'));
    assert.ok(stages.includes('sqlcipher-check'));
    assert.ok(stages.includes('key'));
    assert.ok(stages.includes('recovery-envelope'));
    assert.ok(stages.includes('prepared'));
  } finally {
    f.cleanup();
  }
});

test('an unusable local vault fails closed and advertises recovery instead of ready', async () => {
  const f = fixture();
  try {
    await f.manager.prepare();
    // No legacy databases: finalize can safely activate an empty encrypted workspace.
    await f.manager.finalize();
    let status = await f.manager.status();
    assert.equal(status.ready, true);
    assert.equal(status.vaultUsable, true);

    fs.writeFileSync(f.manager.vaultPath('uid-test-123'), JSON.stringify({
      version: 1,
      workspaceId: 'uid-test-123',
      encryptedRootKey: Buffer.from('not-a-protected-key').toString('base64')
    }));

    status = await f.manager.status();
    assert.equal(status.ready, false);
    assert.equal(status.vault, true);
    assert.equal(status.vaultUsable, false);
    assert.equal(status.recoveryRequired, true);
  } finally {
    f.cleanup();
  }
});

test('local encrypted recovery envelope can restore the vault during offline grace', async () => {
  const f = fixture();
  try {
    const prepared = await f.manager.prepare();
    assert.ok(prepared.recoveryCode);
    await f.manager.finalize();

    // Lose the DPAPI-protected vault but retain the encrypted recovery envelope.
    fs.unlinkSync(f.manager.vaultPath('uid-test-123'));
    f.setOffline(true);

    const recovered = await f.manager.recoverWithCode(prepared.recoveryCode);
    assert.equal(recovered.recovered, true);
    assert.equal(fs.existsSync(f.manager.vaultPath('uid-test-123')), true);
    const status = await f.manager.status();
    assert.equal(status.ready, true);
    assert.equal(status.vaultUsable, true);
  } finally {
    f.cleanup();
  }
});


test('existing protected databases are revalidated before workspace activation', async () => {
  const f = fixture();
  try {
    await f.manager.prepare();
    for (const moduleName of ['followup', 'compras']) {
      const target = f.manager.moduleDb(moduleName, 'uid-test-123');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'mock-encrypted-db');
    }
    await f.manager.finalize();
    const validations = f.securityCalls.filter(args => args[0] === 'validate-db');
    assert.equal(validations.length, 2);
    assert.ok(validations.some(args => args.includes('followup')));
    assert.ok(validations.some(args => args.includes('compras')));
  } finally {
    f.cleanup();
  }
});


test('failed partial migration target is quarantined and rebuilt from untouched legacy source', async () => {
  const f = fixture();
  try {
    await f.manager.prepare();
    const source = f.manager.legacyFollowupDb;
    fs.writeFileSync(source, 'legacy-db-kept-untouched');
    const target = f.manager.moduleDb('followup', 'uid-test-123');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'partial-encrypted-target');

    const original = f.manager.runSecurityTool;
    let validatedPartialBeforeRebuild = false;
    f.manager.runSecurityTool = async (args, env) => {
      if (args[0] === 'validate-db' && args.includes('followup') && fs.readFileSync(target, 'utf8') === 'partial-encrypted-target') {
        validatedPartialBeforeRebuild = true;
        throw new Error('partial target should have been quarantined before validation');
      }
      if (args[0] === 'migrate-db' && args.includes('followup')) {
        fs.writeFileSync(target, 'rebuilt-encrypted-target');
        return { migrated: true };
      }
      return original(args, env);
    };

    const result = await f.manager.finalize();
    assert.equal(validatedPartialBeforeRebuild, false);
    assert.equal(result.ready, true);
    assert.equal(fs.readFileSync(source, 'utf8'), 'legacy-db-kept-untouched');
    assert.equal(fs.readFileSync(target, 'utf8'), 'rebuilt-encrypted-target');
    const failedDir = path.join(f.manager.workspaceRoot('uid-test-123'), 'backups', 'migration-failed');
    const entries = fs.readdirSync(failedDir);
    assert.ok(entries.some(name => name.startsWith('followup-') && name.endsWith('.db')));
  } finally {
    f.cleanup();
  }
});
