const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const {spawn} = require('child_process');

function findBrowser() {
  const candidates = [process.env.VYZIUM_BROWSER_PATH];
  for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
    if (base) {
      for (const suffix of ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']) {
        candidates.push(path.join(base, suffix));
      }
    }
  }
  candidates.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  const browser = candidates.find(p => p && fs.existsSync(p));
  if (!browser) throw new Error('Instale o Microsoft Edge ou Google Chrome para conectar o WhatsApp.');
  return browser;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeBrowserWSEndpoint(value) {
  if (typeof value !== 'string') return null;
  const endpoint = value.trim();
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    if (!['ws:','wss:'].includes(parsed.protocol)) return null;
    if (!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) return null;
    if (!/^\/devtools\/browser\/[^/]+$/.test(parsed.pathname)) return null;
    return endpoint;
  } catch (_) {
    return null;
  }
}

function resolveHiddenBrowserHelperPath() {
  const bundled = path.join(__dirname, 'whatsapp-hidden-browser.ps1');
  const unpacked = bundled.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (unpacked !== bundled && fs.existsSync(unpacked)) return unpacked;
  return bundled;
}

function launchHiddenHeadedBrowser({browser, userDataDir, generation = 0, spawnFn = spawn, timeoutMs = 55000, parentPid = process.pid, helperPath = resolveHiddenBrowserHelperPath(), diagnosticLog = null} = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('O inicializador invisível do Chrome está disponível apenas no Windows.'));
  if (!browser || !fs.existsSync(browser)) return Promise.reject(new Error('Executável do Chrome/Edge não encontrado para o WhatsApp.'));
  if (!userDataDir) return Promise.reject(new Error('Perfil LocalAuth não informado ao inicializador do WhatsApp.'));
  if (!helperPath || !fs.existsSync(helperPath)) return Promise.reject(new Error('Componente de inicialização invisível do WhatsApp não encontrado.'));

  fs.mkdirSync(userDataDir, {recursive:true, mode:0o700});
  const stopFile = path.join(os.tmpdir(), `vyzium-wa-stop-${process.pid}-${generation}-${crypto.randomBytes(6).toString('hex')}.flag`);
  try { fs.rmSync(stopFile, {force:true}); } catch (_) {}

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timer = null;
    let helper;
    const finishError = error => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { fs.writeFileSync(stopFile, 'stop', {encoding:'utf8', mode:0o600}); } catch (_) {}
      const message = stderr.trim() || error?.message || String(error || 'Falha ao iniciar o Chrome invisível.');
      reject(new Error(message.replace(/^VYZIUM_HIDDEN_BROWSER_ERROR:\s*/i, '').slice(0, 1800)));
    };

    try {
      helper = spawnFn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass', '-File', helperPath,
        '-BrowserPath', browser,
        '-UserDataDir', userDataDir,
        '-StopFile', stopFile,
        '-ParentPid', String(parentPid),
        '-WaitForDevToolsSeconds', '45',
        ...(diagnosticLog ? ['-DiagnosticLog', diagnosticLog] : [])
      ], {windowsHide:true, stdio:['ignore','pipe','pipe']});
    } catch (error) {
      finishError(error);
      return;
    }

    helper.stdout?.setEncoding?.('utf8');
    helper.stderr?.setEncoding?.('utf8');
    helper.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-12000); });
    helper.stdout?.on('data', chunk => {
      if (settled) return;
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      const line = stdout.slice(0, newline).trim().replace(/^\uFEFF/, '');
      if (!line) { stdout = stdout.slice(newline + 1); return; }
      try {
        const payload = JSON.parse(line);
        const endpoint = normalizeBrowserWSEndpoint(payload?.endpoint);
        if (!payload?.ok || !endpoint || !Number(payload?.pid)) {
          throw new Error('Resposta inválida do inicializador invisível: endpoint CDP malformado.');
        }
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({
          endpoint,
          pid:Number(payload.pid),
          helper,
          stopFile,
          profileDir:userDataDir,
          helperPath
        });
      } catch (error) {
        finishError(error);
      }
    });
    helper.once?.('error', finishError);
    helper.once?.('exit', (code, signal) => {
      if (!settled) finishError(new Error(`O inicializador invisível encerrou antes do Chrome ficar disponível (código ${code ?? 'n/a'}${signal ? `, ${signal}` : ''}).`));
    });
    timer = setTimeout(() => finishError(new Error('Tempo limite ao preparar o Chrome invisível do WhatsApp.')), Math.max(15000, Number(timeoutMs) || 55000));
    timer.unref?.();
  });
}

async function stopHiddenHeadedBrowser(hidden, timeoutMs = 7000, gracefulWaitMs = 3500) {
  if (!hidden) return;
  const helper = hidden.helper;

  // When whatsapp-web.js closes a browser connected through browserWSEndpoint,
  // Browser.close may resolve a little before chrome.exe has finished flushing
  // its LocalAuth profile. Do not immediately set the stop flag here: the helper
  // would then taskkill the browser tree and could lose the just-authenticated
  // IndexedDB/cookie state. First allow the helper to exit naturally because it
  // watches the real browser PID. Only force the helper/browser down if that
  // graceful window expires.
  if (helper && helper.exitCode == null && !helper.killed && gracefulWaitMs > 0) {
    await new Promise(resolve => {
      let done = false;
      let timer;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        helper.removeListener?.('exit', finish);
        helper.removeListener?.('error', finish);
        resolve();
      };
      helper.once?.('exit', finish);
      helper.once?.('error', finish);
      timer = setTimeout(finish, Math.max(250, Number(gracefulWaitMs) || 0));
      timer.unref?.();
    });
  }

  if (!helper || (helper.exitCode == null && !helper.killed)) {
    try { fs.writeFileSync(hidden.stopFile, 'stop', {encoding:'utf8', mode:0o600}); } catch (_) {}
  }

  if (helper && helper.exitCode == null && !helper.killed) {
    await bounded(new Promise(resolve => {
      const done = () => resolve();
      helper.once?.('exit', done);
      helper.once?.('error', done);
      setTimeout(done, Math.max(1000, timeoutMs)).unref?.();
    }), Math.max(1500, timeoutMs + 500), 'Tempo limite ao encerrar o inicializador invisível.').catch(() => {});
    if (helper.exitCode == null && !helper.killed) {
      try { helper.kill(); } catch (_) {}
    }
  }
  try { fs.rmSync(hidden.stopFile, {force:true}); } catch (_) {}
}


function hideWindowsForPid(pid, spawnFn = spawn) {
  if (process.platform !== 'win32') return false;
  const targetPid = Number(pid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) return false;

  // Keep Chrome in headed mode for WhatsApp/CacheStorage reliability, but make
  // the automation window behave like a background helper instead of a user
  // application window. Chrome can recreate/re-show its HWND long after launch
  // (notably while restoring an authenticated WhatsApp session), so the watcher
  // remains alive for the lifetime of THIS browser process rather than stopping
  // after a fixed startup window.
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VyziumWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern IntPtr GetWindowLong32(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] public static extern IntPtr SetWindowLong32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLong32(hWnd, nIndex);
  }
  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr value) {
    return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, nIndex, value) : SetWindowLong32(hWnd, nIndex, value);
  }
}
"@
$targetPid = ${targetPid}
$GWL_EXSTYLE = -20
$WS_EX_APPWINDOW = 0x00040000
$WS_EX_TOOLWINDOW = 0x00000080
$SW_HIDE = 0
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020
$setPosFlags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED

