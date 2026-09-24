'use strict';

const { app, BrowserWindow, dialog, ipcMain, safeStorage, clipboard, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WhatsAppSession, startBridge } = require('./whatsapp');
const { createUpdater } = require('./updates');
const { FirebaseClient } = require('./firebase-client');
const { AuthManager } = require('./auth-manager');
const { SecurityManager } = require('./security-manager');
const { FullDiagnostics } = require('./diagnostics');
const { createSentryReporter, shouldPromoteWhatsAppEvent } = require('./sentry-client');

let window;
let whatsapp;
let whatsappBridge;
let updater;
let firebaseClient;
let authManager;
let securityManager;
let fullDiagnostics;
let sentryReporter;
let workspaceServicesStarted = false;
let quitting = false;
let shutdownPromise = null;
let updating = false;
let activeRequests = 0;
let navigationBusy = false;
let activeModule = 'home';
let overviewCache = null;

let followupEngine = null;
let followupEngineUrl = null;
let followupStartPromise = null;
let comprasEngine = null;
let comprasEngineUrl = null;
let comprasStartPromise = null;

const engineToken = crypto.randomBytes(24).toString('hex');

// Keep the Windows shell/taskbar identity aligned with the appId used by
// electron-builder. Without an explicit AppUserModelID, development runs can
// be grouped under electron.exe and show Electron's generic taskbar icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.vyzium.gestaooperacional');
}

function appIconPath() {
  const png = path.join(__dirname, '..', 'build', 'icon.png');
  const ico = path.join(__dirname, '..', 'build', 'icon.ico');
  return process.platform === 'win32' && fs.existsSync(ico) ? ico : png;
}

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

function followupDataDir() {
  if (securityManager && authManager?.getState()?.authenticated) {
    try { return securityManager.moduleDir('followup'); } catch (_) {}
  }
  // Legacy path is read only by the migration layer until the account is protected.
  return app.getPath('userData');
}

function comprasDataDir() {
  if (securityManager && authManager?.getState()?.authenticated) {
    try { return securityManager.moduleDir('compras'); } catch (_) {}
  }
  return path.join(app.getPath('appData'), 'Vyzium-Compras');
}

function moduleDataDir(moduleName) {
  return moduleName === 'compras' ? comprasDataDir() : followupDataDir();
}

function resolvePackagedEngine(filename) {
  // Caminho oficial do electron-builder + caminhos de compatibilidade para
  // instalações/empacotamentos anteriores. O primeiro arquivo existente vence.
  const candidates = [
    path.join(process.resourcesPath, 'backend', filename),
    path.join(process.resourcesPath, 'backend', 'dist-engine', filename),
    path.join(process.resourcesPath, 'dist-engine', filename),
    path.join(path.dirname(process.execPath), 'resources', 'backend', filename)
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found) return found;

  const moduleLabel = filename.startsWith('compras') ? 'Cotação & Mapas' : 'Acompanhamento';
  const expected = candidates[0];
  const error = new Error(
    `O motor de ${moduleLabel} não foi encontrado na instalação do Vyzium. ` +
    `Arquivo esperado: ${expected}. Reinstale esta versão do Vyzium. ` +
    `Se o problema persistir, confira o Histórico de proteção do Windows Security, ` +
    `pois o executável pode ter sido colocado em quarentena.`
  );
  error.code = 'VYZIUM_ENGINE_MISSING';
  throw error;
}

function engineCommand(moduleName) {
  const filename = moduleName === 'compras' ? 'compras-engine.exe' : 'followup-engine.exe';
  const source = moduleName === 'compras' ? 'compras_engine.py' : 'engine.py';
  if (app.isPackaged) {
    return { executable: resolvePackagedEngine(filename), args: [] };
  }
  const python = process.env.FOLLOWUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return { executable: python, args: [path.join(__dirname, '..', 'backend', source)] };
}

