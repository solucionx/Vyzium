'use strict';

// Minimal, fail-open Sentry error transport for Vyzium's Electron main process.
// Deliberately dependency-free: monitoring must never become a startup/runtime dependency.
const https = require('https');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_DSN = 'https://c851dd94d8112f48e651cae74050aaa7@o4512142298841088.ingest.us.sentry.io/4512142320730112';
const SENSITIVE_KEY = /(password|passwd|token|authorization|cookie|session|qrcode|\bqr\b|phone|telefone|celular|message|mensagem|firebase|credential|secret|dbkey|keyhex|email)/i;
const TOKENISH = /\b(?:eyJ[A-Za-z0-9._-]{16,}|[A-Fa-f0-9]{40,})\b/g;
const PHONEISH = /(?:\+\d{1,3}\s*(?:\(\d{2,3}\)|\d{2,3})\s*\d{4,5}[ -]?\d{4}|\(\d{2,3}\)\s*\d{4,5}[ -]?\d{4}|\b55\d{10,11}\b|\b\d{10,11}\b|\+?\d{1,3}[ -]+\d{2,3}[ -]+\d{4,5}[ -]?\d{4})/g;
const EMAILISH = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
const PROMOTED_WHATSAPP_EVENTS = new Set([
  'browser.storage-failure-detected',
  'client.initialize-rejected',
  'client.bootstrap-timeout',
  'initialize.attempt-error',
  'browser.first-connection-storage-recovery-error',
  'client.auth-failure',
  'watchdog.startup-fired'
]);

function shouldPromoteWhatsAppEvent(event) {
  // WhatsAppSession._audit prefixes every diagnostic event with `whatsapp.`.
  // Normalize only for classification; never alter the WhatsApp state machine.
  const raw = String(event || '');
  const normalized = raw.startsWith('whatsapp.') ? raw.slice('whatsapp.'.length) : raw;
  return PROMOTED_WHATSAPP_EVENTS.has(normalized);
}

function isExpectedBusinessError(error) {
  const text = String(error?.message || error || '');
  return /esta negocia(?:ç|c)(?:ão|ao) já foi enviada ou está incerta\. consulte o histórico\.?/i.test(text.normalize('NFC'));
}


function sanitizeString(value, max = 6000) {
  return String(value ?? '')
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n]+/ig, '$1[REDACTED_USER]')
    .replace(/(\/home\/)[^/\r\n]+/g, '$1[REDACTED_USER]')
    .replace(TOKENISH, '[REDACTED_TOKEN]')
    .replace(EMAILISH, '[REDACTED_EMAIL]')
    .replace(PHONEISH, '[REDACTED_PHONE]')
    .replace(/([?&](?:token|key|auth|session|code)=)[^&#\s]+/ig, '$1[REDACTED]')
    .slice(0, max);
}

function sanitize(value, depth = 0, key = '') {
  if (SENSITIVE_KEY.test(String(key))) return '[REDACTED]';
  if (depth > 5) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (value instanceof Error) return { name: sanitizeString(value.name, 120), message: sanitizeString(value.message, 2000), stack: sanitizeString(value.stack, 10000) };
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) out[k] = sanitize(v, depth + 1, k);
    return out;
  }
  return sanitizeString(value);
}

function parseDsn(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:' || !url.username || !url.hostname) return null;
    const projectId = url.pathname.split('/').filter(Boolean).at(-1);
    if (!/^\d+$/.test(projectId || '')) return null;
    return { host: url.hostname, publicKey: url.username, projectId, endpoint: `https://${url.hostname}/api/${projectId}/envelope/` };
  } catch (_) { return null; }
}

function stackFrames(stack) {
  const lines = String(stack || '').split(/\r?\n/).slice(1, 30);
  const frames = [];
  for (const line of lines) {
    const m = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    frames.push({ function: sanitizeString(m[1] || '<anonymous>', 200), filename: sanitizeString(m[2], 1000), lineno: Number(m[3]), colno: Number(m[4]), in_app: /[\\/]electron[\\/]|[\\/]renderer[\\/]/i.test(m[2]) });
  }
  return frames.reverse();
}

