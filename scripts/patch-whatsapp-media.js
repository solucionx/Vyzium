'use strict';

// Narrow backport of wwebjs/whatsapp-web.js#201923 for the pinned 1.34.7.
// Do not touch Client.js: its authentication/QR bootstrap must stay identical.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const ORIGINAL_SHA256 = '0d0f88565f481dbfeb9493b04b24033a2cb60f5fd2fd0e84e543b461d98878fe';
const ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)";
const INSERTION = [
  '        // VYZIUM_MEDIA_ID_FIX: MediaData.__x_id must not replace the outgoing MsgKey.',
  '        // Backport: https://github.com/wwebjs/whatsapp-web.js/pull/201923',
  '        delete message.__x_id;',
  '',
  ''
].join('\n');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');

function patchMediaSource(source) {
  const original = source.includes(INSERTION) ? source.replace(INSERTION, '') : source;
  if (hash(original) !== ORIGINAL_SHA256 || original.split(ANCHOR).length !== 2) {
    throw new Error('Utils.js do WhatsApp difere da versão 1.34.7 validada; correção de mídia bloqueada.');
  }
  const patched = original.replace(ANCHOR, INSERTION + ANCHOR);
  new vm.Script(patched, {filename:'whatsapp-web.js/Utils.js'});
  return {source:patched, changed:patched !== source};
}

function mediaFile(projectRoot = path.resolve(__dirname, '..')) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', {paths:[projectRoot]});
  if (JSON.parse(fs.readFileSync(packageFile, 'utf8')).version !== '1.34.7') {
    throw new Error('Correção de mídia validada somente para whatsapp-web.js 1.34.7.');
  }
  return path.join(path.dirname(packageFile), 'src/util/Injected/Utils.js');
}

function verifyMediaPatch(projectRoot) {
  const source = fs.readFileSync(mediaFile(projectRoot), 'utf8');
  if (patchMediaSource(source).changed) throw new Error('Correção de mídia do WhatsApp não foi aplicada.');
  return {sha256:hash(source)};
}

function applyMediaPatch(projectRoot) {
  const file = mediaFile(projectRoot);
  const result = patchMediaSource(fs.readFileSync(file, 'utf8'));
  if (result.changed) fs.writeFileSync(file, result.source, 'utf8');
  return verifyMediaPatch(projectRoot);
}

if (require.main === module) {
  try { console.log('Vyzium: correção de mídia verificada.', applyMediaPatch()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = {patchMediaSource, applyMediaPatch, verifyMediaPatch, ORIGINAL_SHA256, INSERTION, mediaFile};
