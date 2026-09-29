'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function write(rel, value) { fs.writeFileSync(path.join(root, rel), value, 'utf8'); }
function replaceRequired(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) throw new Error(`Combined test patch failed: ${label}`);
  return source.replace(search, replacement);
}

function patchMain() {
  const rel = 'electron/main.js';
  let source = read(rel);
  if (source.includes('REMOTE_BACKUP_COMBINED_TEST_V1')) return;

  source = replaceRequired(
    source,
    "const { FullDiagnostics } = require('./diagnostics');\nconst { createSentryReporter, shouldPromoteWhatsAppEvent } = require('./sentry-client');",
    "const { FullDiagnostics } = require('./diagnostics');\nconst { RemoteBackupManager } = require('./remote-backup');\nconst { createSentryReporter, shouldPromoteWhatsAppEvent } = require('./sentry-client');",
    'remote backup import'
  );

  source = replaceRequired(
    source,
    "const ISOLATED_TEST_BUILD = true;\nconst ISOLATED_TEST_DATA_NAME = 'Vyzium-WhatsApp-V9-Legacy-Test';",
    "const ISOLATED_TEST_BUILD = true;\n// REMOTE_BACKUP_COMBINED_TEST_V1: intentionally reuse the existing V8 TEST workspace.\n// Production Vyzium has a different userData root and is not touched.\nconst ISOLATED_TEST_DATA_NAME = 'Vyzium-WhatsApp-V8-Test';",
    'isolated test data root'
  );

  source = replaceRequired(
    source,
    "let whatsapp;\nlet whatsappBridge;\nlet updater;",
    "let whatsapp;\nlet whatsappBridge;\nlet remoteBackup;\nlet updater;",
    'remote backup variable'
  );

  source = source
    .replaceAll('com.vyzium.whatsappv9legacytest', 'com.vyzium.backupwhatsapptest')
    .replaceAll('Vyzium WhatsApp V9 Legacy Test', 'Vyzium Backup + WhatsApp Test');

  source = replaceRequired(
    source,
    "    browserMode: 'headless',\n    fullDiagnosticEvent:",
    "    browserMode: 'headless',\n    compatibilityMode: 'legacy-2.1',\n    fullDiagnosticEvent:",
    'legacy WhatsApp compatibility mode'
  );

  source = replaceRequired(
    source,
    "  whatsappBridge = await startBridge(whatsapp, engineToken);\n  fullDiagnostics?.stage('Bridge local do WhatsApp iniciado', 'OK');\n  workspaceServicesStarted = true;",
    "  whatsappBridge = await startBridge(whatsapp, engineToken);\n  fullDiagnostics?.stage('Bridge local do WhatsApp iniciado', 'OK');\n  remoteBackup = new RemoteBackupManager({\n    tempRoot: path.join(securityManager.workspaceRoot(), 'backups', 'remote-transfer'),\n    getToken: () => authManager.getIdToken(),\n    getUid: () => authManager.getState().uid,\n    withBackupKey: callback => securityManager.withRemoteBackupKey(callback),\n    audit: (event, details) => { try { fullDiagnostics?.event(event, details); } catch (_) {} }\n  });\n  fullDiagnostics?.stage('Backup remoto Poco preparado', 'OK');\n  workspaceServicesStarted = true;",
    'remote backup initialization'
  );

  source = replaceRequired(
    source,
    "  whatsapp = null;\n  whatsappBridge = null;\n  workspaceServicesStarted = false;",
    "  whatsapp = null;\n  whatsappBridge = null;\n  remoteBackup = null;\n  workspaceServicesStarted = false;",
    'remote backup shutdown'
  );

  const apiAnchor = "async function apiRequest(method, route, body) {\n  if (route === '/supplier-contacts') {";
  const apiReplacement = `function pathInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function createRemoteBackupSnapshots() {
  if (!securityManager || !workspaceServicesStarted) throw new Error('Entre na sua conta Vyzium antes de criar o backup.');
  const snapshots = [];
  const comprasWasRunning = Boolean(comprasEngineUrl);
  try {
    for (const moduleName of ['followup', 'compras']) {
      const databasePath = securityManager.moduleDb(moduleName);
      if (!fs.existsSync(databasePath)) continue;
      const result = await requestEngine(moduleName, 'POST', '/data-safety/backup', {
        reason: 'remote-upload',
        automatic: true
      });
      if (!result?.created || !result?.path) {
        throw new Error(\`Não foi possível criar o snapshot local de \${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'}.\`);
      }
      const backupRoot = path.join(securityManager.moduleDir(moduleName), 'backups', moduleName);
      const snapshotPath = path.resolve(String(result.path));
      if (!pathInside(backupRoot, snapshotPath)) throw new Error('O motor retornou um caminho de snapshot fora do workspace protegido.');
      const stat = await fs.promises.stat(snapshotPath);
      if (!stat.isFile() || stat.size <= 0 || stat.size !== Number(result.size_bytes)) {
        throw new Error(\`O snapshot local de \${moduleName} não passou na validação de tamanho.\`);
      }
      snapshots.push({
        module: moduleName,
        path: snapshotPath,
        filename: String(result.filename || path.basename(snapshotPath)),
        size_bytes: stat.size,
        sha256: String(result.sha256 || '').toLowerCase(),
        encrypted: result.encrypted === true
      });
    }
  } finally {
    if (!comprasWasRunning && activeModule !== 'compras' && comprasEngineUrl) {
      await stopComprasEngine().catch(() => {});
    }
  }
  if (!snapshots.length) throw new Error('Nenhum banco protegido está disponível para o backup remoto.');
  return snapshots;
}

async function apiRequest(method, route, body) {
  if (String(route || '').startsWith('/remote-backup/')) {
    if (!workspaceServicesStarted || !remoteBackup) throw new Error('O backup remoto só fica disponível após entrar na sua conta Vyzium.');
    if (method === 'GET' && route === '/remote-backup/status') return remoteBackup.status();
    if (method === 'POST' && route === '/remote-backup/create') {
      const access = await remoteBackup.status();
      if (!access.authorized) {
        return {
          uploaded:false,
          authorized:false,
          state:access.state,
          reason:access.state === 'pending'
            ? 'Solicitação registrada no Poco. Autorize este usuário no aplicativo do servidor e tente novamente.'
            : \`Acesso ao backup não autorizado no Poco (estado: \${access.state}).\`
        };
      }
      const snapshots = await createRemoteBackupSnapshots();
      return remoteBackup.upload(snapshots, { appVersion:app.getVersion() });
    }
    throw new Error('Operação de backup remoto não permitida.');
  }
  if (route === '/supplier-contacts') {`;
  source = replaceRequired(source, apiAnchor, apiReplacement, 'remote backup API routes');

  write(rel, source);
}