class SentryReporter {
  constructor({ app, dsn = process.env.VYZIUM_SENTRY_DSN || DEFAULT_DSN, environment = 'production', transport = null } = {}) {
    this.app = app;
    this.dsn = parseDsn(dsn);
    this.environment = environment;
    this.transport = transport;
    this.enabled = Boolean(this.dsn) && process.env.VYZIUM_SENTRY_DISABLED !== '1';
    this.recent = new Map();
    this.windowStarted = Date.now();
    this.windowCount = 0;
    this.maxPerWindow = 20;
    this.windowMs = 10 * 60 * 1000;
    this.dedupeMs = 5 * 60 * 1000;
  }

  _allow(fingerprint) {
    const now = Date.now();
    if (now - this.windowStarted >= this.windowMs) { this.windowStarted = now; this.windowCount = 0; }
    if (this.windowCount >= this.maxPerWindow) return false;
    const last = this.recent.get(fingerprint) || 0;
    if (now - last < this.dedupeMs) return false;
    this.recent.set(fingerprint, now);
    for (const [key, at] of this.recent) if (now - at > this.dedupeMs * 2) this.recent.delete(key);
    this.windowCount += 1;
    return true;
  }

  captureException(error, context = {}) {
    try {
      if (!this.enabled) return false;
      const e = error instanceof Error ? error : new Error(String(error || 'Erro desconhecido'));
      // Expected domain rejections are user-facing workflow states, not software failures.
      if (isExpectedBusinessError(e)) return false;
      const source = sanitizeString(context.source || 'vyzium', 120);
      const fingerprint = crypto.createHash('sha256').update(`${source}|${e.name}|${e.message}|${String(e.stack || '').split('\n')[1] || ''}`).digest('hex').slice(0, 24);
      if (!this._allow(fingerprint)) return false;
      const event = this._event(e, source, context.details || {});
      this._send(event);
      return true;
    } catch (_) { return false; }
  }

  _event(error, source, details) {
    const frames = stackFrames(error.stack);
    return {
      event_id: crypto.randomBytes(16).toString('hex'),
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      environment: this.environment,
      release: `vyzium@${sanitizeString(this.app?.getVersion?.() || 'unknown', 80)}`,
      server_name: undefined,
      logger: 'vyzium.electron',
      tags: {
        component: source,
        packaged: String(Boolean(this.app?.isPackaged)),
        platform: process.platform,
        arch: process.arch
      },
      contexts: {
        runtime: { name: 'node', version: process.version },
        electron: { version: process.versions.electron || 'unknown' },
        os: { name: os.type(), version: os.release() }
      },
      extra: sanitize(details),
      exception: { values: [{ type: sanitizeString(error.name || 'Error', 120), value: sanitizeString(error.message || String(error), 2000), stacktrace: frames.length ? { frames } : undefined }] }
    };
  }

  _send(event) {
    try {
      const header = JSON.stringify({ event_id: event.event_id, dsn: `https://${this.dsn.publicKey}@${this.dsn.host}/${this.dsn.projectId}`, sent_at: new Date().toISOString() });
      const body = `${header}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
      if (this.transport) { Promise.resolve().then(() => this.transport({ endpoint: this.dsn.endpoint, body, event })).catch(() => {}); return; }
      const url = new URL(this.dsn.endpoint);
      const req = https.request({ protocol: 'https:', hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope', 'Content-Length': Buffer.byteLength(body), 'User-Agent': `Vyzium/${this.app?.getVersion?.() || 'unknown'}` }, timeout: 3000 }, res => { res.resume(); });
      req.on('timeout', () => req.destroy());
      req.on('error', () => {});
      req.end(body);
    } catch (_) {}
  }
}

function createSentryReporter(options) {
  try { return new SentryReporter(options); } catch (_) { return { enabled: false, captureException: () => false }; }
}

module.exports = { createSentryReporter, SentryReporter, sanitize, sanitizeString, parseDsn, shouldPromoteWhatsAppEvent, isExpectedBusinessError, PROMOTED_WHATSAPP_EVENTS };
