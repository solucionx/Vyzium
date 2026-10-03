'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {KNOWN_GOOD_CLIENT_SHA256} = require('./verify-whatsapp-patch');
const {patchMediaSource, verifyMediaPatch} = require('./patch-whatsapp-media');

const archive = process.argv[2] || 'dist/win-unpacked/resources/app.asar';
const sha = data=>crypto.createHash('sha256').update(data).digest('hex');
const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-whatsapp-package-'));

try {
  asar.extractAll(archive, extractedRoot);

  const clientPath = path.join(extractedRoot, 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');
  const mediaPath = path.join(extractedRoot, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
  assert.ok(fs.existsSync(clientPath), 'Client.js do WhatsApp não existe no app.asar extraído.');
  assert.ok(fs.existsSync(mediaPath), 'Utils.js de mídia do WhatsApp não existe no app.asar extraído.');

  const client = fs.readFileSync(clientPath);
  const media = fs.readFileSync(mediaPath);

  assert.equal(sha(client),KNOWN_GOOD_CLIENT_SHA256,'O bootstrap do WhatsApp empacotado mudou.');
  assert.equal(patchMediaSource(media.toString('utf8')).changed,false,'O pacote contém mídia sem correção.');
  assert.equal(sha(media),verifyMediaPatch().sha256,'A mídia empacotada difere da dependência validada.');

  console.log('Pacote Windows: bootstrap original e correção de mídia confirmados por SHA-256.');
} finally {
  fs.rmSync(extractedRoot, {recursive:true, force:true});
}
