const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig, applyRuntimeEnv } = require('./config');
const { NexusClient } = require('./nexus-client');
const { TTSController } = require('./tts-client');
const { UnderstandingClient } = require('./understanding-client');

const isDev = process.argv.includes('--dev');
const config = loadConfig();
applyRuntimeEnv(config);

app.setName('Vessel');

let mainWindow = null;
let nexus = null;
let tts = null;
let understanding = null;

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function speechHelperPath() {
  const devPath = path.join(__dirname, '../../native/macos/VesselSpeech');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath || '', 'native/macos/VesselSpeech');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Vessel',
    transparent: false,
    frame: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#07070c',
  });
  mainWindow = win;

  nexus = new NexusClient({
    onEvent: (event) => sendToRenderer('nexus-event', event),
    onStatus: (status) => sendToRenderer('nexus-status', status),
  });
  tts = new TTSController({
    onSpeaking: (speaking) => sendToRenderer('speech-speaking', speaking),
  });
  understanding = new UnderstandingClient(config.understanding || {});

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
      wsUrl: config.nexus?.wsUrl || '',
      token: config.nexus?.token || '',
      insecureTLS: Boolean(config.nexus?.insecureTLS),
      visibleAspects: (config.stage?.visibleAspects || []).join(','),
      excludedAspects: (config.stage?.excludedAspects || []).join(','),
      understanding: {
        enabled: Boolean(config.understanding?.enabled),
        reviewBeforeSend: config.understanding?.reviewBeforeSend !== false,
        model: config.understanding?.model || '',
        speechSummaryMode: config.understanding?.speechSummaryMode || 'heuristic',
      },
    };
  });

  ipcMain.handle('nexus-send', async (_event, payload) => {
    try {
      const content = String(payload?.content || '').trim();
      if (!content) return { ok: false, error: 'message is empty' };
      const target = String(payload?.target || '').trim().toLowerCase();
      if (target) {
        const mention = new RegExp(`^@${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i');
        const cleanContent = content.replace(mention, '').trim() || content;
        const msgId = await nexus.sayAspect(target, cleanContent);
        return { ok: true, msgId };
      }
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

  ipcMain.handle('speech-understand', async (_event, payload) => {
    return understanding.clean({
      text: payload?.text || '',
      aspects: payload?.aspects || {},
    });
  });

  ipcMain.handle('speech-summarize', async (_event, payload) => {
    return understanding.summarizeForSpeech({
      text: payload?.text || '',
      speaker: payload?.speaker || '',
    });
  });

  ipcMain.handle('speech-say', (_event, payload) => {
    if (typeof payload === 'string') {
      return tts.speak(payload);
    } else {
      return tts.speak(payload?.text, payload?.speaker);
    }
  });

  ipcMain.handle('speech-stop', () => {
    tts.stop();
    return { ok: true };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  tts?.shutdown();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
