'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

// Backports the QR/bootstrap fixes already present on whatsapp-web.js main to
// the currently published npm 1.34.7 package. Keep the npm version pinned for
// reproducible installs; patch only the startup/authentication code paths.
const PATCH_MARKER = 'VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V6';
const PREVIOUS_PATCH_MARKER = 'VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V5';
const PREVIOUS_PATCH_MARKER_V4 = 'VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V4';
const PREVIOUS_PATCH_MARKER_V3 = 'VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V3';
const PREVIOUS_PATCH_MARKER_V2 = 'VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V2';

const SOCKET_STATE_PROBE_SOURCE = `() => {
                try {
                    if (typeof window.require !== 'function') return false;
                    const socketModule = window.require('WAWebSocketModel');
                    const state = socketModule?.Socket?.state;
                    if (!state || state === 'OPENING' || state === 'UNLAUNCHED' || state === 'PAIRING') return false;
                    return { need: state === 'UNPAIRED' || state === 'UNPAIRED_IDLE', state };
                } catch (_) {
                    return false;
                }
            }`;

const QR_MODULE_PROBE_SOURCE = `() => {
                try {
                    if (typeof window.require !== 'function') return false;
                    const signal = window.require('WAWebSignalStoreApi');
                    const prefs = window.require('WAWebUserPrefsInfoStore');
                    const base64 = window.require('WABase64');
                    const multi = window.require('WAWebUserPrefsMultiDevice');
                    const companion = window.require('WAWebCompanionRegClientUtils');
                    const conn = window.require('WAWebConnModel');
                    return Boolean(signal?.waSignalStore && prefs?.waNoiseInfo && base64?.encodeB64 && multi?.getADVSecretKey && companion?.DEVICE_PLATFORM && conn?.Conn);
                } catch (_) {
                    return false;
                }
            }`;

function assertValidJavaScript(source, label = 'Client.js') {
  try {
    new vm.Script(String(source), { filename: label });
  } catch (error) {
    const detail = error?.message || String(error);
    throw new Error(`O patch do WhatsApp gerou JavaScript inválido (${detail}).`);
  }
}

function repairMalformedV2QrClosure(source) {
  // v3.1.1 could leave the original outer page.evaluate closure behind after
  // replacing the QR bootstrap. Repair only that known malformed sequence.
  if ((!source.includes(PATCH_MARKER) && !source.includes(PREVIOUS_PATCH_MARKER) && !source.includes(PREVIOUS_PATCH_MARKER_V3) && !source.includes(PREVIOUS_PATCH_MARKER_V2)) || !source.includes("Conn.off('change:ref', onRefChange);")) return source;

  const anchor = source.indexOf("Conn.off('change:ref', onRefChange);");
  if (anchor < 0) return source;
  const before = source.slice(0, anchor);
  const after = source.slice(anchor);
  const repaired = after.replace(
    /\n([ \t]*)\}\);[ \t]*\/\/ future QR changes\n\1\}\);/,
    '\n$1});'
  );
  return before + repaired;
}

