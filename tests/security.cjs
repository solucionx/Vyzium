const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePassword,
  generateRootKey,
  deriveModuleKey,
  generateRecoveryCode,
  wrapRootKeyForRecovery,
  unwrapRootKeyFromRecovery
} = require('../electron/security-core');

test('password policy requires 12 chars and mixed character classes', () => {
  assert.equal(validatePassword('Short1!').ok, false);
  assert.equal(validatePassword('Vyzium-Seguro-2026!').ok, true);
});

test('workspace root key is 256 bits and module keys are isolated', () => {
  const root = generateRootKey();
  assert.equal(root.length, 32);
  const followup = deriveModuleKey(root, 'followup');
  const compras = deriveModuleKey(root, 'compras');
  assert.equal(followup.length, 32);
  assert.equal(compras.length, 32);
  assert.notDeepEqual(followup, compras);
  assert.deepEqual(deriveModuleKey(root, 'followup'), followup);
});

test('recovery envelope round-trips root key and rejects wrong code', () => {
  const root = generateRootKey();
  const code = generateRecoveryCode();
  const envelope = wrapRootKeyForRecovery(root, code);
  assert.deepEqual(unwrapRootKeyFromRecovery(envelope, code), root);
  assert.throws(() => unwrapRootKeyFromRecovery(envelope, 'VYZIUM-WRONG-CODE'));
  assert.equal(envelope.algorithm, 'AES-256-GCM');
  assert.equal(envelope.version, 1);
});


test('recovery envelope salt is stable for the same root key and distinct across root keys', () => {
  const rootA = generateRootKey();
  const rootB = generateRootKey();
  const codeA = generateRecoveryCode();
  const codeB = generateRecoveryCode();
  const first = wrapRootKeyForRecovery(rootA, codeA);
  const second = wrapRootKeyForRecovery(rootA, codeB);
  const other = wrapRootKeyForRecovery(rootB, generateRecoveryCode());
  assert.equal(first.salt, second.salt);
  assert.notEqual(first.salt, other.salt);
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(unwrapRootKeyFromRecovery(first, codeA), rootA);
  assert.deepEqual(unwrapRootKeyFromRecovery(second, codeB), rootA);
});

test('recovery code accepts formatting differences without changing the key', () => {
  const root = generateRootKey();
  const code = generateRecoveryCode();
  const envelope = wrapRootKeyForRecovery(root, code);
  const relaxed = code.toLowerCase().replaceAll('-', ' ');
  assert.deepEqual(unwrapRootKeyFromRecovery(envelope, relaxed), root);
});
