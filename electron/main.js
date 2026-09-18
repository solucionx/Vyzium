const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const {WhatsAppSession, startBridge} = require('./whatsapp');
let whatsapp;
let whatsappBridge;
let quitting = false;
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {if (window) {window.restore(); window.focus();}});

let window;
let engine;
let engineUrl;
let updating = false;
let activeRequests = 0;
const { createUpdater } = require('./updates');
let updater;
const engineToken = crypto.randomBytes(24).toString('hex');

function engineCommand() {
  if (app.isPackaged) {
    return {
      executable: path.join(process.resourcesPath, 'backend', 'followup-engine.exe'),
      args: []
    };
  }
  const python = process.env.FOLLOWUP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  return {
    executable: python,
    args: [path.join(__dirname, '..', 'backend', 'engine.py')]
  };
}

function startEngine() {
  return new Promise((resolve, reject) => {
    const command = engineCommand();
    engine = spawn(command.executable, [...command.args, 'serve', '--port', '0'], {
      env: {
        ...process.env,
        FOLLOWUP_DATA_DIR: app.getPath('userData'),
        FOLLOWUP_API_TOKEN: engineToken,
        FOLLOWUP_WHATSAPP_URL: whatsappBridge.url,
        PYTHONUNBUFFERED: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let buffer = '';
    const timeout = setTimeout(() => reject(new Error('O motor Python não iniciou a tempo.')), 20000);
    engine.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.event === 'ready') {
            clearTimeout(timeout);
            engineUrl = `http://127.0.0.1:${event.port}`;
            resolve();
          }
        } catch (_) {
          console.log('[engine]', line);
        }
      }
    });
    engine.stderr.on('data', chunk => console.error('[engine]', chunk.toString()));
    engine.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    engine.once('exit', code => {
      if (!app.isQuitting && window) {
        dialog.showErrorBox('Motor encerrado', `O motor do aplicativo foi encerrado (código ${code}).`);
      }
    });
  });
}

async function apiRequest(method, route, body) {
  if (method === 'GET' && route === '/whatsapp/status') return whatsapp.status();
  if (method === 'POST' && route === '/whatsapp/connect') return whatsapp.connect();
  if (method === 'POST' && route === '/whatsapp/pause') return whatsapp.pause();
  if (!engineUrl) throw new Error('Motor ainda não está pronto.');
  const normalizedMethod = String(method || '').toUpperCase();
  const routePath = String(route || '').split('?')[0];
  const allowed = {
    GET: new Set(['/health', '/dashboard', '/orders', '/order', '/filters', '/suppliers', '/preview', '/history', '/settings', '/send-status']),
    POST: new Set(['/import', '/supplier', '/order-control', '/settings', '/send', '/send-start', '/followup-reviewed'])
  };
  if (!allowed[normalizedMethod]?.has(routePath)) throw new Error('Operação local não permitida.');
  const response = await fetch(`${engineUrl}${route}`, {
    method: normalizedMethod,
    headers: {
      'Content-Type': 'application/json',
      'X-FollowUp-Token': engineToken
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);
  return payload;
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#071521',
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

  // Mantém a escala visual exatamente como na v1.2.8.
  // O zoomFactor em webPreferences continua como fallback; esta chamada
  // garante a escala de 85% também após a criação do webContents.
  window.webContents.setZoomFactor(0.85);
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.webContents.setZoomFactor(0.85);
}

ipcMain.handle('api', async (_event, { method, route, body }) => {
  if (updating) throw new Error('Atualização em instalação. Aguarde a reabertura do Vyzium.');
  activeRequests++;
  try { return await apiRequest(method, route, body); }
  finally { activeRequests--; }
});
ipcMain.handle('check-updates', () => updater.check());
ipcMain.handle('set-zoom', (_event, percent) => {
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 70 || value > 120) throw new Error('Zoom inválido.');
  if (window && !window.isDestroyed()) window.webContents.setZoomFactor(value / 100);
  return value;
});
ipcMain.handle('choose-workbook', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: 'Selecionar base de acompanhamento',
    properties: ['openFile'],
    filters: [{ name: 'Planilhas do Excel', extensions: ['xlsx', 'xlsm'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
app.whenReady().then(async () => {
  try {
    whatsapp = new WhatsAppSession(path.join(app.getPath('userData'), 'whatsapp-session'));
    whatsappBridge = await startBridge(whatsapp, engineToken);
    await startEngine();
    updater = createUpdater({
      app, dialog, getWindow: () => window,
      prepareInstall: async () => {
        if (activeRequests) throw new Error('Aguarde a operação atual terminar e tente novamente.');
        updating = true;
        try {
          const response = await fetch(`${engineUrl}/prepare-update`, {
            method: 'POST', headers: {'X-FollowUp-Token': engineToken},
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) throw new Error('Existe um envio em andamento. Aguarde e tente novamente.');
        } catch (error) { updating = false; throw error; }
        app.isQuitting = true;
        await Promise.resolve(whatsapp?.shutdown()).catch(() => {});
        whatsappBridge?.server.close();
        if (engine && engine.exitCode === null) {
          if (process.platform === 'win32') {
            // PyInstaller onefile has a bootloader child; close the entire tree.
            await new Promise((resolve, reject) => {
              const killer = spawn('taskkill', ['/PID', String(engine.pid), '/T', '/F'], {windowsHide: true});
              killer.once('error', reject);
              killer.once('exit', code => code === 0 || engine.exitCode !== null
                ? resolve() : reject(new Error('Não foi possível encerrar o motor para atualizar.')));
            });
          } else {
            await new Promise(resolve => { engine.once('exit', resolve); engine.kill(); });
          }
        }
        // quitAndInstall must not be canceled by the ordinary async quit handler.
        quitting = true;
      }
    });
    await createWindow();
    // Mantém a sessão do WhatsApp viva em segundo plano. A preferência de
    // pausa é persistida: se o usuário pausou, o app respeita isso no próximo início.
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
  if (engine && !engine.killed) engine.kill();
  whatsappBridge?.server.close();
  Promise.resolve(whatsapp?.shutdown()).catch(() => {}).finally(() => {quitting = true; app.quit();});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