while (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {
  [VyziumWin32]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    [uint32]$windowPid = 0
    [VyziumWin32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid) | Out-Null
    if ($windowPid -eq $targetPid) {
      $stylePtr = [VyziumWin32]::GetWindowLongPtr($hWnd, $GWL_EXSTYLE)
      $style = $stylePtr.ToInt64()
      $style = ($style -band (-bnot [int64]$WS_EX_APPWINDOW)) -bor [int64]$WS_EX_TOOLWINDOW
      [VyziumWin32]::SetWindowLongPtr($hWnd, $GWL_EXSTYLE, [IntPtr]$style) | Out-Null
      [VyziumWin32]::SetWindowPos($hWnd, [IntPtr]::Zero, 0, 0, 0, 0, $setPosFlags) | Out-Null
      [VyziumWin32]::ShowWindow($hWnd, $SW_HIDE) | Out-Null
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 250
}
`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  try {
    const child = spawnFn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
    ], {windowsHide:true, detached:true, stdio:'ignore'});
    child.unref?.();
    return true;
  } catch (_) {
    return false;
  }
}


function isExecutionContextError(error) {
  const message = String(error?.message || error || '');
  return /Execution context was destroyed|Cannot find context with specified id|Target closed|detached Frame/i.test(message);
}

function normalizeBrowserMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (['headless','1','true','yes','on'].includes(mode)) return 'headless';
  if (['headed','headful','visible','0','false','no','off'].includes(mode)) return 'headed';
  return null;
}

function resolveBrowserMode(deps = {}) {
  // Vyzium is a Windows desktop app. On the affected machines the exact
  // CacheStorage failure only occurs in the automated headless path, while
  // the same installed Chrome + a brand-new profile succeeds visibly. Use a
  // normal headed Chrome (minimized on Windows) as the reliability-first
  // default. A diagnostic override remains available for controlled A/B tests.
  return normalizeBrowserMode(deps.browserMode)
    || normalizeBrowserMode(process.env.VYZIUM_WHATSAPP_BROWSER_MODE)
    || 'headed';
}

function isFatalCacheStorageError(text) {
  const value = String(text || '');
  return /Failed to execute ['"]open['"] on ['"]CacheStorage['"]:\s*Unexpected internal error/i.test(value)
    || /storage_initialization_error|storage-initialization-error/i.test(value);
}

function messageIdentity(message) {
  if (!message) return null;
  if (typeof message === 'string') return message.trim() || null;
  const id = message.id ?? message?._data?.id;
  if (typeof id === 'string') return id.trim() || null;
  if (id && typeof id._serialized === 'string' && id._serialized) return id._serialized;
  // Some whatsapp-web.js/WA Web combinations expose the raw id without
  // _serialized for a short period immediately after sendMessage().
  if (id && typeof id.id === 'string' && id.id) return id.id;
  return null;
}

function phoneCandidates(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return [];
  const candidates = [digits];

  // High-confidence repair for legacy Brazilian mobile numbers:
  // +55 + DDD (2) + old 8-digit mobile beginning with 6-9.
  if (digits.startsWith('55') && digits.length === 12 && /[6-9]/.test(digits[4])) {
    const repaired = `${digits.slice(0, 4)}9${digits.slice(4)}`;
    if (!candidates.includes(repaired)) candidates.push(repaired);
  }
  return candidates;
}

async function bounded(promise, ms, message = 'Tempo limite excedido.') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class WhatsAppSession {
  constructor(dataDir, deps = {}) {
    this.dataDir = dataDir;
    // Keep Vyzium metadata/audit in the workspace (Roaming), but keep the
    // Chromium/LocalAuth profile in a local, non-roaming directory on Windows.
    // Chrome itself stores profile + cache under %LOCALAPPDATA% on Windows.
    this.profileDataDir = deps.profileDataDir || dataDir;
    this.deps = deps;
    this.client = null;
    this.starting = null;
    this.startupWatchdog = null;
    this.startupTimeoutMs = Number(deps.startupTimeoutMs || 120000);
    this.qrWatchdog = null;
    // WhatsApp Web rotates the QR roughly every 20s. If no new `qr` event and no
    // authentication arrive within this window, the displayed code is dead and
    // whatsapp-web.js has stopped retrying (qrMaxRetries exhausted or the page
    // stalled). Renew the session so the panel never shows an unusable QR.
    this.qrStaleTimeoutMs = Number(deps.qrStaleTimeoutMs || 75000);
    this.busy = false;
    this.generation = 0;
    this.sendTimeoutMs = Number(deps.sendTimeoutMs || 45000);
    this.numberTimeoutMs = Number(deps.numberTimeoutMs || 15000);
    this.healthTimeoutMs = Number(deps.healthTimeoutMs || 5000);
    this.healthIntervalMs = Number(deps.healthIntervalMs || 15000);
    this.healthFailureThreshold = Number(deps.healthFailureThreshold || 3);
    this.authenticatedTimeoutMs = Number(deps.authenticatedTimeoutMs || 45000);
    this.reconnectBaseMs = Number(deps.reconnectBaseMs || 5000);
    this.reconnectMaxMs = Number(deps.reconnectMaxMs || 60000);
    this.readyAt = 0;
    this.lastHealthCheckAt = 0;
    this.lastAckAt = 0;
    this.monitorTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.consecutiveHealthFailures = 0;
    this.lastHealthyAt = 0;
    this.authenticatedAt = 0;
    this.preferenceFile = path.join(this.dataDir, 'connection-preference.json');
    // Legacy metadata is kept for backwards compatibility only. session-state.json
    // is the single source of truth from 3.1.23 onward.
    this.authProfileFile = path.join(this.dataDir, 'auth-profile.json');
    this.sessionEstablishedFile = path.join(this.dataDir, 'session-established.json');
    this.sessionStateFile = path.join(this.dataDir, 'session-state.json');
    this.auditFile = path.join(this.dataDir, 'whatsapp-debug.jsonl');
    this.auditBootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.auditSequence = 0;
    this.browserMode = resolveBrowserMode(deps);
    this.storageFallbackGeneration = null;
    this.storageFallbackDelayMs = Number(deps.storageFallbackDelayMs || 250);
    this.authFailureCount = 0;

    // Session state is transactional: an established profile remains active while
    // a new QR is prepared in a separate pending profile. No boot-time path is
    // allowed to delete a LocalAuth profile merely because metadata diverged.
    this.sessionState = this._loadOrMigrateSessionState();
    this.activeClientId = this.sessionState.activeClientId || null;
    this.pendingClientId = this.sessionState.pendingClientId || null;
    if (this.activeClientId) {
      this.authClientId = this.activeClientId;
      this.firstConnectionPending = false;
      this._migrateEstablishedProfileToRuntime();
    } else if (this.pendingClientId) {
      this.authClientId = this.pendingClientId;
      this.firstConnectionPending = true;
    } else {
      this.authClientId = this._newAuthClientId();
      this.firstConnectionPending = true;
      this._setPendingSession(this.authClientId, {reason:'first-connection'});
    }
    this.requiresNewQr = false;
    this.userPaused = this._loadPausedPreference();
    this.state = this.userPaused
      ? {status:'paused', qr:null, account:null, error:null}
      : {status:'offline', qr:null, account:null, error:null};
    this._audit('session.created', {
      firstConnectionPending:this.firstConnectionPending,
      paused:this.userPaused,
      profile:this.authClientId,
      profileStorageSeparated:path.resolve(this.profileDataDir) !== path.resolve(this.dataDir),
      metadataDir:this.dataDir,
      profileDataDir:this.profileDataDir,
      node:process.version,
      platform:process.platform,
      arch:process.arch
    });
  }

  status() {
    return {
      ...this.state,
      busy: this.busy,
      monitoring: Boolean(this.monitorTimer) && !this.userPaused,
      lastHealthCheckAt: this.lastHealthCheckAt || null,
      lastHealthyAt: this.lastHealthyAt || null,
      lastAckAt: this.lastAckAt || null,
      healthFailures: this.consecutiveHealthFailures,
      firstConnectionPending: this.firstConnectionPending,
      auditEnabled:true,
      auditFile:path.basename(this.auditFile),
      generation:this.generation,
      browserMode:this.browserMode
    };
  }

  _safeAuditValue(value, depth = 0) {
    if (depth > 4) return '[depth-limit]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (value instanceof Error) return {name:value.name, message:String(value.message || value), stack:String(value.stack || '').split('\n').slice(0, 8).join('\n')};
    if (typeof value === 'string') {
      let text = value.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[QR_IMAGE_REDACTED]');
      text = text.replace(/\b\d{10,15}\b/g, match => `${match.slice(0, 4)}***${match.slice(-2)}`);
      if (text.length > 1800) text = `${text.slice(0, 1800)}…`;
      return text;
    }
    if (Array.isArray(value)) return value.slice(0, 30).map(item => this._safeAuditValue(item, depth + 1));
    if (typeof value === 'object') {
      const clean = {};
      for (const [key, item] of Object.entries(value)) {
        if (/qr|cookie|token|secret|credential|message/i.test(key)) {
          clean[key] = '[REDACTED]';
        } else {
          clean[key] = this._safeAuditValue(item, depth + 1);
        }
      }
      return clean;
    }
    return String(value);
  }

  _audit(event, details = {}) {
    try { this.deps.fullDiagnosticEvent?.(`whatsapp.${String(event)}`, details); } catch (_) {}
    try {
      fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
      try {
        if (fs.existsSync(this.auditFile) && fs.statSync(this.auditFile).size > 5 * 1024 * 1024) {
          fs.renameSync(this.auditFile, `${this.auditFile}.previous`);
        }
      } catch (_) {}
      const entry = {
        at:new Date().toISOString(),
        seq:++this.auditSequence,
        boot:this.auditBootId,
        event:String(event),
        generation:this.generation,
        status:this.state?.status || null,
        details:this._safeAuditValue(details)
      };
      fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`, {encoding:'utf8', mode:0o600});
    } catch (_) {}
  }

  diagnostics(limit = 400) {
    let lines = [];
    try {
      lines = fs.readFileSync(this.auditFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-Math.max(20, Math.min(2000, Number(limit) || 400)));
    } catch (_) {}
    return {
      enabled:true,
      fileName:path.basename(this.auditFile),
      entries:lines.map(line => {
        try { return JSON.parse(line); }
        catch (_) { return {event:'audit.parse-error', details:{line:line.slice(0, 500)}}; }
      }),
      text:lines.join('\n')
    };
  }

  clearDiagnostics() {
    try { fs.rmSync(this.auditFile, {force:true}); } catch (_) {}
    this.auditSequence = 0;
    this._audit('audit.cleared');
    return this.diagnostics();
  }

  diagnosticDirectory() {
    fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
    return this.dataDir;
  }

  _validClientId(value) {
    const id = String(value || '').trim();
    return /^[-_\w]+$/i.test(id) ? id : null;
  }

  _profileExists(clientId) {
    const id = this._validClientId(clientId);
    if (!id) return false;
    return [this.profileDataDir, this.dataDir].some(root => {
      try { return fs.existsSync(path.join(root, `session-${id}`)); }
      catch (_) { return false; }
    });
  }

  _writeSessionState(nextState) {
    const normalizeId = value => this._validClientId(value);
    const state = {
      schemaVersion:1,
      activeClientId:normalizeId(nextState?.activeClientId),
      pendingClientId:normalizeId(nextState?.pendingClientId),
      previousClientId:normalizeId(nextState?.previousClientId),
      state:String(nextState?.state || 'empty'),
      committedAt:nextState?.committedAt || null,
      pendingCreatedAt:nextState?.pendingCreatedAt || null,
      updatedAt:new Date().toISOString()
    };
    if (state.activeClientId && state.pendingClientId === state.activeClientId) state.pendingClientId = null;
    if (state.previousClientId && state.previousClientId === state.activeClientId) state.previousClientId = null;
    fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
    const temp = `${this.sessionStateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), {encoding:'utf8', mode:0o600});
    fs.renameSync(temp, this.sessionStateFile);
    this.sessionState = state;
    this.activeClientId = state.activeClientId;
    this.pendingClientId = state.pendingClientId;
    return state;
  }

  _discoverLegacyProfileCandidate() {
    const candidates = [];
    let legacyProfileId = null;
    let legacyMarkerId = null;
    let legacyEstablished = false;
    try {
      const profile = JSON.parse(fs.readFileSync(this.authProfileFile, 'utf8'));
      legacyProfileId = this._validClientId(profile?.clientId);
    } catch (_) {}
    try {
      const marker = JSON.parse(fs.readFileSync(this.sessionEstablishedFile, 'utf8'));
      legacyMarkerId = this._validClientId(marker?.clientId);
      legacyEstablished = marker?.established === true;
    } catch (_) {}

    // A legacy profile is considered committed only when the two historical
    // metadata files agree on the exact same client id.  A session-* directory
    // by itself is never proof that WhatsApp authentication completed.
    if (legacyEstablished && legacyMarkerId && legacyProfileId &&
        legacyMarkerId === legacyProfileId && this._profileExists(legacyMarkerId)) {
      return {clientId:legacyMarkerId, established:true, source:'legacy-metadata-agreement'};
    }
    if (legacyProfileId && this._profileExists(legacyProfileId)) {
      candidates.push({clientId:legacyProfileId, established:false, source:'legacy-profile-unverified', mtime:0});
    }
    if (legacyMarkerId && this._profileExists(legacyMarkerId)) {
      candidates.push({clientId:legacyMarkerId, established:false, source:'legacy-marker-unverified', mtime:0});
    }

    for (const root of [...new Set([this.profileDataDir, this.dataDir])]) {
      try {
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
          const match = /^session-(.+)$/i.exec(entry.name);
          if (!entry.isDirectory() || !match) continue;
          const clientId = this._validClientId(match[1]);
          if (!clientId) continue;
          let mtime = 0;
          try { mtime = fs.statSync(path.join(root, entry.name)).mtimeMs || 0; } catch (_) {}
          candidates.push({clientId, established:false, source:'profile-discovery', mtime});
        }
      } catch (_) {}
    }
    if (!candidates.length) return null;
    const preferred = candidates.find(item => item.clientId === 'vyzium');
    if (preferred) return preferred;
    candidates.sort((a,b) => b.mtime - a.mtime);
    return candidates[0];
  }

  _loadOrMigrateSessionState() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionStateFile, 'utf8'));
      if (Number(raw?.schemaVersion) === 1) {
        const state = {
          schemaVersion:1,
          activeClientId:this._validClientId(raw.activeClientId),
          pendingClientId:this._validClientId(raw.pendingClientId),
          previousClientId:this._validClientId(raw.previousClientId),
          state:String(raw.state || 'empty'),
          committedAt:raw.committedAt || null,
          pendingCreatedAt:raw.pendingCreatedAt || null,
          updatedAt:raw.updatedAt || null
        };
        // Metadata can be interrupted independently from Chromium. Never delete a
        // profile here. Only drop pointers that provably have no directory.
        if (state.activeClientId && !this._profileExists(state.activeClientId)) state.activeClientId = null;
        if (state.pendingClientId && !this._profileExists(state.pendingClientId)) state.pendingClientId = null;
        if (state.previousClientId && !this._profileExists(state.previousClientId)) state.previousClientId = null;
        return this._writeSessionState(state);
      }
    } catch (_) {}

    const legacy = this._discoverLegacyProfileCandidate();
    if (legacy) {
      const migrated = this._writeSessionState({
        activeClientId:legacy.clientId,
        pendingClientId:null,
        previousClientId:null,
        state:legacy.established ? 'established' : 'legacy_unverified',
        committedAt:legacy.established ? new Date().toISOString() : null
      });
      this._audit?.('profile.state-migrated', {clientId:legacy.clientId, established:legacy.established, source:legacy.source});
      return migrated;
    }
    return this._writeSessionState({activeClientId:null, pendingClientId:null, previousClientId:null, state:'empty'});
  }

  _setPendingSession(clientId, details = {}) {
    const id = this._validClientId(clientId);
    if (!id) throw new Error('Identificador local do WhatsApp inválido.');
    const oldPending = this.sessionState?.pendingClientId;
    const state = this._writeSessionState({
      ...this.sessionState,
      pendingClientId:id,
      state:this.sessionState?.activeClientId ? 'rotating' : 'pending',
      pendingCreatedAt:new Date().toISOString()
    });
    this.pendingClientId = id;
    this.firstConnectionPending = !state.activeClientId;
    this._audit?.('profile.pending-set', {clientId:id, replacedPending:oldPending && oldPending !== id ? oldPending : null, ...details});
    return oldPending && oldPending !== id && oldPending !== state.activeClientId ? oldPending : null;
  }

  _retirePreviousProfileWhenSafe(currentClientId) {
    const previous = this.sessionState?.previousClientId;
    if (!previous || previous === currentClientId) return;
    const timer = setTimeout(async () => {
      try {
        // Only retire after the newly active profile has reached ready again on a
        // later boot/reconnect. This preserves one rollback profile across commit.
        if (this.sessionState?.activeClientId !== currentClientId || this.state?.status !== 'ready') return;
        await this._cleanupAuthProfile(previous);
        if (this.sessionState?.activeClientId === currentClientId && this.sessionState?.previousClientId === previous) {
          this._writeSessionState({...this.sessionState, previousClientId:null});
          this._audit('profile.previous-retired', {previous, active:currentClientId});
        }
      } catch (error) { this._audit('profile.previous-retire-error', {previous, error}); }
    }, 5000);
    timer.unref?.();
  }

  async _quarantineAuthProfile(clientId, reason = 'invalid') {
    const id = this._validClientId(clientId);
    if (!id) return null;
    const source = this._authSessionDir(id);
    if (!fs.existsSync(source)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.profileDataDir, `quarantine-${reason}-${id}-${stamp}`);
    try {
      await fs.promises.rename(source, destination);
      this._audit('profile.quarantined', {clientId:id, reason, destination:path.basename(destination)});
      return destination;
    } catch (error) {
      this._audit('profile.quarantine-error', {clientId:id, reason, error});
      return null;
    }
  }

  _hasEstablishedSession() {
    return Boolean(this.sessionState?.activeClientId && this.sessionState?.state === 'established');
  }

  _beginPendingSession() {
    // Kept for compatibility with older call sites. It must never delete an
    // established profile or metadata. Rotation is committed by _setPendingSession.
    this.firstConnectionPending = !this.sessionState?.activeClientId;
  }

  _purgeUnconfirmedSessionFiles() {
    // 3.1.23 intentionally performs no destructive boot-time purge. A damaged
    // pointer can be repaired; a deleted Chromium profile cannot.
    this._audit?.('profile.initial-purge-skipped', {reason:'non-destructive-session-state'});
  }

  _migrateEstablishedProfileToRuntime() {
    // v3.1.8 and older placed LocalAuth under app.getPath('userData'), which is
    // normally AppData\\Roaming on Windows. Starting with v3.1.9 the Chromium
    // profile is local-only. Preserve an already established login by moving the
    // selected session directory once. Copy+remove is the cross-volume fallback.
    if (path.resolve(this.profileDataDir) === path.resolve(this.dataDir)) return;
    const source = path.join(this.dataDir, `session-${this.authClientId}`);
    const destination = path.join(this.profileDataDir, `session-${this.authClientId}`);
    if (!fs.existsSync(source) || fs.existsSync(destination)) return;
    try {
      fs.mkdirSync(this.profileDataDir, {recursive:true, mode:0o700});
      try {
        fs.renameSync(source, destination);
      } catch (_) {
        fs.cpSync(source, destination, {recursive:true, force:false, errorOnExist:false});
        fs.rmSync(source, {recursive:true, force:true, maxRetries:12, retryDelay:250});
      }
      this._audit?.('profile.runtime-migrated', {
        clientId:this.authClientId,
        from:'workspace-userData',
        to:'local-runtime'
      });
    } catch (error) {
      this._audit?.('profile.runtime-migration-error', {clientId:this.authClientId, error});
      // Do not invalidate a proven session marker just because migration failed.
      // initialize() will surface the real browser error and the user can request
      // a fresh QR, which rotates to a clean local-only profile.
    }
  }

  _markSessionEstablished() {
    const current = this._validClientId(this.authClientId);
    if (!current) throw new Error('Identificador local do WhatsApp inválido.');
    const oldActive = this.sessionState?.activeClientId || null;
    const previous = this.sessionState?.previousClientId || null;
    const stalePending = this.sessionState?.pendingClientId && this.sessionState.pendingClientId !== current
      ? this.sessionState.pendingClientId : null;
    const isConfirmationOfCurrentActive = oldActive === current;
    const nextPrevious = isConfirmationOfCurrentActive ? previous : oldActive;
    this._writeSessionState({
      ...this.sessionState,
      activeClientId:current,
      pendingClientId:null,
      previousClientId:nextPrevious && nextPrevious !== current ? nextPrevious : null,
      state:'established',
      committedAt:new Date().toISOString(),
      pendingCreatedAt:null
    });
    this.activeClientId = current;
    this.pendingClientId = null;
    this.firstConnectionPending = false;
    this.authFailureCount = 0;

    // Keep legacy metadata synchronized so downgrades/diagnostics can still find
    // the selected profile, but it is no longer the source of truth.
    try { this._saveAuthClientId(current); } catch (_) {}
    try {
      const temp = `${this.sessionEstablishedFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({established:true, clientId:current, establishedAt:new Date().toISOString()}), {encoding:'utf8', mode:0o600});
      fs.renameSync(temp, this.sessionEstablishedFile);
    } catch (_) {}
    if (isConfirmationOfCurrentActive && previous) this._retirePreviousProfileWhenSafe(current);
    if (isConfirmationOfCurrentActive && stalePending && stalePending !== previous) {
      const timer = setTimeout(() => this._cleanupAuthProfile(stalePending).catch(() => {}), 5000);
      timer.unref?.();
    }
  }

  _setAuthClientId(clientId, persist = false) {
    const value = this._validClientId(clientId);
    if (!value) throw new Error('Identificador local do WhatsApp inválido.');
    this.authClientId = value;
    if (persist) this._saveAuthClientId(value);
  }

  _loadPausedPreference() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.preferenceFile, 'utf8'));
      return raw?.paused === true;
    } catch (_) {
      return false;
    }
  }

  _savePausedPreference(paused) {
    try {
      fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
      const temp = `${this.preferenceFile}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({paused:Boolean(paused)}), {encoding:'utf8', mode:0o600});
      fs.renameSync(temp, this.preferenceFile);
    } catch (_) {
      // A failure to persist this preference must not break WhatsApp itself.
    }
  }

  _loadAuthClientId() {
    const stateId = this._validClientId(this.sessionState?.activeClientId || this.sessionState?.pendingClientId);
    if (stateId) return stateId;
    try {
      const raw = JSON.parse(fs.readFileSync(this.authProfileFile, 'utf8'));
      const value = this._validClientId(raw?.clientId);
      if (value) return value;
    } catch (_) {}
    return 'vyzium';
  }

  _saveAuthClientId(clientId) {
    const value = String(clientId || '').trim();
    if (!/^[-_\w]+$/i.test(value)) throw new Error('Identificador local do WhatsApp inválido.');
    fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
    const temp = `${this.authProfileFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({clientId:value}), {encoding:'utf8', mode:0o600});
    fs.renameSync(temp, this.authProfileFile);
    this.authClientId = value;
  }

  _newAuthClientId() {
    // Rotating the LocalAuth clientId is more reliable on Windows than trying
    // to reuse/delete a Chromium profile that may still be locked by a process
    // finishing in the background. Every explicit "novo QR" gets a truly clean
    // browser profile, while the selected profile is persisted for future starts.
    return `vyzium-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _authSessionDir(clientId = this.authClientId) {
    return path.join(this.profileDataDir, `session-${clientId}`);
  }

  async _cleanupAuthProfile(clientId) {
    if (!clientId) return;
    const dir = this._authSessionDir(clientId);
    this._audit('profile.cleanup-start', {clientId, dir:path.basename(dir)});
    try {
      await fs.promises.rm(dir, {recursive:true, force:true, maxRetries:12, retryDelay:250});
      this._audit('profile.cleanup-complete', {clientId});
    } catch (error) {
      this._audit('profile.cleanup-error', {clientId, error});
      // A stale Chromium process can keep files locked for a few seconds on
      // Windows. Cleanup is best-effort; profile rotation means this must never
      // prevent a new QR code from being generated.
    }
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  _clearStartupWatchdog() {
    if (this.startupWatchdog) clearTimeout(this.startupWatchdog);
    this.startupWatchdog = null;
  }

  _clearQrWatchdog() {
    if (this.qrWatchdog) clearTimeout(this.qrWatchdog);
    this.qrWatchdog = null;
  }

  _armQrWatchdog(generation, client) {
    this._clearQrWatchdog();
    this.qrWatchdog = setTimeout(() => {
      this.qrWatchdog = null;
      if (generation !== this.generation || this.client !== client) return;
      if (this.userPaused || this.busy || this.state.status !== 'qr') return;
      // Renew instead of leaving a stale image on screen. restartConnection()
      // keeps the same LocalAuth profile, so this is not a logout.
      this.restartConnection().catch(() => this._scheduleReconnect(false));
    }, Math.max(5000, this.qrStaleTimeoutMs));
    this.qrWatchdog.unref?.();
  }

  async _disposeClient(client, timeout = 10000) {
    if (!client) return;
    const browser = client.pupBrowser;
    const hiddenBrowser = client.__vyziumHiddenBrowser || null;
    let child = null;
    try { child = typeof browser?.process === 'function' ? browser.process() : null; } catch (_) {}
    const pid = Number(hiddenBrowser?.pid || child?.pid || 0) || null;
    this._audit('client.dispose-start', {pid, timeout});
    let destroyTimedOut = false;
    try {
      await bounded(Promise.resolve(client.destroy()), timeout, 'Tempo limite ao encerrar o navegador do WhatsApp.');
      this._audit('client.destroy-resolved', {pid});
    } catch (error) {
      destroyTimedOut = true;
      this._audit('client.destroy-error', {pid, error});
    }

    // When Client.initialize() stalls, whatsapp-web.js can leave the Chromium
    // process alive even after destroy() stops responding. Close/kill only the
    // browser launched by this specific client; never touch the user's normal
    // Edge/Chrome processes.
    if (browser && (destroyTimedOut || this.client !== client || child?.exitCode == null)) {
      try {
        if (typeof browser.close === 'function') {
          await bounded(Promise.resolve(browser.close()), 3500, 'Tempo limite ao fechar o navegador do WhatsApp.');
          this._audit('browser.close-resolved', {pid});
        }
      } catch (error) { this._audit('browser.close-error', {pid, error}); }
      try {
        if (child && child.exitCode == null && !child.killed && typeof child.kill === 'function') {
          this._audit('browser.kill-start', {pid, platform:process.platform});
          if (process.platform === 'win32' && pid) {
            await bounded(new Promise(resolve => {
              const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'});
              killer.once('close', resolve);
              killer.once('error', resolve);
            }), 5000, 'Tempo limite ao finalizar a árvore do navegador.').catch(() => {});
          } else {
            try { child.kill('SIGKILL'); } catch (_) { try { child.kill(); } catch (_) {} }
          }
        }
      } catch (error) { this._audit('browser.kill-error', {pid, error}); }
    }
    if (hiddenBrowser) {
      try {
        const stopLauncher = this.deps.stopHiddenHeadedBrowser || stopHiddenHeadedBrowser;
        await stopLauncher(hiddenBrowser, 7000);
        this._audit('browser.pre-show-guard-stopped', {pid});
      } catch (error) { this._audit('browser.pre-show-guard-stop-error', {pid, error}); }
      try { client.__vyziumHiddenBrowser = null; } catch (_) {}
    }
    this._audit('client.dispose-complete', {pid, exited:child ? child.exitCode != null || child.killed === true : hiddenBrowser ? true : null});
  }

  async _recoverFatalHeadlessStorage(generation, client, source = 'console') {
    if (generation !== this.generation || this.client !== client) return;
    if (this.userPaused || this.busy || this.state.status !== 'starting') return;
    if (this.storageFallbackGeneration === generation) return;
    this.storageFallbackGeneration = generation;
    this.browserMode = 'headed';
    this._audit('browser.storage-fallback-start', {generation, source, from:'headless', to:'headed'});

    // Invalidate callbacks from the broken headless page before disposing it.
    // This is intentionally profile-preserving: the storage backend failed,
    // not the WhatsApp credentials. The same LocalAuth profile is reopened in
    // a normal Chrome process so the QR/auth flow can continue.
    const stalledStarting = this.starting;
    this.generation++;
    this.client = null;
    this.starting = null;
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    if (stalledStarting && typeof stalledStarting.catch === 'function') stalledStarting.catch(() => {});
    await this._disposeClient(client, 8000);
    if (this.userPaused || this.busy) return;

    this.state = {status:'offline', qr:null, account:null, error:null};
    this._audit('browser.storage-fallback-restart', {source, mode:'headed'});
    this._connectInternal({browserMode:'headed', reason:'fatal-cache-storage'}).catch(error => {
      if (!this.userPaused && !['qr','authenticated','ready'].includes(this.state.status)) {
        this.state = {
          status:'error', qr:null, account:null,
          error:error?.message || 'O Chrome não conseguiu inicializar o armazenamento necessário do WhatsApp.'
        };
      }
    });
  }

  _armStartupWatchdog(generation, options = {}) {
    this._clearStartupWatchdog();
    const timeout = Math.max(25, Number(options.timeoutMs || this.startupTimeoutMs));
    this.startupWatchdog = setTimeout(() => {
      this.startupWatchdog = null;
      this._recoverStalledStartup(generation, options).catch(() => {});
    }, timeout);
    this.startupWatchdog.unref?.();
  }

  async _recoverStalledStartup(generation, options = {}) {
    if (generation !== this.generation || this.userPaused || this.busy || this.state.status !== 'starting') return;
    this._audit('watchdog.startup-fired', {generation, options});

    // Invalidate every callback/promise from the stalled browser first. The old
    // initialize() promise may remain pending, but it can no longer mutate the
    // active session because all event handlers are generation/client guarded.
    const stalledClient = this.client;
    const stalledStarting = this.starting;
    this.generation++;
    this.client = null;
    this.starting = null;
    if (stalledStarting && typeof stalledStarting.catch === 'function') stalledStarting.catch(() => {});

    await this._disposeClient(stalledClient, 8000);
    if (this.userPaused || this.busy) return;

    const retriesLeft = Math.max(0, Number(options.stallRetries || 0));
    if (options.rotateProfileOnStall && retriesLeft > 0) {
      const freshClientId = this._newAuthClientId();
      const disposablePending = this._setPendingSession(freshClientId, {reason:'startup-stall'});
      this._setAuthClientId(freshClientId, false);
      if (disposablePending) await this._cleanupAuthProfile(disposablePending);
      this.state = {status:'offline', qr:null, account:null, error:null};
      this._connectInternal({...options, stallRetries:retriesLeft - 1}).catch(() => {});
      return;
    }

    this.state = {
      status:'error',
      qr:null,
      account:null,
      error:'O navegador do WhatsApp não iniciou corretamente dentro do prazo. Clique em Gerar novo QR Code para tentar novamente.'
    };
  }

  _scheduleReconnect(immediate = false) {
    if (this.userPaused || this.requiresNewQr || this.reconnectTimer || this.starting || this.busy) return;
    if (['starting','qr','authenticated'].includes(this.state.status)) return;
    const attempt = this.reconnectAttempts++;
    const wait = immediate ? 0 : Math.min(this.reconnectMaxMs, this.reconnectBaseMs * Math.max(1, 2 ** Math.min(attempt, 4)));
    this._audit('reconnect.scheduled', {attempt, wait, immediate});
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userPaused || this.busy) return;
      this._connectInternal().catch(() => this._scheduleReconnect(false));
    }, wait);
    this.reconnectTimer.unref?.();
  }

  startMonitoring() {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(async () => {
      if (this.userPaused || this.busy || this.starting) return;
      if (this.state.status === 'qr') return;
      if (this.state.status === 'authenticated') {
        if (!this.authenticatedAt) this.authenticatedAt = Date.now();
        if (Date.now() - this.authenticatedAt < this.authenticatedTimeoutMs) return;
        // A session can occasionally authenticate but never reach `ready`.
        // Treat that as a stalled synchronization and renew it silently instead
        // of leaving a batch waiting forever at the same percentage.
        try { await this.restartConnection(); }
        catch (_) { this._scheduleReconnect(false); }
        return;
      }
      if (this.state.status === 'ready') {
        const healthy = await this.connectionHealthy();
        if (healthy) {
          this.consecutiveHealthFailures = 0;
          this.reconnectAttempts = 0;
          return;
        }
        this.consecutiveHealthFailures += 1;
        // One delayed getState() is not enough to tear down a healthy-looking
        // session. Only consecutive failures promote it to offline.
        if (this.consecutiveHealthFailures < this.healthFailureThreshold) return;
        this.readyAt = 0;
        this.state = {status:'offline', qr:null, account:null, error:'Conexão interrompida. O Vyzium está tentando restaurá-la automaticamente.'};
      }
      if (['offline','error'].includes(this.state.status)) this._scheduleReconnect(false);
    }, this.healthIntervalMs);
    this.monitorTimer.unref?.();
  }

  async backgroundHealthCheck() {
    this.startMonitoring();
    if (this.userPaused) return {healthy:false, paused:true, status:'paused'};
    if (this.busy || this.starting || ['qr','starting'].includes(this.state.status)) {
      return {healthy:false, paused:false, status:this.state.status};
    }
    if (this.state.status === 'authenticated') {
      if (!this.authenticatedAt) this.authenticatedAt = Date.now();
      if (Date.now() - this.authenticatedAt >= this.authenticatedTimeoutMs) {
        try { await this.restartConnection(); }
        catch (_) { this._scheduleReconnect(false); }
      }
      return {healthy:false, paused:false, status:this.state.status};
    }
    if (this.state.status === 'ready') {
      const healthy = await this.connectionHealthy();
      if (healthy) {
        this.consecutiveHealthFailures = 0;
        this.reconnectAttempts = 0;
        return {healthy:true, paused:false, status:'ready'};
      }
      this.consecutiveHealthFailures += 1;
      if (this.consecutiveHealthFailures >= this.healthFailureThreshold) {
        this.readyAt = 0;
        this.state = {status:'offline', qr:null, account:null, error:'Conexão interrompida. O Vyzium está tentando restaurá-la automaticamente.'};
      }
    }
    if (['offline','error'].includes(this.state.status)) this._scheduleReconnect(false);
    return {healthy:false, paused:false, status:this.state.status};
  }

  autoStart() {
    this.startMonitoring();
    this._audit('action.auto-start', {firstConnectionPending:this.firstConnectionPending, paused:this.userPaused});
    if (!this.userPaused) {
      if (this.firstConnectionPending) {
        // First launch (including the first launch after upgrading from an older
        // build): never attempt to restore legacy credentials. A fresh LocalAuth
        // profile was selected in the constructor, so go straight to a new QR.
        this._clearReconnectTimer();
        this._connectInternal({rotateProfileOnStall:true, stallRetries:1}).catch(() => {});
      } else {
        this._scheduleReconnect(true);
      }
    }
    return this.status();
  }

  _rememberAck(message, ack) {
    // whatsapp-web.js still reports delivery acknowledgements for messages this
    // session sent. They are no longer used to gate a send (a completed
    // sendMessage() is the success signal), but the timestamp of the last
    // positive ACK is a cheap, useful liveness indicator in status().
    if (typeof ack !== 'number' || ack < 1) return;
    if (!messageIdentity(message)) return;
    this.lastAckAt = Date.now();
  }

  connect() {
    this.userPaused = false;
    this.consecutiveHealthFailures = 0;
    this._savePausedPreference(false);
    this.startMonitoring();
    this._clearReconnectTimer();
    this._audit('action.connect');
    this._connectInternal().catch(() => {});
    return this.status();
  }

  async _initializeWithRecovery(generation, options = {}) {
    const maxAttempts = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this._audit('initialize.attempt', {generation, attempt, maxAttempts});
        return await this.initialize(generation, options);
      } catch (error) {
        lastError = error;
        this._audit('initialize.attempt-error', {generation, attempt, executionContextError:isExecutionContextError(error), error});
        if (!isExecutionContextError(error) || generation !== this.generation || this.userPaused || attempt >= maxAttempts) throw error;

        // whatsapp-web.js 1.34.7 can lose its Puppeteer execution context when
        // WhatsApp Web performs an internal navigation during Client.inject().
        // Tear down that browser instance and retry with the same LocalAuth
        // profile. No user data or session is deleted here.
        const failedClient = this.client;
        this.client = null;
        if (failedClient) await this._disposeClient(failedClient, 10000);
        if (generation !== this.generation || this.userPaused) return;
        this.state = {status:'starting', qr:null, account:null, error:null};
        await delay(700 * attempt);
      }
    }
    throw lastError;
  }

  async _connectInternal(options = {}) {
    if (this.userPaused || this.starting || ['starting','qr','authenticated','ready'].includes(this.state.status)) return this.status();
    this.state = {status:'starting', qr:null, account:null, error:null};
    const generation = ++this.generation;
    this._audit('connection.start', {generation, profile:this.authClientId, options});
    const starting = this._initializeWithRecovery(generation, options)
      .catch(error => {
        if (generation === this.generation && !this.userPaused) {
          this.state = {
            status:'error',
            qr:null,
            account:null,
            error: error?.message || 'Falha ao conectar. Confira a internet e se Edge ou Chrome está instalado.'
          };
        }
        throw error;
      })
      .finally(() => { if (this.starting === starting) this.starting = null; });
    this.starting = starting;
    this._armStartupWatchdog(generation, options);
    try {
      await starting;
      return this.status();
    } catch (error) {
      if (!this.userPaused && generation === this.generation) {
        this._clearStartupWatchdog();
        this._scheduleReconnect(false);
      }
      throw error;
    }
  }

  async initialize(generation, options = {}) {
    if (this.client) await this._disposeClient(this.client, 10000);
    if (generation !== this.generation) return;

    const {Client, LocalAuth} = this.deps.library || require('whatsapp-web.js');
    const qrCode = this.deps.qrCode || require('qrcode');
    const browser = this.deps.browser || findBrowser();
    fs.mkdirSync(this.dataDir, {recursive:true, mode:0o700});
    fs.mkdirSync(this.profileDataDir, {recursive:true, mode:0o700});
    const launchMode = normalizeBrowserMode(options.browserMode) || this.browserMode;
    const headless = launchMode === 'headless';
    const browserArgs = ['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'];
    // Keep native Windows behavior in production, while allowing unit tests to
    // inject a deterministic platform without spawning a real PowerShell/Chrome.
    // forcePreShowGuard still wins so the dedicated pre-show test exercises the
    // hidden-browser integration contract on every CI platform.
    const runtimePlatform = this.deps.platform || process.platform;
    const preShowGuard = !headless && (this.deps.forcePreShowGuard === true || runtimePlatform === 'win32');
    this._audit('browser.selected', {browser:path.basename(browser), executablePath:browser});
    this._audit('browser.launch-config', {generation, mode:launchMode, headless, args:browserArgs, preShowGuard});
    this._audit('browser.profile-storage', {
      generation,
      metadataDir:this.dataDir,
      profileDataDir:this.profileDataDir,
      separated:path.resolve(this.profileDataDir) !== path.resolve(this.dataDir)
    });
    this._audit('browser.bootstrap-policy', {
      generation,
      activeStorageProbe:false,
      startupTimeoutMs:this.startupTimeoutMs,
      reason:'A inicialização não executa CacheStorage/IndexedDB antes do QR ou ready.'
    });
    if (!this.deps.library) {
      try {
        const packageFile = require.resolve('whatsapp-web.js/package.json');
        const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        const puppeteerPackageFile = require.resolve('puppeteer/package.json', {paths:[path.dirname(packageFile)]});
        const puppeteerPkg = JSON.parse(fs.readFileSync(puppeteerPackageFile, 'utf8'));
        const clientFile = path.join(path.dirname(packageFile), 'src', 'Client.js');
        const source = fs.readFileSync(clientFile);
        this._audit('dependency.integrity', {
          whatsappWebJs:pkg.version,
          puppeteer:puppeteerPkg.version,
          clientSha256:crypto.createHash('sha256').update(source).digest('hex'),
          syntax:'loaded-by-node',
          hasVyziumPatch:source.includes('VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V6'),
          hasSafeNavigationOrder:source.includes('navigation recovery is installed only after the initial inject'),
          hasSignalStore:source.includes('WAWebSignalStoreApi'),
          hasRegistrationUtils:source.includes('AuthStore.RegistrationUtils'),
          hasRestoredSessionReplay:source.includes('Vyzium restored-session replay')
        });
      } catch (error) { this._audit('dependency.integrity-error', {error}); }
    }

    let hiddenBrowser = null;
    let puppeteerOptions = {headless, executablePath:browser, args:browserArgs};
    if (preShowGuard) {
      const sessionDir = this._authSessionDir();
      const hiddenLauncher = this.deps.launchHiddenHeadedBrowser || launchHiddenHeadedBrowser;
      this._audit('browser.pre-show-guard-start', {generation, sessionDir:path.basename(sessionDir)});
      hiddenBrowser = await hiddenLauncher({
        browser,
        userDataDir:sessionDir,
        generation,
        parentPid:process.pid,
        spawnFn:this.deps.spawn || spawn,
        diagnosticLog:this.deps.hiddenBrowserDiagnosticLog || null
      });
      puppeteerOptions = {
        headless:false,
        browserWSEndpoint:hiddenBrowser.endpoint
      };
      this._audit('browser.pre-show-guard-ready', {generation, pid:hiddenBrowser.pid, headless:false});
    }

    let client;
    try {
      client = new Client({
        authStrategy: new LocalAuth({clientId:this.authClientId, dataPath:this.profileDataDir, rmMaxRetries:12}),
        puppeteer:puppeteerOptions,
        // Do not pin a WhatsApp Web build. Let whatsapp-web.js use the current build
        // and its normal cache fallback. Pinned/stale builds are especially fragile.
        authTimeoutMs:120000,
        qrMaxRetries:10
      });
      if (hiddenBrowser) client.__vyziumHiddenBrowser = hiddenBrowser;
    } catch (error) {
      if (hiddenBrowser) {
        const stopLauncher = this.deps.stopHiddenHeadedBrowser || stopHiddenHeadedBrowser;
        await stopLauncher(hiddenBrowser, 7000).catch(() => {});
      }
      throw error;
    }

    this.client = client;
    this.readyAt = 0;
    let qrSequence = 0;
    let attachedBrowser = null;
    let attachedPage = null;
    const triggerFatalStorageRecovery = (source, text) => {
      if (!isFatalCacheStorageError(text)) return;
      this._audit('browser.storage-failure-detected', {generation, mode:launchMode, source, text:String(text || '').slice(0, 900)});
      if (!headless) return;
      const timer = setTimeout(() => {
        this._recoverFatalHeadlessStorage(generation, client, source).catch(error => {
          this._audit('browser.storage-fallback-error', {generation, source, error});
        });
      }, Math.max(0, this.storageFallbackDelayMs));
      timer.unref?.();
    };
    const attachRuntimeAudit = () => {
      try {
        if (client.pupBrowser && client.pupBrowser !== attachedBrowser) {
          attachedBrowser = client.pupBrowser;
          const child = typeof attachedBrowser.process === 'function' ? attachedBrowser.process() : null;
          const browserPid = child?.pid || hiddenBrowser?.pid || null;
          this._audit('puppeteer.browser-attached', {generation, pid:browserPid, preShowGuard:Boolean(hiddenBrowser)});
          if (!headless && runtimePlatform === 'win32' && browserPid && !hiddenBrowser) {
            const hidden = this.deps.hideBrowserWindow
              ? Boolean(this.deps.hideBrowserWindow(browserPid))
              : hideWindowsForPid(browserPid);
            this._audit('browser.window-hidden', {generation, pid:browserPid, requested:hidden});
          }
          try {
            Promise.resolve(attachedBrowser.version?.()).then(version => {
              if (version) this._audit('puppeteer.browser-version', {generation, version:String(version)});
            }).catch(error => this._audit('puppeteer.browser-version-error', {generation, error}));
          } catch (_) {}
          attachedBrowser.on?.('disconnected', () => this._audit('puppeteer.browser-disconnected', {generation, pid:child?.pid || null}));
        }
        if (client.pupPage && client.pupPage !== attachedPage) {
          attachedPage = client.pupPage;
          this._audit('puppeteer.page-attached', {generation});
          attachedPage.on?.('framenavigated', frame => {
            if (typeof frame.parentFrame === 'function' && frame.parentFrame() !== null) return;
            let url = '';
            try { url = frame.url(); } catch (_) {}
            const safeUrl = (() => {
              try {
                const parsed = new URL(url);
                const logout = parsed.searchParams.get('post_logout');
                return `${parsed.origin}${parsed.pathname}${logout != null ? `?post_logout=${logout}` : ''}`;
              } catch (_) { return String(url).slice(0, 500); }
            })();
            this._audit('page.navigation', {generation, url:safeUrl, postLogout:/post_logout=1/.test(url)});
          });
          attachedPage.on?.('console', message => {
            const text = message.text?.();
            this._audit('page.console', {generation, type:message.type?.(), text});
            triggerFatalStorageRecovery('console', text);
          });
          attachedPage.on?.('pageerror', error => this._audit('page.error', {generation, error}));
          attachedPage.on?.('requestfailed', request => this._audit('page.request-failed', {
            generation,
            url:String(request.url?.() || '').split('?')[0].slice(0, 500),
            failure:request.failure?.()?.errorText || null
          }));
          attachedPage.on?.('close', () => this._audit('page.closed', {generation}));
        }
      } catch (error) { this._audit('runtime-audit.attach-error', {generation, error}); }
    };
    const runtimeAuditTimer = setInterval(attachRuntimeAudit, 100);
    runtimeAuditTimer.unref?.();

    client.on('qr', async value => {
      if (this.client !== client || generation !== this.generation) return;
      this._audit('client.qr-received', {generation, sequence:qrSequence + 1, rawLength:String(value || '').length});
      this._clearStartupWatchdog();
      this._armQrWatchdog(generation, client);
      const sequence = ++qrSequence;
      this.state = {status:'qr', qr:null, account:null, error:null};
      try {
        const qr = await qrCode.toDataURL(value, {width:280, margin:3});
        if (this.client === client && sequence === qrSequence && this.state.status === 'qr') {
          this.state.qr = qr;
          this._audit('client.qr-image-ready', {generation, sequence});
        }
      } catch (error) {
        this._audit('client.qr-image-error', {generation, sequence, error});
        this.state.error = 'Não foi possível gerar o QR. Tente reconectar.';
      }
    });

    client.on('authenticated', () => {
      if (this.client === client && generation === this.generation) {
        this._clearStartupWatchdog();
        this._clearQrWatchdog();
        this.authenticatedAt = Date.now();
        this.state = {status:'authenticated', qr:null, account:null, error:null};
        this._audit('client.authenticated', {generation});
      }
    });

    client.on('ready', () => {
      if (this.client === client && generation === this.generation) {
        this._clearStartupWatchdog();
        this._clearQrWatchdog();
        this.requiresNewQr = false;
        this.readyAt = Date.now();
        this.authenticatedAt = 0;
        this.lastHealthCheckAt = Date.now();
        this.lastHealthyAt = Date.now();
        this.consecutiveHealthFailures = 0;
        this.reconnectAttempts = 0;
        this._clearReconnectTimer();
        try { this._markSessionEstablished(); }
        catch (_) {
          // Reaching ready proves that the current LocalAuth profile is the one
          // that must be reused. Keep the live connection usable even if the
          // metadata write fails; a later ready event can repair it again.
        }
        this.state = {status:'ready', qr:null, account:client.info?.wid?.user || null, error:null};
        this._audit('client.ready', {generation, accountPresent:Boolean(client.info?.wid?.user)});
      }
    });

    client.on('message_ack', (message, ack) => {
      if (this.client === client && generation === this.generation) this._rememberAck(message, ack);
    });

    client.on('auth_failure', reason => {
      if (this.client === client && generation === this.generation) {
        this.authFailureCount += 1;
        const currentIsCommitted = this.sessionState?.activeClientId === this.authClientId;
        this._audit('client.auth-failure', {generation, reason:String(reason || ''), attempts:this.authFailureCount, currentIsCommitted});
        this._clearStartupWatchdog();
        this._clearQrWatchdog();
        this.authenticatedAt = 0;
        if (currentIsCommitted && this.authFailureCount <= 1) {
          this.state = {status:'offline',qr:null,account:null,error:'A sessão não foi aceita nesta tentativa. O Vyzium fará uma única recuperação automática.'};
          this._scheduleReconnect(false);
        } else {
          this.requiresNewQr = true;
          this._clearReconnectTimer();
          this.state = {
            status:'error',qr:null,account:null,
            error:currentIsCommitted
              ? 'A sessão do WhatsApp não foi autorizada após a tentativa de recuperação. Gere um novo QR Code.'
              : 'O novo perfil do WhatsApp não foi autorizado. A sessão anterior foi preservada; gere um novo QR Code para tentar novamente.'
          };
        }
      }
    });

    client.on('disconnected', reason => {
      if (this.client === client && generation === this.generation) {
        this._clearStartupWatchdog();
        this._clearQrWatchdog();
        this.readyAt = 0;
        this.authenticatedAt = 0;
        this.lastHealthCheckAt = 0;
        const reasonText = String(reason || '').trim();
        const loggedOut = /LOGOUT/i.test(reasonText);
        this._audit('client.disconnected', {generation, reason:reasonText, loggedOut});
        if (loggedOut) {
          this.requiresNewQr = true;
          // LOGOUT invalidates the persisted WhatsApp credentials. Retrying the
          // same LocalAuth profile only reopens the logged-out profile and can
          // loop forever. Stop automatic reuse and require a genuinely fresh QR.
          this._clearReconnectTimer();
          this.reconnectAttempts = 0;
          this.state = {
            status:'offline',
            qr:null,
            account:null,
            error:'A sessão do WhatsApp foi encerrada. Clique em Gerar novo QR Code para conectar novamente.'
          };
          this._cleanupAfterLogout(client, generation).catch(error => {
            if (generation === this.generation) {
              this._audit('logout.cleanup-error', {generation, error});
            }
          });
          return;
        }
        this.requiresNewQr = false;
        this.state = {
          status:'offline',
          qr:null,
          account:null,
          error:`WhatsApp desconectado${reasonText ? ` (${reasonText})` : ''}. O Vyzium tentará restaurar a conexão automaticamente.`
        };
        this._scheduleReconnect(false);
      }
    });
    client.on('loading_screen', (percent, message) => this._audit('client.loading-screen', {generation, percent, message}));
    client.on('change_state', state => this._audit('client.change-state', {generation, state}));
    client.on('remote_session_saved', () => this._audit('client.remote-session-saved', {generation}));
    client.on('vyzium_navigation_error', error => this._audit('client.navigation-error', {generation, error}));
    client.on('vyzium_bootstrap_waiting', details => this._audit('client.bootstrap-waiting', {generation, ...(details || {})}));
    client.on('vyzium_bootstrap_stable', details => this._audit('client.bootstrap-stable', {generation, ...(details || {})}));
    client.on('vyzium_bootstrap_timeout', details => this._audit('client.bootstrap-timeout', {generation, ...(details || {})}));

    this._audit('client.initialize-start', {generation, profile:this.authClientId});
    try {
      await client.initialize();
      this._audit('client.initialize-resolved', {generation});
    } catch (error) {
      this._audit('client.initialize-rejected', {generation, error});
      throw error;
    } finally {
      clearInterval(runtimeAuditTimer);
      attachRuntimeAudit();
    }
  }

  async _cleanupAfterLogout(client, generation) {
    if (generation !== this.generation || this.client !== client) return;
    const loggedOutClientId = this.authClientId;
    this.generation++;
    this.client = null;
    this.starting = null;
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    this._audit('logout.cleanup-start', {oldGeneration:generation, loggedOutClientId});
    await this._disposeClient(client, 10000);
    await this._quarantineAuthProfile(loggedOutClientId, 'logout');

    const state = {...this.sessionState};
    if (state.activeClientId === loggedOutClientId) state.activeClientId = null;
    if (state.pendingClientId === loggedOutClientId) state.pendingClientId = null;
    if (state.previousClientId === loggedOutClientId) state.previousClientId = null;
    state.state = state.activeClientId ? 'established' : 'empty';
    this._writeSessionState(state);
    this.firstConnectionPending = !state.activeClientId;
    this.authClientId = state.activeClientId || this._newAuthClientId();
    this._audit('logout.cleanup-complete', {loggedOutClientId, preservedActive:state.activeClientId || null});
  }

  async restartConnection() {
    if (this.busy) throw new Error('Existe um envio em andamento.');
    this._audit('action.restart-connection');
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    const oldClient = this.client;
    this.client = null;
    this.readyAt = 0;
    this.authenticatedAt = 0;
    this.lastHealthCheckAt = 0;
    this.consecutiveHealthFailures = 0;
    this.generation++;
    const generation = this.generation;
    this.state = {status:'starting', qr:null, account:null, error:null};
    if (oldClient) await this._disposeClient(oldClient, 10000);

    const starting = this._initializeWithRecovery(generation)
      .catch(error => {
        if (generation === this.generation) {
          this.state = {status:'error', qr:null, account:null, error:error?.message || 'Falha ao renovar a conexão do WhatsApp.'};
        }
        throw error;
      })
      .finally(() => { if (this.starting === starting) this.starting = null; });
    this.starting = starting;
    this._armStartupWatchdog(generation, {stallRetries:0, timeoutMs:30000});

    try {
      await bounded(starting, 30000, 'O WhatsApp demorou demais para renovar a conexão.');
    } catch (error) {
      if (generation === this.generation && this.state.status === 'starting') {
        await this._recoverStalledStartup(generation, {stallRetries:0});
      }
      throw error;
    }
  }

  async newQr() {
    if (this.busy) throw new Error('Aguarde o envio terminar antes de gerar um novo QR Code.');
    this._audit('action.new-qr', {profile:this.authClientId, active:this.sessionState?.activeClientId || null});

    this.userPaused = false;
    this.requiresNewQr = false;
    this._savePausedPreference(false);
    this._clearReconnectTimer();
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    this.reconnectAttempts = 0;
    this.authFailureCount = 0;
    this.consecutiveHealthFailures = 0;
    this.readyAt = 0;
    this.authenticatedAt = 0;
    this.lastHealthCheckAt = 0;

    // Stop only the current browser. The last committed LocalAuth profile stays
    // intact on disk until a different pending profile reaches `ready`.
    const pendingStart = this.starting;
    const oldClient = this.client;
    this.generation++;
    this.client = null;
    this.starting = null;
    if (pendingStart && typeof pendingStart.catch === 'function') pendingStart.catch(() => {});
    this.state = {status:'starting', qr:null, account:null, error:null};
    await this._disposeClient(oldClient, 8000);

    const freshClientId = this._newAuthClientId();
    const disposablePending = this._setPendingSession(freshClientId, {reason:'explicit-new-qr'});
    this._setAuthClientId(freshClientId, false);
    if (disposablePending) await this._cleanupAuthProfile(disposablePending);
    this._audit('new-qr.profile-prepared', {activeClientId:this.sessionState?.activeClientId || null, freshClientId, pending:true});

    this.state = {status:'offline', qr:null, account:null, error:null};
    this.startMonitoring();
    this._connectInternal({rotateProfileOnStall:true, stallRetries:1}).catch(error => {
      if (!this.userPaused && !['qr','authenticated','ready'].includes(this.state.status)) {
        this.state = {
          status:'error',
          qr:null,
          account:null,
          error:error?.message || 'Não foi possível preparar um novo QR Code do WhatsApp. A sessão anterior continua preservada.'
        };
      }
    });
    return this.status();
  }

  async connectionHealthy() {
    if (this.state.status !== 'ready' || !this.client) return false;
    if (typeof this.client.getState !== 'function') {
      this.lastHealthCheckAt = Date.now();
      return true;
    }
    try {
      const state = await bounded(
        this.client.getState(),
        this.healthTimeoutMs,
        'Tempo limite ao verificar a conexão do WhatsApp.'
      );
      const healthy = String(state || '').toUpperCase() === 'CONNECTED';
      this.lastHealthCheckAt = Date.now();
      if (healthy) this.lastHealthyAt = this.lastHealthCheckAt;
      return healthy;
    } catch (_) {
      return false;
    }
  }

  async waitReady(timeout = 120000) {
    if (this.userPaused || this.state.status === 'paused') throw new Error('Conexão pausada. Clique em Retomar conexão para continuar.');

    // Reuse a healthy session. If it is degraded, restart it once and let the
    // monitor keep it alive in the background from then on.
    if (this.state.status === 'ready') {
      if (!(await this.connectionHealthy())) await this.restartConnection();
    } else {
      this.connect();
    }

    const deadline = Date.now() + timeout;
    while (this.state.status !== 'ready') {
      if (this.state.status === 'error') throw new Error(this.state.error);
      if (this.state.status === 'paused') throw new Error('Conexão cancelada.');
      if (Date.now() >= deadline) {
        throw new Error('Conecte pelo QR Code em Configurações e tente enviar novamente. Nenhuma mensagem deste lote foi enviada.');
      }
      await delay(250);
    }
    return {ready:true};
  }

  async send(phone, message) {
    if (this.busy) return {status:'failed', error:'Já existe um envio em andamento.'};
    if (this.state.status !== 'ready' || !this.client) return {status:'failed', error:'WhatsApp não conectado.'};
    if (!/^\+?[1-9]\d{7,14}$/.test(phone || '') || typeof message !== 'string' || !message.trim() || message.length > 60000) {
      return {status:'failed', error:'Número ou mensagem inválidos.'};
    }

    this.busy = true;
    let submitted = false;
    let messageId = null;
    let reconnectAfterSend = false;
    const client = this.client;

    try {
      if (!(await this.connectionHealthy())) {
        this.state = {status:'offline', qr:null, account:null, error:'A conexão do WhatsApp não está ativa. Reconecte antes de enviar.'};
        return {status:'failed', error:'Conexão do WhatsApp indisponível antes do envio.'};
      }

      const candidates = phoneCandidates(phone);
      let number = null;
      let resolvedPhone = null;
      for (const candidate of candidates) {
        number = await bounded(
          client.getNumberId(candidate),
          this.numberTimeoutMs,
          'Tempo limite ao validar o número no WhatsApp.'
        );
        if (number) {
          resolvedPhone = `+${candidate}`;
          break;
        }
      }
      if (!number) {
        return {
          status:'failed',
          error:'O número está salvo no Vyzium, mas o WhatsApp não localizou uma conta para ele. Confira país, DDD e, em celular brasileiro, o 9º dígito.'
        };
      }
      if (this.state.status !== 'ready' || this.client !== client) {
        return {status:'failed', error:'Conexão perdida antes do envio.'};
      }

      submitted = true;
      const result = await bounded(
        client.sendMessage(number._serialized, message, {waitUntilMsgSent:true}),
        this.sendTimeoutMs,
        'O WhatsApp não concluiu a chamada de envio dentro do prazo.'
      );

      messageId = messageIdentity(result);

      // For the current WhatsApp Web integration, a completed sendMessage() call
      // is treated as a successful send. Some WA Web builds do not expose a
      // reliable ACK/message id even though the message was actually sent.
      return {status:'sent', message_id:messageId, resolved_phone:resolvedPhone};
    } catch (error) {
      if (submitted) {
        // An ACK timeout means the delivery is uncertain, not that the whole
        // WhatsApp session is broken. Destroying a healthy client here caused
        // the old 2/N stall: one uncertain message forced a full resync before
        // the next supplier. Keep a healthy session alive and only reconnect
        // when the transport itself is demonstrably down.
        let healthy = false;
        try { healthy = this.client === client && await this.connectionHealthy(); }
        catch (_) { healthy = false; }
        if (!healthy) {
          this.readyAt = 0;
          this.authenticatedAt = 0;
          this.lastHealthCheckAt = 0;
          this.state = {
            status:'offline',
            qr:null,
            account:null,
            error:'A conexão do WhatsApp ficou indisponível após um envio sem confirmação. O Vyzium tentará restaurá-la automaticamente.'
          };
          reconnectAfterSend = true;
        }
      }

      return submitted
        ? {
            status:'uncertain',
            message_id:messageId,
            error:`Envio não confirmado pelo servidor do WhatsApp${messageId ? ` (${messageId})` : ''}. Confira a conversa antes de liberar um novo envio. Detalhe: ${error?.message || 'sem confirmação.'}`
          }
        : {status:'failed', error:error?.message || 'Falha ao verificar o contato. Nenhuma mensagem enviada.'};
    } finally {
      this.busy = false;
      if (reconnectAfterSend) this._scheduleReconnect(false);
    }
  }

  async pause(force = false) {
    if (this.busy && !force) throw new Error('Aguarde o envio terminar antes de pausar.');
    this._audit('action.pause', {force});
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    this.userPaused = true;
    this._savePausedPreference(true);
    this._clearReconnectTimer();
    this.generation++;
    this.readyAt = 0;
    this.authenticatedAt = 0;
    this.lastHealthCheckAt = 0;
    this.consecutiveHealthFailures = 0;
    this.state = {status:'paused',qr:null,account:null,error:null};
    const client = this.client;
    this.client = null;
    if (client) await this._disposeClient(client, 10000);
    if (this.starting) await bounded(this.starting, 1500).catch(() => {});
    this.state = {status:'paused',qr:null,account:null,error:null};
    return this.status();
  }

  async shutdown() {
    this._audit('action.shutdown');
    this._clearReconnectTimer();
    this._clearStartupWatchdog();
    this._clearQrWatchdog();
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.generation++;
    const client = this.client;
    this.client = null;
    if (client) await this._disposeClient(client, 10000);
  }

}

async function startBridge(session, token) {
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => {
      res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-followup-token'] !== token) {
      reply(401,{error:'Não autorizado.'});
      return;
    }
    try {
      if (req.method === 'POST' && req.url === '/health') {
        reply(200, await session.backgroundHealthCheck());
        return;
      }
      if (req.method === 'POST' && req.url === '/wait') {
        reply(200, await session.waitReady());
        return;
      }
      if (req.method !== 'POST' || req.url !== '/send') {
        reply(404,{error:'Rota inválida.'});
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 300000) {
          reply(413,{error:'Mensagem muito grande.'});
          return;
        }
      }
      const data = JSON.parse(body);
      reply(200, await session.send(data.phone, data.message));
    } catch (error) {
      reply(400,{error:error.message});
    }
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {server, url:`http://127.0.0.1:${server.address().port}`};
}

module.exports = {WhatsAppSession, startBridge, phoneCandidates, normalizeBrowserMode, resolveBrowserMode, isFatalCacheStorageError, hideWindowsForPid, resolveHiddenBrowserHelperPath, normalizeBrowserWSEndpoint, launchHiddenHeadedBrowser, stopHiddenHeadedBrowser};
