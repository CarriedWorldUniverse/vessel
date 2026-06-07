// Right panel overlay — shows active speaker's long-form content
import { stageState, onStateChange, patchAspect, setState } from './state.js';
import { normalizeAddress } from './targeting.js';

const panel = document.getElementById('right-panel');
const panelSpeaker = document.getElementById('right-panel-speaker');
const panelState = document.getElementById('right-panel-state');
const panelSpoken = document.getElementById('right-panel-spoken');
const panelDetail = document.getElementById('right-panel-detail');
const spokenSection = document.getElementById('spoken-section');
const detailSection = document.getElementById('detail-section');
const input = document.getElementById('input-field');
const connectButton = document.getElementById('connect-nexus');
const dictateButton = document.getElementById('dictate-button');
const sendButton = document.getElementById('send-button');
const settingsToggle = document.getElementById('settings-toggle');
const modeTabs = document.getElementById('mode-tabs');
const voiceTestButton = document.getElementById('voice-test-button');
const voiceAgentTabs = document.getElementById('voice-agent-tabs');
const transcriptPreview = document.getElementById('transcript-preview');
const inputWaveform = document.getElementById('input-waveform');
const connectionLabel = document.getElementById('connection-label');
const connectionDot = document.getElementById('connection-dot');
const activityPill = document.getElementById('activity-pill');
const pendingTurns = document.getElementById('pending-turns');
const incomingInbox = document.getElementById('incoming-inbox');
const configRow = document.getElementById('config-row');
const nexusUrl = document.getElementById('nexus-url');
const nexusToken = document.getElementById('nexus-token');
const nexusInsecure = document.getElementById('nexus-insecure');
const SPEECH_THRESHOLD = 200;
const VOICE_TEST_LINES = {
  shadow: 'Voice check for Shadow. I am ready to coordinate the room and keep the next action clear.',
  anvil: 'Voice check for Anvil. I am ready to build the practical path and call out the tradeoffs.',
  plumb: 'Voice check for Plumb. I am ready to connect the pieces and move quickly with you.',
};
let selectedVoiceAgent = 'shadow';
let waveformFrame = null;
let latestWaveformSamples = null;
let responseQueue = [];
let responseQueueRunning = false;
let currentSpeechWaiters = [];
let inputBusy = false;
let inputIdleWaiters = [];

