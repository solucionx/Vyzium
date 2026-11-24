'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {verifyWhatsAppBootstrap} = require('../scripts/verify-whatsapp-patch');
const {SOCKET_STATE_PROBE_SOURCE} = require('../scripts/patch-whatsapp-web');

test('installed WhatsApp client matches the patched bootstrap', () => {
  verifyWhatsAppBootstrap();
});

test('socket probe tolerates unavailable modules and recognizes a new or linked session', () => {
  let socketModule = null;
  const window = {require: () => socketModule};
  const probe = vm.runInNewContext('(' + SOCKET_STATE_PROBE_SOURCE + ')', {window});
  assert.equal(probe(), false);
  window.require = () => { throw new Error('unresolved dependencies'); };
  assert.equal(probe(), false);
  window.require = () => socketModule;
  socketModule = {Socket: {state: 'OPENING'}};
  assert.equal(probe(), false);
  socketModule.Socket.state = 'UNPAIRED';
  assert.equal(probe().need, true);
  socketModule.Socket.state = 'CONNECTED';
  assert.equal(probe().need, false);
});
