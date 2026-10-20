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
    getVersion() { return '3.3.4'; },
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

test('report surfaces WhatsApp storage errors and last stage even without app errors', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-diag-wa-'));
 try{
  const d=new FullDiagnostics(fakeApp(root));
  d.event('whatsapp.page.console',{type:'warn',text:'Permissions-Policy'});
  d.event('whatsapp.page.console',{type:'error',text:'storage_initialization_error token: sensitive'});
  d.event('whatsapp.client.inject-stage',{stage:'socket-wait',generation:3});
  const report=fs.readFileSync(d.report,'utf8');
  assert.match(report,/ERROS CAPTURADOS: 0/);assert.match(report,/OCORRENCIAS DO WHATSAPP: 1/);
  assert.match(report,/storage_initialization_error/);assert.match(report,/socket-wait/);
  assert.doesNotMatch(report,/sensitive/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('old diagnostic runs and ZIPs are bounded without deleting unknown content',()=>{
  const {pruneDiagnostics}=require('../electron/storage-retention');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vyzium-retention-'));
  try {
    const dirs=[];
    for(let i=0;i<8;i++){
      const dir=path.join(root,`run-2026-01-01T00-00-00-000Z-abc${i}-abcdef`);fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir,'timeline.jsonl'),'test');fs.utimesSync(dir,i+1,i+1);dirs.push(dir);
      const zip=path.join(root,`Vyzium-Diagnostico-abc${i}-abcdef.zip`);fs.writeFileSync(zip,'zip');fs.utimesSync(zip,i+1,i+1);
    }
    fs.writeFileSync(path.join(dirs[0],'user.db'),'preserve');fs.utimesSync(dirs[0],1,1);
    pruneDiagnostics(root,dirs[7]);
    assert.equal(fs.existsSync(dirs[0]),true);
    assert.equal(fs.existsSync(dirs[1]),false);
    assert.equal(fs.existsSync(dirs[7]),true);
    assert.equal(fs.readdirSync(root).filter(x=>x.endsWith('.zip')).length,5);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