function displayName(name) {
  return String(name || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function escapeHTML(value) {
  return String(value || '').replace(/[<>&"]/g, (ch) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  }[ch]));
}

function compactConnectionDetail(detail) {
  const raw = String(detail || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw.replace(/^wss?:\/\//, '').replace(/\/connect$/, '');
  }
}

function setActivity(status, label, detail = '') {
  setState({ activity: { status, label, detail } });
}

function setInputMode(mode) {
  const next = mode === 'dictation' ? 'dictation' : 'conversation';
  localStorage.setItem('vessel.inputMode', next);
  setState({ inputMode: next });
  for (const tab of modeTabs?.querySelectorAll('[data-mode]') || []) {
    tab.classList.toggle('active', tab.dataset.mode === next);
  }
}

function roomMembers() {
  const visible = new Set((stageState.visibleAspects || []).map(name => name.toLowerCase()));
  const excluded = new Set((stageState.excludedAspects || []).map(name => name.toLowerCase()));
  return Object.entries(stageState.aspects || {})
    .filter(([name, aspect]) => {
      const cleanName = name.toLowerCase();
      const status = aspect?.status;
      return (status === 'online' || status === 'speaking')
        && !excluded.has(cleanName)
        && (visible.size === 0 || visible.has(cleanName));
    })
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

function isMuted(name) {
  return (stageState.mutedAspects || []).includes(String(name || '').toLowerCase());
}

function setMutedAspects(nextMuted) {
  const mutedAspects = [...new Set(nextMuted.map(name => String(name || '').toLowerCase()).filter(Boolean))].sort();
  localStorage.setItem('vessel.mutedAspects', JSON.stringify(mutedAspects));
  setState({ mutedAspects });
}

async function toggleMemberMute(name) {
  const cleanName = String(name || '').toLowerCase();
  const current = new Set(stageState.mutedAspects || []);
  const nextMuted = !current.has(cleanName);
  if (nextMuted) current.add(cleanName);
  else current.delete(cleanName);
  selectedVoiceAgent = cleanName;
  setMutedAspects([...current]);
  setActivity(nextMuted ? 'muted' : 'idle', nextMuted ? 'Muted' : 'Voice enabled', cleanName);
  if (nextMuted && stageState.activeSpeaker === cleanName) {
    await window.vessel?.stopSpeech?.();
    resolveSpeechWaiters();
    patchAspect(cleanName, { status: 'online' });
  }
}

function renderMemberButtons() {
  if (!voiceAgentTabs) return;
  const members = roomMembers();
  if (members.length && !members.includes(selectedVoiceAgent)) {
    selectedVoiceAgent = members[0];
  }
  voiceAgentTabs.innerHTML = '';
  for (const name of members) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'voice-agent-tab';
    button.dataset.agent = name;
    button.textContent = displayName(name);
    button.title = isMuted(name) ? `${displayName(name)} is silenced` : `Silence ${displayName(name)}`;
    button.setAttribute('aria-pressed', isMuted(name) ? 'true' : 'false');
    button.classList.toggle('active', name === selectedVoiceAgent);
    button.classList.toggle('muted', isMuted(name));
    voiceAgentTabs.appendChild(button);
  }
}

function extractSendCommand(text) {
  const clean = String(text || '').trim();
  const match = clean.match(/^(?:send|send it|send this|submit|dispatch)\b[,:]?\s*(.*)$/i);
  if (!match) return { shouldSend: false, text: clean };
  return { shouldSend: true, text: (match[1] || clean).trim() || clean };
}

function setInputText(text, { focus = true } = {}) {
  input.value = String(text || '');
  input.dispatchEvent(new Event('input'));
  if (!focus) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function setWaveformVisible(visible) {
  inputWaveform?.classList.toggle('hidden', !visible);
  if (!visible) {
    latestWaveformSamples = null;
    if (waveformFrame) {
      cancelAnimationFrame(waveformFrame);
      waveformFrame = null;
    }
  }
}

function updateWaveform(samples) {
  if (!inputWaveform || inputWaveform.classList.contains('hidden')) return;
  latestWaveformSamples = samples;
  if (!waveformFrame) {
    waveformFrame = requestAnimationFrame(drawWaveform);
  }
}

function drawWaveform() {
  waveformFrame = null;
  if (!inputWaveform || inputWaveform.classList.contains('hidden')) return;
  const rect = inputWaveform.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (inputWaveform.width !== width || inputWaveform.height !== height) {
    inputWaveform.width = width;
    inputWaveform.height = height;
  }
  const ctx = inputWaveform.getContext('2d');
  const samples = latestWaveformSamples;
  ctx.clearRect(0, 0, width, height);
  const mid = height / 2;
  ctx.strokeStyle = 'rgba(232,232,240,0.12)';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();
  if (!samples?.length) return;

  ctx.strokeStyle = 'rgba(82, 196, 176, 0.92)';
  ctx.lineWidth = 1.6 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  const step = Math.max(1, Math.floor(samples.length / width));
  for (let x = 0; x < width; x += 1) {
    const start = x * step;
    let peak = 0;
    for (let i = 0; i < step && start + i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[start + i]));
    }
    const y = mid - peak * mid * 0.92;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let x = width - 1; x >= 0; x -= 1) {
    const start = x * step;
    let peak = 0;
    for (let i = 0; i < step && start + i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[start + i]));
    }
    ctx.lineTo(x, mid + peak * mid * 0.92);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = 'rgba(82, 196, 176, 0.85)';
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const idx = Math.min(samples.length - 1, Math.floor((x / width) * samples.length));
    const y = mid + samples[idx] * mid * 0.86;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function addPendingTurn(target, msgId, text) {
  if (!target || !msgId) return;
  const pending = (stageState.pendingTurns || []).filter(turn => turn.msgId !== msgId);
  pending.push({
    target,
    msgId,
    text,
    queuedAt: Date.now(),
  });
  setState({ pendingTurns: pending.slice(-4) });
}

function clearPendingFor(target) {
  if (!target) return;
  const pending = (stageState.pendingTurns || []).filter(turn => turn.target !== target);
  if (pending.length !== (stageState.pendingTurns || []).length) {
    setState({ pendingTurns: pending });
  }
}

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
  const response = state.response || {};
  const spoken = response.spoken || '';
  const detail = response.detail || state.panelContent || '';
  const speaker = response.speaker || state.activeSpeaker || 'Response';
  if (spoken || detail) {
    panelSpeaker.textContent = speaker === 'operator' ? 'You' : speaker;
    panelState.textContent = spoken && detail && spoken !== detail
      ? 'Speaking summary, showing detail'
      : spoken
        ? 'Speaking response'
        : 'Showing detail';
    panelSpoken.textContent = spoken;
    panelDetail.textContent = detail;
    spokenSection.classList.toggle('hidden', !spoken);
    detailSection.classList.toggle('hidden', !detail || detail === spoken);
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }

  const status = state.connection?.status || 'disconnected';
  const connectionDetail = compactConnectionDetail(state.connection?.detail);
  connectionLabel.textContent = connectionDetail ? `${status}: ${connectionDetail}` : status;
  connectionDot.dataset.status = status;

  const activity = state.activity || { status: 'idle', label: 'Idle' };
  activityPill.textContent = activity.detail ? `${activity.label}: ${activity.detail}` : activity.label;
  activityPill.dataset.status = activity.status || 'idle';

  const transcript = state.transcript || '';
  if (transcript) {
    transcriptPreview.textContent = transcript;
    transcriptPreview.classList.remove('hidden');
  } else {
    transcriptPreview.classList.add('hidden');
  }

  const pending = state.pendingTurns || [];
  if (pending.length) {
    pendingTurns.innerHTML = pending.map((turn) => {
      const label = `${turn.target} #${turn.msgId}`;
      const text = escapeHTML(turn.text);
      return `<span class="pending-turn"><strong>${label}</strong><span>${text}</span></span>`;
    }).join('');
    pendingTurns.classList.remove('hidden');
  } else {
    pendingTurns.innerHTML = '';
    pendingTurns.classList.add('hidden');
  }

  const inbox = state.responseInbox || [];
  if (inbox.length) {
    incomingInbox.innerHTML = inbox.map((turn) => {
      const label = `${displayName(turn.speaker)}${turn.messageId ? ` #${turn.messageId}` : ''}`;
      return `<span class="incoming-turn"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(turn.preview)}</span></span>`;
    }).join('');
    incomingInbox.classList.remove('hidden');
  } else {
    incomingInbox.innerHTML = '';
    incomingInbox.classList.add('hidden');
  }

  renderMemberButtons();
}

onStateChange(update);
update(stageState);

function displayTextForMessage(msg) {
  return msg.panelContent || msg.display || msg.content || msg.text || '';
}

function firstSentence(text) {
  const clean = String(text || '').trim();
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] || clean).trim();
}

function speechTextForMessage(msg) {
  const explicit = msg.speech || msg.speech_text || msg.speechText;
  if (explicit) return String(explicit).trim();
  const display = displayTextForMessage(msg);
  if (display.length <= SPEECH_THRESHOLD) return display;
  return fallbackSpeechSummary(display);
}

function hasExplicitSpeechText(msg) {
  return Boolean(msg.speech || msg.speech_text || msg.speechText);
}

function fallbackSpeechSummary(text) {
  const summary = firstSentence(text);
  return summary || 'I have a longer response.';
}

function shouldSummarizeForSpeech(msg, displayText) {
  return stageState.speechSummaryMode === 'model'
    && !hasExplicitSpeechText(msg)
    && String(displayText || '').length > SPEECH_THRESHOLD;
}

function isShortenedSpeech(msg, displayText) {
  return !hasExplicitSpeechText(msg) && String(displayText || '').length > SPEECH_THRESHOLD;
}

function queuedResponseLabel() {
  if (!responseQueue.length) return '';
  return `${responseQueue.length} queued`;
}

function syncResponseInbox() {
  setState({
    responseInbox: responseQueue.map((turn) => ({
      speaker: turn.label || turn.speaker || 'unknown',
      messageId: turn.messageId || 0,
      preview: String(turn.displayText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    })),
  });
}

function applyUnderstandingTarget(result) {
  const cleaned = String(result?.cleanedText || result?.cleaned_text || '').trim();
  const target = String(result?.target || '').trim().toLowerCase();
  if (!cleaned) return '';
  if (!target || cleaned.startsWith('@')) return cleaned;
  return `@${target} ${cleaned}`.trim();
}

function shouldSpeakMessage(speaker) {
  if (!speaker || speaker === 'operator') return false;
  return !stageState.addressingAspectId || speaker === stageState.addressingAspectId;
}

function waitForSpeechDone(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      currentSpeechWaiters = currentSpeechWaiters.filter(waiter => waiter !== done);
      resolve();
    }, timeoutMs);
    function done() {
      clearTimeout(timeout);
      resolve();
    }
    currentSpeechWaiters.push(done);
  });
}

