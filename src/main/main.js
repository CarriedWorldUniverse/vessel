const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const isDev = process.argv.includes('--dev');

app.setName('Vessel');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Vessel',
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

  ipcMain.on('window-close', () => {
    win.close();
  });

  ipcMain.on('window-minimize', () => {
    win.minimize();
  });

  ipcMain.on('window-toggle-top', () => {
    win.setAlwaysOnTop(!win.isAlwaysOnTop());
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
