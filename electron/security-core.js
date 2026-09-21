'use strict';

const crypto = require('crypto');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  const value = String(password || '');
  const checks = {
    minLength: value.length >= 12,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value)
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function generateRootKey() {
  return crypto.randomBytes(32);
}

function deriveModuleKey(rootKey, moduleName) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) throw new Error('Chave raiz inválida.');
  const name = String(moduleName || '').trim().toLowerCase();
  if (!['followup', 'compras'].includes(name)) throw new Error('Módulo inválido.');
  return Buffer.from(crypto.hkdfSync('sha256', rootKey, Buffer.alloc(0), Buffer.from(`vyzium:${name}:v1`), 32));
}

function generateRecoveryCode() {
  const raw = crypto.randomBytes(20).toString('hex').toUpperCase();
  return `VYZIUM-${raw.match(/.{1,5}/g).join('-')}`;
}

function normalizeRecoveryCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function recoveryKek(code, salt) {
  return crypto.scryptSync(normalizeRecoveryCode(code), salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
}

function wrapRootKeyForRecovery(rootKey, recoveryCode) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) throw new Error('Chave raiz inválida.');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const kek = recoveryKek(recoveryCode, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(Buffer.from('vyzium-recovery-v1'));
  const ciphertext = Buffer.concat([cipher.update(rootKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'scrypt-N16384-r8-p1',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64')
  };
}

function unwrapRootKeyFromRecovery(envelope, recoveryCode) {
  if (!envelope || Number(envelope.version) !== 1) throw new Error('Envelope de recuperação incompatível.');
  const salt = Buffer.from(String(envelope.salt || ''), 'base64');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const kek = recoveryKek(recoveryCode, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAAD(Buffer.from('vyzium-recovery-v1'));
  decipher.setAuthTag(tag);
  const rootKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (rootKey.length !== 32) throw new Error('Código de recuperação inválido.');
  return rootKey;
}

module.exports = {
  normalizeEmail,
  validatePassword,
  generateRootKey,
  deriveModuleKey,
  generateRecoveryCode,
  wrapRootKeyForRecovery,
  unwrapRootKeyFromRecovery
};
