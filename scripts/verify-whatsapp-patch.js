'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_VERSION = '1.34.7';
const KNOWN_GOOD_CLIENT_SHA256 = '36c70c1eb058087624e57ddea6b0c4d4a140faa2daf9c097dc670697ac321389';

function resolveClientFile(projectRoot = path.resolve(__dirname, '..')) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', { paths: [projectRoot] });
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  return {
    packageFile,
    clientFile: path.join(path.dirname(packageFile), 'src', 'Client.js'),
    version: pkg.version
  };
}

function verifyUpstreamBootstrap(projectRoot = path.resolve(__dirname, '..')) {
  const { clientFile, version } = resolveClientFile(projectRoot);
  const source = fs.readFileSync(clientFile);
  const text = source.toString('utf8');
  const sha256 = crypto.createHash('sha256').update(source).digest('hex');

  if (version !== EXPECTED_VERSION) {
    throw new Error(`WhatsApp compatibility baseline expected ${EXPECTED_VERSION}, got ${version}.`);
  }
  if (sha256 !== KNOWN_GOOD_CLIENT_SHA256) {
    throw new Error(`Client.js differs from the known-good installer baseline: ${sha256}.`);
  }
  if (!text.includes('await this.pupPage.evaluate(ExposeAuthStore);')) {
    throw new Error('Known-good ExposeAuthStore bootstrap is missing.');
  }
  if (!text.includes('window.AuthStore.RegistrationUtils')) {
    throw new Error('Known-good QR bootstrap is missing.');
  }
  if (text.includes('VYZIUM_WWEBJS_BOOTSTRAP_PATCH_')) {
    throw new Error('A Vyzium bootstrap patch is still present in Client.js.');
  }

  process.stdout.write(`Vyzium: upstream WhatsApp bootstrap verified (${version}, ${sha256}).\n`);
  return { version, sha256 };
}

if (require.main === module) {
  try {
    verifyUpstreamBootstrap();
    const media = require('./patch-whatsapp-media').verifyMediaPatch();
    console.log('Vyzium: media ID correction verified.', media);
  } catch (error) {
    console.error(`Vyzium: compatibility bootstrap verification failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyUpstreamBootstrap, EXPECTED_VERSION, KNOWN_GOOD_CLIENT_SHA256 };