function patchFollowupUi() {
  const rel = 'renderer/app.js';
  let source = read(rel);
  if (source.includes('remote-backup-status')) return;

  source = replaceRequired(
    source,
    '<div id="data-safety-status" class="callout">Verificando banco de dados…</div>\n    <div class="toolbar" style="margin-top:12px">\n      <button id="create-db-backup" class="button primary" type="button">Criar backup agora</button>',
    '<div id="data-safety-status" class="callout">Verificando banco de dados…</div>\n    <div id="remote-backup-status" class="callout" style="margin-top:10px">Backup online: verificando servidor Poco…</div>\n    <div class="toolbar" style="margin-top:12px">\n      <button id="create-db-backup" class="button primary" type="button">Criar e enviar backup</button>',
    'followup backup panel'
  );

  source = replaceRequired(
    source,
    "    target.classList.toggle('notice', !ok);\n  } catch (error) {\n    target.textContent = `Não foi possível verificar a segurança do banco: ${String(error.message || error)}`;\n  }\n}",
    "    target.classList.toggle('notice', !ok);\n  } catch (error) {\n    target.textContent = `Não foi possível verificar a segurança do banco: ${String(error.message || error)}`;\n  }\n  const remote = document.getElementById('remote-backup-status');\n  if (remote) {\n    api('GET', '/remote-backup/status').then(state => {\n      remote.textContent = state.authorized\n        ? 'Backup online: Poco conectado e usuário autorizado.'\n        : `Backup online: acesso ${state.state || 'pendente'} no Poco.`;\n    }).catch(error => { remote.textContent = `Backup online indisponível: ${String(error.message || error)}`; });\n  }\n}",
    'followup remote status'
  );

  source = replaceRequired(
    source,
    "    button.textContent = 'Criando backup…';\n    try {\n      const result = await api('POST', '/data-safety/backup', { reason: 'manual', automatic: false });\n      showToast(result.created ? `Backup criado: ${result.filename}` : (result.reason || 'Backup não necessário.'));",
    "    button.textContent = 'Criando e enviando…';\n    try {\n      const result = await api('POST', '/remote-backup/create', {});\n      showToast(result.uploaded ? `Backup online confirmado: ${String(result.id || '').slice(0, 12)}…` : (result.reason || 'Backup não enviado.'), !result.uploaded && result.state !== 'pending');",
    'followup remote upload button'
  );

  write(rel, source);
}

