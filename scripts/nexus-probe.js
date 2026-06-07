#!/usr/bin/env node

const { loadConfig } = require('../src/main/config');
const { NexusClient } = require('../src/main/nexus-client');

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const config = loadConfig();
  const aspect = argValue('aspect', process.env.VESSEL_PROBE_ASPECT || 'keel').trim().toLowerCase();
  const timeoutMs = Number(argValue('timeout-ms', process.env.VESSEL_PROBE_TIMEOUT_MS || '45000'));
  const wsUrl = argValue('ws-url', process.env.NEXUS_WS_URL || config.nexus?.wsUrl || '');
  const token = argValue('token', process.env.NEXUS_TOKEN || config.nexus?.token || '');
  const insecureTLS = argValue('insecure-tls', process.env.NEXUS_INSECURE_TLS || '') === '1'
    || Boolean(config.nexus?.insecureTLS);
  const message = argValue(
    'message',
    `vessel live probe ${new Date().toISOString()}; reply with one short sentence confirming receipt`,
  );

  if (!aspect) throw new Error('Probe aspect is empty.');
  if (!wsUrl) throw new Error('Nexus WebSocket URL is empty.');

  let sawReply = false;
  let replyText = '';
  let sentMsgId = 0;

  const client = new NexusClient({
    onStatus: (status) => {
      console.log(`[nexus] ${status.status}${status.detail ? ` ${status.detail}` : ''}`);
    },
    onEvent: (event) => {
      if (event.type !== 'message') return;
      const msg = event.message || {};
      const from = String(msg.from || msg.speaker || msg.aspect || msg.author || '').toLowerCase();
      const content = String(msg.content || msg.text || '');
      console.log(`[chat] ${from || 'unknown'}: ${content.slice(0, 220)}`);
      if (from === aspect) {
        sawReply = true;
        replyText = content;
      }
    },
  });

  client.connect({ wsUrl, token, insecureTLS });
  await wait(2500);

  sentMsgId = await client.sayAspect(aspect, message);
  console.log(`[probe] aspect.say ${aspect} msg_id=${sentMsgId}`);

  const deadline = Date.now() + timeoutMs;
  while (!sawReply && Date.now() < deadline) {
    await wait(250);
  }

  client.close();

  if (!sawReply) {
    throw new Error(`No ${aspect} reply within ${timeoutMs}ms after msg_id=${sentMsgId}.`);
  }
  console.log(`[probe] ok ${aspect}: ${replyText}`);
}

main().catch((err) => {
  console.error(`[probe] failed: ${err.message}`);
  process.exit(1);
});