function engineState(moduleName) {
  if (moduleName === 'compras') {
    return {
      get process() { return comprasEngine; },
      set process(value) { comprasEngine = value; },
      get url() { return comprasEngineUrl; },
      set url(value) { comprasEngineUrl = value; },
      get promise() { return comprasStartPromise; },
      set promise(value) { comprasStartPromise = value; }
    };
  }
  return {
    get process() { return followupEngine; },
    set process(value) { followupEngine = value; },
    get url() { return followupEngineUrl; },
    set url(value) { followupEngineUrl = value; },
    get promise() { return followupStartPromise; },
    set promise(value) { followupStartPromise = value; }
  };
}

function startEngine(moduleName) {
  fullDiagnostics?.event('engine.start-request', {moduleName});
  const state = engineState(moduleName);
  if (state.url) return Promise.resolve(state.url);
  if (state.promise) return state.promise;

  state.promise = new Promise((resolve, reject) => {
    const command = engineCommand(moduleName);
    fullDiagnostics?.event('engine.spawn', {moduleName, executable:command.executable, packaged:app.isPackaged});
    const child = spawn(command.executable, [...command.args, 'serve', '--port', '0'], {
      env: {
        ...process.env,
        FOLLOWUP_DATA_DIR: moduleDataDir(moduleName),
        FOLLOWUP_API_TOKEN: engineToken,
        FOLLOWUP_WHATSAPP_URL: whatsappBridge.url,
        VYZIUM_DB_KEY_HEX: securityManager.getModuleKeyHex(moduleName),
        VYZIUM_APP_VERSION: app.getVersion(),
        PYTHONUNBUFFERED: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    state.process = child;

    let buffer = '';
    let startupStderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (state.process === child) {
        state.process = null;
        state.url = null;
      }
      killProcessTree(child).catch(() => {});
      reject(new Error(`O motor de ${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'} não iniciou a tempo.`));
    }, 20000);

    const finishReady = url => {
      // Ignore a late "ready" emitted by a process that already timed out or
      // was superseded. This prevents a stale child from becoming the active engine.
      if (settled || state.process !== child) return;
      settled = true;
      clearTimeout(timeout);
      state.url = url;
      fullDiagnostics?.stage(`Motor ${moduleName} pronto`, 'OK', {pid:child.pid});
      resolve(url);
    };

    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.event === 'ready') finishReady(`http://127.0.0.1:${event.port}`);
        } catch (_) {
          if (line.trim()) console.log(`[${moduleName}-engine]`, line);
        }
      }
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      startupStderr = (startupStderr + text).slice(-12000);
      console.error(`[${moduleName}-engine]`, text);
      fullDiagnostics?.event('engine.stderr', {moduleName, text});
    });
    child.once('error', error => {
      clearTimeout(timeout);
      if (state.process === child) {
        state.process = null;
        state.url = null;
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      const wasCurrentProcess = state.process === child;
      if (wasCurrentProcess) {
        state.process = null;
        state.url = null;
        state.promise = null;
      }
      if (!settled) {
        settled = true;
        const integrityMatch = startupStderr.match(/VYZIUM_DATA_INTEGRITY:\s*([^\r\n]+)/i);
        reject(new Error(integrityMatch?.[1]?.trim() || `O motor de ${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'} encerrou antes de iniciar.`));
      } else if (wasCurrentProcess && !app.isQuitting && !updating && window && !window.isDestroyed() && activeModule === moduleName) {
        dialog.showErrorBox('Motor encerrado', `O motor do módulo foi encerrado (código ${code}).`);
      }
    });
  }).finally(() => {
    // Depois de pronto, o URL passa a ser a fonte de verdade. Em caso de falha,
    // liberar a promessa permite uma tentativa posterior sem reiniciar o app.
    const latest = engineState(moduleName);
    if (!latest.url) latest.promise = null;
  });

  return state.promise;
}

async function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
  } else {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
  }
}

async function stopComprasEngine() {
  const child = comprasEngine;
  comprasEngine = null;
  comprasEngineUrl = null;
  comprasStartPromise = null;
  await killProcessTree(child);
}

