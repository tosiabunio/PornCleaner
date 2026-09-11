import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatcher, normalizeDomain, validateDataset, validateSettings } from '../src/shared/domains';
import { Engine } from '../src/shared/engine';
import { newScan, scanStep } from '../src/shared/scanner';
import type { Dataset, Port, Session, Settings } from '../src/shared/model';

const dataset: Dataset = { schemaVersion: 1, version: 'test-1', generatedAt: '2026-09-11T00:00:00Z',
  source: 'https://example.com', coverage: 'Synthetic fixtures', rules: [
    { domain: 'adult.example.com', includeSubdomains: true }, { domain: 'studio.example.net', includeSubdomains: true }
  ] };
const paused: Settings = { schemaVersion: 1, enabled: false, customRules: [], exceptions: [] };
class FakePort implements Port {
  settings: unknown;
  session?: Session;
  time = Date.parse('2026-09-11T12:00:00Z');
  history = new Map<string, number[]>();
  failures = new Set<string>(); deleted: string[] = [];
  async loadSettings() { return structuredClone(this.settings); }
  async saveSettings(value: Settings) { this.settings = structuredClone(value); }
  async loadSession() { return structuredClone(this.session); }
  async saveSession(value: Session) { this.session = structuredClone(value); }
  async search(q: { startTime: number; endTime: number; maxResults: number }) {
    return [...this.history].map(([url, visits]) => ({ url, lastVisitTime: Math.max(...visits) }))
      .filter(item => item.lastVisitTime >= q.startTime && item.lastVisitTime < q.endTime)
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, q.maxResults);
  }
  async deleteUrl(url: string) { if (this.failures.has(url)) throw new Error('blocked'); this.history.delete(url); this.deleted.push(url); }
  async remains(url: string) { return this.history.has(url); }
  now() { return this.time; }
  add(url: string, time = this.time - 1000) { this.history.set(url, [...this.history.get(url) ?? [], time]); }
}
async function drain(engine: Engine) {
  let steps = 0;
  while (engine.hasWork()) { assert.ok(++steps < 15000, 'job must terminate'); await engine.step(); }
}

