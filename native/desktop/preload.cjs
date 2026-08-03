const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dallmayrNative', {
  shell: 'electron',
  platform: process.platform,
});
