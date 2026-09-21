'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('node:vm');

function browserCandidates() {
  const result = [process.env.VYZIUM_BROWSER_PATH];
  for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
    if (!base) continue;
    result.push(
      path.join(base, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(base, 'Google/Chrome/Application/chrome.exe')
    );
  }
  result.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return [...new Set(result.filter(Boolean))];
}

function diagnose(projectRoot = path.resolve(__dirname, '..')) {
  const packageFile = require.resolve('whatsapp-web.js/package.json', {paths:[projectRoot]});
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const clientFile = path.join(path.dirname(packageFile), 'src', 'Client.js');
  const source = fs.readFileSync(clientFile, 'utf8');
  let syntax = 'OK';
  try { new vm.Script(source, {filename:clientFile}); }
  catch (error) { syntax = `ERRO: ${error.message}`; }
  const browsers = browserCandidates().filter(candidate => fs.existsSync(candidate));
  const navigationStart = source.indexOf('navigation recovery is installed only after the initial inject');
  const navigationBlock = source.slice(navigationStart, navigationStart + 2500);
  const report = {
    generatedAt:new Date().toISOString(),
    node:process.version,
    platform:`${process.platform}-${process.arch}`,
    whatsappWebJs:pkg.version,
    clientFile,
    clientSha256:crypto.createHash('sha256').update(source).digest('hex'),
    syntax,
    hasVyziumPatch:source.includes('VYZIUM_WWEBJS_BOOTSTRAP_PATCH_V6'),
    hasSafeNavigationOrder:source.indexOf('await this.inject();') < source.indexOf("this.pupPage.on('framenavigated'"),
    hasInjectMutex:source.includes('let vyziumNavigationRecovery = null'),
    deletesProfileInsideNavigationHandler:navigationBlock.includes('await this.authStrategy.logout()'),
    hasSignalStore:source.includes('WAWebSignalStoreApi'),
    hasRegistrationUtils:source.includes('AuthStore.RegistrationUtils'),
    browsers
  };
  return report;
}

if (require.main === module) {
  try {
    const report = diagnose();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.syntax !== 'OK' || !report.hasVyziumPatch || !report.hasSafeNavigationOrder || !report.hasInjectMutex || report.deletesProfileInsideNavigationHandler || !report.browsers.length) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Diagnóstico do WhatsApp falhou: ${error?.stack || error}`);
    process.exitCode = 1;
  }
}

module.exports = {diagnose, browserCandidates};
