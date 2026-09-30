const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dallmayrRFID', {
  getStatus: () => ipcRenderer.invoke('rfid:get-status'),
  sendCommand: (command) => ipcRenderer.invoke('rfid:command', command),
  saveCsv: (csvText) => ipcRenderer.invoke('rfid:save-csv', csvText),
  setPaused: (paused) => ipcRenderer.invoke('rfid:set-paused', Boolean(paused)),
  quit: () => ipcRenderer.invoke('rfid:quit'),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('rfid:status', handler);
    return () => ipcRenderer.removeListener('rfid:status', handler);
  },
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('rfid:event', handler);
    return () => ipcRenderer.removeListener('rfid:event', handler);
  }
});
