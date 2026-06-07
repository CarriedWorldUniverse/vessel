const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function parseJSONEnv(name) {
  try {
    return JSON.parse(process.env[name] || '{}');
  } catch {
    return {};
  }
}

function speakerEnvKey(prefix, speaker) {
  return `${prefix}_${String(speaker || '').replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
}

function voiceForSpeaker(speaker) {
  const clean = String(speaker || '').trim();
  if (!clean) return process.env.VESSEL_VOICE_DEFAULT || '';
  const map = parseJSONEnv('VESSEL_VOICES');
  const envKey = speakerEnvKey('VESSEL_VOICE', clean);
  return process.env[envKey] || map[clean] || process.env.VESSEL_VOICE_DEFAULT || '';
}

function voxVoiceForSpeaker(speaker) {
  const clean = String(speaker || '').trim();
  const map = parseJSONEnv('VESSEL_VOXCPM_VOICES');
  const envKey = speakerEnvKey('VESSEL_VOXCPM_VOICE', clean);
  return process.env[envKey] || map[clean] || process.env.VESSEL_VOXCPM_VOICE_DEFAULT || 'default';
}

function voxPromptForSpeaker(speaker) {
  const clean = String(speaker || '').trim();
  const map = parseJSONEnv('VESSEL_VOXCPM_PROMPTS');
  const envKey = speakerEnvKey('VESSEL_VOXCPM_PROMPT', clean);
  return process.env[envKey] || map[clean] || '';
}

function tmpAudioPath(ext = 'wav') {
  return path.join(os.tmpdir(), `vessel-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
}

function repoPath(...parts) {
  return path.join(__dirname, '../..', ...parts);
}

function splitArgs(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Fall through to a simple whitespace split.
  }
  return raw.split(/\s+/).filter(Boolean);
}

function sidecarPort() {
  return process.env.VESSEL_VOXCPM_SIDECAR_PORT || '8765';
}

function defaultSidecarBaseURL() {
  return `http://127.0.0.1:${sidecarPort()}/v1`;
}

function spawnPlayer(filePath) {
  const player = process.platform === 'darwin' ? 'afplay' : 'ffplay';
  const args = process.platform === 'darwin'
    ? [filePath]
    : ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath];
  return spawn(player, args, { stdio: 'ignore' });
}

class TTSController {
  constructor({ onSpeaking } = {}) {
    this.onSpeaking = onSpeaking;
    this.process = null;
    this.abort = null;
    this.tmpFile = null;
    this.sidecar = null;
    this.sidecarReady = null;
  }

  stop() {
    this.stopPlayback();
  }

  shutdown() {
    this.stopPlayback();
    if (this.sidecar) {
      this.sidecar.kill();
      this.sidecar = null;
      this.sidecarReady = null;
    }
  }