function patchComprasUi() {
  const rel = 'renderer/compras-app.js';
  let source = read(rel);
  if (source.includes('compras-remote-backup')) return;

  source = replaceRequired(
    source,
    '<div id="compras-data-safety" class="notice">Verificando banco de dados…</div><div class="toolbar"><button id="compras-backup-now" class="button primary">Criar backup agora</button>',
    '<div id="compras-data-safety" class="notice">Verificando banco de dados…</div><div id="compras-remote-backup" class="notice" style="margin-top:10px">Backup online: verificando servidor Poco…</div><div class="toolbar"><button id="compras-backup-now" class="button primary">Criar e enviar backup</button>',
    'compras backup panel'
  );

  source = replaceRequired(
    source,
    " const loadSafety=async()=>{try{const state=await api('GET','/data-safety');const protection=state.encrypted?'🔒 Criptografado com SQLCipher':'Banco legado sem criptografia';$('#compras-data-safety').innerHTML=`<strong>${state.integrity?.ok?'✓ Banco íntegro':'⚠ Verificação requer atenção'}</strong> · ${esc(protection)}<br>Schema ${esc(state.schema_version??'—')}`;}catch(e){$('#compras-data-safety').textContent='Não foi possível verificar a segurança do banco.';}};",
    " const loadSafety=async()=>{try{const state=await api('GET','/data-safety');const protection=state.encrypted?'🔒 Criptografado com SQLCipher':'Banco legado sem criptografia';$('#compras-data-safety').innerHTML=`<strong>${state.integrity?.ok?'✓ Banco íntegro':'⚠ Verificação requer atenção'}</strong> · ${esc(protection)}<br>Schema ${esc(state.schema_version??'—')}`;}catch(e){$('#compras-data-safety').textContent='Não foi possível verificar a segurança do banco.';}api('GET','/remote-backup/status').then(state=>{$('#compras-remote-backup').textContent=state.authorized?'Backup online: Poco conectado e usuário autorizado.':`Backup online: acesso ${state.state||'pendente'} no Poco.`;}).catch(e=>{$('#compras-remote-backup').textContent=`Backup online indisponível: ${e.message||e}`;});};",
    'compras remote status'
  );

  source = replaceRequired(
    source,
    "on($('#compras-backup-now'),'click',async e=>{const b=e.currentTarget;b.disabled=true;const old=b.textContent;b.textContent='Criando backup…';try{const r=await api('POST','/data-safety/backup',{reason:'manual',automatic:false});toast(r.created?`Backup criado: ${r.filename}`:(r.reason||'Backup não necessário.'));await loadSafety();}finally{b.disabled=false;b.textContent=old;}});",
    "on($('#compras-backup-now'),'click',async e=>{const b=e.currentTarget;b.disabled=true;const old=b.textContent;b.textContent='Criando e enviando…';try{const r=await api('POST','/remote-backup/create',{});toast(r.uploaded?`Backup online confirmado: ${String(r.id||'').slice(0,12)}…`:(r.reason||'Backup não enviado.'));await loadSafety();}catch(error){toast(`Falha no backup online: ${error.message||error}`);}finally{b.disabled=false;b.textContent=old;}});",
    'compras remote upload button'
  );

  write(rel, source);
}

patchMain();
patchFollowupUi();
patchComprasUi();
process.stdout.write('Vyzium: combined Poco backup + legacy WhatsApp test patch applied.\n');
