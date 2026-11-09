'use strict';
const $ = id => document.getElementById(id);
const API = 'http://127.0.0.1:8765';
let runId = null, lastRun = null, polling = false;
const labels = { running: 'Выполняется', completed: 'Завершено', stopped: 'Остановлено', needs_attention: 'Требуется проверка результата' };
async function request(path, method = 'GET', data) {
  const response = await fetch(API + path, { method, headers: {
    Authorization: `Bearer ${$('token').value.trim()}`, 'Content-Type': 'application/json'
  }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  if (!response.ok) { const error = Error(result.error ?? `HTTP ${response.status}`); error.status = response.status; throw error; }
  return result;
}
function render(run) {
  lastRun = run;
  $('status').textContent = `${labels[run.status] ?? run.status}: ${run.current}/${run.total}`;
  $('progress').max = run.total; $('progress').value = run.current;
  $('run').disabled = run.status === 'running'; $('stop').disabled = run.status !== 'running';
  $('log').textContent = run.results.map(r => `${r.at}  ${r.scenario}: ${r.outcome}${r.code ? ' (' + r.code + ')' : ''}`).join('\n');
}
async function refresh() {
  if (!runId || polling) return;
  polling = true;
  try {
    const run = await request(`/runs/${runId}`);
    render(run);
    if (run.status !== 'running') { runId = null; await chrome.storage.session.remove('runId'); }
  } catch (error) {
    $('status').textContent = `Сервер: ${error.message}`;
    if (error.status === 404) {
      runId = null; await chrome.storage.session.remove('runId');
      $('run').disabled = false; $('stop').disabled = true;
    }
  }
  finally { polling = false; }
}
$('token').addEventListener('change', async () => {
  await chrome.storage.session.set({ token: $('token').value.trim() }); await refresh();
});
$('fixtures').addEventListener('click', () => { $('cards').value = Object.keys(SandboxFixtures.fixtures).join('\n'); });
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 32768) throw Error('Максимум 32 KiB');
    const raw = await file.text();
    const scenarios = SandboxFixtures.parseInput(raw);
    $('cards').value = scenarios.join('\n');
    $('status').textContent = `Загружено сценариев: ${scenarios.length}`;
  } catch (error) { $('status').textContent = error.message; }
  finally { event.target.value = ''; }
});
$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  try {
    const scenarios = SandboxFixtures.parseInput($('cards').value);
    const delay = Number($('delay').value);
    if (!Number.isInteger(delay) || delay < 500 || delay > 30000) throw Error('Задержка: целое число 500–30000 мс.');
    if ($('token').value.trim().length < 24) throw Error('Вставьте локальный токен из окна сервера.');
    await chrome.storage.session.set({ token: $('token').value.trim() });
    await chrome.storage.local.set({ delay });
    const run = await request('/runs', 'POST', { scenarios, delay });
    runId = run.id;
    await chrome.storage.session.set({ runId });
    render(run);
  } catch (error) { $('status').textContent = error.message; $('run').disabled = false; }
});
$('stop').addEventListener('click', async () => {
  if (!runId) return;
  try { await request(`/runs/${runId}/stop`, 'POST'); await refresh(); }
  catch (error) { $('status').textContent = error.message; }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(lastRun ?? { results: [] }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'ironclad-sandbox-results.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
(async () => {
  const [session, saved] = await Promise.all([chrome.storage.session.get(['token', 'runId']), chrome.storage.local.get('delay')]);
  $('token').value = session.token ?? ''; $('delay').value = saved.delay ?? 2000;
  runId = session.runId ?? null; await refresh();
  setInterval(() => void refresh(), 1000);
})().catch(error => { $('status').textContent = error.message; });
