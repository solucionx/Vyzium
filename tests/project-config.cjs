const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('package identity remains compatible with the existing Vyzium installation', () => {
  assert.equal(pkg.name, 'vyzium-gestao-operacional');
  assert.equal(pkg.build?.appId, 'com.vyzium.gestaooperacional');
  assert.equal(pkg.build?.productName, 'Vyzium');
});

test('release version changes preserve the original dependency versions and archive URLs', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const expected = {
    'node_modules/@electron/asar': '3.2.18',
    'node_modules/node-webpmux': '3.2.1',
    'node_modules/tar-fs/node_modules/tar-stream': '3.2.1',
    'node_modules/whatsapp-web.js/node_modules/tar-stream': '3.2.1'
  };
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(lock.packages[name]?.version, version, `Dependência alterada ao numerar a release: ${name}`);
    assert.ok(lock.packages[name].resolved.endsWith(`-${version}.tgz`));
  }
  assert.equal(lock.packages['node_modules/app-builder-lib'].dependencies['@electron/asar'], '3.2.18');
  assert.equal(lock.packages['node_modules/whatsapp-web.js'].dependencies['node-webpmux'], '3.2.1');
});


test('3.3.0 keeps one authoritative release version across package, Python and renderer', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.version, pkg.version);
  const versionPattern = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionRegex = new RegExp(`VYZIUM_APP_VERSION[\\s\\S]*?${versionPattern}`);
  assert.match(read('backend/engine.py'), versionRegex);
  assert.match(read('backend/compras_engine.py'), versionRegex);
  assert.match(read('backend/crypto_migration.py'), versionRegex);
  const main = read('electron/main.js');
  assert.match(main, /ipcMain\.handle\('app-version'/);
  assert.match(main, /VYZIUM_APP_VERSION:\s*app\.getVersion\(\)/);
  for (const rel of ['renderer/index.html', 'renderer/acompanhamento.html', 'renderer/compras.html']) {
    assert.match(read(rel), /src="version\.js"/);
  }
  assert.match(read('renderer/version.js'), /window\.followup\?\.appVersion/);
});

test('repository safety blocks operational spreadsheets and WhatsApp session artifacts', () => {
  const ignore = read('.gitignore');
  for (const pattern of ['*.xls', '*.xlsx', '*.xlsm', '*.csv', 'whatsapp-runtime/', 'session-state.json', 'whatsapp-debug.jsonl']) {
    assert.ok(ignore.includes(pattern), `Proteção ausente no .gitignore: ${pattern}`);
  }
  const guard = read('scripts/verify-repository-safety.ps1');
  for (const marker of ["'.xls'", "'.xlsx'", "'session-state.json'", "'whatsapp-debug.jsonl'"]) {
    assert.ok(guard.includes(marker), `Proteção ausente no verificador de repositório: ${marker}`);
  }
});

test('Windows installer assets referenced by electron-builder exist', () => {
  for (const rel of ['build/icon.ico', 'build/icon.png', 'build/installer-sidebar.bmp']) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, `Arquivo ausente: ${rel}`);
  }
});

