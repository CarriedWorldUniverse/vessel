const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CONFIG = {
  nexus: {
    wsUrl: 'wss://nexus.tail41686e.ts.net:7888',
    token: '',
    insecureTLS: true,
  },
  stage: {
    visibleAspects: [],
    excludedAspects: ['dispatch', 'dispatch-controller', 'dispatch_controller', 'controller', 'operator'],
  },
  tts: {
    engine: 'voxcpm',
    voxcpm: {
      baseUrl: 'http://dmonextreme.tail41686e.ts.net:30435/v1',
      model: 'openbmb/VoxCPM2',
      voices: {},
      prompts: {
        shadow: 'composed female orchestrator, warm but precise, measured pace, clear New Zealand English',
        anvil: 'grounded male builder, low confident voice, practical cadence, concise delivery',
        plumb: 'friendly male builder, lighter voice than Anvil, quick collaborative cadence',
      },
    },
  },
  understanding: {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'http://dmonextreme.tail41686e.ts.net:30434/v1',
    model: 'hf.co/google/gemma-4-12B-it-qat-q4_0-gguf:latest',
    apiKey: '',
    reviewBeforeSend: true,
    requestTimeoutMs: 20000,
    speechSummaryMode: 'heuristic',
    speechSummaryThreshold: 240,
    speechSummaryMaxWords: 55,
  },
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const next = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(next[key])) {
      next[key] = mergeDeep(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Failed to read Vessel config ${filePath}: ${err.message}`);
    return null;
  }
}

function configPaths() {
  return [
    path.join(__dirname, '../../vessel.config.json'),
    path.join(os.homedir(), '.vessel/config.json'),
    process.env.VESSEL_CONFIG,
  ].filter(Boolean);
}

function loadConfig() {
  let config = DEFAULT_CONFIG;
  for (const filePath of configPaths()) {
    const loaded = readJSON(filePath);
    if (loaded) config = mergeDeep(config, loaded);
  }

  if (process.env.NEXUS_WS_URL) config.nexus.wsUrl = process.env.NEXUS_WS_URL;
  if (process.env.NEXUS_TOKEN) config.nexus.token = process.env.NEXUS_TOKEN;
  if (process.env.NEXUS_INSECURE_TLS) config.nexus.insecureTLS = process.env.NEXUS_INSECURE_TLS === '1';
  if (process.env.VESSEL_VISIBLE_ASPECTS) {
    config.stage.visibleAspects = process.env.VESSEL_VISIBLE_ASPECTS
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean);
  }
  if (process.env.VESSEL_EXCLUDED_ASPECTS) {
    config.stage.excludedAspects = process.env.VESSEL_EXCLUDED_ASPECTS
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean);
  }
  if (process.env.VESSEL_TTS_ENGINE) config.tts.engine = process.env.VESSEL_TTS_ENGINE;
  if (process.env.VESSEL_VOXCPM_BASE_URL) config.tts.voxcpm.baseUrl = process.env.VESSEL_VOXCPM_BASE_URL;
  if (process.env.VESSEL_VOXCPM_MODEL) config.tts.voxcpm.model = process.env.VESSEL_VOXCPM_MODEL;
  if (process.env.VESSEL_UNDERSTANDING_BASE_URL) {
    config.understanding.baseUrl = process.env.VESSEL_UNDERSTANDING_BASE_URL;
  }
  if (process.env.VESSEL_UNDERSTANDING_MODEL) config.understanding.model = process.env.VESSEL_UNDERSTANDING_MODEL;
  if (process.env.VESSEL_SPEECH_SUMMARY_MODE) {
    config.understanding.speechSummaryMode = process.env.VESSEL_SPEECH_SUMMARY_MODE;
  }

  return config;
}

function applyRuntimeEnv(config) {
  process.env.VESSEL_TTS_ENGINE = process.env.VESSEL_TTS_ENGINE || config.tts.engine || 'say';
  process.env.VESSEL_VOXCPM_BASE_URL = process.env.VESSEL_VOXCPM_BASE_URL || config.tts.voxcpm?.baseUrl || '';
  process.env.VESSEL_VOXCPM_MODEL = process.env.VESSEL_VOXCPM_MODEL || config.tts.voxcpm?.model || '';
  process.env.VESSEL_VOXCPM_PROMPTS = process.env.VESSEL_VOXCPM_PROMPTS || JSON.stringify(config.tts.voxcpm?.prompts || {});
  process.env.VESSEL_VOXCPM_VOICES = process.env.VESSEL_VOXCPM_VOICES || JSON.stringify(config.tts.voxcpm?.voices || {});
}

module.exports = { loadConfig, applyRuntimeEnv };
