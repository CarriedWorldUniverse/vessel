const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const isDev = process.argv.includes('--dev');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Windows: required for per-pixel transparency
    backgroundColor: '#00000000',
  });

  // Click-through on transparent regions — set via setIgnoreMouseEvents with forward:true
  // so the renderer can tell main when to enable/disable hit-testing
  win.setIgnoreMouseEvents(false);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Renderer signals mouse hit state changes
  ipcMain.on('set-ignore-mouse-events', (_event, ignore) => {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
