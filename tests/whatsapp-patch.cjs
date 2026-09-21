const {test} = require('node:test');
const assert = require('node:assert/strict');
const {patchClientSource, PATCH_MARKER, SOCKET_STATE_PROBE_SOURCE, QR_MODULE_PROBE_SOURCE} = require('../scripts/patch-whatsapp-web');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Representative excerpts from whatsapp-web.js 1.34.7's Client.js. The test
// intentionally includes every block Vyzium changes during postinstall.
const fixture = `
class Client {
    async inject() {
        if (
            this.options.authTimeoutMs === undefined ||
            this.options.authTimeoutMs == 0
        ) {
            this.options.authTimeoutMs = 30000;
        }
        let start = Date.now();
        let timeout = this.options.authTimeoutMs;
        let res = false;
        while (start > Date.now() - timeout) {
            res = await this.pupPage.evaluate(
                'window.Debug?.VERSION != undefined',
            );
            if (res) {
                break;
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        if (!res) {
            throw 'auth timeout';
        }
        await this.setDeviceName(
            this.options.deviceName,
            this.options.browserName,
        );
        const pairWithPhoneNumber = this.options.pairWithPhoneNumber;
        const version = await this.getWWebVersion();
        await this.pupPage.evaluate(ExposeAuthStore);

        const needAuthentication = await this.pupPage.evaluate(async () => {
            let state = window.require('WAWebSocketModel').Socket.state;
            if (
                state === 'OPENING' ||
                state === 'UNLAUNCHED' ||
                state === 'PAIRING'
            ) {
                await new Promise((r) => {
                    window
                        .require('WAWebSocketModel')
                        .Socket.on(
                            'change:state',
                            function waitTillInit(_AppState, state) {
                                if (
                                    state !== 'OPENING' &&
                                    state !== 'UNLAUNCHED' &&
                                    state !== 'PAIRING'
                                ) {
                                    window
                                        .require('WAWebSocketModel')
                                        .Socket.off(
                                            'change:state',
                                            waitTillInit,
                                        );
                                    r();
                                }
                            },
                        );
                });
            }
            state = window.require('WAWebSocketModel').Socket.state;
            return state == 'UNPAIRED' || state == 'UNPAIRED_IDLE';
        });
        if (needAuthentication) {
            if (pairWithPhoneNumber.phoneNumber) {
                this.requestPairingCode();
            } else {
                let qrRetries = 0;
                await exposeFunctionIfAbsent(
                    this.pupPage,
                    'onQRChangedEvent',
                    async (qr) => {
                        this.emit(Events.QR_RECEIVED, qr);
                    },
                );
                await this.pupPage.evaluate(async () => {
                    const registrationInfo =
                        await window.AuthStore.RegistrationUtils.waSignalStore.getRegistrationInfo();
                    const noiseKeyPair =
                        await window.AuthStore.RegistrationUtils.waNoiseInfo.get();
                    const staticKeyB64 = window.AuthStore.Base64Tools.encodeB64(
                        noiseKeyPair.staticKeyPair.pubKey,
                    );
                    const identityKeyB64 =
                        window.AuthStore.Base64Tools.encodeB64(
                            registrationInfo.identityKeyPair.pubKey,
                        );
                    const platform =
                        window.AuthStore.RegistrationUtils.DEVICE_PLATFORM;
                    const getQR = (ref) =>
                        ref +
                        ',' +
                        staticKeyB64 +
                        ',' +
                        identityKeyB64 +
                        ',' +
                        window
                            .require('WAWebUserPrefsMultiDevice')
                            .getADVSecretKey() +
                        ',' +
                        platform;
                    window.onQRChangedEvent(getQR(window.AuthStore.Conn.ref)); // initial qr
                    window.AuthStore.Conn.on('change:ref', (_, ref) => {
                        window.onQRChangedEvent(getQR(ref));
                    }); // future QR changes
                });
            }
        }
        await exposeFunctionIfAbsent(
            this.pupPage,
            'onAuthAppStateChangedEvent',
            async (state) => {
                if (
                    state == 'UNPAIRED_IDLE' &&
                    !pairWithPhoneNumber.phoneNumber
                ) {
                    // refresh qr code
                    window.require('WAWebCmd').Cmd.refreshQR();
                }
            },
        );
        const x = window.AuthStore.OfflineMessageHandler.getOfflineDeliveryProgress();
        window
            .require('WAWebSocketModel')
            .Socket.on('change:hasSynced', () => {
                window.onAppStateHasSyncedEvent();
            });
                    let start = Date.now();
                    let res = false;
                    while (start > Date.now() - 30000) {
                        // Check window.WWebJS Injection
                        res = await this.pupPage.evaluate(
                            'window.WWebJS != undefined',
                        );
                        if (res) {
                            break;
                        }
                        await new Promise((r) => setTimeout(r, 200));
                    }
                    if (!res) {
                        throw 'ready timeout';
                    }
    }
    async initialize() {
        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/',
        });
        await this.inject();
        this.pupPage.on('framenavigated', async (frame) => {
            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });
    }
}
`;