function resolveSpeechWaiters() {
  const waiters = currentSpeechWaiters;
  currentSpeechWaiters = [];
  for (const waiter of waiters) waiter();
}

function setInputBusy(busy) {
  inputBusy = Boolean(busy);
  if (!inputBusy) {
    const waiters = inputIdleWaiters;
    inputIdleWaiters = [];
    for (const waiter of waiters) waiter();
    processResponseQueue();
  } else if (responseQueue.length) {
    setActivity('queued', 'Queued', queuedResponseLabel());
  }
}

function waitForInputIdle() {
  if (!inputBusy) return Promise.resolve();
  return new Promise((resolve) => inputIdleWaiters.push(resolve));
}

function summarizeTurnForSpeech(turn) {
  if (!turn.needsSpeechSummary) {
    return Promise.resolve({
      speechText: turn.initialSpeechText,
      fallback: false,
    });
  }
  return window.vessel?.summarizeSpeech({
    text: turn.displayText,
    speaker: turn.speaker,
  }).catch((err) => ({
    ok: false,
    error: err.message,
    speechText: fallbackSpeechSummary(turn.displayText),
    fallback: true,
  }));
}

function enqueueResponseTurn(turn) {
  const nextTurn = {
    ...turn,
    summaryPromise: summarizeTurnForSpeech(turn),
  };
  responseQueue.push(nextTurn);
  syncResponseInbox();
  if (inputBusy && stageState.activity?.status !== 'speaking') {
    setActivity('queued', 'Queued', queuedResponseLabel());
  }
  processResponseQueue();
}

