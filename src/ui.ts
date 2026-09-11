import type { Engine } from './shared/engine';
import type { Rule, Settings } from './shared/model';
type Status = ReturnType<Engine['status']>;
let status: Status | undefined;
let renderedJob = '';
let renderedRules = '';
let bundled: Rule[] = [];
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const setText = (id: string, text: string) => { const node = el(id); if (node) node.textContent = text; };
const hide = (id: string, hidden: boolean) => { const node = el(id); if (node) node.hidden = hidden; };
async function request<T = Status>(type: string, args: object = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...args });
  if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Try reloading it.');
  return result.data;
}
function error(value: unknown) { setText('error', value instanceof Error ? value.message : 'Operation failed.'); hide('error', false); }
function notice(text: string) { setText('notice', text); hide('notice', false); }
function listen(id: string, fn: () => Promise<unknown>) {
  el(id)?.addEventListener('click', () => { hide('error', true); void fn().catch(error); });
}
function render(next: Status) {
  status = next;
  const { settings, dataset, job } = next;
  document.body.classList.toggle('paused', !settings.enabled);
  setText('mode', settings.enabled ? 'Cleaning is on' : 'Cleaning is paused');
  setText('mode-note', settings.enabled ? 'Matching history is cleared automatically, including existing visits.' : 'Your history stays as it is until you resume cleaning or run a manual cleanup.');
  setText('toggle', settings.enabled ? 'Pause cleaning' : 'Resume cleaning');
  const toggle = el<HTMLButtonElement>('toggle'); if (toggle) toggle.disabled = false;
  setText('scan', settings.enabled ? 'Pause & scan' : 'Scan history');
  setText('domain-count', dataset.count.toLocaleString());
  setText('dataset-date', `Collected ${new Date(dataset.generatedAt).toLocaleDateString()} · ${dataset.version}`);
  setText('coverage', dataset.coverage);
  let activity = settings.enabled ? 'Watching for matching visits.' : 'Automatic cleanup is off.';
  if (job) {
    const removed = `${job.deleted.toLocaleString()} ${job.deleted === 1 ? 'URL' : 'URLs'} removed`;
    if (job.state === 'running') activity = `${job.kind === 'preview' ? 'Scanning available history' : 'Cleaning matching history'}… ${removed}.`;
    else if (job.state === 'ready') activity = `${job.groups.reduce((sum, g) => sum + g.count, 0).toLocaleString()} matching URLs across ${job.groups.length} domains. Automatic cleaning is paused.`;
    else if (job.state === 'complete') activity = `Last cleanup: ${removed}${job.failed ? `, ${job.failed} failed` : ''}${job.skipped ? `, ${job.skipped} skipped` : ''}.`;
    else if (job.state === 'incomplete') activity = `Cleanup is incomplete. ${removed}.`;
    else activity = 'Cleanup stopped.';
    if (job.message) activity += ` ${job.message}`;
  }
  setText('activity', activity);
  hide('progress', job?.state !== 'running'); hide('cancel', job?.state !== 'running');
  hide('retry', !job?.failed || job.state === 'running');
  hide('clear', !job || job.state === 'running');
  setText('clear', job?.state === 'ready' ? 'Clear preview' : 'Clear status');
  const scan = el<HTMLButtonElement>('scan'); if (scan) scan.disabled = job?.state === 'running';
  const previewKey = JSON.stringify([job?.id, job?.state, job?.groups]);
  if (previewKey !== renderedJob) { renderedJob = previewKey; renderPreview(next); }
  const rulesKey = JSON.stringify([settings.customRules, settings.exceptions]);
  if (rulesKey !== renderedRules) { renderedRules = rulesKey; renderRuleList('customRules', settings.customRules); renderRuleList('exceptions', settings.exceptions); }
}
function button(label: string, action: () => Promise<unknown>) {
  const result = document.createElement('button'); result.type = 'button'; result.className = 'text-button'; result.textContent = label;
  result.addEventListener('click', () => { void action().catch(error); }); return result;
}
function updateSelection() {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('#matches input[type=checkbox]')];
  const selected = inputs.filter(input => input.checked).length;
  const all = el<HTMLInputElement>('select-all');
  if (all) { all.checked = inputs.length > 0 && selected === inputs.length; all.indeterminate = selected > 0 && selected < inputs.length; }
  const remove = el<HTMLButtonElement>('delete'); if (remove) remove.disabled = selected === 0;
}
function renderPreview(next: Status) {
  const { job } = next;
  hide('preview', job?.state !== 'ready' || !job.groups.length);
  const body = el('matches'); if (!body) return;
  body.replaceChildren();
  if (!job || job.state !== 'ready') return;
  const all = el<HTMLInputElement>('select-all'); if (all) all.checked = true;
  for (const group of job.groups) {
    const row = document.createElement('tr');
    const selection = document.createElement('td');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = group.domain;
    checkbox.addEventListener('change', updateSelection);
    checkbox.setAttribute('aria-label', `Select ${group.domain}`); selection.append(checkbox);
    const domain = document.createElement('td'); domain.textContent = group.domain;
    const count = document.createElement('td'); count.textContent = String(group.count);
    const actions = document.createElement('td');
    actions.append(button('Keep', async () => {
      render(await request('rule', { list: 'exceptions', rule: { domain: group.domain, includeSubdomains: true } }));
      notice(`${group.domain} is now an exception. Scan again to update the preview.`);
    }), button('Details', async () => {
      const urls = await request<string[]>('details', { id: job.id, domain: group.domain });
      const existing = row.nextElementSibling;
      if (existing?.classList.contains('detail-row')) { existing.remove(); return; }
      const detail = document.createElement('tr'); detail.className = 'detail-row';
      const cell = document.createElement('td'); cell.colSpan = 4; cell.className = 'url-details'; cell.textContent = urls.join('\n');
      detail.append(cell); row.after(detail);
    }));
    row.append(selection, domain, count, actions); body.append(row);
  }
  updateSelection();
}
function renderRuleList(list: 'customRules' | 'exceptions', rules: Rule[]) {
  const node = el(list); if (!node) return; node.replaceChildren();
  if (!rules.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No domains added yet.'; node.append(empty); }
  for (const rule of rules) {
    const row = document.createElement('li'); const label = document.createElement('span'); label.textContent = rule.domain;
    const scope = document.createElement('small'); scope.textContent = rule.includeSubdomains ? 'Includes subdomains' : 'Exact hostname only'; label.append(scope);
    row.append(label, button('Remove', async () => render(await request('rule', { list, rule, remove: true })))); node.append(row);
  }
}
function wireRuleForm(prefix: string, list: 'customRules' | 'exceptions') {
  el(`${prefix}-form`)?.addEventListener('submit', event => {
    event.preventDefault(); hide('error', true);
    const input = el<HTMLInputElement>(`${prefix}-domain`)!;
    void request('rule', { list, rule: { domain: input.value, includeSubdomains: el<HTMLInputElement>(`${prefix}-subdomains`)!.checked } })
      .then(next => { render(next); input.value = ''; notice(list === 'exceptions' ? 'Exception saved.' : 'Custom cleanup domain saved.'); }).catch(error);
  });
}
listen('toggle', async () => { if (status) render(await request('enable', { enabled: !status.settings.enabled })); });
listen('manage', async () => { await chrome.runtime.openOptionsPage(); });
listen('scan', async () => { render(await request('scan')); notice('Automatic cleaning is paused for your review.'); });
listen('cancel', async () => render(await request('cancel')));
listen('retry', async () => render(await request('retry')));
listen('clear', async () => render(await request('clear')));
listen('delete', async () => {
  const domains = [...document.querySelectorAll<HTMLInputElement>('#matches input[type=checkbox]:checked')].map(input => input.value);
  render(await request('delete', { id: status?.job?.id, domains }));
});
el<HTMLInputElement>('select-all')?.addEventListener('change', event => {
  for (const input of document.querySelectorAll<HTMLInputElement>('#matches input[type=checkbox]')) input.checked = (event.target as HTMLInputElement).checked;
  updateSelection();
});
wireRuleForm('exception', 'exceptions'); wireRuleForm('custom', 'customRules');
listen('export', async () => {
  const settings = await request<Settings>('export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'porncleaner-settings.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
el<HTMLInputElement>('import')?.addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0];
  if (!file) return;
  void (async () => {
    if (file.size > 500_000) throw new Error('Settings file is too large. Maximum size: 500 KB.');
    const settings = JSON.parse(await file.text());
    if (!confirm('Replace your settings with this file? If automatic cleaning is enabled in it, matching history will be removed immediately.')) return;
    render(await request('import', { settings })); notice('Settings imported.');
  })().catch(error).finally(() => { input.value = ''; });
});
function renderBundled() {
  const node = el('bundled-rules'); if (!node) return;
  const search = el<HTMLInputElement>('rule-search')!.value.trim().toLowerCase();
  const matches = bundled.filter(r => r.domain.includes(search)); node.replaceChildren();
  for (const rule of matches.slice(0, 200)) { const row = document.createElement('div'); row.textContent = rule.domain; node.append(row); }
  if (matches.length > 200) { const note = document.createElement('div'); note.textContent = `Showing 200 of ${matches.length}. Refine your filter.`; node.append(note); }
}
el('rule-search')?.addEventListener('input', renderBundled);
// Explicit request type keeps the UI protocol narrow.
async function poll() { try { render(await request('status')); } catch (value) { error(value); } }
void poll();
if (el('bundled-rules')) void request<Rule[]>('rules').then(rules => { bundled = rules; renderBundled(); }).catch(error);
setInterval(() => { if (!document.hidden) void poll(); }, 1200);