test('patch backports current QR/bootstrap paths to npm 1.34.7', () => {
  const result = patchClientSource(fixture);
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER));
  assert.match(result.source, /const needAuthHandle = await this\.pupPage\.waitForFunction/);
  assert.match(result.source, /const socketModule = window\.require\('WAWebSocketModel'\)/);
  assert.match(result.source, /catch \(_\) \{\s*return false;/);
  assert.match(result.source, /if \(needAuthentication\.need\)/);
  assert.match(result.source, /WAWebSignalStoreApi/);
  assert.match(result.source, /WAWebUserPrefsInfoStore/);
  assert.match(result.source, /WAWebCompanionRegClientUtils/);
  assert.match(result.source, /const advSecretKey = await/);
  assert.doesNotMatch(result.source, /AuthStore\.RegistrationUtils/);
  assert.match(result.source, /this\.pupPage\.evaluate\(\(\) => \{\s*window\.require\('WAWebCmd'\)\.Cmd\.refreshQR/);
  assert.match(result.source, /WAWebOfflineHandler/);
  assert.match(result.source, /Vyzium restored-session replay/);
  assert.match(result.source, /const vyziumSocket = window\.require\('WAWebSocketModel'\)\.Socket/);
  assert.match(result.source, /vyziumSocket\.hasSynced !== true/);
  assert.match(result.source, /vyziumNotifyHasSynced\(\);/);
  assert.doesNotMatch(result.source, /\.Socket\.on\('change:hasSynced', \(\) => \{\s*window\.onAppStateHasSyncedEvent\(\);/);
  assert.match(result.source, /waitForFunction\('typeof window\.WWebJS/);
  assert.match(result.source, /wait for a stable WhatsApp document before the first inject/);
  assert.match(result.source, /vyziumBootstrapStableSince/);
  assert.match(result.source, /Date\.now\(\) - vyziumBootstrapStableSince >= 4000/);
  assert.match(result.source, /!snapshot\.href\.includes\('post_logout=1'\)/);
  assert.match(result.source, /this\.emit\('vyzium_bootstrap_waiting'/);
  assert.match(result.source, /this\.emit\('vyzium_bootstrap_stable'/);
  assert.match(result.source, /this\.emit\('vyzium_bootstrap_timeout'/);
  assert.ok(result.source.indexOf('wait for a stable WhatsApp document before the first inject') < result.source.indexOf('await this.inject();'));
  const barrierStart = result.source.indexOf('wait for a stable WhatsApp document before the first inject');
  const firstInject = result.source.indexOf('await this.inject();', barrierStart);
  const barrierSource = result.source.slice(barrierStart, firstInject);
  assert.doesNotMatch(barrierSource, /caches\.|CacheStorage|indexedDB|window\.require|WAWebSocketModel/);
  assert.ok(result.source.indexOf('await this.inject();') < result.source.indexOf("this.pupPage.on('framenavigated'"));
  assert.match(result.source, /let vyziumNavigationRecovery = null/);
  assert.doesNotMatch(result.source, /await this\.authStrategy\.logout\(\)/);
  assert.doesNotThrow(() => new vm.Script(result.source), 'Client.js patched must remain valid JavaScript');
});

test('repairs the malformed v3.1.1 QR closure instead of keeping a broken marked patch', () => {
  const correct = patchClientSource(fixture).source;
  const malformed = correct.replace(
    "                    });\n                });",
    "                    });\n                }); // future QR changes\n                });"
  );
  assert.notEqual(malformed, correct);
  assert.throws(() => new vm.Script(malformed), /Unexpected token/);

  const repaired = patchClientSource(malformed);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.source, correct);
  assert.doesNotThrow(() => new vm.Script(repaired.source));
});

test('patch is idempotent', () => {
  const first = patchClientSource(fixture);
  const second = patchClientSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.source, first.source);
});

test('patch accepts CRLF source from Windows/npm extraction', () => {
  const result = patchClientSource(fixture.replace(/\n/g, '\r\n'));
  assert.equal(result.changed, true);
  assert.match(result.source, /WAWebSignalStoreApi/);
  assert.doesNotMatch(result.source, /AuthStore\.RegistrationUtils/);
});



test('socket bootstrap probe tolerates unresolved WA modules instead of aborting WaitTask', () => {
  const probe = vm.runInNewContext(`(${SOCKET_STATE_PROBE_SOURCE})`, {
    window: { require() { throw new Error('ModuleError: unresolved dependencies'); } }
  });
  assert.equal(probe(), false);

  const readyProbe = vm.runInNewContext(`(${SOCKET_STATE_PROBE_SOURCE})`, {
    window: { require(name) { assert.equal(name, 'WAWebSocketModel'); return {Socket:{state:'UNPAIRED'}}; } }
  });
  const ready = readyProbe();
  assert.equal(ready.need, true);
  assert.equal(ready.state, 'UNPAIRED');
});

test('QR module probe waits through partial WhatsApp bundle initialization', () => {
  let calls = 0;
  const incomplete = vm.runInNewContext(`(${QR_MODULE_PROBE_SOURCE})`, {
    window: { require() { calls += 1; if (calls < 3) throw new Error('not resolved'); return {}; } }
  });
  assert.equal(incomplete(), false);

  const modules = {
    WAWebSignalStoreApi:{waSignalStore:{}},
    WAWebUserPrefsInfoStore:{waNoiseInfo:{}},
    WABase64:{encodeB64(){}},
    WAWebUserPrefsMultiDevice:{getADVSecretKey(){}},
    WAWebCompanionRegClientUtils:{DEVICE_PLATFORM:'DESKTOP'},
    WAWebConnModel:{Conn:{}}
  };
  const complete = vm.runInNewContext(`(${QR_MODULE_PROBE_SOURCE})`, {
    window: { require(name) { return modules[name]; } }
  });
  assert.equal(complete(), true);
});

test('restored-session hasSynced replay is idempotent and only fires for a synced socket', () => {
  const source = patchClientSource(fixture).source;
  assert.match(source, /Vyzium restored-session replay/);

  let notifications = 0;
  const listeners = {};
  const socket = {
    hasSynced: true,
    on(name, fn) { listeners[name] = fn; }
  };
  const window = {
    require(name) {
      assert.equal(name, 'WAWebSocketModel');
      return {Socket: socket};
    },
    onAppStateHasSyncedEvent() { notifications += 1; }
  };

  let vyziumHasSyncedNotified = false;
  const vyziumSocket = window.require('WAWebSocketModel').Socket;
  const vyziumNotifyHasSynced = () => {
    if (vyziumHasSyncedNotified || vyziumSocket.hasSynced !== true) return;
    vyziumHasSyncedNotified = true;
    window.onAppStateHasSyncedEvent();
  };
  vyziumSocket.on('change:hasSynced', vyziumNotifyHasSynced);
  vyziumNotifyHasSynced();

  assert.equal(notifications, 1);
  listeners['change:hasSynced']();
  assert.equal(notifications, 1);

  const socket2 = { hasSynced: false, handlers: {}, on(name, fn) { this.handlers[name] = fn; } };
  let notifications2 = 0;
  let notified2 = false;
  const notify2 = () => {
    if (notified2 || socket2.hasSynced !== true) return;
    notified2 = true;
    notifications2 += 1;
  };
  socket2.on('change:hasSynced', notify2);
  notify2();
  assert.equal(notifications2, 0);
  socket2.hasSynced = true;
  socket2.handlers['change:hasSynced']();
  assert.equal(notifications2, 1);
});

test('build verification rejects an incomplete Client.js', () => {
  const {verifyPatch} = require('../scripts/verify-whatsapp-patch');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vyzium-patch-'));
  const pkgDir = path.join(root, 'node_modules', 'whatsapp-web.js');
  fs.mkdirSync(path.join(pkgDir, 'src'), {recursive: true});
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({name:'whatsapp-web.js', version:'1.34.7', main:'index.js'}));
  fs.writeFileSync(path.join(pkgDir, 'index.js'), '');

  fs.writeFileSync(path.join(pkgDir, 'src', 'Client.js'), `// ${PATCH_MARKER}\nmodule.exports = {};`);
  assert.throws(() => verifyPatch(root), /incompleta|incompleto|QR/i);

  const patched = patchClientSource(fixture).source;
  fs.writeFileSync(path.join(pkgDir, 'src', 'Client.js'), patched);
  assert.equal(verifyPatch(root).patched, true);
});