function mustReplace(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Não foi possível aplicar o patch do WhatsApp Web (${label}). A versão instalada da dependência mudou.`);
  }
  return source.replace(search, replacement);
}

function replaceNavigationBlock(source, replacement) {
  const exact = `        await this.inject();\n        this.pupPage.on('framenavigated', async (frame) => {\n            if (frame.url().includes('post_logout=1') || this.lastLoggedOut) {\n                this.emit(Events.DISCONNECTED, 'LOGOUT');\n                await this.authStrategy.logout();\n                await this.authStrategy.beforeBrowserInitialized();\n                await this.authStrategy.afterBrowserInitialized();\n                this.lastLoggedOut = false;\n            }\n            await this.inject();\n        });`;

  if (source.includes(exact)) return source.replace(exact, replacement);

  // Accept the earlier Vyzium navigation patch as an input as well. This makes
  // rerunning postinstall safe even when node_modules was not freshly removed.
  const olderVyzium = /[ \t]*\/\/[^\n]*register navigation recovery before the first inject\.[\s\S]*?\n[ \t]*\}\);\n[ \t]*await this\.inject\(\);/i;
  if (olderVyzium.test(source)) return source.replace(olderVyzium, replacement.trimEnd());

  const tolerant = /[ \t]*await this\.inject\(\);\n(?:[ \t]*\n)*[ \t]*this\.pupPage\.on\('framenavigated',[ \t]*async[ \t]*\(frame\)[ \t]*=>[ \t]*\{[\s\S]*?\n[ \t]*\}\);/;
  if (!tolerant.test(source)) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (recuperação de navegação). O bloco esperado não foi localizado.');
  }
  return source.replace(tolerant, replacement);
}

function patchClientSource(input) {
  let source = String(input).replace(/\r\n/g, '\n');
  if (source.includes(PREVIOUS_PATCH_MARKER_V2)) {
    source = repairMalformedV2QrClosure(source).replaceAll(PREVIOUS_PATCH_MARKER_V2, PATCH_MARKER);
  }
  if (source.includes(PREVIOUS_PATCH_MARKER_V3)) {
    source = source.replaceAll(PREVIOUS_PATCH_MARKER_V3, PATCH_MARKER);
  }
  if (source.includes(PREVIOUS_PATCH_MARKER_V4)) {
    source = source.replaceAll(PREVIOUS_PATCH_MARKER_V4, PATCH_MARKER);
  }
  if (source.includes(PREVIOUS_PATCH_MARKER)) {
    source = source.replaceAll(PREVIOUS_PATCH_MARKER, PATCH_MARKER);
  }
  if (source.includes(PATCH_MARKER)) {
    const hasSafeNavigationOrder = source.includes('navigation recovery is installed only after the initial inject');
    const hasStableBootstrapBarrier = source.includes('wait for a stable WhatsApp document before the first inject');
    const hasRestoredSessionReplay = source.includes('Vyzium restored-session replay') && source.includes('vyziumNotifyHasSynced');
    if (hasSafeNavigationOrder && hasStableBootstrapBarrier && hasRestoredSessionReplay && source.includes("const socketModule = window.require('WAWebSocketModel')") && source.includes('catch (_)')) {
      try {
        assertValidJavaScript(source);
        return { source, changed: false };
      } catch (error) {
        const repaired = repairMalformedV2QrClosure(source);
        if (repaired === source) throw error;
        assertValidJavaScript(repaired);
        return { source:repaired, changed:true };
      }
    }
  }

  // 1) Debug.VERSION: avoid page.evaluate polling tied to one execution context.
  const authPolling = `        let start = Date.now();\n        let timeout = this.options.authTimeoutMs;\n        let res = false;\n        while (start > Date.now() - timeout) {\n            res = await this.pupPage.evaluate(\n                'window.Debug?.VERSION != undefined',\n            );\n            if (res) {\n                break;\n            }\n            await new Promise((r) => setTimeout(r, 200));\n        }\n        if (!res) {\n            throw 'auth timeout';\n        }`;
  const authWait = `        // ${PATCH_MARKER}: current WA Web can replace the page execution context\n        // during startup. Puppeteer's waitForFunction survives that transition.\n        const authTimeout = this.options.authTimeoutMs || 30000;\n        await this.pupPage\n            .waitForFunction('window.Debug?.VERSION != undefined', { timeout: authTimeout })\n            .catch(() => { throw 'auth timeout'; });`;

  if (source.includes(authPolling)) {
    source = source.replace(authPolling, authWait);
  } else if (!source.includes("waitForFunction('window.Debug?.VERSION != undefined'")) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (espera de Debug.VERSION).');
  }

  // 2) Authentication bootstrap: the npm 1.34.7 build injects AuthStore and then
  // waits inside one page.evaluate callback for Socket.change:state. Current WA
  // Web can replace that context or change state before the listener is attached,
  // leaving initialize() pending forever and Vyzium stuck at "Iniciando".
  const oldAuthBootstrap = /[ \t]*await this\.pupPage\.evaluate\(ExposeAuthStore\);\n\s*const needAuthentication = await this\.pupPage\.evaluate\(async \(\) => \{[\s\S]*?\n\s*\}\);\n\s*if \(needAuthentication\) \{/;
  const unsafeV3AuthBootstrap = `        const needAuthHandle = await this.pupPage.waitForFunction(
            () => {
                const state = window.require?.('WAWebSocketModel')?.Socket?.state;
                if (!state || state === 'OPENING' || state === 'UNLAUNCHED' || state === 'PAIRING') return false;
                return { need: state === 'UNPAIRED' || state === 'UNPAIRED_IDLE', state };
            },
            { timeout: authTimeout },
        );
        const needAuthentication = await needAuthHandle.jsonValue();
        if (needAuthentication.need) {`;
  const newAuthBootstrap = `        const needAuthHandle = await this.pupPage.waitForFunction(
            ${SOCKET_STATE_PROBE_SOURCE},
            { timeout: authTimeout },
        );
        const needAuthentication = await needAuthHandle.jsonValue();
        if (needAuthentication.need) {`;

  if (source.includes(unsafeV3AuthBootstrap)) {
    source = source.replace(unsafeV3AuthBootstrap, newAuthBootstrap);
  } else if (oldAuthBootstrap.test(source)) {
    source = source.replace(oldAuthBootstrap, newAuthBootstrap);
  } else if (!source.includes('const needAuthHandle = await this.pupPage.waitForFunction(')) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (detecção do estado de autenticação).');
  }

  // 3) QR bootstrap: AuthStore.RegistrationUtils from the released 1.34.7 no
  // longer matches current WhatsApp Web internals. Use the direct module names
  // already used by current whatsapp-web.js main.
  // Match the closing page.evaluate() at the same indentation as its opening
  // line. v3.1.1 stopped at the inner Conn.on(...); closure and left an extra
  // `});`, which made Client.js fail to parse with `Unexpected token ')'`.
  const oldQrBlock = /^([ \t]*)await this\.pupPage\.evaluate\(async \(\) => \{\n(?=[\s\S]*?window\.AuthStore\.RegistrationUtils)[\s\S]*?window\.AuthStore\.Conn\.on\('change:ref',[\s\S]*?\n\1\}\);/m;
  const newQrBlock = `                await this.pupPage.waitForFunction(
                    ${QR_MODULE_PROBE_SOURCE},
                    { timeout: authTimeout },
                );
                await this.pupPage.evaluate(async () => {\n                    const registrationInfo = await window\n                        .require('WAWebSignalStoreApi')\n                        .waSignalStore.getRegistrationInfo();\n                    const noiseKeyPair = await window\n                        .require('WAWebUserPrefsInfoStore')\n                        .waNoiseInfo.get();\n                    const staticKeyB64 = window\n                        .require('WABase64')\n                        .encodeB64(noiseKeyPair.staticKeyPair.pubKey);\n                    const identityKeyB64 = window\n                        .require('WABase64')\n                        .encodeB64(registrationInfo.identityKeyPair.pubKey);\n                    const advSecretKey = await window\n                        .require('WAWebUserPrefsMultiDevice')\n                        .getADVSecretKey();\n                    const platform = window.require('WAWebCompanionRegClientUtils').DEVICE_PLATFORM;\n                    const getQR = (ref) =>\n                        ref + ',' + staticKeyB64 + ',' + identityKeyB64 + ',' + advSecretKey + ',' + platform;\n                    const onRefChange = (_, ref) => {\n                        if (ref == null) return;\n                        window.onQRChangedEvent(getQR(ref));\n                    };\n                    const Conn = window.require('WAWebConnModel').Conn;\n                    if (Conn.ref != null) window.onQRChangedEvent(getQR(Conn.ref));\n                    Conn.on('change:ref', onRefChange);\n                    window.require('WAWebSocketModel').Socket.on('change:hasSynced', () => {\n                        Conn.off('change:ref', onRefChange);\n                    });\n                });`;

  if (oldQrBlock.test(source)) {
    source = source.replace(oldQrBlock, newQrBlock);
  } else if (source.includes("require('WAWebSignalStoreApi')") && !source.includes("const signal = window.require('WAWebSignalStoreApi')")) {
    const anchor = '                await this.pupPage.evaluate(async () => {\n                    const registrationInfo = await window';
    if (source.includes(anchor)) {
      source = source.replace(anchor, `                await this.pupPage.waitForFunction(\n                    ${QR_MODULE_PROBE_SOURCE},\n                    { timeout: authTimeout },\n                );\n                await this.pupPage.evaluate(async () => {\n                    const registrationInfo = await window`);
    }
  } else if (!source.includes("require('WAWebSignalStoreApi')")) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (geração do QR Code).');
  }

  // 4) The callback registered by exposeFunctionIfAbsent runs in Node, not in
  // the page. Refresh the QR inside page.evaluate instead of referencing window
  // from Node (upstream issue #201663).
  const oldRefresh = `                    // refresh qr code\n                    window.require('WAWebCmd').Cmd.refreshQR();`;
  const newRefresh = `                    // refresh qr code inside the browser execution context\n                    await this.pupPage.evaluate(() => {\n                        window.require('WAWebCmd').Cmd.refreshQR();\n                    });`;
  if (source.includes(oldRefresh)) source = source.replace(oldRefresh, newRefresh);

  // 5) ExposeAuthStore was removed from the current bootstrap. Keep the offline
  // progress callback independent from it as well.
  source = source.replace(
    "window.AuthStore.OfflineMessageHandler.getOfflineDeliveryProgress()",
    "window.require('WAWebOfflineHandler').OfflineMessageHandler.getOfflineDeliveryProgress()"
  );

  // 6) Use waitForFunction for the post-auth WWebJS injection too.
  const storePolling = `                    let start = Date.now();\n                    let res = false;\n                    while (start > Date.now() - 30000) {\n                        // Check window.WWebJS Injection\n                        res = await this.pupPage.evaluate(\n                            'window.WWebJS != undefined',\n                        );\n                        if (res) {\n                            break;\n                        }\n                        await new Promise((r) => setTimeout(r, 200));\n                    }\n                    if (!res) {\n                        throw 'ready timeout';\n                    }`;
  const storeWait = `                    await this.pupPage\n                        .waitForFunction('typeof window.WWebJS !== "undefined"', { timeout: 30000 })\n                        .catch(() => { throw 'ready timeout'; });`;
  if (source.includes(storePolling)) source = source.replace(storePolling, storeWait);

  // 7) Restored LocalAuth sessions can already be fully synchronized before
  // whatsapp-web.js installs the `change:hasSynced` listener. In that case the
  // browser is visibly connected, but AUTHENTICATED/READY never fire because
  // the transition happened in the past. Register an idempotent listener and
  // immediately replay the current synced state when necessary.
  const oldHasSyncedListener = /[ \t]*window\s*\n[ \t]*\.require\('WAWebSocketModel'\)\s*\n[ \t]*\.Socket\.on\('change:hasSynced', \(\) => \{\s*\n[ \t]*window\.onAppStateHasSyncedEvent\(\);\s*\n[ \t]*\}\);/;
  const restoredSessionListener = `        // ${PATCH_MARKER}: Vyzium restored-session replay.
        const vyziumSocket = window.require('WAWebSocketModel').Socket;
        let vyziumHasSyncedNotified = false;
        const vyziumNotifyHasSynced = () => {
            if (vyziumHasSyncedNotified || vyziumSocket.hasSynced !== true) return;
            vyziumHasSyncedNotified = true;
            window.onAppStateHasSyncedEvent();
        };
        vyziumSocket.on('change:hasSynced', vyziumNotifyHasSynced);
        vyziumNotifyHasSynced();`;

  if (oldHasSyncedListener.test(source)) {
    source = source.replace(oldHasSyncedListener, restoredSessionListener);
  } else if (!source.includes('Vyzium restored-session replay')) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (restauração de sessão sincronizada).');
  }

  // 8) Do not inject into the first document immediately after the load event.
  // Chrome can report `load` while WhatsApp is still replacing its main document
  // (including the short-lived `?post_logout=1` transition seen in the Vyzium
  // audit). Poll only basic DOM/location state here: never call window.require,
  // CacheStorage, IndexedDB or WhatsApp internals before the page stays stable.
  const gotoBlock = `        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/',
        });`;
  const stableGotoBlock = `${gotoBlock}

        // ${PATCH_MARKER}: wait for a stable WhatsApp document before the first inject.
        const vyziumBootstrapDeadline = Date.now() + 60000;
        this.emit('vyzium_bootstrap_waiting', { timeoutMs: 60000 });
        let vyziumBootstrapStableSince = 0;
        let vyziumBootstrapLastUrl = '';
        while (Date.now() < vyziumBootstrapDeadline) {
            let snapshot = null;
            try {
                snapshot = await page.evaluate(() => ({
                    href: String(location.href || ''),
                    readyState: document.readyState,
                    hasBody: Boolean(document.body),
                    hasDebug: Boolean(window.Debug?.VERSION),
                }));
            } catch (_) {
                vyziumBootstrapStableSince = 0;
                await new Promise((resolve) => setTimeout(resolve, 250));
                continue;
            }

            const cleanMainDocument =
                snapshot.href.startsWith('https://web.whatsapp.com/') &&
                !snapshot.href.includes('post_logout=1') &&
                snapshot.readyState === 'complete' &&
                snapshot.hasBody &&
                snapshot.hasDebug;

            if (cleanMainDocument) {
                if (snapshot.href !== vyziumBootstrapLastUrl) {
                    vyziumBootstrapLastUrl = snapshot.href;
                    vyziumBootstrapStableSince = Date.now();
                } else if (!vyziumBootstrapStableSince) {
                    vyziumBootstrapStableSince = Date.now();
                }
                if (Date.now() - vyziumBootstrapStableSince >= 4000) break;
            } else {
                vyziumBootstrapLastUrl = snapshot.href;
                vyziumBootstrapStableSince = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (!vyziumBootstrapStableSince || Date.now() - vyziumBootstrapStableSince < 4000) {
            this.emit('vyzium_bootstrap_timeout', { timeoutMs: 60000 });
            throw new Error('WhatsApp Web não estabilizou o documento inicial dentro do prazo.');
        }
        this.emit('vyzium_bootstrap_stable', { stableForMs: Date.now() - vyziumBootstrapStableSince });`;

  if (source.includes(gotoBlock) && !source.includes('wait for a stable WhatsApp document before the first inject')) {
    source = source.replace(gotoBlock, stableGotoBlock);
  } else if (!source.includes('wait for a stable WhatsApp document before the first inject')) {
    throw new Error('Não foi possível aplicar o patch do WhatsApp Web (barreira de estabilidade inicial).');
  }

  // 9) Preserve the upstream bootstrap order: the first inject must finish
  // before navigation recovery is registered. The former Vyzium patch did the
  // opposite, allowing a navigation event to start a second concurrent inject.
  // A LOGOUT is only reported here; profile deletion belongs to the host after
  // Chromium is fully stopped, never to Client.js while the profile is in use.
  const newNavigationBlock = `        // ${PATCH_MARKER}: navigation recovery is installed only after the initial inject.\n        await this.inject();\n        let vyziumNavigationRecovery = null;\n        this.pupPage.on('framenavigated', async (frame) => {\n            if (typeof frame.parentFrame === 'function' && frame.parentFrame() !== null) return;\n            const navigationUrl = frame.url();\n            const isLogout = navigationUrl.includes('post_logout=1') || this.lastLoggedOut;\n            if (isLogout) {\n                this.lastLoggedOut = false;\n                this.emit(Events.DISCONNECTED, 'LOGOUT');\n                return;\n            }\n            if (vyziumNavigationRecovery) return vyziumNavigationRecovery;\n            vyziumNavigationRecovery = (async () => {\n                try {\n                    let storeAvailable = false;\n                    try {\n                        storeAvailable = await this.pupPage.evaluate('typeof window.WWebJS !== "undefined"');\n                    } catch (_) {}\n                    if (storeAvailable || this.pupPage.isClosed()) return;\n                    await this.inject();\n                } catch (error) {\n                    const message = String(error?.message || error || '');\n                    if (/Execution context was destroyed|Cannot find context with specified id|Target closed|detached Frame/i.test(message)) return;\n                    this.emit('vyzium_navigation_error', error);\n                } finally {\n                    vyziumNavigationRecovery = null;\n                }\n            })();\n            return vyziumNavigationRecovery;\n        });`;
  source = replaceNavigationBlock(source, newNavigationBlock);

  // A simple build-time invariant: old QR bootstrap must be gone.
  if (source.includes('window.AuthStore.RegistrationUtils')) {
    throw new Error('O patch do QR ficou incompleto: AuthStore.RegistrationUtils ainda está presente.');
  }
  if (!source.includes("require('WAWebSignalStoreApi')")) {
    throw new Error('O patch do QR ficou incompleto: WAWebSignalStoreApi não foi instalado.');
  }
  if (!source.includes(PATCH_MARKER)) {
    throw new Error('O marcador do patch não foi inserido no Client.js.');
  }

  // Never persist a patched dependency that Node cannot parse. This turns the
  // former runtime QR failure into an immediate, readable install-time error.
  assertValidJavaScript(source);

  return { source, changed: true };
}

