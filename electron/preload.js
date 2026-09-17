const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('followup', {
  api: (method, route, body) => ipcRenderer.invoke('api', { method, route, body }),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onUpdateStatus: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  chooseWorkbook: () => ipcRenderer.invoke('choose-workbook')
});
