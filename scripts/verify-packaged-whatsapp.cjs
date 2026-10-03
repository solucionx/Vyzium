'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const {KNOWN_GOOD_CLIENT_SHA256} = require('./verify-whatsapp-patch');
const {patchMediaSource, verifyMediaPatch} = require('./patch-whatsapp-media');

const archive = process.argv[2] || 'dist/win-unpacked/resources/app.asar';
const sha = data=>crypto.createHash('sha256').update(data).digest('hex');
const normalize = value=>String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');

function readPackaged(relativePath) {
  const wanted = normalize(relativePath);
  const entries = asar.listPackage(archive).map(normalize);
  const matches = entries.filter(entry=>entry === wanted || entry.endsWith('/' + wanted));
  if (matches.length > 1) {
    throw new Error(`Arquivo duplicado no app.asar: ${wanted} (${matches.join(', ')})`);
  }
  if (matches.length === 1) {
    return {data:asar.extractFile(archive, matches[0]), location:`app.asar:${matches[0]}`};
  }

  const unpackedRoot = archive.replace(/\.asar$/i, '.asar.unpacked');
  const unpackedPath = path.join(unpackedRoot, ...wanted.split('/'));
  if (fs.existsSync(unpackedPath) && fs.statSync(unpackedPath).isFile()) {
    return {data:fs.readFileSync(unpackedPath), location:unpackedPath};
  }

  throw new Error(`Arquivo empacotado não encontrado: ${wanted}. Verificados app.asar e app.asar.unpacked.`);
}

const client = readPackaged('node_modules/whatsapp-web.js/src/Client.js');
const media = readPackaged('node_modules/whatsapp-web.js/src/util/Injected/Utils.js');

assert.equal(sha(client.data),KNOWN_GOOD_CLIENT_SHA256,'O bootstrap do WhatsApp empacotado mudou.');
assert.equal(patchMediaSource(media.data.toString('utf8')).changed,false,'O pacote contém mídia sem correção.');
assert.equal(sha(media.data),verifyMediaPatch().sha256,'A mídia empacotada difere da dependência validada.');

console.log('Pacote Windows: bootstrap original e correção de mídia confirmados por SHA-256.');
console.log(`Bootstrap: ${client.location}`);
console.log(`Mídia: ${media.location}`);
