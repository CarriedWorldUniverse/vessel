#!/usr/bin/env node
// Quick probe: Inworld TTS streaming endpoint
// Usage: INWORLD_API_KEY=<key> node inworld-tts-probe.js
// Writes audio to probe-output.mp3 and reports timing.

import https from 'https';
import fs from 'fs';

const API_KEY = process.env.INWORLD_API_KEY;
if (!API_KEY) {
  console.error('Set INWORLD_API_KEY env var');
  process.exit(1);
}

const body = JSON.stringify({
  voiceId: 'Ashley',
  modelId: 'inworld-tts-2',
  text: 'Hello, I am Forge. How can I help you today?',
});

const auth = Buffer.from(API_KEY + ':').toString('base64');

const options = {
  hostname: 'api.inworld.ai',
  path: '/tts/v1/voice:stream',
  method: 'POST',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const t0 = Date.now();
let firstChunkMs = null;
const chunks = [];

const req = https.request(options, (res) => {
  console.log('status:', res.statusCode);
  console.log('content-type:', res.headers['content-type']);

  res.on('data', (chunk) => {
    if (!firstChunkMs) {
      firstChunkMs = Date.now() - t0;
      console.log(`first chunk: ${firstChunkMs}ms`);
    }
    // Each NDJSON line contains base64 audioContent
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.audioContent) {
          chunks.push(Buffer.from(obj.audioContent, 'base64'));
        }
      } catch { /* partial line, skip */ }
    }
  });

  res.on('end', () => {
    const totalMs = Date.now() - t0;
    const audio = Buffer.concat(chunks);
    fs.writeFileSync('probe-output.bin', audio);
    console.log(`total: ${totalMs}ms, audio bytes: ${audio.length}`);
    console.log('written to probe-output.bin');
  });
});

req.on('error', e => console.error('error:', e.message));
req.write(body);
req.end();
