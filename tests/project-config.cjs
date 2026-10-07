const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

test('3.4.11 production candidate keeps the stable Vyzium identity and Draft release channel', () => {
  assert.equal(pkg.name, 'vyzium-gestao-operacional');
  assert.equal(pkg.version, '3.4.11');
  assert.equal(pkg.build?.appId, 'com.vyzium.gestaooperacional');
  assert.equal(pkg.build?.productName, 'Vyzium');
  assert.equal(pkg.build?.artifactName, "Vyzium-Setup.${ext}");
  assert.equal(pkg.build?.publish?.[0]?.releaseType, 'draft');
  const main=read('electron/main.js');
  const updates=read('electron/updates.js');
  assert.match(main,/const RC_SANDBOX = String\(app\.getVersion\(\)\)\.includes\('-rc\.'\)/);
  assert.match(updates,/String\(app\.getVersion\(\)\)\.includes\('-rc\.'\)/);
  assert.doesNotMatch(main,/\bPoco\b/i);
});

test('production UI never exposes a device model as the backup server name', () => {
  for (const rel of [
    'electron/main.js',
    'electron/remote-backup.js',
    'electron/backup-restore.js',
    'renderer/app.js',
    'renderer/compras-app.js',
    'renderer/auth.js'
  ]) {
    assert.doesNotMatch(read(rel), /\bPoco\b/i, `Referência específica de aparelho em ${rel}`);
  }
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


test('3.4 line keeps one authoritative release version across package, Python and renderer', () => {
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

test('Windows runtime keeps production and RC taskbar identities explicit with the Vyzium icon', () => {
  const main = read('electron/main.js');
  assert.match(main, /app\.setAppUserModelId\(/);
  assert.match(main, /com\.vyzium\.gestaooperacional\.rc340/);
  assert.match(main, /com\.vyzium\.gestaooperacional/);
  assert.match(main, /RC_SANDBOX/);
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
  assert.match(serialized, /backup-sync-engine\.exe/);
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
  assert.equal(pkg.version, '3.4.11');
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



test('3.4 line keeps the exact upstream WhatsApp bootstrap validated on a clean account', () => {
  assert.equal(pkg.dependencies?.['whatsapp-web.js'], '1.34.7');
  assert.equal(pkg.overrides, undefined);
  assert.equal(pkg.scripts?.postinstall, undefined);
  const verifier = read('scripts/verify-whatsapp-patch.js');
  const whatsapp = read('electron/whatsapp.js');
  const main = read('electron/main.js');
  assert.match(verifier, /36c70c1eb058087624e57ddea6b0c4d4a140faa2daf9c097dc670697ac321389/);
  assert.match(whatsapp, /compatibilityMode/);
  assert.match(main, /browserMode:\s*'headless'/);
  assert.match(main, /compatibilityMode:\s*'legacy-2\.1'/);
  assert.match(main, /com\.vyzium\.gestaooperacional/);
});

test('3.4.9 keeps quotation sending text-only while preserving overview search and urgent maps', () => {
  const whatsapp = read('electron/whatsapp.js');
  const compras = read('backend/compras_engine.py');
  const comprasUi = read('renderer/compras-app.js');
  const main = read('electron/main.js');
  const home = read('renderer/home.js');
  assert.match(whatsapp, /async send\(phone, message\)/);
  assert.doesNotMatch(whatsapp, /MessageMedia|data\.images|images\s*=\s*\[\]/);
  assert.doesNotMatch(compras, /quote_references|validate_reference|reference_count|reference_image|payload\[['"]images['"]\]/);
  assert.doesNotMatch(comprasUi, /reference_image|data-reference|FileReader|image\/jpeg|quote-reference/);
  assert.match(compras, /search_compras/);
  assert.match(main, /global-search/);
  assert.match(home, /global-search/);
  assert.match(comprasUi, /map-urgent/);
});

test('3.4 line preserves manual/on-close backup policy while adding safe restore', () => {
  const main = read('electron/main.js');
  const remote = read('electron/remote-backup.js');
  const security = read('electron/security-manager.js');
  const followupUi = read('renderer/app.js');
  const comprasUi = read('renderer/compras-app.js');
  assert.match(main, /\/remote-backup\/status/);
  assert.match(main, /\/remote-backup\/create/);
  assert.match(main, /performRemoteBackup\(\{reason:'manual', skipIfUnchanged:false\}\)/);
  assert.match(main, /backupOnNormalClose/);
  assert.match(main, /performRemoteBackup\(\{reason:'app-close', skipIfUnchanged:true\}\)/);
  assert.doesNotMatch(main, /setInterval\([^\n]*remote-backup/);
  assert.match(security, /withRemoteBackupKey/);
  assert.match(remote, /VZB1/);
  assert.match(remote, /vyzium-backup-v1/);
  assert.match(remote, /Content-Length/);
  assert.match(remote, /\/v1\/backups/);
  assert.doesNotMatch(remote, /DELETE/);
  assert.match(followupUi, /Criar e enviar backup/);
  assert.match(comprasUi, /Criar e enviar backup/);
});

test('3.4 restore architecture is fail-safe and lineage aware', () => {
  const main=read('electron/main.js');
  const restore=read('electron/backup-restore.js');
  const remote=read('electron/remote-backup.js');
  const security=read('electron/security-manager.js');
  const preload=read('electron/preload.js');
  assert.match(main,/backup-sync-preflight/);
  assert.match(main,/parentOverride/);
  assert.match(main,/writeCandidateBackupState/);
  assert.match(restore,/pre-sync/);
  assert.match(restore,/_atomicInstall/);
  assert.match(restore,/Otro|Outro|backup principal mudou/i);
  assert.match(remote,/X-Vyzium-Parent/);
  assert.match(remote,/BACKUP_DOWNLOAD_CHECKSUM_MISMATCH/);
  assert.match(remote,/BACKUP_AUTHENTICATION_FAILED/);
  assert.match(security,/_recoveryEnvelopeForWorkspace/);
  assert.match(security,/bloqueou a criação de uma chave nova/);
  assert.match(preload,/backupSync/);
  assert.equal(fs.existsSync(path.join(root,'backend','backup_sync.py')),true);
  assert.equal(fs.existsSync(path.join(root,'backend','test_backup_sync.py')),true);
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
