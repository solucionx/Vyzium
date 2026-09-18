'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('followup', {
  api: (method, route, body) => ipcRenderer.invoke('api', { method, route, body }),
  chooseWorkbook: () => ipcRenderer.invoke('choose-workbook'),
  exportMap: id => ipcRenderer.invoke('save-export', id),
  setZoom: percent => ipcRenderer.invoke('set-zoom', percent),
  switchModule: moduleName => ipcRenderer.invoke('switch-module', moduleName),
  goHome: () => ipcRenderer.invoke('go-home'),
  getOverview: () => ipcRenderer.invoke('get-overview'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  onUpdateStatus: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  onUpdatePrompt: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-prompt', listener);
    return () => ipcRenderer.removeListener('update-prompt', listener);
  },
  respondUpdatePrompt: action => ipcRenderer.send('update-prompt-response', action)
});
