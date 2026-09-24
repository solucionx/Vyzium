'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FullDiagnostics, redactText, clean } = require('../electron/diagnostics');

function fakeApp(root) {
  return {
    getVersion: () => '3.2.6',
    isPackaged: true,
    getPath: name => name === 'userData' ? root : path.join(root, name)
  };
}

test('diagnostics redacts credentials and user home paths', () => {
  const input = `${os.homedir()} apiKey=abc token:xyz password secretvalue eyJabcdefghijklmnopqrstuv`;
  const output = redactText(input);
  assert.equal(output.includes(os.homedir()), false);
  assert.match(output, /%USERPROFILE%/);
  assert.equal(output.includes('secretvalue'), false);
  assert.equal(output.includes('eyJabcdefghijklmnopqrstuv'), false);
});

test('diagnostics masks sensitive object fields', () => {
  const value = clean({ token: 'abc', password: 'def', safe: 'ok' });
  assert.equal(value.token, '[REDACTED]');
  assert.equal(value.password, '[REDACTED]');
  assert.equal(value.safe, 'ok');
});

test('diagnostics creates report and finalization is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-diag-'));
  try {
    const diag = new FullDiagnostics(fakeApp(root));
    diag.stage('Teste', 'OK');
    diag.error('teste', new Error('falha controlada'));
    diag.finalize({ reason: 'test' });
    const count = diag.seq;
    diag.finalize({ reason: 'second' });
    assert.equal(diag.seq, count);
    assert.equal(fs.existsSync(path.join(diag.dir, 'RELATORIO.txt')), true);
    assert.equal(fs.existsSync(path.join(diag.dir, 'timeline.jsonl')), true);
    const report = fs.readFileSync(path.join(diag.dir, 'RELATORIO.txt'), 'utf8');
    assert.match(report, /Teste/);
    assert.match(report, /falha controlada/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('production shutdown captures WhatsApp audit before final bundle', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  const save = main.indexOf('const whatsappAuditFile = whatsapp?.auditFile || null;');
  const stop = main.indexOf('Promise.resolve(stopWorkspaceServices())', save);
  const copy = main.indexOf("fullDiagnostics?.copy(whatsappAuditFile, 'whatsapp-debug.jsonl')", stop);
  const finalize = main.indexOf("fullDiagnostics?.finalize({reason:'before-quit'})", copy);
  assert.ok(save >= 0 && stop > save && copy > stop && finalize > copy);
});