async function processResponseQueue() {
  if (responseQueueRunning) return;
  responseQueueRunning = true;
  while (responseQueue.length) {
    await waitForInputIdle();
    const turn = responseQueue.shift();
    syncResponseInbox();
    await presentResponseTurn(turn);
  }
  responseQueueRunning = false;
  syncResponseInbox();
}

async function presentResponseTurn(turn) {
  const speaker = turn.speaker;
  if (speaker && speaker !== 'operator') {
    clearPendingFor(speaker);
    patchAspect(speaker, { status: 'speaking' });
  }
  setState({
    activeSpeaker: speaker && speaker !== 'operator' ? speaker : stageState.activeSpeaker,
    addressingAspectId: speaker === stageState.addressingAspectId ? null : stageState.addressingAspectId,
    panelContent: `${turn.label}: ${turn.displayText}`,
    response: {
      speaker: turn.label,
      spoken: turn.needsSpeechSummary ? '' : turn.initialSpeechText,
      detail: turn.displayText,
    },
    lastMessageId: turn.messageId || stageState.lastMessageId || 0,
  });

  let speechText = turn.initialSpeechText;
  if (turn.needsSpeechSummary) {
    setActivity('understanding', 'Summarizing', speaker);
    const summary = await turn.summaryPromise;
    speechText = String(summary?.speechText || fallbackSpeechSummary(turn.displayText)).trim();
    setState({
      response: {
        speaker: turn.label,
        spoken: speechText,
        detail: turn.displayText,
      },
    });
  }

  if (speechText) {
    if (isMuted(speaker)) {
      if (speaker && speaker !== 'operator') {
        patchAspect(speaker, { status: 'online' });
      }
      setActivity('muted', 'Muted', speaker);
      return;
    }
    setActivity('speaking', turn.shortenedSpeech ? 'Speaking summary' : 'Speaking', speaker);
    const speechDone = waitForSpeechDone();
    await window.vessel?.say({ speaker, text: speechText });
    await speechDone;
  }
  if (speaker && speaker !== 'operator') {
    patchAspect(speaker, { status: 'online' });
  }
  setActivity(responseQueue.length ? 'queued' : 'idle', responseQueue.length ? 'Queued' : 'Idle', queuedResponseLabel());
}