async function stopAllEngines() {
  const follow = followupEngine;
  const compras = comprasEngine;
  followupEngine = null;
  followupEngineUrl = null;
  followupStartPromise = null;
  comprasEngine = null;
  comprasEngineUrl = null;
  comprasStartPromise = null;
  await Promise.allSettled([killProcessTree(follow), killProcessTree(compras)]);
}

const ROUTES = {
  followup: {
    GET: new Set(['/health', '/overview', '/dashboard', '/orders', '/order', '/filters', '/suppliers', '/preview', '/history', '/settings', '/send-status', '/data-safety']),
    POST: new Set(['/import', '/supplier', '/order-control', '/settings', '/send', '/send-start', '/followup-reviewed', '/data-safety/backup'])
  },
  compras: {
    GET: new Set(['/health', '/overview', '/items', '/maps', '/map', '/preview', '/negotiation-preview', '/history', '/settings', '/export', '/data-safety']),
    POST: new Set(['/import', '/maps/create', '/maps/save', '/maps/complete', '/maps/archive', '/maps/delete', '/settings', '/send', '/send-negotiation', '/review', '/data-safety/backup'])
  }
};

function engineRequestTimeout(moduleName, method, routePath) {
  // Imports may legitimately take longer on large workbooks. Cotação /send
  // waits for WhatsApp readiness before sending, so it also needs a larger window.
  if (routePath === '/import') return 300000;
  if (routePath === '/export') return 120000;
  if (routePath === '/data-safety/backup') return 120000;
  if (moduleName === 'compras' && String(method).toUpperCase() === 'POST' && ['/send', '/send-negotiation'].includes(routePath)) return 240000;
  return 45000;
}

async function requestEngine(moduleName, method, route, body) {
  const normalizedMethod = String(method || '').toUpperCase();
  const routePath = String(route || '').split('?')[0];
  if (!ROUTES[moduleName]?.[normalizedMethod]?.has(routePath)) throw new Error('Operação local não permitida.');
  const base = await startEngine(moduleName);
  const timeoutMs = engineRequestTimeout(moduleName, normalizedMethod, routePath);
  try {
    const response = await fetch(`${base}${route}`, {
      method: normalizedMethod,
      headers: { 'Content-Type': 'application/json', 'X-FollowUp-Token': engineToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`O motor de ${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'} demorou além do esperado nesta operação.`);
    }
    throw error;
  }
}

async function apiRequest(method, route, body) {
  if (String(route || '').startsWith('/whatsapp/')) {
    // The session is torn down by stopWorkspaceServices() during logout and
    // during the security setup, while an open WhatsApp panel may still be
    // polling. Answer with a clear message instead of dereferencing null.
    if (!workspaceServicesStarted || !whatsapp) {
      throw new Error('A conexão do WhatsApp não está ativa. Entre na sua conta Vyzium.');
    }
    if (method === 'GET' && route === '/whatsapp/status') return whatsapp.status();
    if (method === 'GET' && route === '/whatsapp/diagnostics') return whatsapp.diagnostics();
    if (method === 'POST' && route === '/whatsapp/connect') return whatsapp.connect();
    if (method === 'POST' && route === '/whatsapp/new-qr') return whatsapp.newQr();
    if (method === 'POST' && route === '/whatsapp/pause') return whatsapp.pause();
    if (method === 'POST' && route === '/whatsapp/diagnostics/clear') return whatsapp.clearDiagnostics();
    if (method === 'POST' && route === '/whatsapp/diagnostics/open-folder') {
      const error = await shell.openPath(whatsapp.diagnosticDirectory());
      if (error) throw new Error(`Não foi possível abrir a pasta do diagnóstico: ${error}`);
      return {opened:true};
    }
    throw new Error('Operação de WhatsApp não permitida.');
  }
  if (!['followup', 'compras'].includes(activeModule)) throw new Error('Entre em um módulo para realizar esta operação.');
  // Os dois módulos usam a mesma sessão do WhatsApp. Impedir que uma cotação
  // concorra com um lote de follow-up que esteja rodando em segundo plano.
  const routePath = String(route || '').split('?')[0];
  if (activeModule === 'compras' && String(method).toUpperCase() === 'POST' && ['/send', '/send-negotiation'].includes(routePath)) {
    try {
      const state = await requestEngine('followup', 'GET', '/send-status');
      if (state?.active) throw new Error('O Acompanhamento possui um lote de WhatsApp em andamento. Aguarde a conclusão antes de enviar pelo módulo de Compras.');
    } catch (error) {
      if (String(error.message || error).includes('lote de WhatsApp')) throw error;
      // Se o status do motor principal estiver temporariamente indisponível,
      // não mascarar a própria validação do WhatsApp do módulo de Compras.
    }
  }
  return requestEngine(activeModule, method, route, body);
}

async function comprasOverview() {
  if (comprasEngineUrl) return requestEngine('compras', 'GET', '/overview');

  const command = engineCommand('compras');
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, 'summary'], {
      env: { ...process.env, FOLLOWUP_DATA_DIR: comprasDataDir(), VYZIUM_DB_KEY_HEX: securityManager.getModuleKeyHex('compras'), VYZIUM_APP_VERSION: app.getVersion(), PYTHONUNBUFFERED: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killProcessTree(child).finally(() => reject(new Error('Resumo de compras demorou além do esperado.')));
    }, 12000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || 'Não foi possível carregar o resumo de compras.'));
      try {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        resolve(JSON.parse(lines.at(-1) || '{}'));
      } catch (_) {
        reject(new Error('O resumo de compras retornou uma resposta inválida.'));
      }
    });
  });
}

