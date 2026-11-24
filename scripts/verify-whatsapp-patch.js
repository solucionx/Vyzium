'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_VERSION = '1.34.7';
const PATCHED_CLIENT_SHA256 = 'bbc38a9374f1cda780afbcdf133c42b8e89cc9480811d08590f870f51d22dcb6';

function resolveClientFile(projectRoot = path.resolve(__dirname, '..')) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', { paths: [projectRoot] });
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  return {
    packageFile,
    clientFile: path.join(path.dirname(packageFile), 'src', 'Client.js'),
    version: pkg.version
  };
}

function verifyWhatsAppBootstrap(projectRoot = path.resolve(__dirname, '..')) {
  const { clientFile, version } = resolveClientFile(projectRoot);
  const source = fs.readFileSync(clientFile);
  const sha256 = crypto.createHash('sha256').update(source).digest('hex');

  if (version !== EXPECTED_VERSION) {
    throw new Error(`WhatsApp compatibility baseline expected ${EXPECTED_VERSION}, got ${version}.`);
  }
  if (sha256 !== PATCHED_CLIENT_SHA256) {
    throw new Error(`Client.js differs from the expected patched WhatsApp bootstrap: ${sha256}.`);
  }
  process.stdout.write(`Vyzium: patched WhatsApp bootstrap verified (${version}, ${sha256}).\n`);
  return { version, sha256 };
}

if (require.main === module) {
  try {
    verifyWhatsAppBootstrap();
  } catch (error) {
    console.error(`Vyzium: compatibility bootstrap verification failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyWhatsAppBootstrap, EXPECTED_VERSION, PATCHED_CLIENT_SHA256 };
