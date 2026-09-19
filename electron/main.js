'use strict';

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WhatsAppSession, startBridge } = require('./whatsapp');
const { createUpdater } = require('./updates');

let window;
let whatsapp;
let whatsappBridge;
let updater;
let quitting = false;
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

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

function followupDataDir() {
  // Mantém o mesmo userData do Vyzium 2.1 para preservar followup.db,
  // configurações, filtros e a sessão já existente do WhatsApp.
  return app.getPath('userData');
}

function comprasDataDir() {
  // Mantém a base do antigo Vyzium Compras no local original. Os módulos
  // continuam independentes e nenhuma memória operacional é compartilhada.
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
  const state = engineState(moduleName);
  if (state.url) return Promise.resolve(state.url);
  if (state.promise) return state.promise;

  state.promise = new Promise((resolve, reject) => {
    const command = engineCommand(moduleName);
    const child = spawn(command.executable, [...command.args, 'serve', '--port', '0'], {
      env: {
        ...process.env,
        FOLLOWUP_DATA_DIR: moduleDataDir(moduleName),
        FOLLOWUP_API_TOKEN: engineToken,
        FOLLOWUP_WHATSAPP_URL: whatsappBridge.url,
        PYTHONUNBUFFERED: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    state.process = child;

    let buffer = '';
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
    child.stderr.on('data', chunk => console.error(`[${moduleName}-engine]`, chunk.toString()));
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
        reject(new Error(`O motor de ${moduleName === 'compras' ? 'Cotação & Mapas' : 'Acompanhamento'} encerrou antes de iniciar.`));
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
    GET: new Set(['/health', '/overview', '/dashboard', '/orders', '/order', '/filters', '/suppliers', '/preview', '/history', '/settings', '/send-status']),
    POST: new Set(['/import', '/supplier', '/order-control', '/settings', '/send', '/send-start', '/followup-reviewed'])
  },
  compras: {
    GET: new Set(['/health', '/overview', '/items', '/maps', '/map', '/preview', '/history', '/settings', '/export']),
    POST: new Set(['/import', '/maps/create', '/maps/save', '/maps/archive', '/settings', '/send', '/review'])
  }
};

function engineRequestTimeout(moduleName, method, routePath) {
  // Imports may legitimately take longer on large workbooks. Cotação /send
  // waits for WhatsApp readiness before sending, so it also needs a larger window.
  if (routePath === '/import') return 300000;
  if (routePath === '/export') return 120000;
  if (moduleName === 'compras' && String(method).toUpperCase() === 'POST' && routePath === '/send') return 240000;
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
  if (method === 'GET' && route === '/whatsapp/status') return whatsapp.status();
  if (method === 'POST' && route === '/whatsapp/connect') return whatsapp.connect();
  if (method === 'POST' && route === '/whatsapp/pause') return whatsapp.pause();
  if (!['followup', 'compras'].includes(activeModule)) throw new Error('Entre em um módulo para realizar esta operação.');
  // Os dois módulos usam a mesma sessão do WhatsApp. Impedir que uma cotação
  // concorra com um lote de follow-up que esteja rodando em segundo plano.
  if (activeModule === 'compras' && String(method).toUpperCase() === 'POST' && route === '/send') {
    try {
      const state = await requestEngine('followup', 'GET', '/send-status');
      if (state?.active) throw new Error('O Acompanhamento possui um lote de WhatsApp em andamento. Aguarde a conclusão antes de enviar uma cotação.');
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
      env: { ...process.env, FOLLOWUP_DATA_DIR: comprasDataDir(), PYTHONUNBUFFERED: '1' },
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

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#eef3f7',
    title: 'Vyzium',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      zoomFactor: 0.85,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setZoomFactor(0.85);
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.webContents.setZoomFactor(0.85);
}

ipcMain.handle('api', async (_event, { method, route, body }) => {
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  activeRequests++;
  try {
    const result = await apiRequest(method, route, body);
    if (String(method).toUpperCase() !== 'GET') overviewCache = null;
    return result;
  } finally {
    activeRequests--;
  }
});

ipcMain.handle('switch-module', async (_event, target) => {
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

ipcMain.handle('get-overview', () => getOverview());
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

app.whenReady().then(async () => {
  try {
    whatsapp = new WhatsAppSession(path.join(followupDataDir(), 'whatsapp-session'));
    whatsappBridge = await startBridge(whatsapp, engineToken);

    updater = createUpdater({
      app,
      dialog,
      getWindow: () => window,
      prepareInstall: async () => {
        if (activeRequests) throw new Error('Aguarde a operação atual terminar e tente novamente.');
        if (navigationBusy) throw new Error('Aguarde a troca de tela terminar e tente novamente.');
        updating = true;
        try {
          // O follow-up pode executar lotes em segundo plano mesmo quando a tela
          // de Compras está aberta. Sempre pedir ao motor principal para validar.
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
        await Promise.resolve(whatsapp?.shutdown()).catch(() => {});
        whatsappBridge?.server.close();
        await stopAllEngines();
        quitting = true;
      }
    });

    await createWindow();

    // O acompanhamento é o motor de fundo do Vyzium: mantém agendamento,
    // cache e automações sem bloquear a primeira pintura da Visão geral.
    startEngine('followup').catch(error => {
      console.error('[followup-engine]', error);
      if (window && !window.isDestroyed()) {
        window.webContents.send('engine-status', { module: 'followup', error: error.message });
      }
    });
    whatsapp.autoStart();
  } catch (error) {
    dialog.showErrorBox('Falha ao iniciar', `${error.message}\n\nInstale as dependências do motor e tente novamente.`);
    app.quit();
  }
});

app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  app.isQuitting = true;
  Promise.allSettled([
    stopAllEngines(),
    Promise.resolve(whatsapp?.shutdown()).catch(() => {})
  ]).finally(() => {
    whatsappBridge?.server.close();
    quitting = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
