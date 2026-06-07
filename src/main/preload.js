const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vessel', {
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  closeWindow: () => ipcRenderer.send('window-close'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window-toggle-top'),
  getNexusDefaultConfig: () => ipcRenderer.invoke('nexus-default-config'),
  connectNexus: (config) => ipcRenderer.invoke('nexus-connect', config),
  sendNexus: (payload) => ipcRenderer.invoke('nexus-send', payload),
  transcribeSpeech: (audioBytes) => ipcRenderer.invoke('speech-transcribe', audioBytes),
  understandSpeech: (payload) => ipcRenderer.invoke('speech-understand', payload),
  summarizeSpeech: (payload) => ipcRenderer.invoke('speech-summarize', payload),
  say: (payload) => ipcRenderer.invoke('speech-say', payload),
  stopSpeech: () => ipcRenderer.invoke('speech-stop'),
  onNexusStatus: (handler) => ipcRenderer.on('nexus-status', (_event, payload) => handler(payload)),
  onNexusEvent: (handler) => ipcRenderer.on('nexus-event', (_event, payload) => handler(payload)),
  onSpeechSpeaking: (handler) => ipcRenderer.on('speech-speaking', (_event, payload) => handler(payload)),
});
