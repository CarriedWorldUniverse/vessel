// Right panel overlay — shows active speaker's long-form content
import { stageState, onStateChange, patchAspect, setState } from './state.js';

const panel = document.getElementById('right-panel');
const content = document.getElementById('right-panel-content');
const input = document.getElementById('input-field');
const connectButton = document.getElementById('connect-nexus');
const dictateButton = document.getElementById('dictate-button');
const connectionLabel = document.getElementById('connection-label');
const connectionDot = document.getElementById('connection-dot');
const nexusUrl = document.getElementById('nexus-url');
const nexusToken = document.getElementById('nexus-token');
const nexusInsecure = document.getElementById('nexus-insecure');
const THRESHOLD = 200;  // chars before panel appears

document.getElementById('close-window')?.addEventListener('click', () => {
  window.vessel?.closeWindow();
});

document.getElementById('minimize-window')?.addEventListener('click', () => {
  window.vessel?.minimizeWindow();
});

document.getElementById('toggle-top-window')?.addEventListener('click', () => {
  window.vessel?.toggleAlwaysOnTop();
});

function update(state) {
  const text = state.panelContent;
  if (text && text.length > THRESHOLD / 2) {
    content.textContent = text;
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }

  const status = state.connection?.status || 'disconnected';
  connectionLabel.textContent = state.connection?.detail
    ? `${status}: ${state.connection.detail}`
    : status;
  connectionDot.dataset.status = status;
}

onStateChange(update);
update(stageState);

function mentionFor(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (/^@\w+/.test(trimmed)) return trimmed;
  const active = stageState.activeSpeaker;
  return active ? `@${active} ${trimmed}` : trimmed;
}

async function sendInput() {
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  const content = mentionFor(value);
  setState({
    panelContent: `You: ${content}`,
  });
  const res = await window.vessel?.sendNexus({
    content,
    replyTo: stageState.lastMessageId || 0,
  });
  if (res && !res.ok) {
    setState({ panelContent: `Nexus send failed: ${res.error}` });
  }
}

connectButton?.addEventListener('click', async () => {
  await connectNexusFromForm();
});

input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendInput();
  }
});

window.vessel?.onNexusStatus((status) => {
  setState({ connection: status });
});

window.vessel?.onNexusEvent((event) => {
  if (event.type === 'roster') {
    const next = {};
    for (const aspect of event.aspects || []) {
      next[aspect.name] = {
        status: aspect.status === 'live' ? 'online' : aspect.status === 'down' ? 'offline' : 'online',
        model: aspect.model,
        provider: aspect.provider,
      };
    }
    setState({ aspects: { ...stageState.aspects, ...next } });
  }
  if (event.type === 'roster-update') {
    const u = event.update || {};
    patchAspect(u.aspect, {
      status: u.status === 'live' ? 'online' : u.status === 'down' ? 'offline' : 'online',
      model: u.model,
      provider: u.provider,
    });
  }
  if (event.type === 'message') {
    const msg = event.message || {};
    const speaker = msg.from || null;
    if (speaker && speaker !== 'operator') {
      patchAspect(speaker, { status: 'speaking' });
      setTimeout(() => patchAspect(speaker, { status: 'online' }), 2400);
    }
    setState({
      activeSpeaker: speaker && speaker !== 'operator' ? speaker : stageState.activeSpeaker,
      panelContent: `${msg.from || 'unknown'}: ${msg.content || ''}`,
      lastMessageId: Number(msg.id || stageState.lastMessageId || 0),
    });
    if (speaker && speaker !== 'operator') {
      window.vessel?.say(msg.content || '');
    }
  }
});

async function loadDefaultsAndConnect() {
  const defaults = await window.vessel?.getNexusDefaultConfig?.();
  const stored = JSON.parse(localStorage.getItem('vessel.nexus') || '{}');
  nexusUrl.value = stored.wsUrl || defaults?.wsUrl || '';
  nexusToken.value = stored.token || defaults?.token || '';
  nexusInsecure.checked = stored.insecureTLS ?? Boolean(defaults?.insecureTLS);
  await connectNexusFromForm();
}

async function connectNexusFromForm() {
  const config = {
    wsUrl: nexusUrl.value.trim(),
    token: nexusToken.value.trim(),
    insecureTLS: nexusInsecure.checked,
  };
  localStorage.setItem('vessel.nexus', JSON.stringify(config));
  await window.vessel?.connectNexus(config);
}

loadDefaultsAndConnect();

let recorder = null;

dictateButton?.addEventListener('click', async () => {
  if (recorder) {
    dictateButton.textContent = 'Dictate';
    const wavBytes = await recorder.stop();
    recorder = null;
    const result = await window.vessel?.transcribeSpeech(wavBytes);
    if (!result?.ok) {
      setState({ panelContent: `Apple Speech failed: ${result?.error || 'unknown error'}` });
      return;
    }
    input.value = result.text || '';
    await sendInput();
    return;
  }

  try {
    recorder = await startWavRecorder();
    dictateButton.textContent = 'Stop';
    setState({ panelContent: 'Listening...' });
  } catch (err) {
    setState({ panelContent: `Microphone failed: ${err.message}` });
  }
});

async function startWavRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);

  return {
    async stop() {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      return encodeWav(chunks, context.sampleRate);
    },
  };
}

function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }
  return new Uint8Array(buffer);
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