async function getOverview() {
  if (overviewCache && Date.now() - overviewCache.at < 5000) return overviewCache.value;
  const [followupResult, comprasResult] = await Promise.allSettled([
    requestEngine('followup', 'GET', '/overview'),
    comprasOverview()
  ]);
  const value = {
    followup: followupResult.status === 'fulfilled' ? followupResult.value : null,
    compras: comprasResult.status === 'fulfilled' ? comprasResult.value : null,
    errors: {
      followup: followupResult.status === 'rejected' ? followupResult.reason.message : '',
      compras: comprasResult.status === 'rejected' ? comprasResult.reason.message : ''
    }
  };
  overviewCache = { at: Date.now(), value };
  if (activeModule === 'home' && comprasEngineUrl) {
    setTimeout(() => {
      if (activeModule === 'home' && activeRequests === 0) stopComprasEngine().catch(() => {});
    }, 400);
  }
  return value;
}


async function runSecurityTool(args, extraEnv = {}) {
  const command = engineCommand('followup');
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, ...args], {
      env: {
        ...process.env,
        ...extraEnv,
        VYZIUM_APP_VERSION: app.getVersion(),
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let lastStage = '';
    const operation = args[0] || 'security-tool';
    const timeoutMs = operation === 'migrate-db' ? 20 * 60 * 1000 : operation === 'validate-db' ? 2 * 60 * 1000 : 45 * 1000;
    const timer = setTimeout(() => {
      killProcessTree(child).catch(() => {});
      const seconds = Math.round(timeoutMs / 1000);
      reject(new Error(`${operation} excedeu ${seconds} segundos. O banco original foi preservado; tente novamente.`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr = (stderr + text).slice(-16000);
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('VYZIUM_SECURITY_STAGE:')) {
          lastStage = line.slice('VYZIUM_SECURITY_STAGE:'.length).trim();
          continue;
        }
        if (line.startsWith('VYZIUM_SECURITY_PROGRESS:')) {
          try {
            const payload = JSON.parse(line.slice('VYZIUM_SECURITY_PROGRESS:'.length));
            if (window && !window.isDestroyed()) window.webContents.send('security-progress', payload);
          } catch (_) {}
        }
      }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const numericCode = Number(code);
        const unsignedCode = Number.isFinite(numericCode) ? (numericCode >>> 0) : null;
        const hexCode = unsignedCode === null ? '' : ` (0x${unsignedCode.toString(16).toUpperCase().padStart(8, '0')})`;
        const stageText = lastStage ? `; etapa: ${lastStage}` : '';
        let detail = '';
        try {
          const candidate = stderr.trim().split(/\r?\n/).filter(Boolean).reverse().find(line => line.trim().startsWith('{'));
          const parsed = JSON.parse(candidate || '{}');
          detail = parsed.error || '';
        } catch (_) {}
        if (!detail) {
          detail = stderr
            .split(/\r?\n/)
            .filter(line => line && !line.startsWith('VYZIUM_SECURITY_STAGE:') && !line.startsWith('VYZIUM_SECURITY_PROGRESS:'))
            .join('\n')
            .trim();
        }
        const exitText = unsignedCode === null ? 'processo encerrado' : `saída ${unsignedCode}${hexCode}`;
        return reject(new Error(`${operation}${stageText}; ${exitText}. ${detail || 'O motor encerrou sem informar a causa.'}`));
      }
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
        resolve(JSON.parse(line));
      } catch (_) {
        reject(new Error('O motor de segurança retornou uma resposta inválida.'));
      }
    });
  });
}

