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


test('recovery code accepts formatting differences without changing the key', () => {
  const root = generateRootKey();
  const code = generateRecoveryCode();
  const envelope = wrapRootKeyForRecovery(root, code);
  const relaxed = code.toLowerCase().replaceAll('-', ' ');
  assert.deepEqual(unwrapRootKeyFromRecovery(envelope, relaxed), root);
});
