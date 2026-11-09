'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { createSandbox, validateKey, API_URL, STRIPE_VERSION } = require('./server.cjs');
const { fixtures, parseInput } = require('./fixtures.js');
const root = path.resolve(__dirname, '..');
const token = 'local-unit-test-token-0123456789';
let checks = 0;
function eq(a, b) { assert.deepEqual(a, b); checks++; }
function ok(a, message) { assert.ok(a, message); checks++; }
function throws(fn) { assert.throws(fn); checks++; }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const servers = new Set();
async function setup(fetchImpl, options = {}) {
  const server = createSandbox({ key: 'sk_test_mock123', token, fetchImpl, ...options });
  servers.add(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, async api(route, method = 'GET', data, headers = {}) {
    const response = await fetch(base + route, { method, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers
    }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  } };
}
async function terminal(api, id) {
  for (let i = 0; i < 300; i++) {
    const { body } = await api(`/runs/${id}`);
    if (body.status !== 'running') return body;
    await sleep(10);
  }
  throw Error('Run did not terminate');
}
async function main() {
  eq(validateKey('sk_test_abc123'), 'sk_test_abc123');
  for (const key of [undefined, '', 'sk_live_mock123', 'pk_test_mock123', 'sk_test_', 'sk_test_a\n']) throws(() => validateKey(key));
  throws(() => createSandbox({ key: 'sk_test_mock123', token: 'short' }));
  eq(parseInput('visa\nmastercard\ndeclined\ninsufficient_funds'), Object.keys(fixtures));
  eq(parseInput('4242 4242 4242 4242|12|2034|123\n4000000000000002|12|2034|123'), ['visa', 'declined']);
  eq(parseInput('[{"scenario":"visa"},{"card":"5555555555554444|12|2034|123"}]'), ['visa', 'mastercard']);
  eq(parseInput('pm_card_visa_chargeDeclinedInsufficientFunds'), ['insufficient_funds']);
  for (const raw of ['', '4111111111111111|12|2034|123', '[null]', '["visa",5]', '[', 'visa\nunknown', 'visa\n'.repeat(21), 'x'.repeat(32769)]) throws(() => parseInput(raw));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  eq(manifest.host_permissions, ['http://127.0.0.1:8765/*']);
  eq(manifest.permissions, ['storage']);
  eq(manifest.content_scripts, undefined); eq(manifest.background, undefined);
  ok(!fs.readFileSync(path.join(root, 'popup.html'), 'utf8').includes('https://'));
  for (const file of ['popup.js', 'background.js', 'sandbox/fixtures.js', 'sandbox/server.cjs']) {
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }); checks++;
  }
  const calls = [];
  const ctx = await setup(async (url, opts) => {
    const params = new URLSearchParams(opts.body);
    calls.push({ url, opts, params, at: Date.now() });
    await sleep(30);
    if (params.get('payment_method').includes('chargeDeclined')) {
      return new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline' } }), { status: 402 });
    }
    return Response.json({ id: 'pi_mock', livemode: false, status: 'succeeded' });
  });
  eq((await ctx.api('/health', 'GET', undefined, { Authorization: '' })).status, 401);
  eq((await ctx.api('/health', 'GET', undefined, { Origin: 'https://example.com' })).status, 403);
  eq((await ctx.api('/health', 'GET', undefined, { Origin: `chrome-extension://${'a'.repeat(32)}` })).body, { mode: 'sandbox', ready: true });
  eq((await ctx.api('/health', 'OPTIONS', undefined, { Origin: `chrome-extension://${'a'.repeat(32)}` })).status, 204);
  for (const body of [null, {}, { scenarios: ['unknown'], delay: 500 }, { scenarios: ['visa'], delay: 499 },
      { scenarios: ['visa'], delay: 30001 }, { scenarios: ['visa'], delay: 500.5 },
      { scenarios: ['visa'], delay: 500, card: '4242424242424242' }, { scenarios: [], delay: 500 },
      { scenarios: Array(21).fill('visa'), delay: 500 }, { scenarios: ['constructor'], delay: 500 }]) {
    eq((await ctx.api('/runs', 'POST', body)).status, 400);
  }
  eq((await ctx.api('/runs', 'POST', { scenarios: ['visa'], delay: 500 }, { 'Content-Type': 'text/plain' })).status, 415);
  eq((await ctx.api('/runs', 'POST', { scenarios: ['visa'], delay: 500, junk: 'x'.repeat(5000) })).status, 413);
  eq(calls.length, 0);
  const started = await ctx.api('/runs', 'POST', { scenarios: ['visa', 'declined', 'insufficient_funds', 'mastercard'], delay: 500 });
  eq(started.status, 202);
  eq((await ctx.api('/runs', 'POST', { scenarios: ['visa'], delay: 500 })).status, 409);
  const result = await terminal(ctx.api, started.body.id);
  eq(result.status, 'completed'); eq(result.current, 4);
  eq(result.results.map(r => r.outcome), ['succeeded', 'declined', 'declined', 'succeeded']);
  for (let i = 0; i < calls.length; i++) {
    const { url, opts, params } = calls[i];
    eq(url, API_URL); eq(opts.redirect, 'error');
    eq(opts.headers['Stripe-Version'], STRIPE_VERSION);
    eq(params.get('amount'), '100'); eq(params.get('currency'), 'usd');
    eq(params.get('confirm'), 'true'); eq(params.get('payment_method_types[]'), 'card');
    eq(params.get('payment_method'), fixtures[['visa', 'declined', 'insufficient_funds', 'mastercard'][i]].method);
    ok(!String(opts.body).includes('4242424242424242'));
    ok(!String(opts.body).includes('cvc'));
    if (i) ok(calls[i].at - calls[i - 1].at >= 520, 'Delay must begin after the response');
  }
  eq(new Set(calls.map(c => c.opts.headers['Idempotency-Key'])).size, 4);
  eq((await ctx.api('/runs', 'POST', { scenarios: ['visa'], delay: 500 })).status, 409);
  eq((await ctx.api('/runs/00000000-0000-0000-0000-000000000000')).status, 404);

  let count = 0;
  const stop = await setup(async () => { count++; return Response.json({ status: 'succeeded', livemode: false }); });
  const run = (await stop.api('/runs', 'POST', { scenarios: ['visa', 'mastercard'], delay: 30000 })).body;
  for (let i = 0; i < 100; i++) {
    if ((await stop.api(`/runs/${run.id}`)).body.current === 1) break;
    await sleep(5);
  }
  const stopAt = Date.now();
  eq((await stop.api(`/runs/${run.id}/stop`, 'POST')).status, 200);
  const stopped = await terminal(stop.api, run.id);
  eq(stopped.status, 'stopped'); eq(stopped.current, 1); eq(count, 1);
  ok(Date.now() - stopAt < 500, 'Stop should interrupt the wait');

  for (const response of [
    () => { throw Error('network fail'); },
    () => Response.json({ status: 'succeeded', livemode: true }),
    () => Response.json({ status: 'requires_action', livemode: false }),
    () => Response.json({ error: { type: 'rate_limit_error' } }, { status: 429 }),
    () => Response.json({ status: 'succeeded' }),
    () => new Response('not JSON')
  ]) {
    let attempts = 0;
    const failure = await setup(async () => { attempts++; return response(); });
    const first = (await failure.api('/runs', 'POST', { scenarios: ['visa', 'mastercard'], delay: 500 })).body;
    const finished = await terminal(failure.api, first.id);
    eq(finished.status, 'needs_attention'); eq(attempts, 1);
    ok(finished.results[0].outcome !== 'succeeded');
  }
  let complete;
  const pending = await setup(() => new Promise(resolve => { complete = resolve; }));
  const pendingRun = (await pending.api('/runs', 'POST', { scenarios: ['visa', 'mastercard'], delay: 500 })).body;
  eq((await pending.api(`/runs/${pendingRun.id}/stop`, 'POST')).body.status, 'running');
  complete(Response.json({ status: 'succeeded', livemode: false }));
  const afterStop = await terminal(pending.api, pendingRun.id);
  eq(afterStop.status, 'stopped'); eq(afterStop.current, 1);
  const timeout = await setup(async (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Error('Timed out')), { once: true });
  }), { timeoutMs: 30 });
  const timedRun = (await timeout.api('/runs', 'POST', { scenarios: ['visa', 'mastercard'], delay: 500 })).body;
  const timed = await terminal(timeout.api, timedRun.id);
  eq(timed.status, 'needs_attention'); eq(timed.current, 1); eq(timed.results[0].outcome, 'unknown');
  await testPopup();
  console.log(`PASS ${checks} checks (mocked Stripe; no external requests)`);
}
async function testPopup() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, textContent: '',
      handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, click() {} });
    return elements.get(id);
  }
  const session = {}, local = {}; const requests = [];
  const storage = data => ({ async get() { return { ...data }; }, async set(values) { Object.assign(data, values); }, async remove(key) { delete data[key]; } });
  const timers = [];
  const sandbox = {
    document: { getElementById: element, createElement: () => ({ click() {} }) },
    SandboxFixtures: { fixtures, parseInput },
    chrome: { storage: { session: storage(session), local: storage(local) } },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      return Response.json({ id: 'test-run-id', status: 'running', current: 0, total: 2, results: [] });
    }, AbortSignal, Blob, URL, setTimeout, setInterval: fn => { timers.push(fn); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), sandbox);
  await sleep(10);
  await element('fixtures').handlers.click();
  eq(element('cards').value, Object.keys(fixtures).join('\n'));
  element('cards').value = '4111111111111111|12|2034|123';
  element('delay').value = '500'; element('token').value = token;
  await element('run').handlers.click(); eq(requests.length, 0);
  element('cards').value = 'visa\ndeclined';
  await element('run').handlers.click();
  eq(requests.length, 1); eq(requests[0].url, 'http://127.0.0.1:8765/runs');
  eq(JSON.parse(requests[0].opts.body), { scenarios: ['visa', 'declined'], delay: 500 });
  eq(session.runId, 'test-run-id'); eq(session.token, token); eq(local.delay, 500);
  eq(element('run').disabled, true); eq(element('stop').disabled, false);
  await element('stop').handlers.click();
  eq(requests[1].url, 'http://127.0.0.1:8765/runs/test-run-id/stop');
  eq(requests[1].opts.method, 'POST');
  ok(timers.length === 1);
  sandbox.fetch = async () => Response.json({ error: 'Run not found; server may have restarted.' }, { status: 404 });
  timers[0](); await sleep(10);
  eq(session.runId, undefined); eq(element('run').disabled, false); eq(element('stop').disabled, true);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const server of servers) {
    server.stopRun(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
