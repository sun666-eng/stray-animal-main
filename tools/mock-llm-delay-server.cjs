/**
 * Controllable delayed OpenAI-compatible mock LLM for Phase 4C AI concurrency tests.
 * Binds 127.0.0.1 only. Env: MOCK_LLM_PORT, MOCK_LLM_DELAY_MS (default 2500), MOCK_LLM_PID_FILE
 */
'use strict';
const http = require('http');
const fs = require('fs');

const port = Number(process.env.MOCK_LLM_PORT || 18299);
const delayMs = Number(process.env.MOCK_LLM_DELAY_MS || 2500);
const host = '127.0.0.1';
let inFlight = 0;
let maxInFlight = 0;
let hitCount = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hitCount, maxInFlight, inFlight }));
    return;
  }
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hitCount, maxInFlight, inFlight, delayMs }));
    return;
  }
  // Chat completions — delayed to force concurrency contention
  if (req.method === 'POST' && /\/v1\/chat\/completions|\/chat\/completions/.test(req.url || '')) {
    hitCount++;
    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      setTimeout(() => {
        inFlight = Math.max(0, inFlight - 1);
        const payload = {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '连接成功' },
            finish_reason: 'stop'
          }]
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      }, delayMs);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(port, host, () => {
  const line = JSON.stringify({ ready: true, host, port, delayMs, pid: process.pid });
  console.log(line);
  if (process.env.MOCK_LLM_PID_FILE) {
    fs.writeFileSync(process.env.MOCK_LLM_PID_FILE, String(process.pid));
  }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