async function startWorkspaceServices() {
  fullDiagnostics?.stage('Inicializacao dos servicos', 'INICIO');
  if (workspaceServicesStarted) return;
  const security = await securityManager.status();
  if (!security.ready) throw new Error('Conclua a proteção dos dados antes de abrir o Vyzium.');
  // Fail closed before starting any operational service if the protected root key
  // cannot be unwrapped or an existing SQLCipher database fails integrity/key
  // validation. Fresh accounts without a database are allowed and the engine will
  // create a new encrypted database on first use.
  securityManager.getModuleKeyHex('followup');
  securityManager.getModuleKeyHex('compras');
  await securityManager.validateProtectedDatabases();
  fullDiagnostics?.stage('Seguranca e bancos validados', 'OK');
  whatsapp = new WhatsAppSession(securityManager.whatsappDir(), {
    profileDataDir: securityManager.whatsappRuntimeDir(),
    fullDiagnosticEvent: (event, details) => {
      fullDiagnostics?.event(event, details);
      // Only high-value technical failures are promoted remotely. The reporter
      // deduplicates them locally, sanitizes details, and never controls recovery.
      if (shouldPromoteWhatsAppEvent(event)) {
        try { sentryReporter?.captureException?.(new Error(`WhatsApp technical failure: ${String(event)}`), { source: String(event), details }); } catch (_) {}
      }
    },
    hiddenBrowserDiagnosticLog: fullDiagnostics ? path.join(fullDiagnostics.dir, 'hidden-browser.log') : null
  });
  fullDiagnostics?.stage('Sessao WhatsApp criada', 'OK', {diagnosticDirectory:whatsapp.diagnosticDirectory()});
  whatsappBridge = await startBridge(whatsapp, engineToken);
  fullDiagnostics?.stage('Bridge local do WhatsApp iniciado', 'OK');
  workspaceServicesStarted = true;
  startEngine('followup').catch(error => {
    console.error('[followup-engine]', error);
    if (window && !window.isDestroyed()) {
      window.webContents.send('engine-status', { module: 'followup', error: error.message });
    }
  });
  fullDiagnostics?.stage('AutoStart do WhatsApp solicitado', 'OK');
  whatsapp.autoStart();
}

async function stopWorkspaceServices() {
  await stopAllEngines();
  await Promise.resolve(whatsapp?.shutdown()).catch(() => {});
  try { if (whatsapp?.auditFile) fullDiagnostics?.copy(whatsapp.auditFile, 'whatsapp-debug.jsonl'); } catch (_) {}
  if (whatsappBridge?.server) {
    await new Promise(resolve => whatsappBridge.server.close(() => resolve())).catch(() => {});
  }
  whatsapp = null;
  whatsappBridge = null;
  workspaceServicesStarted = false;
}

async function enterApplication() {
  await startWorkspaceServices();
  activeModule = 'home';
  overviewCache = null;
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.webContents.setZoomFactor(0.85);
  return true;
}