test('Windows runtime uses the Vyzium taskbar identity and explicit app icon', () => {
  const main = read('electron/main.js');
  assert.match(main, /app\.setAppUserModelId\(['"]com\.vyzium\.gestaooperacional['"]\)/);
  assert.match(main, /function appIconPath\(\)/);
  assert.match(main, /build['"], ['"]icon\.ico/);
  assert.match(main, /icon:\s*appIconPath\(\)/);
});

test('Windows hidden-browser launcher is unpacked for PowerShell execution', () => {
  assert.equal(fs.existsSync(path.join(root, 'electron', 'whatsapp-hidden-browser.ps1')), true);
  assert.ok((pkg.build?.asarUnpack || []).includes('electron/whatsapp-hidden-browser.ps1'));
});

test('Python requirements include Excel readers and SQLCipher', () => {
  const req = read('backend/requirements.txt');
  for (const dependency of ['openpyxl==', 'xlrd==', 'xlwt==', 'sqlcipher3==']) {
    assert.match(req, new RegExp(`^${dependency}[^\\r\\n]+`, 'm'));
  }
});

test('release packages both Python engines as extraResources', () => {
  const serialized = JSON.stringify(pkg.build?.extraResources || []);
  assert.match(serialized, /followup-engine\.exe/);
  assert.match(serialized, /compras-engine\.exe/);
});

test('release workflow builds, validates and packages SQLCipher-enabled engines', () => {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const content = fs.readdirSync(workflowsDir)
    .filter(name => /\.ya?ml$/i.test(name))
    .map(name => fs.readFileSync(path.join(workflowsDir, name), 'utf8'))
    .join('\n');
  assert.match(content, /followup-engine/);
  assert.match(content, /compras-engine/);
  assert.match(content, /--collect-all sqlcipher3/);
  assert.match(content, /verify-engines\.ps1/);
  assert.match(content, /verify-packaged-engines\.ps1/);
  assert.match(content, /verify-repository-safety\.ps1/);
  assert.match(content, /VYZIUM_APP_VERSION=\$version/);
});

test('3.1 data safety and authentication files are included', () => {
  assert.equal(pkg.version, '3.3.0');
  for (const rel of [
    'backend/data_safety.py', 'backend/secure_sqlite.py', 'backend/crypto_migration.py',
    'electron/firebase-client.js', 'electron/auth-manager.js', 'electron/security-manager.js',
    'renderer/auth.html', 'renderer/auth.js', 'renderer/auth.css', 'firebase/firestore.rules'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, `Arquivo ausente: ${rel}`);

  const main = read('electron/main.js');
  assert.match(main, /\/data-safety\/backup/);
  assert.match(main, /pre-update-/);
  assert.match(main, /security-finalize/);
});



test('WhatsApp dependency remains pinned while the bootstrap fix stays focused', () => {
  assert.equal(pkg.dependencies?.['whatsapp-web.js'], '1.34.7');
  assert.equal(pkg.overrides, undefined);
  const patch = read('scripts/patch-whatsapp-web.js');
  const whatsapp = read('electron/whatsapp.js');
  assert.match(patch, /VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V6/);
  assert.match(whatsapp, /VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V6/);
  assert.match(patch, /Vyzium restored-session replay/);
});

test('3.1 keeps updates on the dedicated public releases repository', () => {
  const updates = read('electron/updates.js');
  assert.match(updates, /owner:\s*['"]solucionx['"]/);
  assert.match(updates, /repo:\s*['"]Vyzium-Releases['"]/);
  assert.equal(pkg.build?.publish?.[0]?.owner, 'solucionx');
  assert.equal(pkg.build?.publish?.[0]?.repo, 'Vyzium-Releases');
  assert.equal(pkg.repository?.url, 'https://github.com/solucionx/Vyzium.git');
});

test('3.1 retains legacy database paths only as migration sources and adds workspace paths', () => {
  const main = read('electron/main.js');
  const security = read('electron/security-manager.js');
  assert.match(security, /followup\.db/);
  assert.match(security, /Vyzium-Compras/);
  assert.match(security, /workspaces/);
  assert.match(security, /legacyDatabasesRetained:\s*true/);
  assert.match(main, /VYZIUM_DB_KEY_HEX/);
});

test('update modal uses the visible colored Vyzium mark', () => {
  for (const rel of ['renderer/index.html', 'renderer/acompanhamento.html', 'renderer/compras.html']) {
    const html = read(rel);
    const modal = html.slice(html.indexOf('id="update-modal"'));
    assert.match(modal, /assets\/vyzium-mark\.svg/);
  }
  assert.equal(fs.existsSync(path.join(root, 'renderer', 'assets', 'vyzium-mark.svg')), true);
});

test('private-core workflow publishes only release artifacts to Vyzium-Releases', () => {
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
  assert.match(content, /workflow_dispatch:/);
  assert.doesNotMatch(content, /push:\s*\n\s*tags:/);
});

test('Firebase client config contains no Admin SDK private credential', () => {
  const config = read('electron/firebase-config.js');
  const allJs = ['electron/firebase-config.js','electron/firebase-client.js','electron/auth-manager.js','electron/security-manager.js']
    .map(read).join('\n');
  assert.match(config, /projectId:\s*['"]vyzium-production['"]/);
  assert.doesNotMatch(allJs, /private_key|service-account|BEGIN PRIVATE KEY|client_email/);
});

test('Firestore rules default-deny unknown paths and protect recovery envelope by owner', () => {
  const rules = read('firebase/firestore.rules');
  assert.match(rules, /email_verified\s*==\s*true/);
  assert.match(rules, /match \/keyRecovery\/\{keyId\}/);
  assert.match(rules, /isWorkspaceOwner\(workspaceId\)/);
  assert.match(rules, /match \/\{document=\*\*\}/);
  assert.match(rules, /allow read, write: if false/);
});

test('Firestore v3.1 constrains first workspace to Firebase UID and keeps schema immutable from the client', () => {
  const rules = read('firebase/firestore.rules');
  assert.match(rules, /workspaceId\s*==\s*request\.auth\.uid/);
  assert.match(rules, /affectedKeys\(\)[\s\S]*?hasOnly\(\[[\s\S]*?'name'[\s\S]*?\]\)/);
  assert.match(rules, /schemaVersion\s*==\s*resource\.data\.schemaVersion/);
});

test('Firebase deployment files point only to the Vyzium production project rules and indexes', () => {
  const firebaseJson = JSON.parse(read('firebase.json'));
  const firebaseRc = JSON.parse(read('.firebaserc'));
  assert.equal(firebaseJson.firestore?.rules, 'firebase/firestore.rules');
  assert.equal(firebaseJson.firestore?.indexes, 'firebase/firestore.indexes.json');
  assert.equal(firebaseRc.projects?.default, 'vyzium-production');
});

test('recovery material is encrypted locally and interrupted setup cannot silently skip a recovery code', () => {
  const security = read('electron/security-manager.js');
  assert.match(security, /recovery-envelope\.json/);
  assert.match(security, /if \(!marker\?\.active\)/);
  assert.match(security, /wrapRootKeyForRecovery/);
  assert.match(security, /vaultUsable/);
  assert.match(security, /recoveryRequired/);
});

test('stable desktop build blocks DevTools and hides WhatsApp audit UI', () => {
  const main = read('electron/main.js');
  const whatsappUi = read('renderer/whatsapp.js');
  assert.match(main, /devTools:\s*false/);
  assert.doesNotMatch(main, /toggleDevTools\s*\(/);
  assert.doesNotMatch(whatsappUi, /wa-diagnostics|modo auditável|Atualizar diagnóstico/);
});

test('operational view exposes multi-select filters without changing Compras', () => {
  const operational = read('renderer/operational.js');
  assert.match(operational, /buyer:\s*\{title:'Comprador'/);
  assert.match(operational, /company:\s*\{title:'Hotel'/);
  assert.match(operational, /urgency:\s*\{title:'Prazo'/);
  assert.match(operational, /control_status:\s*\{title:'Controle'/);
  assert.match(operational, /attendance_status:\s*\{title:'Atendimento'/);
});


test('Compras desktop allowlist covers map completion, deletion and assisted negotiation routes', () => {
  const main = read('electron/main.js');
  const requiredGet = ['/negotiation-preview'];
  const requiredPost = ['/maps/complete', '/maps/delete', '/send-negotiation'];
  for (const route of requiredGet) {
    assert.ok(main.includes(`GET: new Set([`) && main.includes(`'${route}'`), `Rota GET ausente no allowlist do Electron: ${route}`);
  }
  for (const route of requiredPost) {
    assert.ok(main.includes(`POST: new Set([`) && main.includes(`'${route}'`), `Rota POST ausente no allowlist do Electron: ${route}`);
  }
  assert.match(main, /\['\/send', '\/send-negotiation'\]\.includes\(routePath\)/);
});
