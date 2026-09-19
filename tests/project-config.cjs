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
  const workflowsDir = path.join(root, '.github', 'workflows');
  const workflowFiles = fs.readdirSync(workflowsDir)
    .filter(name => /\.ya?ml$/i.test(name));

  assert.ok(workflowFiles.length > 0, 'Nenhum workflow de release foi encontrado.');

  const workflows = workflowFiles.map(name =>
    fs.readFileSync(path.join(workflowsDir, name), 'utf8')
  );

  const releaseWorkflow = workflows.find(content =>
    /compras-engine/.test(content) &&
    /followup-engine/.test(content) &&
    /verify-engines\.ps1/.test(content) &&
    /verify-packaged-engines\.ps1/.test(content)
  );

  assert.ok(
    releaseWorkflow,
    'O workflow de Windows deve compilar e validar os dois motores antes de publicar.'
  );
});

test('data safety layer is included and app version is 3.0.4', () => {
  assert.equal(pkg.version, '3.0.4');
  assert.equal(fs.existsSync(path.join(root, 'backend', 'data_safety.py')), true);

  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /\/data-safety\/backup/);
  assert.match(main, /pre-update-/);
  assert.match(main, /open-backup-folder/);
});


test('3.0.4 keeps installed clients on the dedicated public releases repository', () => {
  const updates = fs.readFileSync(path.join(root, 'electron', 'updates.js'), 'utf8');
  assert.match(updates, /owner:\s*['\"]solucionx['\"]/);
  assert.match(updates, /repo:\s*['\"]Vyzium-Releases['\"]/);
  assert.equal(pkg.build?.publish?.[0]?.owner, 'solucionx');
  assert.equal(pkg.build?.publish?.[0]?.repo, 'Vyzium-Releases');
});

test('bridge keeps production identity and database-location contracts unchanged', () => {
  assert.equal(pkg.name, 'vyzium-gestao-operacional');
  assert.equal(pkg.build?.appId, 'com.vyzium.gestaooperacional');
  assert.equal(pkg.build?.productName, 'Vyzium');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /followup\.db/);
  assert.match(main, /Vyzium-Compras/);
});

test('update modal uses the visible colored Vyzium mark', () => {
  for (const rel of ['renderer/index.html', 'renderer/acompanhamento.html', 'renderer/compras.html']) {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    const modal = html.slice(html.indexOf('id="update-modal"'));
    assert.match(modal, /assets\/vyzium-mark\.svg/);
  }
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'assets', 'vyzium-mark.svg')), true);
});


test('3.0.4 workflow publishes only release artifacts to the dedicated public repository', () => {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const content = fs.readdirSync(workflowsDir)
    .filter(name => /\.ya?ml$/i.test(name))
    .map(name => fs.readFileSync(path.join(workflowsDir, name), 'utf8'))
    .join('\n');
  assert.match(content, /VYZIUM_RELEASE_TOKEN/);
  assert.match(content, /solucionx\/Vyzium-Releases/);
  assert.match(content, /gh release create \$tag/);
  assert.match(content, /--repo \$releaseRepo/);
  assert.match(content, /--target main/);
});

test('transition release workflow is manual and cannot publish a Release in the old code repository', () => {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const workflowFiles = fs.readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name));
  const content = workflowFiles.map(name => fs.readFileSync(path.join(workflowsDir, name), 'utf8')).join('\n');

  assert.match(content, /workflow_dispatch:/);
  assert.doesNotMatch(content, /push:\s*\n\s*tags:/);
  assert.match(content, /RELEASE_REPO:\s*["']solucionx\/Vyzium-Releases["']/);
  assert.match(content, /GH_TOKEN:\s*\$\{\{\s*secrets\.VYZIUM_RELEASE_TOKEN\s*\}\}/);

  const releaseCommands = content.split('\n').filter(line => /gh release (?:view|create|upload)/.test(line));
  assert.ok(releaseCommands.length >= 3, 'Esperava comandos explícitos de GitHub Release.');
  // The repo flag can be on following PowerShell continuation lines; assert globally for each command family.
  for (const command of ['view', 'create', 'upload']) {
    const re = new RegExp(`gh release ${command}[\\s\\S]{0,500}?--repo \\$releaseRepo`);
    assert.match(content, re, `gh release ${command} deve usar --repo $releaseRepo.`);
  }
});