async function sendInput() {
  const value = input.value.trim();
  if (!value) return;
  setInputBusy(true);
  input.value = '';
  input.dispatchEvent(new Event('input'));
  setActivity('sending', 'Sending');
  setState({ transcript: '' });
  const routed = normalizeAddress(value, {
    aspects: stageState.aspects,
    activeSpeaker: stageState.activeSpeaker,
  });
  const content = routed.content;
  if (routed.target) {
    patchAspect(routed.target, { status: 'online' });
  }
  const visibleContent = routed.target
    ? content.replace(new RegExp(`^@${routed.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    : content;
  setState({
    activeSpeaker: routed.target || stageState.activeSpeaker,
    addressingAspectId: routed.target || null,
    panelContent: routed.target
      ? `You -> ${routed.target}: ${visibleContent}`
      : `You: ${visibleContent}`,
    response: {
      speaker: 'You',
      spoken: '',
      detail: routed.target
        ? `To ${routed.target}: ${visibleContent}`
        : visibleContent,
    },
  });
  try {
    const res = await window.vessel?.sendNexus({
      content,
      target: routed.target || '',
      replyTo: stageState.lastMessageId || 0,
    });
    if (res && !res.ok) {
      setActivity('error', 'Send failed');
      setState({ panelContent: `Nexus send failed: ${res.error}` });
      return;
    }
    const queueLabel = res?.msgId ? `${routed.target || 'Nexus'} #${res.msgId}` : routed.target || 'Nexus';
    if (res?.msgId) {
      setState({ lastMessageId: Number(res.msgId) || stageState.lastMessageId });
      addPendingTurn(routed.target, Number(res.msgId), visibleContent);
    }
    setActivity(routed.target ? 'queued' : 'waiting', routed.target ? 'Queued' : 'Waiting', queueLabel);
  } finally {
    setInputBusy(false);
  }
}

connectButton?.addEventListener('click', async () => {
  await connectNexusFromForm();
});

sendButton?.addEventListener('click', () => {
  sendInput();
});

settingsToggle?.addEventListener('click', () => {
  configRow.classList.toggle('hidden');
});

modeTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  setInputMode(button.dataset.mode);
});

voiceAgentTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-agent]');
  if (!button) return;
  toggleMemberMute(button.dataset.agent);
  setState({
    panelContent: isMuted(selectedVoiceAgent)
      ? `${selectedVoiceAgent} silenced`
      : `${selectedVoiceAgent} voice enabled`,
  });
});

voiceTestButton?.addEventListener('click', async () => {
  const speaker = selectedVoiceAgent;
  if (isMuted(speaker)) {
    setActivity('muted', 'Muted', speaker);
    setState({ panelContent: `${speaker} is silenced.` });
    return;
  }
  const text = VOICE_TEST_LINES[speaker] || VOICE_TEST_LINES.shadow;
  setActivity('speaking', 'Voice test', speaker);
  patchAspect(speaker, { status: 'speaking' });
  setState({
    activeSpeaker: speaker,
    panelContent: `${speaker}: ${text}`,
    response: {
      speaker,
      spoken: text,
      detail: text,
    },
  });
  const res = await window.vessel?.say({ speaker, text });
  if (res && !res.ok) {
    setActivity('error', 'Voice failed');
    setState({ panelContent: `Voice test failed: ${res.error}` });
  }
});

input?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendInput();
  }
});

input?.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

window.vessel?.onNexusStatus((status) => {
  setState({ connection: status });
  if (status?.status === 'error' || (status?.status === 'disconnected' && !stageState.rosterLoaded)) {
    configRow.classList.remove('hidden');
  }
});

window.vessel?.onSpeechSpeaking((speaking) => {
  if (!stageState.activeSpeaker) return;
  patchAspect(stageState.activeSpeaker, { status: speaking ? 'speaking' : 'online' });
  if (speaking) {
    setActivity('speaking', 'Speaking', stageState.activeSpeaker);
  } else if (stageState.activity?.status === 'speaking') {
    resolveSpeechWaiters();
    setActivity(responseQueue.length ? 'queued' : 'idle', responseQueue.length ? 'Queued' : 'Idle', queuedResponseLabel());
  } else if (!speaking) {
    resolveSpeechWaiters();
  }
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
    setState({ aspects: { ...stageState.aspects, ...next }, rosterLoaded: true });
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
    const messageId = Number(msg.id || 0);
    if (speaker === 'operator') {
      if (messageId) setState({ lastMessageId: messageId });
      return;
    }
    const displayText = displayTextForMessage(msg);
    const speechText = speechTextForMessage(msg);
    const needsSpeechSummary = shouldSummarizeForSpeech(msg, displayText);
    const shortenedSpeech = isShortenedSpeech(msg, displayText);
    const canSpeak = shouldSpeakMessage(speaker);
    if (speaker && speaker !== 'operator' && !canSpeak) {
      return;
    }
    enqueueResponseTurn({
      speaker,
      label: msg.from || 'unknown',
      messageId: Number(msg.id || stageState.lastMessageId || 0),
      displayText,
      initialSpeechText: speechText,
      needsSpeechSummary,
      shortenedSpeech,
    });
  }
});

