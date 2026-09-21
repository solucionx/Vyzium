'use strict';

const fs = require('fs');
const path = require('path');
const { PATCH_MARKER, assertValidJavaScript } = require('./patch-whatsapp-web');

function resolveClientFile(projectRoot) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', { paths: [projectRoot] });
  return {
    packageFile,
    clientFile: path.join(path.dirname(packageFile), 'src', 'Client.js'),
    version: JSON.parse(fs.readFileSync(packageFile, 'utf8')).version
  };
}

function verifyPatch(projectRoot = path.resolve(__dirname, '..')) {
  const { clientFile, version } = resolveClientFile(projectRoot);
  const source = fs.readFileSync(clientFile, 'utf8');
  const fail = message => { throw new Error(`Correção do WhatsApp incompleta: ${message}`); };

  try {
    assertValidJavaScript(source, clientFile);
  } catch (error) {
    fail(`Client.js inválido: ${error?.message || error}`);
  }

  if (!source.includes(PATCH_MARKER)) fail(`marcador ${PATCH_MARKER} ausente.`);
  if (!source.includes('const needAuthHandle = await this.pupPage.waitForFunction(')) fail('detecção moderna do estado de autenticação ausente.');
  if (!source.includes("const socketModule = window.require('WAWebSocketModel')")) fail('probe resiliente de WAWebSocketModel ausente.');
  if (!source.includes('catch (_)')) fail('probe do bootstrap ainda pode abortar por módulo não resolvido.');
  if (!source.includes("const signal = window.require('WAWebSignalStoreApi')")) fail('espera segura pelas dependências do QR ausente.');
  if (!source.includes("require('WAWebSignalStoreApi')")) fail('bootstrap atual do QR Code ausente.');
  if (!source.includes("require('WAWebUserPrefsInfoStore')")) fail('leitura atual da chave de ruído ausente.');
  if (!source.includes("require('WAWebCompanionRegClientUtils')")) fail('plataforma atual do QR ausente.');
  if (source.includes('window.AuthStore.RegistrationUtils')) fail('caminho legado AuthStore.RegistrationUtils ainda presente.');
  if (!source.includes("window.require('WAWebCmd').Cmd.refreshQR();")) fail('renovação do QR ausente.');
  if (!source.includes('WAWebOfflineHandler')) fail('callback pós-autenticação ainda depende do AuthStore legado.');
  if (!source.includes('Vyzium restored-session replay')) fail('recuperação de sessão já sincronizada ausente.');
  if (!source.includes('vyziumNotifyHasSynced')) fail('listener idempotente de hasSynced ausente.');
  if (!source.includes('vyziumSocket.hasSynced !== true')) fail('restauração ainda não valida o estado atual de sincronização.');
  if (!source.includes('wait for a stable WhatsApp document before the first inject')) fail('barreira de estabilidade antes do primeiro inject ausente.');
  if (!source.includes('vyziumBootstrapStableSince')) fail('janela mínima de estabilidade do documento ausente.');
  if (!source.includes('navigation recovery is installed only after the initial inject')) fail('ordem segura do bootstrap ausente.');
  if (source.indexOf('await this.inject();') > source.indexOf("this.pupPage.on('framenavigated'")) fail('listener de navegação ainda antecede o primeiro inject.');
  if (!source.includes('let vyziumNavigationRecovery = null')) fail('trava contra inject concorrente ausente.');
  const navigationStart = source.indexOf('navigation recovery is installed only after the initial inject');
  const navigationBlock = source.slice(navigationStart, navigationStart + 2500);
  if (navigationBlock.includes('await this.authStrategy.logout()')) fail('handler de navegação ainda apaga o perfil com o navegador ativo.');

  return { patched: true, version, clientFile };
}

if (require.main === module) {
  try {
    const result = verifyPatch();
    process.stdout.write(`Vyzium: patch de bootstrap/QR do whatsapp-web.js ${result.version} verificado com sucesso.\n`);
  } catch (error) {
    process.stderr.write(`Vyzium: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verifyPatch };
