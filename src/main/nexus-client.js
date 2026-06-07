const crypto = require('crypto');
const WebSocket = require('ws');

function frame(kind, payload = {}) {
  return {
    kind,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

function normalizeWsUrl(input) {
  const raw = (input || 'wss://localhost:7888').trim();
  const withScheme = raw.startsWith('http://')
    ? raw.replace(/^http:\/\//, 'ws://')
    : raw.startsWith('https://')
      ? raw.replace(/^https:\/\//, 'wss://')
      : raw;
  if (withScheme.endsWith('/connect')) return withScheme;
  return withScheme.replace(/\/$/, '') + '/connect';
}

class NexusClient {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ws = null;
    this.pending = new Map();
    this.connected = false;
    this.config = null;
    this.lastError = '';
  }

  status(status, detail = '') {
    this.onStatus?.({ status, detail });
  }

  connect(config = {}) {
    this.close();
    const token = (config.token || process.env.NEXUS_TOKEN || '').trim();

    const url = new URL(normalizeWsUrl(config.wsUrl || process.env.NEXUS_WS_URL));
    if (token) {
      url.searchParams.set('token', token);
    }
    const insecure = config.insecureTLS ?? process.env.NEXUS_INSECURE_TLS === '1';
    this.config = { wsUrl: url.toString(), insecureTLS: insecure };
    this.status('connecting', token ? url.origin : `${url.origin} (no token)`);

    this.ws = new WebSocket(url, {
      rejectUnauthorized: !insecure,
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.lastError = '';
      this.status('connected', url.origin);
      this.request('roster.list', {}).catch((err) => {
        this.status('connected', `roster.list failed: ${err.message}`);
      });
      this.request('subscribe.chat', {}).catch(() => {});
      this.request('subscribe.roster', {}).catch(() => {});
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (err) => {
      this.lastError = err.message;
      this.status('error', err.message);
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.status('disconnected', this.lastError || 'Nexus connection closed.');
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('Nexus connection closed.'));
      }
      this.pending.clear();
    });
  }

  close() {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        // ignore close failures during reconnect
      }
      this.ws = null;
    }
    this.connected = false;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Nexus is not connected.');
    }
    this.ws.send(JSON.stringify(payload));
  }

  request(kind, payload = {}) {
    const env = frame(kind, payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(env.id);
        reject(new Error(`${kind} timed out`));
      }, 10000);
      this.pending.set(env.id, { resolve, reject, timer });
      try {
        this.send(env);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(env.id);
        reject(err);
      }
    });
  }

  sendChat(content, replyTo = 0) {
    const env = frame('chat.send', {
      from: 'operator',
      content,
      reply_to: replyTo || undefined,
    });
    this.send(env);
    return env.id;
  }

  async sayAspect(aspect, content) {
    const env = await this.request('aspect.say', {
      aspect,
      content,
    });
    return env.payload?.msg_id || env.payload?.msgID || 0;
  }

  handleMessage(data) {
    let env;
    try {
      env = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (env.in_reply_to && this.pending.has(env.in_reply_to)) {
      const pending = this.pending.get(env.in_reply_to);
      clearTimeout(pending.timer);
      this.pending.delete(env.in_reply_to);
      pending.resolve(env);
    }

    if (env.kind === 'roster.list.result') {
      this.onEvent?.({ type: 'roster', aspects: env.payload?.aspects || [] });
      return;
    }
    if (env.kind === 'roster.update') {
      this.onEvent?.({ type: 'roster-update', update: env.payload || {} });
      return;
    }
    if (env.kind === 'chat.deliver') {
      this.onEvent?.({ type: 'message', message: env.payload || {} });
    }
  }
}

module.exports = { NexusClient };
