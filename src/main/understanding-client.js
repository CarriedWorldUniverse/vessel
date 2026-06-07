function stripJSONFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

function parseMaybeJSON(value) {
  const clean = stripJSONFence(value);
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('understanding model did not return JSON');
    return JSON.parse(match[0]);
  }
}

function unescapeLooseString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .trim();
}

function extractLooseField(value, key) {
  const clean = stripJSONFence(value);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`["']${escapedKey}["']\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'),
    new RegExp(`["']${escapedKey}["']\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'`, 'i'),
    new RegExp(`\\b${escapedKey}\\b\\s*[:=]\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'),
    new RegExp(`\\b${escapedKey}\\b\\s*[:=]\\s*'((?:\\\\.|[^'\\\\])*)'`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return unescapeLooseString(match[1]);
  }
  return '';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackClean(text) {
  return String(text || '')
    .replace(/\bnext us\b/gi, 'nexus')
    .replace(/\bbridal\b/gi, 'bridle')
    .replace(/\bplum\b/gi, 'plumb')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectTarget(text, aspects = {}) {
  const names = Object.keys(aspects || {})
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const trimmed = String(text || '').trim();
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const patterns = [
      new RegExp(`^(?:hey|hi|hello|okay|ok|yo)\\s+${escaped}(?:\\b|\\s|[,.:;!?-])(.*)$`, 'i'),
      new RegExp(`^(?:to|at|talk to|speak to|send to)\\s+${escaped}(?:\\b|\\s|[,.:;!?-])(.*)$`, 'i'),
      new RegExp(`^@${escaped}\\b(.*)$`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const body = match[1] || trimmed;
        return {
          target: name,
          cleanedText: fallbackClean(body).trim(),
        };
      }
    }
  }
  return { target: null, cleanedText: fallbackClean(trimmed) };
}

function buildPrompt({ text, aspects }) {
  const names = Object.keys(aspects || {}).sort().join(', ');
  return [
    'Clean this dictated text for sending to an AI agent.',
    'Preserve the user intent exactly. Do not answer the request.',
    'Fix punctuation, filler words, and obvious speech transcription errors.',
    'Extract the addressed agent when the user says forms like "hey shadow" or "to anvil".',
    `Known agent names: ${names || 'none'}.`,
    'Known local terms: nexus, bridle, plumb, shadow, anvil, carried world.',
    'Return only JSON with keys: cleaned_text, target, confidence, corrections.',
    `Transcript: ${JSON.stringify(text)}`,
  ].join('\n');
}

function fallbackSpeechSummary(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  const summary = (match?.[1] || clean).trim();
  return summary || 'I have a longer response.';
}

function buildSpeechSummaryPrompt({ text, speaker, maxWords }) {
  return [
    'Summarize this AI agent response for spoken playback.',
    'The full response is already visible in the UI panel.',
    'Do not add facts, do not answer as the user, and do not mention JSON.',
    `Use at most ${maxWords} words, in one or two short sentences.`,
    'Preserve decisions, warnings, next actions, and important results.',
    `Speaker: ${speaker || 'agent'}.`,
    'Return only JSON with key: speech_text.',
    `Response: ${JSON.stringify(text)}`,
  ].join('\n');
}

class UnderstandingClient {
  constructor(config = {}) {
    this.config = config;
  }

  async clean({ text, aspects = {} }) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: true, cleanedText: '', target: null, confidence: 0, corrections: [] };

    if (!this.config.enabled || this.config.provider === 'off') {
      const fallback = detectTarget(raw, aspects);
      return { ok: true, cleanedText: fallback.cleanedText, target: fallback.target, confidence: 0, corrections: [] };
    }

    try {
      const baseUrl = String(this.config.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl) throw new Error('understanding baseUrl is not configured');
      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: 768,
          messages: [
            { role: 'system', content: 'You clean speech transcripts. Return strict JSON only.' },
            { role: 'user', content: buildPrompt({ text: raw, aspects }) },
          ],
        }),
      }, Number(this.config.requestTimeoutMs || 20000));
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || '';
      let parsed;
      try {
        parsed = parseMaybeJSON(content);
      } catch {
        parsed = {
          cleaned_text: extractLooseField(content, 'cleaned_text'),
          target: extractLooseField(content, 'target'),
          confidence: extractLooseField(content, 'confidence'),
        };
      }
      const fallback = detectTarget(raw, aspects);
      const cleanedText = fallbackClean(parsed.cleaned_text || fallback.cleanedText || raw);
      const parsedTarget = String(parsed.target || '').trim();
      const target = parsedTarget && !/^null$/i.test(parsedTarget) ? parsedTarget.toLowerCase() : fallback.target;
      return {
        ok: true,
        cleanedText,
        target,
        confidence: Number(parsed.confidence || 0),
        corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
        rawText: raw,
      };
    } catch (err) {
      const fallback = detectTarget(raw, aspects);
      return {
        ok: false,
        error: err.message,
        cleanedText: fallback.cleanedText,
        target: fallback.target,
        confidence: 0,
        corrections: [],
        rawText: raw,
      };
    }
  }

  async summarizeForSpeech({ text, speaker = '' }) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: true, speechText: '' };

    const threshold = Number(this.config.speechSummaryThreshold || 240);
    if (raw.length <= threshold) {
      return { ok: true, speechText: raw, summarized: false };
    }

    const fallback = fallbackSpeechSummary(raw);
    if (!this.config.enabled || this.config.provider === 'off') {
      return { ok: true, speechText: fallback, summarized: true, fallback: true };
    }

    try {
      const baseUrl = String(this.config.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl) throw new Error('understanding baseUrl is not configured');
      const maxWords = Number(this.config.speechSummaryMaxWords || 55);
      const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: 220,
          messages: [
            { role: 'system', content: 'You summarize long UI responses for text-to-speech. Return strict JSON only.' },
            { role: 'user', content: buildSpeechSummaryPrompt({ text: raw, speaker, maxWords }) },
          ],
        }),
      }, Number(this.config.requestTimeoutMs || 20000));
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || '';
      let speechText = '';
      try {
        const parsed = parseMaybeJSON(content);
        speechText = String(parsed.speech_text || '').replace(/\s+/g, ' ').trim();
      } catch {
        speechText = extractLooseField(content, 'speech_text') || stripJSONFence(content)
          .replace(/^speech_text\s*[:=]\s*/i, '')
          .replace(/^["']|["']$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      return {
        ok: true,
        speechText: speechText || fallback,
        summarized: true,
        fallback: !speechText,
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
        speechText: fallback,
        summarized: true,
        fallback: true,
      };
    }
  }
}

module.exports = { UnderstandingClient };
