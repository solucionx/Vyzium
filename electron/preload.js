'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('followup', {
  api: (method, route, body) => ipcRenderer.invoke('api', { method, route, body }),
  chooseWorkbook: () => ipcRenderer.invoke('choose-workbook'),
  exportMap: id => ipcRenderer.invoke('save-export', id),
  setZoom: percent => ipcRenderer.invoke('set-zoom', percent),
  switchModule: (moduleName, destination) => ipcRenderer.invoke('switch-module', moduleName, destination),
  searchAll: query => ipcRenderer.invoke('global-search', query),
  goHome: () => ipcRenderer.invoke('go-home'),
  getOverview: () => ipcRenderer.invoke('get-overview'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  logRendererError: payload => ipcRenderer.invoke('renderer-error', payload),
  copyText: value => ipcRenderer.invoke('copy-text', value),
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
  respondUpdatePrompt: action => ipcRenderer.send('update-prompt-response', action),
  auth: {
    state: () => ipcRenderer.invoke('auth-state'),
    register: body => ipcRenderer.invoke('auth-register', body),
    login: body => ipcRenderer.invoke('auth-login', body),
    resendVerification: () => ipcRenderer.invoke('auth-resend-verification'),
    refreshVerification: () => ipcRenderer.invoke('auth-refresh-verification'),
    resetPassword: email => ipcRenderer.invoke('auth-reset-password', email),
    logout: () => ipcRenderer.invoke('auth-logout')
  },
  backupSync: {
    preflight: () => ipcRenderer.invoke('backup-sync-preflight'),
    prepare: () => ipcRenderer.invoke('backup-sync-prepare'),
    apply: (planId, resolutions = {}) => ipcRenderer.invoke('backup-sync-apply', { planId, resolutions }),
    cancel: planId => ipcRenderer.invoke('backup-sync-cancel', planId),
    skip: headId => ipcRenderer.invoke('backup-sync-skip', headId)
  },
  security: {
    status: () => ipcRenderer.invoke('security-status'),
    setup: () => ipcRenderer.invoke('security-setup'),
    finalize: () => ipcRenderer.invoke('security-finalize'),
    recover: code => ipcRenderer.invoke('security-recover', code),
    enterApp: () => ipcRenderer.invoke('security-enter-app'),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('security-progress', listener);
      return () => ipcRenderer.removeListener('security-progress', listener);
    }
  }
});
