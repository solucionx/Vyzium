'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SentryReporter, sanitize, parseDsn } = require('../electron/sentry-client');
const app = { getVersion: () => '3.3.2', isPackaged: true };
const dsn = 'https://public@example.ingest.sentry.io/123';

test('Sentry DSN parser accepts only valid HTTPS ingestion DSNs', () => {
  assert.equal(parseDsn(dsn).projectId, '123');
  assert.equal(parseDsn('http://public@example/123'), null);
  assert.equal(parseDsn('https://example/123'), null);
});

test('Sentry sanitizer removes explicit sensitive fields and common PII patterns', () => {
  const value = sanitize({ token:'abc', phone:'+55 85 99999-9999', email:'x@example.com', nested:{authorization:'Bearer xyz'}, safe:'stage.bootstrap' });
  assert.equal(value.token, '[REDACTED]');
  assert.equal(value.phone, '[REDACTED]');
  assert.equal(value.email, '[REDACTED]');
  assert.equal(value.nested.authorization, '[REDACTED]');
  assert.equal(value.safe, 'stage.bootstrap');
  assert.equal(JSON.stringify(sanitize({stack:'C:\\Users\\Levi\\AppData\\Vyzium\\main.js'})).includes('Levi'), false);
});

test('Sentry reporter is fail-open when transport rejects', async () => {
  const reporter = new SentryReporter({ app, dsn, transport: async () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => reporter.captureException(new Error('boom'), {source:'test'}));
  await new Promise(resolve => setTimeout(resolve, 10));
});

test('Sentry reporter deduplicates identical errors', async () => {
  const sent=[];
  const reporter = new SentryReporter({ app, dsn, transport: ({event}) => sent.push(event) });
  const err = new Error('same failure');
  assert.equal(reporter.captureException(err,{source:'same'}), true);
  assert.equal(reporter.captureException(err,{source:'same'}), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sent.length,1);
});

test('Sentry event contains technical metadata but no user object', async () => {
  const sent=[];
  const reporter = new SentryReporter({ app, dsn, transport: ({event}) => sent.push(event) });
  reporter.captureException(new Error('failure +55 85 99999-9999 x@example.com'), {source:'whatsapp.bootstrap', details:{session:'secret',stage:'qr'}});
  await new Promise(resolve => setTimeout(resolve, 10));
  const raw=JSON.stringify(sent[0]);
  assert.equal(sent[0].release,'vyzium@3.3.2');
  assert.equal(Object.hasOwn(sent[0],'user'),false);
  assert.equal(raw.includes('99999-9999'),false);
  assert.equal(raw.includes('x@example.com'),false);
  assert.equal(raw.includes('secret'),false);
});

test('Sentry sanitizer preserves technical versions/timestamps while masking slash paths and complete phones', () => {
  const {sanitizeString} = require('../electron/sentry-client');
  assert.equal(sanitizeString('Chrome/153.0.7339.128'), 'Chrome/153.0.7339.128');
  assert.equal(sanitizeString('2026-09-24T14:14:03.123Z'), '2026-09-24T14:14:03.123Z');
  assert.equal(sanitizeString('C:/Users/Levi/AppData/Vyzium').includes('Levi'), false);
  assert.equal(sanitizeString('file:///C:/Users/Levi/AppData/Vyzium').includes('Levi'), false);
  assert.equal(sanitizeString('+55 (85) 99999-9999'), '[REDACTED_PHONE]');
  assert.equal(sanitizeString('5585999999999'), '[REDACTED_PHONE]');
});

test('WhatsApp Sentry promotion list matches real high-value audit events', () => {
  const {shouldPromoteWhatsAppEvent} = require('../electron/sentry-client');
  for (const event of [
    'browser.storage-failure-detected',
    'client.initialize-rejected',
    'client.bootstrap-timeout',
    'initialize.attempt-error',
    'browser.first-connection-storage-recovery-error',
    'client.auth-failure',
    'watchdog.startup-fired'
  ]) {
    assert.equal(shouldPromoteWhatsAppEvent(event), true, event);
    assert.equal(shouldPromoteWhatsAppEvent('whatsapp.' + event), true, 'prefixed ' + event);
  }
  assert.equal(shouldPromoteWhatsAppEvent('browser-launch-failed'), false);
  assert.equal(shouldPromoteWhatsAppEvent('watchdog-timeout'), false);
  assert.equal(shouldPromoteWhatsAppEvent('client.ready'), false);
});


test('Sentry ignores expected negotiation idempotency rejection', async () => {
  const sent=[];
  const reporter = new SentryReporter({ app, dsn, transport: ({event}) => sent.push(event) });
  const error = new Error("Error invoking remote method 'api': Error: Esta negociação já foi enviada ou está incerta. Consulte o Histórico.");
  assert.equal(reporter.captureException(error,{source:'renderer'}), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sent.length,0);
});
