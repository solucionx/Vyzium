'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MAX_RUNS = 8;
const MAX_BUNDLES = 5;

function safeError(error) {
  if (!error) return null;
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || error).slice(0, 4000),
    code: error.code == null ? null : String(error.code),
    stack: String(error.stack || '').slice(0, 12000)
  };
}

function redactText(value) {
  let text = String(value ?? '');
  const home = os.homedir();
  if (home) text = text.split(home).join('%USERPROFILE%');
  text = text
    .replace(/(api[_-]?key|token|secret|password|authorization|cookie|session[_-]?key|db[_-]?key)(["'\s:=]+)([^\s"',;}]+)/ig, '$1$2[REDACTED]')
    .replace(/\b[A-Fa-f0-9]{48,}\b/g, '[REDACTED_HEX]')
    .replace(/\beyJ[A-Za-z0-9._-]{20,}\b/g, '[REDACTED_TOKEN]');
  return text.slice(0, 20000);
}

function clean(value, depth = 0) {
  if (depth > 5) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactText(value);
  if (value instanceof Error) return safeError(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => clean(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      out[key] = /password|token|secret|cookie|authorization|dbkey|keyhex/i.test(key) ? '[REDACTED]' : clean(item, depth + 1);
    }
    return out;
  }
  return redactText(value);
}

class FullDiagnostics {
  constructor(app) {
    this.app = app;
    this.boot = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    this.started = new Date().toISOString();
    this.root = path.join(app.getPath('userData'), 'diagnostics');
    this.dir = path.join(this.root, `run-${this.started.replace(/[:.]/g, '-')}-${this.boot}`);
    this.timeline = path.join(this.dir, 'timeline.jsonl');
    this.errorsFile = path.join(this.dir, 'errors.log');
    this.report = path.join(this.dir, 'RELATORIO.txt');
    this.seq = 0;
    this.stages = [];
    this.errors = [];
    this.finalized = false;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this._prune();
  }

  _prune() {
    try {
      const entries = fs.readdirSync(this.root, { withFileTypes: true });
      const runs = entries.filter(e => e.isDirectory() && e.name.startsWith('run-')).map(e => path.join(this.root, e.name));
      const bundles = entries.filter(e => e.isFile() && /^Vyzium-Diagnostico-.*\.zip$/i.test(e.name)).map(e => path.join(this.root, e.name));
      const trim = (items, keep, remove) => items
        .map(file => ({ file, mtime: fs.statSync(file).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(keep)
        .forEach(({ file }) => { try { remove(file); } catch (_) {} });
      trim(runs, MAX_RUNS, file => fs.rmSync(file, { recursive: true, force: true }));
      trim(bundles, MAX_BUNDLES, file => fs.rmSync(file, { force: true }));
    } catch (_) {}
  }

  event(event, details = {}) {
    const entry = { at: new Date().toISOString(), seq: ++this.seq, boot: this.boot, event: String(event), details: clean(details) };
    try { fs.appendFileSync(this.timeline, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 }); } catch (_) {}
    return entry;
  }

  stage(name, status = 'OK', details = {}) {
    this.stages.push({ at: new Date().toISOString(), name: String(name), status: String(status), details: clean(details) });
    this.event(`stage.${String(name).replace(/\s+/g, '-').toLowerCase()}`, { status, ...details });
    this.writeReport();
  }

  error(source, error, details = {}) {
    const item = { at: new Date().toISOString(), source: String(source), error: safeError(error), details: clean(details) };
    this.errors.push(item);
    this.event('error', item);
    try { fs.appendFileSync(this.errorsFile, JSON.stringify(item, null, 2) + '\n', 'utf8'); } catch (_) {}
    this.writeReport();
  }

  system() {
    const info = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      appVersion: this.app.getVersion(),
      packaged: this.app.isPackaged,
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      userData: this.app.getPath('userData'),
      appData: this.app.getPath('appData'),
      temp: this.app.getPath('temp'),
      env: {
        LOCALAPPDATA: Boolean(process.env.LOCALAPPDATA),
        PROGRAMFILES: Boolean(process.env.PROGRAMFILES),
        PROGRAMFILES_X86: Boolean(process.env['PROGRAMFILES(X86)'])
      },
      os: {
        type: os.type(), release: os.release(), version: os.version?.(),
        totalmem: os.totalmem(), freemem: os.freemem(),
        cpuModels: [...new Set(os.cpus().map(cpu => cpu.model))]
      }
    };
    try { fs.writeFileSync(path.join(this.dir, 'system.json'), JSON.stringify(clean(info), null, 2), 'utf8'); } catch (_) {}
    this.event('system.snapshot', info);
  }

  processes() {
    if (process.platform !== 'win32') return;
    try {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process | Where-Object {$_.Name -match 'Vyzium|chrome|msedge|powershell|followup|compras'} | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress"
      ], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      fs.writeFileSync(path.join(this.dir, 'processes.json'), redactText(result.stdout || '[]') || '[]', 'utf8');
      this.event('process.snapshot', { exitCode: result.status, stderr: redactText(result.stderr || '') });
    } catch (error) { this.error('process.snapshot', error); }
  }

  writeReport() {
    const lines = [
      'VYZIUM - RELATORIO DE DIAGNOSTICO INTEGRAL',
      `Versao: ${this.app.getVersion()}`,
      `Inicio: ${this.started}`,
      `Boot: ${this.boot}`, '', 'LINHA DO TEMPO RESUMIDA'
    ];
    for (const item of this.stages) {
      const detail = Object.keys(item.details || {}).length ? ` | ${redactText(JSON.stringify(item.details))}` : '';
      lines.push(`[${item.status}] ${item.at} - ${item.name}${detail}`);
    }
    lines.push('', `ERROS CAPTURADOS: ${this.errors.length}`);
    for (const item of this.errors.slice(-30)) lines.push(`[ERRO] ${item.at} ${item.source}: ${redactText(item.error?.message || 'sem mensagem')}`);
    lines.push('', 'Detalhes: timeline.jsonl, system.json, processes.json, errors.log, hidden-browser.log e whatsapp-debug.jsonl.');
    try { fs.writeFileSync(this.report, lines.join('\r\n'), 'utf8'); } catch (_) {}
  }

  copy(source, name) {
    try { if (source && fs.existsSync(source)) fs.copyFileSync(source, path.join(this.dir, name)); }
    catch (error) { this.error('diagnostics.copy', error, { name }); }
  }

  bundle() {
    if (process.platform !== 'win32') return null;
    try {
      const output = path.join(this.root, `Vyzium-Diagnostico-${this.boot}.zip`);
      const esc = value => String(value).replace(/'/g, "''");
      const command = `Compress-Archive -Path '${esc(this.dir)}\\*' -DestinationPath '${esc(output)}' -Force`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      this.event('diagnostics.bundle', { output, exitCode: result.status, stderr: redactText(result.stderr || '') });
      return result.status === 0 ? output : null;
    } catch (error) { this.error('diagnostics.bundle', error); return null; }
  }

  finalize(extra = {}) {
    if (this.finalized) return null;
    this.finalized = true;
    this.event('diagnostics.finalize', extra);
    this.processes();
    this.writeReport();
    const output = this.bundle();
    this._prune();
    return output;
  }
}

module.exports = { FullDiagnostics, clean, redactText };
