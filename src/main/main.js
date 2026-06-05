const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { NexusClient } = require('./nexus-client');

const isDev = process.argv.includes('--dev');

app.setName('Vessel');

let mainWindow = null;
let nexus = null;
let sayProcess = null;

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function speechHelperPath() {
  const devPath = path.join(__dirname, '../../native/macos/VesselSpeech');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath || '', 'native/macos/VesselSpeech');
}

function speak(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  if (sayProcess) {
    sayProcess.kill();
    sayProcess = null;
  }
  sayProcess = spawn('say', [clean], { stdio: 'ignore' });
  sayProcess.on('exit', () => {
    sayProcess = null;
    sendToRenderer('speech-speaking', false);
  });
  sendToRenderer('speech-speaking', true);
}

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
  mainWindow = win;

  nexus = new NexusClient({
    onEvent: (event) => sendToRenderer('nexus-event', event),
    onStatus: (status) => sendToRenderer('nexus-status', status),
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

  ipcMain.handle('nexus-connect', (_event, config) => {
    nexus.connect(config || {});
    return { ok: true };
  });

  ipcMain.handle('nexus-default-config', () => {
    return {
      wsUrl: process.env.NEXUS_WS_URL || 'wss://dmonextreme.tail41686e.ts.net:7888',
      token: process.env.NEXUS_TOKEN || '',
      insecureTLS: process.env.NEXUS_INSECURE_TLS === '1' || !process.env.NEXUS_WS_URL,
    };
  });

  ipcMain.handle('nexus-send', (_event, payload) => {
    try {
      const content = String(payload?.content || '').trim();
      if (!content) return { ok: false, error: 'message is empty' };
      nexus.sendChat(content, Number(payload?.replyTo || 0));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('speech-transcribe', async (_event, audioBytes) => {
    const helper = speechHelperPath();
    if (!fs.existsSync(helper)) {
      return { ok: false, error: `Apple Speech helper not built at ${helper}` };
    }
    const tmp = path.join(os.tmpdir(), `vessel-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    fs.writeFileSync(tmp, Buffer.from(audioBytes));
    return await new Promise((resolve) => {
      const child = spawn(helper, [tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => {
        fs.rm(tmp, { force: true }, () => {});
        resolve({ ok: false, error: err.message });
      });
      child.on('exit', () => {
        fs.rm(tmp, { force: true }, () => {});
        const line = stdout.trim().split(/\n/).filter(Boolean).pop();
        if (!line) {
          resolve({ ok: false, error: stderr.trim() || 'speech helper returned no output' });
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ ok: false, error: line });
        }
      });
    });
  });

  ipcMain.handle('speech-say', (_event, text) => {
    speak(text);
    return { ok: true };
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