  stopPlayback() {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.tmpFile) {
      fs.rm(this.tmpFile, { force: true }, () => {});
      this.tmpFile = null;
    }
    this.onSpeaking?.(false);
  }

  speak(text, speaker = '') {
    const clean = String(text || '').trim();
    if (!clean) return { ok: true, engine: 'none' };
    this.stopPlayback();
    this.onSpeaking?.(true);
    if ((process.env.VESSEL_TTS_ENGINE || '').toLowerCase() === 'voxcpm') {
      this.speakVoxCPM(clean, speaker).catch((err) => {
        console.error(`VoxCPM TTS failed: ${err.message}`);
        this.speakSay(clean, speaker);
      });
      return { ok: true, engine: 'voxcpm' };
    }
    this.speakSay(clean, speaker);
    return { ok: true, engine: 'say' };
  }

  speakSay(text, speaker = '') {
    const voice = voiceForSpeaker(speaker);
    const args = voice ? ['-v', voice, text] : [text];
    this.process = spawn('say', args, { stdio: 'ignore' });
    this.process.on('exit', () => {
      this.process = null;
      this.onSpeaking?.(false);
    });
  }

  async speakVoxCPM(text, speaker = '') {
    await this.ensureVoxCPMSidecar();
    const baseURL = process.env.VESSEL_VOXCPM_BASE_URL || process.env.VESSEL_TTS_BASE_URL || defaultSidecarBaseURL();
    if (!baseURL) {
      throw new Error('VESSEL_VOXCPM_BASE_URL or VESSEL_TTS_BASE_URL is required');
    }

    const prompt = voxPromptForSpeaker(speaker);
    const input = prompt ? `(${prompt})${text}` : text;
    const controller = new AbortController();
    this.abort = controller;

    const res = await fetch(`${baseURL.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.VESSEL_TTS_API_KEY ? { Authorization: `Bearer ${process.env.VESSEL_TTS_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.VESSEL_VOXCPM_MODEL || process.env.VESSEL_TTS_MODEL || 'openbmb/VoxCPM2',
        input,
        voice: voxVoiceForSpeaker(speaker),
        response_format: process.env.VESSEL_VOXCPM_FORMAT || 'wav',
      }),
      signal: controller.signal,
    });
    this.abort = null;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
    }

    const audio = Buffer.from(await res.arrayBuffer());
    const filePath = tmpAudioPath(process.env.VESSEL_VOXCPM_FORMAT || 'wav');
    this.tmpFile = filePath;
    fs.writeFileSync(filePath, audio);

    if (process.env.VESSEL_TTS_NO_PLAY === '1') {
      fs.rm(filePath, { force: true }, () => {});
      this.tmpFile = null;
      this.onSpeaking?.(false);
      return;
    }

    this.process = spawnPlayer(filePath);
    this.process.on('exit', () => {
      this.process = null;
      fs.rm(filePath, { force: true }, () => {});
      if (this.tmpFile === filePath) this.tmpFile = null;
      this.onSpeaking?.(false);
    });
  }

  async ensureVoxCPMSidecar() {
    if (process.env.VESSEL_VOXCPM_SIDECAR !== '1') return;
    if (this.sidecarReady) return this.sidecarReady;

    const port = sidecarPort();
    const command = process.env.VESSEL_VOXCPM_SIDECAR_COMMAND || 'python3';
    const defaultArgs = [
      repoPath('sidecars/voxcpm/server.py'),
      '--host',
      '127.0.0.1',
      '--port',
      port,
    ];
    const args = process.env.VESSEL_VOXCPM_SIDECAR_ARGS
      ? splitArgs(process.env.VESSEL_VOXCPM_SIDECAR_ARGS)
      : defaultArgs;

    this.sidecarReady = (async () => {
      if (!this.sidecar) {
        this.sidecar = spawn(command, args, {
          cwd: repoPath(),
          env: {
            ...process.env,
            VESSEL_VOXCPM_LISTEN_PORT: port,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.sidecar.stdout.on('data', (chunk) => {
          console.log(`[voxcpm] ${chunk.toString().trim()}`);
        });
        this.sidecar.stderr.on('data', (chunk) => {
          console.error(`[voxcpm] ${chunk.toString().trim()}`);
        });
        this.sidecar.on('exit', (code, signal) => {
          console.error(`[voxcpm] exited code=${code} signal=${signal}`);
          this.sidecar = null;
          this.sidecarReady = null;
        });
      }
      await waitForSidecar(process.env.VESSEL_VOXCPM_BASE_URL || process.env.VESSEL_TTS_BASE_URL || defaultSidecarBaseURL());
    })();

    return this.sidecarReady;
  }
}

async function waitForSidecar(baseURL) {
  const normalized = baseURL.replace(/\/$/, '');
  const root = normalized.replace(/\/v1$/, '');
  const timeoutMs = Number(process.env.VESSEL_VOXCPM_STARTUP_TIMEOUT_MS || 60000);
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    for (const endpoint of [`${root}/health`, `${normalized}/models`]) {
      try {
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
        if (res.ok) return;
        lastError = new Error(`${endpoint}: ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`VoxCPM sidecar did not become ready: ${lastError?.message || 'timeout'}`);
}

module.exports = { TTSController };