function applyPatch(projectRoot = path.resolve(__dirname, '..')) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', { paths: [projectRoot] });
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (pkg.version !== '1.34.7') {
    throw new Error(`Patch do WhatsApp Web validado para 1.34.7, mas foi instalada a versão ${pkg.version}.`);
  }
  const clientFile = path.join(path.dirname(packageFile), 'src', 'Client.js');
  const original = fs.readFileSync(clientFile, 'utf8');
  const result = patchClientSource(original);
  if (result.changed) {
    fs.writeFileSync(clientFile, result.source, 'utf8');
    process.stdout.write('Vyzium: correção de bootstrap/QR do whatsapp-web.js aplicada.\n');
  } else {
    process.stdout.write('Vyzium: correção de bootstrap/QR do whatsapp-web.js já estava aplicada.\n');
  }
  return result.changed;
}

if (require.main === module) {
  try {
    applyPatch();
  } catch (error) {
    // A broken Client.js prevents QR generation entirely, so postinstall must
    // fail instead of reporting a successful installation with a latent error.
    console.error(`Vyzium: patch do WhatsApp não pôde ser aplicado: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  patchClientSource,
  applyPatch,
  PATCH_MARKER,
  SOCKET_STATE_PROBE_SOURCE,
  QR_MODULE_PROBE_SOURCE,
  assertValidJavaScript,
  repairMalformedV2QrClosure
};
