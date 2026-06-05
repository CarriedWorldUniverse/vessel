const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vessel', {
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
});
