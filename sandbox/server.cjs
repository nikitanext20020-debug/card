'use strict';
const http = require('node:http');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { fixtures } = require('./fixtures.js');
const API_URL = 'https://api.stripe.com/v1/payment_intents';
const STRIPE_VERSION = '2026-10-28.endive';
const MIN_DELAY = 500, MAX_DELAY = 30000, MAX_ITEMS = 20, MAX_RUNS = 10;

function validateKey(key) {
  if (typeof key !== 'string' || !/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    throw Error('STRIPE_SECRET_KEY must be a sandbox sk_test_ key.');
  }
  return key;
}

function createSandbox({ key, token, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  validateKey(key);
  if (typeof token !== 'string' || token.length < 24) throw Error('Local access token must contain at least 24 characters.');
  const expectedToken = Buffer.from(`Bearer ${token}`);
  const runs = new Map();
  let active = null, lastStart = 0;
  const snapshot = run => ({ id: run.id, status: run.status, total: run.scenarios.length,
    current: run.results.length, delay: run.delay, results: run.results.slice() });

  function finish(run, status) { run.status = status; if (active === run) active = null; }
  async function execute(run) {
    try {
      for (let index = 0; index < run.scenarios.length; index++) {
        if (run.stop) break;
        const scenario = run.scenarios[index];
        const body = new URLSearchParams({ amount: '100', currency: 'usd',
          payment_method: fixtures[scenario].method, confirm: 'true',
          'payment_method_types[]': 'card', 'metadata[ironclad_run]': run.id });
        lastStart = Date.now();
        let response;
        try {
          response = await fetchImpl(API_URL, { method: 'POST', redirect: 'error',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded',
              'Stripe-Version': STRIPE_VERSION, 'Idempotency-Key': `${run.id}-${index}` },
            body, signal: AbortSignal.timeout(timeoutMs) });
          const data = await response.json();
          const intent = data.error?.payment_intent ?? data;
          if (intent.livemode === true) throw Error('Unexpected live-mode response.');
          let result;
          if (response.ok && intent.livemode === false && typeof intent.status === 'string') {
            result = { scenario, outcome: intent.status, id: intent.id ?? null };
          } else if (!response.ok && data.error?.type === 'card_error') {
            result = { scenario, outcome: 'declined', code: data.error.decline_code ?? data.error.code ?? 'card_error' };
          } else {
            result = { scenario, outcome: 'error', code: `stripe_http_${response.status}` };
          }
          run.results.push({ ...result, at: new Date().toISOString() });
          // Authentication, rate limits, non-card errors and ambiguous statuses stop the run; no retries.
          if (result.outcome === 'error' || !['succeeded', 'declined'].includes(result.outcome)) {
            finish(run, run.stop ? 'stopped' : 'needs_attention'); return;
          }
        } catch {
          run.results.push({ scenario, outcome: 'unknown', code: 'transport_or_response_error', at: new Date().toISOString() });
          finish(run, run.stop ? 'stopped' : 'needs_attention'); return;
        }
        if (run.stop) break;
        if (index + 1 < run.scenarios.length) {
          await new Promise(resolve => {
            run.wake = resolve;
            run.timer = setTimeout(resolve, run.delay);
          });
          run.wake = null;
          clearTimeout(run.timer);
        }
      }
      finish(run, run.stop ? 'stopped' : 'completed');
    } catch {
      finish(run, 'needs_attention');
    }
  }

  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) { reply(403, { error: 'Origin rejected' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const received = Buffer.from(req.headers.authorization ?? '');
    if (received.length !== expectedToken.length || !timingSafeEqual(received, expectedToken)) {
      reply(401, { error: 'Local access token required' }); return;
    }
    const route = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && route === '/health') { reply(200, { mode: 'sandbox', ready: true }); return; }
    const match = /^\/runs\/([0-9a-f-]{36})(\/stop)?$/.exec(route);
    if (match) {
      const run = runs.get(match[1]);
      if (!run) { reply(404, { error: 'Run not found; server may have restarted.' }); return; }
      if (req.method === 'POST' && match[2]) {
        if (run.status === 'running') {
          run.stop = true;
          run.wake?.();
        }
        reply(200, snapshot(run)); return;
      }
      if (req.method === 'GET' && !match[2]) { reply(200, snapshot(run)); return; }
    }
    if (req.method !== 'POST' || route !== '/runs') { reply(404, { error: 'Unknown route' }); return; }
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) { reply(415, { error: 'JSON required' }); return; }
    let input;
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) { reply(413, { error: 'Body too large' }); return; }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { reply(400, { error: 'Malformed JSON' }); return; }
    if (!input || Object.keys(input).some(k => !['scenarios', 'delay'].includes(k)) ||
        !Array.isArray(input.scenarios) || !input.scenarios.length || input.scenarios.length > MAX_ITEMS ||
        input.scenarios.some(s => typeof s !== 'string' || !Object.hasOwn(fixtures, s)) ||
        !Number.isInteger(input.delay) || input.delay < MIN_DELAY || input.delay > MAX_DELAY) {
      reply(400, { error: 'Expected 1–20 official scenario names and delay 500–30000 ms.' }); return;
    }
    if (active || Date.now() - lastStart < MIN_DELAY) { reply(409, { error: 'Run active or cooling down.' }); return; }
    if (runs.size >= MAX_RUNS) runs.delete(runs.keys().next().value);
    const run = { id: randomUUID(), status: 'running', scenarios: input.scenarios.slice(),
      delay: input.delay, results: [], stop: false, wake: null, timer: null };
    runs.set(run.id, run); active = run;
    reply(202, snapshot(run));
    void execute(run);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.stopRun = () => { if (active) { active.stop = true; active.wake?.(); } };
  return server;
}

if (require.main === module) {
  try {
    const key = validateKey(process.env.STRIPE_SECRET_KEY);
    const token = process.env.IRONCLAD_TOKEN || randomBytes(24).toString('hex');
    const server = createSandbox({ key, token });
    server.on('error', error => { console.error(`Sandbox server: ${error.code ?? 'startup_error'}`); process.exitCode = 1; });
    server.listen(8765, '127.0.0.1', () => {
      console.log('Ironclad Stripe Sandbox: http://127.0.0.1:8765');
      console.log(`Local access token: ${token}`);
      console.log('Test API only; 100 USD cents per scenario. Ctrl+C stops the server.');
    });
    const shutdown = () => { server.stopRun(); server.close(() => process.exit(0)); };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createSandbox, validateKey, API_URL, STRIPE_VERSION };
