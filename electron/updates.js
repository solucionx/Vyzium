'use strict';
function createUpdater({app, dialog, getWindow, prepareInstall, promptInstall, platform = process.platform, autoUpdater = require('electron-updater').autoUpdater}) {
  let busy = false, ready = false;
  const notify = message => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-status', {message});
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL({provider: 'github', owner: 'solucionx', repo: 'Vyzium'});
  autoUpdater.on('download-progress', p => notify(`Baixando atualização: ${Math.round(p.percent)}%`));
  autoUpdater.on('error', () => notify('Não foi possível atualizar. Verifique a conexão e tente novamente.'));
  async function install() {
    const win = getWindow();
    let installNow = false;
    if (typeof promptInstall === 'function') {
      installNow = await promptInstall();
    } else if (win && !win.isDestroyed()) {
      const { ipcMain } = require('electron');
      installNow = await new Promise(resolve => {
        const channel = 'update-prompt-response';
        const timer = setTimeout(() => {
          ipcMain.removeAllListeners(channel);
          resolve(false);
        }, 300000);
        ipcMain.once(channel, (_event, action) => {
          clearTimeout(timer);
          resolve(action === 'install');
        });
        win.webContents.send('update-prompt', {
          title: 'Atualizar Vyzium',
          message: 'Atualização pronta. Reiniciar o Vyzium para instalar?',
          confirmLabel: 'Reiniciar e instalar',
          cancelLabel: 'Mais tarde'
        });
      });
    } else {
      const {response} = await dialog.showMessageBox(getWindow(), {
        type: 'info', title: 'Atualizar Vyzium',
        message: 'Atualização pronta. Reiniciar o Vyzium para instalar?',
        buttons: ['Reiniciar e instalar', 'Mais tarde'], defaultId: 0, cancelId: 1
      });
      installNow = response === 0;
    }
    if (!installNow) { notify('Atualização pronta. Clique em Verificar atualizações para instalar.'); return; }
    await prepareInstall();
    notify('Instalando atualização…');
    autoUpdater.quitAndInstall(false, true);
  }
  return {async check() {
    if (busy) return;
    if (!app.isPackaged || platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_FILE) {
      notify('Para atualizar, use o Vyzium instalado pelo instalador do Windows.'); return;
    }
    busy = true;
    try {
      if (ready) return await install();
      notify('Verificando atualizações…');
      let available = false;
      const found = () => { available = true; };
      autoUpdater.once('update-available', found);
      try { await autoUpdater.checkForUpdates(); }
      finally { autoUpdater.removeListener('update-available', found); }
      if (!available) { notify(`Vyzium ${app.getVersion()} está atualizado.`); return; }
      notify('Baixando atualização…');
      await autoUpdater.downloadUpdate();
      ready = true;
      await install();
    } catch (error) {
      notify(error.message?.includes('andamento') || error.message?.includes('operação')
        ? error.message : 'Não foi possível atualizar. Confira a conexão e a Release publicada no GitHub.');
    } finally { busy = false; }
  }};
}
module.exports = {createUpdater};
