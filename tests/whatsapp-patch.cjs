'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  verifyUpstreamBootstrap,
  EXPECTED_VERSION,
  KNOWN_GOOD_CLIENT_SHA256
} = require('../scripts/verify-whatsapp-patch');

function installedClient() {
  const packageFile = require.resolve('whatsapp-web.js/package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const clientFile = path.join(path.dirname(packageFile), 'src', 'Client.js');
  const source = fs.readFileSync(clientFile);
  return {pkg, clientFile, source, text:source.toString('utf8')};
}

test('V9 uses the exact whatsapp-web.js version from the working installer', () => {
  const {pkg} = installedClient();
  assert.equal(pkg.version, EXPECTED_VERSION);
});

test('V9 Client.js is byte-identical to the known-good working installer baseline', () => {
  const {source} = installedClient();
  const sha = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(sha, KNOWN_GOOD_CLIENT_SHA256);
});

test('V9 restores the upstream first-login authentication and QR bootstrap', () => {
  const {text} = installedClient();
  assert.match(text, /await this\.pupPage\.evaluate\(ExposeAuthStore\);/);
  assert.match(text, /window\.AuthStore\.RegistrationUtils/);
  assert.match(text, /Socket\.on\(\s*'change:state'/);
  assert.doesNotMatch(text, /VYZIUM_WWEBJS_BOOTSTRAP_PATCH_/);
});

test('V9 compatibility verifier accepts the installed dependency', () => {
  const result = verifyUpstreamBootstrap();
  assert.equal(result.version, EXPECTED_VERSION);
  assert.equal(result.sha256, KNOWN_GOOD_CLIENT_SHA256);
});