async function returnToAuth() {
  activeModule = 'auth';
  overviewCache = null;
  await stopWorkspaceServices();
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'auth.html'));
  window.webContents.setZoomFactor(0.85);
}

async function createWindow(initialPage = 'auth.html') {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#eef3f7',
    title: 'Vyzium',
    icon: appIconPath(),
    webPreferences: {
      zoomFactor: 0.85,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false
    }
  });
  window.removeMenu();

  // Build estável: DevTools permanece indisponível e os atalhos comuns são bloqueados.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const devToolsShortcut = input.key === 'F12'
      || (input.control && input.shift && ['i','j','c'].includes(key));
    if (devToolsShortcut) event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setZoomFactor(0.85);
  await window.loadFile(path.join(__dirname, '..', 'renderer', initialPage));
  window.webContents.setZoomFactor(0.85);
}

ipcMain.handle('api', async (_event, { method, route, body }) => {
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const blocksNavigation = normalizedMethod !== 'GET';
  if (blocksNavigation) activeRequests++;
  try {
    const result = await apiRequest(normalizedMethod, route, body);
    if (blocksNavigation) overviewCache = null;
    return result;
  } finally {
    if (blocksNavigation) activeRequests--;
  }
});

ipcMain.handle('switch-module', async (_event, target) => {
  if (!workspaceServicesStarted) throw new Error('Entre na sua conta Vyzium.');
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  if (!['followup', 'compras'].includes(target)) throw new Error('Módulo inválido.');
  if (activeRequests) throw new Error('Aguarde a operação atual terminar antes de trocar de módulo.');
  if (navigationBusy) throw new Error('Aguarde a troca de tela terminar.');
  navigationBusy = true;
  try {
    if (target === 'compras') await startEngine('compras');
    else await startEngine('followup');
    const previousModule = activeModule;
    activeModule = target;
    const page = target === 'compras' ? 'compras.html' : 'acompanhamento.html';
    try {
      await window.loadFile(path.join(__dirname, '..', 'renderer', page));
    } catch (error) {
      activeModule = previousModule;
      throw error;
    }
    if (target === 'followup') await stopComprasEngine();
    return true;
  } finally {
    navigationBusy = false;
  }
});

