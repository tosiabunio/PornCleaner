import { Engine } from './shared/engine';
import { validateSettings } from './shared/domains';
import type { Port, Session } from './shared/model';

const port: Port = {
  loadSettings: async () => (await chrome.storage.local.get('settings')).settings,
  saveSettings: async settings => { await chrome.storage.local.set({ settings }); },
  loadSession: async () => (await chrome.storage.session.get('session')).session as Session | undefined,
  saveSession: async session => { await chrome.storage.session.set({ session }); },
  search: query => chrome.history.search(query),
  deleteUrl: async url => { await chrome.history.deleteUrl({ url }); },
  remains: async url => (await chrome.history.getVisits({ url })).length > 0,
  now: () => Date.now()
};
let engine: Engine;
let fatal = '';
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = queue.then(fn, fn); queue = next.catch(() => {}); return next;
}
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const response = await fetch(chrome.runtime.getURL('domains.json'));
  if (!response.ok) throw new Error('Bundled domain list could not be loaded.');
  engine = new Engine(port, await response.json());
  await engine.init(); fatal = '';
}
const ready = initialize().catch(() => { fatal = 'Cleaning is stopped because settings or the domain list could not be loaded. Restore a valid settings export or reinstall the extension.'; });
async function usable() { await ready; if (fatal) throw new Error(fatal); }
async function syncAlarms() {
  if (engine.settings.enabled) {
    if (!await chrome.alarms.get('reconcile')) await chrome.alarms.create('reconcile', { periodInMinutes: 15 });
  } else await chrome.alarms.clear('reconcile');
  const job = engine.session.job;
  if (job && job.kind !== 'auto' && (job.state === 'running' || job.matches.length || job.pending.length || job.failed.length)) await chrome.alarms.create('expire-preview', { when: job.startedAt + 30 * 60_000 });
  else await chrome.alarms.clear('expire-preview');
  await chrome.action.setBadgeText({ text: engine.settings.enabled ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#776b58' });
}
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await usable();
    // Schedule recovery before work starts; it survives unexpected suspension.
    await chrome.alarms.create('continue', { delayInMinutes: 0.5 });
    const until = Date.now() + 8000;
    while (Date.now() < until && engine.hasWork()) await serial(() => engine.step());
    await syncAlarms();
    if (!engine.hasWork()) await chrome.alarms.clear('continue');
  } catch {
    fatal = 'Cleaning stopped after a storage or background error. Reload the extension to retry; no complete-cleanup claim is available.';
    await chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  } finally { pumping = false; }
}
function kick() { void pump(); }

chrome.history.onVisited.addListener(item => {
  if (!item.url) return;
  void serial(async () => { await usable(); await engine.enqueueVisit(item.url!); }).then(kick).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void serial(async () => { await usable(); await engine.reconcile(); }).then(kick).catch(() => {});
});
chrome.runtime.onInstalled.addListener(details => {
  void serial(async () => {
    await usable(); await engine.reconcile();
    if (details.reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('manage.html#welcome') });
  }).then(kick).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (!['continue', 'reconcile', 'expire-preview'].includes(alarm.name)) return;
  void serial(async () => {
    await usable();
    if (alarm.name === 'reconcile') await engine.reconcile();
    if (alarm.name === 'expire-preview') await engine.step();
  }).then(kick).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  void serial(async () => {
    if (!message || typeof message.type !== 'string') throw new Error('Invalid request.');
    if (message.type === 'import' && fatal) {
      await chrome.storage.local.set({ settings: validateSettings(message.settings) });
      await chrome.storage.session.remove('session');
      await initialize();
    }
    await usable();
    await engine.housekeeping();
    switch (message.type) {
      case 'status': break;
      case 'enable': await engine.setEnabled(message.enabled); break;
      case 'scan': await engine.startPreview(); break;
      case 'delete': await engine.deleteSelected(message.id, message.domains); break;
      case 'retry': await engine.retry(); break;
      case 'cancel': await engine.cancel(); break;
      case 'clear': await engine.clearPreview(); break;
      case 'rule': await engine.editRule(message.list, message.rule, message.remove === true); break;
      case 'import': await engine.updateSettings(message.settings); break;
      case 'export': return engine.settings;
      case 'details': return engine.details(message.id, message.domain);
      case 'rules': return engine.dataset.rules;
      default: throw new Error('Unknown request.');
    }
    await syncAlarms();
    return engine.status();
  }).then(data => { respond({ ok: true, data }); kick(); }, error => {
    respond({ ok: false, error: error instanceof Error ? error.message : 'Operation failed.' });
  });
  return true;
});
void ready.then(() => { if (!fatal) kick(); });