test('hostname boundaries, schemes, query strings and exceptions', () => {
  const match = createMatcher(dataset.rules, [{ domain: 'keep.adult.example.com', includeSubdomains: true }]);
  assert.equal(match('https://adult.example.com/watch'), 'adult.example.com');
  assert.equal(match('http://WWW.ADULT.EXAMPLE.COM.:80/watch'), 'adult.example.com');
  for (const url of ['https://notadult.example.com/', 'https://adult.example.com.evil.net/',
    'https://search.example.com/?q=adult.example.com', 'https://adult.example.com@evil.net/',
    'file://adult.example.com/file', 'chrome://history', 'not a url', 'https://keep.adult.example.com/', 'https://a.keep.adult.example.com/']) assert.equal(match(url), undefined, url);
  const exact = createMatcher([{ domain: 'adult.example.com', includeSubdomains: false }], []);
  assert.equal(exact('https://www.adult.example.com'), undefined);
});
test('normalization rejects unsafe input and shared-host suffixes', () => {
  assert.equal(normalizeDomain('WWW.Example.COM.'), 'www.example.com');
  assert.equal(normalizeDomain('bücher.de'), 'xn--bcher-kva.de');
  for (const value of ['com', 'co.uk', 'github.io', 'localhost', '127.0.0.1', 'https://example.com', 'example.com/path', '*.example.com', 'foo..com', 'foo.com:123', 'example.com%2f']) assert.throws(() => normalizeDomain(value), value);
  assert.equal(normalizeDomain('tenant.github.io'), 'tenant.github.io');
});
test('settings and dataset validation fail closed', () => {
  assert.throws(() => validateSettings({ enabled: 'false', schemaVersion: 1, customRules: [], exceptions: [] }));
  assert.throws(() => validateDataset({ ...dataset, rules: [] }));
  assert.throws(() => validateSettings({ ...paused, customRules: [{ domain: 'com', includeSubdomains: true }] }));
});
test('enumerates old history, saturated windows, and tied timestamps without losing URLs', async () => {
  const port = new FakePort();
  for (let i = 0; i < 2600; i++) port.add(`https://adult.example.com/${i}`, i < 1600 ? port.time - 7 * 86400000 : port.time - i * 3000);
  port.add('https://example.org/ancient', 1);
  let state = newScan(port.now()); const seen = new Set<string>();
  while (state.windows.length) { const next = await scanStep(port, state); state = next.state; next.urls.forEach(url => seen.add(url)); }
  assert.equal(seen.size, port.history.size);
  assert.deepEqual([...seen].sort(), [...port.history.keys()].sort());
});
test('unresolvable result caps report incomplete coverage', async () => {
  const port = new FakePort();
  for (let i = 0; i < 32001; i++) port.add(`https://adult.example.com/${i}`, 1);
  await assert.rejects(scanStep(port, { windows: [{ start: 0, end: 3, limit: 32000 }], queries: 0, checked: 0 }), /incomplete/);
});
test('fresh installation defaults on and removes all occurrences while preserving unrelated history', async () => {
  const port = new FakePort();
  port.add('https://adult.example.com/old', port.time - 5 * 86400000); port.add('https://adult.example.com/old');
  port.add('https://example.org/keep'); port.add('https://notadult.example.com/keep');
  const engine = new Engine(port, dataset); await engine.init(); await drain(engine);
  assert.equal(engine.settings.enabled, true);
  assert.deepEqual([...port.history.keys()].sort(), ['https://example.org/keep', 'https://notadult.example.com/keep']);
  assert.equal(engine.status().job?.deleted, 1);
  assert.equal(engine.status().job?.state, 'complete');
});
test('visit handling uses exceptions and saved disabled preferences survive update and restart', async () => {
  const port = new FakePort(); port.settings = { ...paused, exceptions: [{ domain: 'keep.adult.example.com', includeSubdomains: true }] };
  let engine = new Engine(port, dataset); await engine.init();
  port.add('https://adult.example.com/new'); await engine.enqueueVisit('https://adult.example.com/new'); await drain(engine);
  assert.equal(port.deleted.length, 0);
  await engine.setEnabled(true); await drain(engine);
  port.add('https://adult.example.com/next'); port.add('https://keep.adult.example.com/next');
  await engine.enqueueVisit('https://adult.example.com/next'); await engine.enqueueVisit('https://keep.adult.example.com/next'); await drain(engine);
  assert.ok(!port.history.has('https://adult.example.com/next')); assert.ok(port.history.has('https://keep.adult.example.com/next'));
  await engine.setEnabled(false); port.session = undefined;
  engine = new Engine(port, { ...dataset, version: 'test-2' }); await engine.init();
  assert.equal(engine.settings.enabled, false); assert.equal(engine.hasWork(), false);
});
test('manual scan pauses auto, previews without deletion, and deletes only selected domains', async () => {
  const port = new FakePort(); port.settings = paused;
  port.add('https://adult.example.com/a'); port.add('https://studio.example.net/b'); port.add('https://example.org/keep');
  const engine = new Engine(port, dataset); await engine.init(); await engine.startPreview(); await drain(engine);
  assert.equal(port.deleted.length, 0); assert.equal(engine.status().job?.state, 'ready');
  const id = engine.status().job!.id;
  await engine.deleteSelected(id, ['adult.example.com']); await drain(engine);
  assert.deepEqual([...port.history.keys()], ['https://studio.example.net/b', 'https://example.org/keep']);
  assert.equal(engine.session.job?.matches.length, 0); assert.equal(engine.session.job?.pending.length, 0);
  assert.deepEqual(Object.keys(port.settings as object).sort(), ['customRules', 'enabled', 'exceptions', 'schemaVersion']);
});
test('rule edits invalidate stale manual approval and exceptions apply before later deletion', async () => {
  const port = new FakePort(); port.settings = paused; port.add('https://adult.example.com/a');
  const engine = new Engine(port, dataset); await engine.init(); await engine.startPreview(); await drain(engine);
  const id = engine.status().job!.id;
  await engine.editRule('exceptions', { domain: 'adult.example.com', includeSubdomains: true }, false);
  await assert.rejects(engine.deleteSelected(id, ['adult.example.com']), /no longer/);
  await engine.setEnabled(true); await drain(engine); assert.equal(port.deleted.length, 0);
});
test('worker interruption resumes transient work, failures remain retryable, and cancellation stops pending deletion', async () => {
  const port = new FakePort(); port.settings = paused;
  for (let i = 0; i < 25; i++) port.add(`https://adult.example.com/${i}`);
  let engine = new Engine(port, dataset); await engine.init(); await engine.startPreview(); await drain(engine);
  await engine.deleteSelected(engine.status().job!.id, ['adult.example.com']);
  port.failures.add('https://adult.example.com/0');
  await engine.step(); engine = new Engine(port, dataset); await engine.init(); await drain(engine);
  assert.equal(engine.status().job?.failed, 1); assert.equal(port.history.size, 1);
  port.failures.clear(); await engine.retry(); await drain(engine); assert.equal(port.history.size, 0);
  for (let i = 0; i < 25; i++) port.add(`https://adult.example.com/cancel/${i}`);
  await engine.setEnabled(true); await engine.step(); await engine.step();
  const deleted = port.deleted.length; await engine.setEnabled(false); await drain(engine);
  assert.equal(port.deleted.length, deleted); assert.ok(port.history.size > 0);
});
test('browser restart expires manual consent; preview TTL clears sensitive transient data', async () => {
  const port = new FakePort(); port.settings = paused; port.add('https://adult.example.com/a');
  let engine = new Engine(port, dataset); await engine.init(); await engine.startPreview(); await drain(engine);
  const id = engine.status().job!.id;
  port.time += 31 * 60_000; await engine.housekeeping();
  assert.equal(port.session?.job?.matches.length, 0); assert.equal(port.session?.job?.state, 'cancelled');
  await assert.rejects(engine.deleteSelected(id, ['adult.example.com']));
  port.session = undefined; engine = new Engine(port, dataset); await engine.init();
  assert.equal(engine.hasWork(), false); assert.equal(port.deleted.length, 0);
});
test('corrupted settings never reset to enabled defaults', async () => {
  const port = new FakePort(); port.settings = { enabled: false };
  port.add('https://adult.example.com/a');
  const engine = new Engine(port, dataset); await assert.rejects(engine.init()); assert.equal(port.deleted.length, 0);
});
