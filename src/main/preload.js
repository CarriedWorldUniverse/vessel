const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vessel', {
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window-toggle-top'),
});