ipcMain.handle('go-home', async () => {
  if (!workspaceServicesStarted) throw new Error('Entre na sua conta Vyzium.');
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  if (activeRequests) throw new Error('Aguarde a operação atual terminar.');
  if (navigationBusy) throw new Error('Aguarde a troca de tela terminar.');
  navigationBusy = true;
  try {
    const previousModule = activeModule;
    activeModule = 'home';
    try {
      await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    } catch (error) {
      activeModule = previousModule;
      throw error;
    }
    // A Visão geral usa o motor de Compras, quando já aberto, apenas para obter
    // seu resumo. getOverview() o encerra logo depois para recuperar a RAM.
    return true;
  } finally {
    navigationBusy = false;
  }
});

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('renderer-error', (_event, payload = {}) => {
  try {
    const rendererError = new Error(String(payload.message || 'Erro no renderer').slice(0, 1200));
    if (payload.stack) rendererError.stack = String(payload.stack).slice(0, 5000);
    sentryReporter?.captureException?.(rendererError, { source: 'renderer', details: { page: String(payload.page || activeModule || '').slice(0, 80) } });
  } catch (_) {}
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const safe = {
      at: new Date().toISOString(),
      page: String(payload.page || activeModule || '').slice(0, 80),
      message: String(payload.message || 'Erro no renderer').slice(0, 1200),
      stack: String(payload.stack || '').split('\n').slice(0, 12).join('\n').slice(0, 5000)
    };
    fs.appendFileSync(path.join(dir, 'renderer-errors.jsonl'), JSON.stringify(safe) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch (_) {}
  return true;
});
ipcMain.handle('get-overview', () => getOverview());
ipcMain.handle('copy-text', (_event, value) => { clipboard.writeText(String(value || '')); return true; });
ipcMain.handle('check-updates', () => updater.check());
ipcMain.handle('set-zoom', (_event, percent) => {
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 70 || value > 120) throw new Error('Zoom inválido.');
  if (window && !window.isDestroyed()) window.webContents.setZoomFactor(value / 100);
  return value;
});
ipcMain.handle('choose-workbook', async () => {
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  const isCompras = activeModule === 'compras';
  const result = await dialog.showOpenDialog(window, {
    title: isCompras ? 'Selecionar BASE SCI de compras' : 'Selecionar base de acompanhamento',
    properties: ['openFile'],
    filters: [{ name: 'Planilhas do Excel', extensions: isCompras ? ['xls', 'xlsx', 'xlsm'] : ['xlsx', 'xlsm'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('save-export', async (_event, mapId) => {
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  if (activeModule !== 'compras') throw new Error('Abra Cotação & Mapas para exportar.');
  activeRequests++;
  try {
    const result = await requestEngine('compras', 'GET', '/export?id=' + encodeURIComponent(mapId));
    const chosen = await dialog.showSaveDialog(window, {
      defaultPath: result.filename,
      filters: [{ name: 'Mapa Excel', extensions: ['xls'] }]
    });
    if (chosen.canceled) return false;
    await fs.promises.writeFile(chosen.filePath, Buffer.from(result.content, 'base64'));
    return true;
  } finally {
    activeRequests--;
  }
});


ipcMain.handle('auth-state', () => authManager.getState());
ipcMain.handle('auth-register', (_event, body) => authManager.register(body || {}));
ipcMain.handle('auth-login', (_event, body) => authManager.login(body || {}));
ipcMain.handle('auth-resend-verification', () => authManager.resendVerification());
ipcMain.handle('auth-refresh-verification', () => authManager.refreshVerification());
ipcMain.handle('auth-reset-password', (_event, email) => authManager.resetPassword(email));
ipcMain.handle('security-status', () => securityManager.status());
ipcMain.handle('security-setup', async () => {
  if (workspaceServicesStarted) await stopWorkspaceServices();
  return securityManager.prepare();
});
ipcMain.handle('security-finalize', async () => {
  if (workspaceServicesStarted) await stopWorkspaceServices();
  return securityManager.finalize();
});
ipcMain.handle('security-recover', (_event, code) => securityManager.recoverWithCode(code));
ipcMain.handle('security-enter-app', async () => {
  const auth = authManager.getState();
  if (!auth.authenticated || !auth.emailVerified) throw new Error('Confirme sua conta antes de continuar.');
  const security = await securityManager.status();
  if (!security.ready) throw new Error('Conclua a proteção dos dados antes de abrir o Vyzium.');
  return enterApplication();
});
ipcMain.handle('auth-logout', async () => {
  const result = authManager.logout();
  securityManager.clearKeyFromMemory();
  await returnToAuth();
  return result;
});

app.whenReady().then(async () => {
  fullDiagnostics = new FullDiagnostics(app);
  // Fail-open remote monitoring: initialization is local-only and cannot block startup.
  // Any Sentry/network failure is swallowed by the isolated reporter.
  try {
    sentryReporter = createSentryReporter({ app, environment: app.isPackaged ? 'production' : 'development' });
    fullDiagnostics.setRemoteReporter(sentryReporter);
  } catch (_) { sentryReporter = null; }
  fullDiagnostics.system();
  fullDiagnostics.stage('Electron app.ready', 'OK');
  process.on('uncaughtException', error => fullDiagnostics?.error('process.uncaughtException', error));
  process.on('unhandledRejection', reason => fullDiagnostics?.error('process.unhandledRejection', reason instanceof Error ? reason : new Error(String(reason))));
  app.on('render-process-gone', (_event, wc, details) => fullDiagnostics?.error('electron.render-process-gone', new Error(details?.reason || 'renderer gone'), {exitCode:details?.exitCode, url:wc?.getURL?.()}));
  app.on('child-process-gone', (_event, details) => fullDiagnostics?.error('electron.child-process-gone', new Error(details?.reason || 'child gone'), {type:details?.type,name:details?.name,exitCode:details?.exitCode,serviceName:details?.serviceName}));
  try {
    fullDiagnostics.stage('Bootstrap principal', 'INICIO');
    firebaseClient = new FirebaseClient();
    fullDiagnostics.stage('Firebase client construido', 'OK');
    authManager = new AuthManager({ firebase: firebaseClient, safeStorage, userDataDir: app.getPath('userData') });
    securityManager = new SecurityManager({
      app,
      safeStorage,
      firebase: firebaseClient,
      auth: authManager,
      runSecurityTool,
      reportProgress: payload => {
        if (window && !window.isDestroyed()) window.webContents.send('security-progress', payload);
      }
    });

    updater = createUpdater({
      app,
      dialog,
      getWindow: () => window,
      prepareInstall: async () => {
        if (!workspaceServicesStarted) {
          throw new Error('Entre no Vyzium antes de instalar a atualização para que os bancos sejam protegidos por backup.');
        }
        if (activeRequests) throw new Error('Aguarde a operação atual terminar e tente novamente.');
        if (navigationBusy) throw new Error('Aguarde a troca de tela terminar e tente novamente.');
        updating = true;
        try {
          if (followupEngineUrl) {
            const state = await requestEngine('followup', 'GET', '/send-status');
            if (state?.active) throw new Error('Existe um envio em andamento. Aguarde e tente novamente.');
          }

          // Backups created in secure mode remain SQLCipher-encrypted with the
          // same per-module key. No plaintext backup is produced by the updater.
          await requestEngine('followup', 'POST', '/data-safety/backup', {
            reason: `pre-update-${app.getVersion()}`,
            automatic: true
          });
          await requestEngine('compras', 'POST', '/data-safety/backup', {
            reason: `pre-update-${app.getVersion()}`,
            automatic: true
          });

          if (followupEngineUrl) {
            const response = await fetch(`${followupEngineUrl}/prepare-update`, {
              method: 'POST',
              headers: { 'X-FollowUp-Token': engineToken },
              signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error('Existe um envio em andamento. Aguarde e tente novamente.');
          }
        } catch (error) {
          updating = false;
          throw error;
        }
        app.isQuitting = true;
        await stopWorkspaceServices();
        quitting = true;
      }
    });

    const restored = await authManager.restore();
    fullDiagnostics.stage('Estado de autenticacao restaurado', 'OK', {authenticated:Boolean(restored.authenticated),emailVerified:Boolean(restored.emailVerified)});
    let security = null;
    if (restored.authenticated && restored.emailVerified) {
      security = await securityManager.status();
    }
    const ready = Boolean(restored.authenticated && restored.emailVerified && security?.ready);
    activeModule = ready ? 'home' : 'auth';
    if (ready) {
      await startWorkspaceServices();
      await createWindow('index.html');
    } else {
      await createWindow('auth.html');
    }
  } catch (error) {
    fullDiagnostics?.error('app.bootstrap', error);
    fullDiagnostics?.stage('Bootstrap principal', 'FALHA', {error:error.message});
    dialog.showErrorBox('Falha ao iniciar', `${error.message}\n\nO Vyzium não alterou seus bancos de dados.`);
    app.quit();
  }
});

app.on('before-quit', event => {
  try { if (whatsapp?.auditFile) fullDiagnostics?.copy(whatsapp.auditFile, 'whatsapp-debug.jsonl'); } catch (_) {}
  if (quitting) {
    try { fullDiagnostics?.finalize({reason:'before-quit'}); } catch (_) {}
    return;
  }
  event.preventDefault();
  if (shutdownPromise) return;
  app.isQuitting = true;
  shutdownPromise = Promise.resolve(stopWorkspaceServices()).catch(error => {
    try { fullDiagnostics?.error('app.shutdown', error); } catch (_) {}
  }).finally(() => {
    // Stop the browser before running diagnostic compression. Finalize is
    // idempotent, including the second before-quit raised by app.quit().
    try { fullDiagnostics?.finalize({reason:'before-quit'}); } catch (_) {}
    quitting = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