async function loadDefaultsAndConnect() {
  const defaults = await window.vessel?.getNexusDefaultConfig?.();
  const stored = JSON.parse(localStorage.getItem('vessel.nexus') || '{}');
  const visibleAspects = String(defaults?.visibleAspects || '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
  setState({ visibleAspects });
  const excludedAspects = String(defaults?.excludedAspects || 'dispatch,dispatch-controller,dispatch_controller,controller,operator')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
  setState({ excludedAspects });
  try {
    setState({ mutedAspects: JSON.parse(localStorage.getItem('vessel.mutedAspects') || '[]') });
  } catch {
    setState({ mutedAspects: [] });
  }
  setState({ speechSummaryMode: defaults?.understanding?.speechSummaryMode || 'heuristic' });
  setInputMode(localStorage.getItem('vessel.inputMode') || 'conversation');
  const storedUrl = String(stored.wsUrl || '').trim();
  const defaultUrl = String(defaults?.wsUrl || '').trim();
  const wsUrl = !storedUrl || !storedUrl.includes('nexus.tail41686e.ts.net:7888')
    ? defaultUrl
    : storedUrl;
  nexusUrl.value = wsUrl;
  nexusToken.value = stored.token || defaults?.token || '';
  nexusInsecure.checked = stored.insecureTLS ?? Boolean(defaults?.insecureTLS);
  if (!wsUrl) {
    setState({ connection: { status: 'error', detail: 'missing Nexus URL' } });
    configRow.classList.remove('hidden');
    return;
  }
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
    try {
      dictateButton.textContent = 'Dictate';
      dictateButton.disabled = true;
      setActivity('transcribing', 'Transcribing');
      const wavBytes = await recorder.stop();
      setWaveformVisible(false);
      recorder = null;
      const result = await window.vessel?.transcribeSpeech(wavBytes);
      dictateButton.disabled = false;
      if (!result?.ok) {
        setActivity('error', 'Speech failed');
        setState({ panelContent: `Apple Speech failed: ${result?.error || 'unknown error'}` });
        return;
      }
      const transcript = result.text || '';
      if (transcript) {
        setInputText(transcript);
      }
      setActivity(transcript ? 'understanding' : 'review', transcript ? 'Cleaning' : 'Review');
      setState({
        transcript,
        panelContent: transcript ? 'Cleaning transcript...' : 'Apple Speech returned an empty transcript.',
        response: transcript
          ? {
              speaker: 'Transcript',
              spoken: '',
              detail: transcript,
            }
          : stageState.response,
      });

      let reviewed = transcript;
      let spokenSend = false;
      if (transcript) {
        const understood = await window.vessel?.understandSpeech({
          text: transcript,
          aspects: stageState.aspects,
        });
        reviewed = applyUnderstandingTarget(understood) || transcript;
        const sendCommand = extractSendCommand(reviewed);
        spokenSend = sendCommand.shouldSend;
        reviewed = sendCommand.text;
        if (understood?.target) {
          patchAspect(understood.target, { status: 'online' });
        }
        const detail = understood?.ok === false
          ? `Understanding fallback: ${understood.error}`
          : understood?.target
            ? `Transcript ready -> ${understood.target}`
            : 'Transcript ready';
        setActivity('review', 'Cleaned', understood?.target || '');
        setState({
          activeSpeaker: understood?.target || stageState.activeSpeaker,
          transcript: reviewed,
          panelContent: `${detail}: ${reviewed}`,
          response: {
            speaker: 'Transcript',
            spoken: '',
            detail: reviewed,
          },
        });
      }

      setInputText(reviewed);
      if (stageState.inputMode === 'conversation' || spokenSend) {
        await sendInput();
      }
    } finally {
      dictateButton.disabled = false;
      if (!recorder) setWaveformVisible(false);
      setInputBusy(false);
    }
    return;
  }

  try {
    setInputBusy(true);
    await window.vessel?.stopSpeech?.();
    resolveSpeechWaiters();
    recorder = await startWavRecorder(updateWaveform);
    dictateButton.textContent = 'Stop';
    setWaveformVisible(true);
    setActivity('listening', 'Listening');
    setState({ transcript: '', panelContent: 'Listening...' });
  } catch (err) {
    setInputBusy(false);
    setWaveformVisible(false);
    setActivity('error', 'Mic failed');
    setState({ panelContent: `Microphone failed: ${err.message}` });
  }
});

async function startWavRecorder(onSamples) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  processor.onaudioprocess = (event) => {
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    chunks.push(samples);
    onSamples?.(samples);
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
