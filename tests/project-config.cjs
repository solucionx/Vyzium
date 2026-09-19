const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

test('package identity remains compatible with the existing Vyzium installation', () => {
  assert.equal(pkg.name, 'vyzium-gestao-operacional');
  assert.equal(pkg.build?.appId, 'com.vyzium.gestaooperacional');
  assert.equal(pkg.build?.productName, 'Vyzium');
});

test('Windows installer assets referenced by electron-builder exist', () => {
  for (const rel of ['build/icon.ico', 'build/icon.png', 'build/installer-sidebar.bmp']) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `Arquivo ausente: ${rel}`);
  }
});

test('Python requirements include both Excel formats used by the unified app', () => {
  const req = fs.readFileSync(path.join(root, 'backend', 'requirements.txt'), 'utf8');
  for (const dependency of ['openpyxl==', 'xlrd==', 'xlwt==']) {
    assert.match(req, new RegExp(`^${dependency.replace('==', '==')}[^\\r\\n]+`, 'm'));
  }
});

test('release packages both Python engines as extraResources', () => {
  const resources = pkg.build?.extraResources || [];
  const serialized = JSON.stringify(resources);
  assert.match(serialized, /followup-engine\.exe/);
  assert.match(serialized, /compras-engine\.exe/);
});

test('release workflow verifies both engines before publishing', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-windows.yml'), 'utf8');
  assert.match(workflow, /verify-engines\.ps1/);
  assert.match(workflow, /verify-packaged-engines\.ps1/);
});
