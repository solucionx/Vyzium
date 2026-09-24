'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {FullDiagnostics, redact} = require('../electron/diagnostics');

function fakeApp(root) {
  return {
    getPath(name) { return name === 'userData' ? root : path.join(root, name); },
    getVersion() { return '3.3.3'; },
    isPackaged: false
  };
}

test('diagnostic redact masks secrets, JWT-like tokens, long hex and Windows usernames', () => {
  assert.equal(redact('token: abc123').includes('abc123'), false);
  assert.equal(redact('a'.repeat(48)), '[REDACTED_HEX]');
  assert.equal(redact('eyJ' + 'A'.repeat(30)), '[REDACTED_TOKEN]');
  assert.equal(redact('C:/Users/Levi/AppData/Vyzium').includes('Levi'), false);
});

test('diagnostic timeline, errors and report use real line breaks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-diag-test-'));
  try {
    const d = new FullDiagnostics(fakeApp(root));
    d.event('one', {token:'secret'});
    d.event('two', {});
    const timeline = fs.readFileSync(d.timeline, 'utf8');
    assert.equal(timeline.includes('\\n'), false);
    assert.equal(timeline.trim().split(/\r?\n/).length, 2);
    d.error('test', new Error('boom token: abc123'));
    const errors = fs.readFileSync(d.errorsFile, 'utf8');
    assert.equal(errors.endsWith('\n'), true);
    assert.ok(errors.split(/\r?\n/).length > 2);
    assert.equal(errors.includes('abc123'), false);
    const report = fs.readFileSync(d.report, 'utf8');
    assert.equal(report.includes('\\r\\n'), false);
    assert.ok(report.split(/\r?\n/).length > 4);
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('hidden browser helper stays on the proven stable launcher contract', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'electron', 'whatsapp-hidden-browser.ps1'), 'utf8');
  assert.doesNotMatch(helper, /DisableStorageBuckets/);
  assert.doesNotMatch(helper, /DiagnosticLog/);
  assert.match(helper, /WaitForDevToolsSeconds = 45/);
});

test('unwritable diagnostics directory cannot prevent construction or reporting', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-diag-blocked-'));
 try{
  fs.writeFileSync(path.join(root,'diagnostics'),'not a directory');
  const d=new FullDiagnostics(fakeApp(root));
  assert.doesNotThrow(()=>{d.event('test');d.error('test',new Error('failure'));d.writeReport();});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('diagnostic bundle uses a literal directory, verifies output and finalizes once', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vyzium-diag-quote'-"));
 try{
  const calls=[];
  const d=new FullDiagnostics(fakeApp(root),{platform:'win32',spawnSync:(exe,args)=>{calls.push(args);return {status:0,stdout:'[]'};}});
  assert.equal(d.finalize(),null,'a successful shell status without a ZIP is not success');
  const command=calls.find(a=>a.at(-1).includes('Compress-Archive')).at(-1);
  assert.ok(command.includes("-LiteralPath '"+d.dir.replace(/'/g,"''")+"'"));
  assert.ok(!command.includes('\\*'));const count=calls.length;d.finalize();assert.equal(calls.length,count);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
