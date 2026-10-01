'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const SANDBOX_APP_ID = 'com.vyzium.visualsandbox';
const sandboxRoot = path.join(app.getPath('appData'), 'Vyzium-Visual-Sandbox');

app.setName('Vyzium Visual Sandbox');
app.setPath('userData', sandboxRoot);
try { app.setPath('sessionData', path.join(sandboxRoot, 'session')); } catch (_) {}
try { app.setAppLogsPath(path.join(sandboxRoot, 'logs')); } catch (_) {}

if (process.platform === 'win32') {
  app.setAppUserModelId(SANDBOX_APP_ID);
}

let mainWindow = null;

if (!app.requestSingleInstanceLock()) app.exit(0);

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function iconPath() {
  const ico = path.join(__dirname, '..', 'build', 'icon.ico');
  const png = path.join(__dirname, '..', 'build', 'icon.png');
  return process.platform === 'win32' && fs.existsSync(ico) ? ico : png;
}

function isLocalFile(url) {
  return typeof url === 'string' && url.startsWith('file://');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#eef2f4',
    title: 'Vyzium - Sandbox Visual',
    icon: iconPath(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      webSecurity: true,
      webviewTag: false
    }
  });

  mainWindow.removeMenu();

  const wc = mainWindow.webContents;
  wc.setZoomFactor(0.85);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!isLocalFile(url)) event.preventDefault();
  });
  wc.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (
      input.key === 'F12' ||
      (input.control && input.shift && ['i', 'j', 'c'].includes(key)) ||
      (input.control && key === 'r')
    ) {
      event.preventDefault();
    }
  });

  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'visual-sandbox.html'));
  wc.setZoomFactor(0.85);
  mainWindow.show();
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  );
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
