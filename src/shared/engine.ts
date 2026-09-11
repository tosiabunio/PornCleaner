import { createMatcher, validateDataset, validateRules, validateSettings } from './domains';
import { newScan, scanStep } from './scanner';
import type { Dataset, Job, Match, Port, Session, Settings } from './model';

const SESSION_BUDGET = 4_000_000;
const PREVIEW_TTL = 30 * 60_000;
export class Engine {
  settings!: Settings;
  session: Session = { visits: [] };
  readonly dataset: Dataset;
  private match!: (url: string) => string | undefined;
  constructor(private port: Port, dataset: unknown) { this.dataset = validateDataset(dataset); }
  async init() {
    const saved = await this.port.loadSettings();
    this.settings = saved === undefined
      ? { schemaVersion: 1, enabled: true, customRules: [], exceptions: [] }
      : validateSettings(saved);
    if (saved === undefined) await this.port.saveSettings(this.settings);
    this.rematch();
    this.session = await this.port.loadSession() ?? { visits: [] };
    if (this.session.job?.datasetVersion !== this.dataset.version) this.session.job = undefined;
    if (!this.settings.enabled) this.session.visits = [];
    if (this.session.job?.kind === 'auto' && !this.settings.enabled) this.session.job = undefined;
    this.expirePreview();
    if (this.settings.enabled && !this.session.job) this.session.job = this.newJob('auto');
    await this.persist();
  }
  private rematch() { this.match = createMatcher([...this.dataset.rules, ...this.settings.customRules], this.settings.exceptions); }
  private newJob(kind: Job['kind']): Job {
    return { id: crypto.randomUUID(), kind, state: 'running', datasetVersion: this.dataset.version,
      startedAt: this.port.now(), scan: kind !== 'delete' ? newScan(this.port.now()) : undefined,
      matches: [], pending: [], failed: [], deleted: 0, skipped: 0, checked: 0, message: '' };
  }
  private expirePreview() {
    const job = this.session.job;
    if (job && job.kind !== 'auto' && this.port.now() - job.startedAt > PREVIEW_TTL) {
      job.matches = []; job.pending = []; job.failed = []; job.scan = undefined;
      job.state = 'cancelled'; job.message = 'Preview expired. Scan again to review current history.';
    }
  }
  async housekeeping() {
    const before = this.session.job?.state;
    this.expirePreview();
    if (before !== this.session.job?.state) await this.persist();
  }
  private async persist() {
    if (new TextEncoder().encode(JSON.stringify(this.session)).byteLength > SESSION_BUDGET) {
      const job = this.session.job;
      if (job) {
        job.state = 'incomplete'; job.message = 'This job exceeded its temporary memory limit. Narrow the domain list and scan again.';
        job.matches = []; job.pending = []; job.failed = []; job.scan = undefined;
      }
      this.session.visits = [];
    }
    await this.port.saveSession(structuredClone(this.session));
  }
  async updateSettings(value: unknown) {
    const next = validateSettings(value);
    await this.port.saveSettings(next);
    this.settings = next; this.rematch();
    this.session = { visits: [] };
    if (next.enabled) this.session.job = this.newJob('auto');
    await this.persist();
  }
  async setEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid automatic-cleaning setting.');
    await this.updateSettings({ ...this.settings, enabled });
  }
  async editRule(list: 'customRules' | 'exceptions', rule: unknown, remove: boolean) {
    if (!['customRules', 'exceptions'].includes(list)) throw new Error('Invalid rule list.');
    const [valid] = validateRules([rule]);
    const values = this.settings[list].filter(r => r.domain !== valid.domain);
    if (!remove) values.push(valid);
    await this.updateSettings({ ...this.settings, [list]: values });
  }
  async reconcile() {
    if (this.settings.enabled && this.session.job?.state !== 'running') {
      this.session.job = this.newJob('auto'); await this.persist();
    }
  }
  async enqueueVisit(url: string) {
    if (this.settings.enabled && this.match(url)) {
      if (!this.session.visits.includes(url)) this.session.visits.push(url);
      // A recovery scan is scheduled even if this bounded fast path overflows.
      if (this.session.visits.length > 500) this.session.visits.shift();
      await this.persist();
    }
  }
  async startPreview() {
    // An explicitly requested preview pauses automatic deletion, so its entries
    // stay available for review. The UI labels this action "Pause & scan".
    await this.setEnabled(false);
    this.session.job = this.newJob('preview'); await this.persist();
  }
  async deleteSelected(id: string, domains: string[]) {
    this.expirePreview();
    const job = this.session.job;
    if (!job || job.id !== id || job.kind !== 'preview' || job.state !== 'ready') throw new Error('Preview is no longer available. Scan again.');
    if (!Array.isArray(domains) || domains.some(d => typeof d !== 'string')) throw new Error('Invalid selection.');
    const selected = new Set(domains);
    const pending = job.matches.filter(m => selected.has(m.domain) && this.match(m.url));
    if (!pending.length) throw new Error('Select at least one matching domain.');
    job.kind = 'delete'; job.state = 'running'; job.pending = pending;
    job.matches = []; job.scan = undefined; job.message = ''; await this.persist();
  }
  async retry() {
    const job = this.session.job;
    if (!job || job.state === 'running' || !job.failed.length) throw new Error('No failed URLs are available to retry.');
    if (job.kind === 'auto' && !this.settings.enabled) throw new Error('Automatic cleaning is paused.');
    job.pending = job.failed; job.failed = []; job.state = 'running'; job.message = ''; await this.persist();
  }
  async cancel() {
    if (this.session.job?.kind === 'auto') { await this.setEnabled(false); return; }
    const job = this.session.job;
    if (job) { job.state = 'cancelled'; job.matches = []; job.pending = []; job.failed = []; job.scan = undefined; job.message = 'Stopped. Completed deletions cannot be undone.'; }
    await this.persist();
  }
  async clearPreview() {
    if (this.session.job?.state === 'running') throw new Error('Stop the active job first.');
    this.session.job = undefined; await this.persist();
  }
  hasWork() { return this.session.visits.length > 0 || this.session.job?.state === 'running'; }
  private async remove(item: Match, automatic: boolean): Promise<'deleted' | 'skipped' | 'failed'> {
    if (automatic && !this.settings.enabled || !this.match(item.url)) return 'skipped';
    try {
      await this.port.deleteUrl(item.url);
      return await this.port.remains(item.url) ? 'failed' : 'deleted';
    } catch { return 'failed'; }
  }
  async step() {
    this.expirePreview();
    if (this.session.visits.length) {
      const url = this.session.visits[0];
      const domain = this.match(url);
      const result = domain ? await this.remove({ url, domain }, true) : 'skipped';
      this.session.visits.shift();
      if (result === 'failed') {
        if (!this.session.job || this.session.job.state !== 'running') this.session.job = this.newJob('auto');
        this.session.job.message = 'A visit could not be removed. Recovery cleanup will retry it.';
      }
      await this.persist(); return;
    }
    const job = this.session.job;
    if (!job || job.state !== 'running') { await this.persist(); return; }
    if (job.kind === 'auto' && !this.settings.enabled) { await this.cancel(); return; }
    try {
      if (job.pending.length) {
        // Persisted pending work is removed only after the operation completes.
        // If the worker stops mid-delete, replaying it is harmless.
        for (let i = 0; i < 10 && job.pending.length; i++) {
          const item = job.pending[0];
          const result = await this.remove(item, job.kind === 'auto');
          job.pending.shift();
          if (result === 'deleted') job.deleted++;
          else if (result === 'skipped') job.skipped++;
          else job.failed.push(item);
        }
      } else if (job.scan?.windows.length) {
        const { state, urls } = await scanStep(this.port, job.scan);
        const matches = urls.flatMap(url => { const domain = this.match(url); return domain ? [{ url, domain }] : []; });
        job.scan = state; job.checked = state.checked;
        if (job.kind === 'preview') {
          const seen = new Set(job.matches.map(m => m.url));
          job.matches.push(...matches.filter(m => !seen.has(m.url)));
        } else job.pending = matches;
      } else {
        job.state = job.kind === 'preview' ? 'ready' : 'complete';
        job.scan = undefined;
        job.message = job.failed.length ? 'Some URLs could not be removed. Retry them or scan again.' : '';
      }
    } catch {
      job.state = 'incomplete'; job.message = 'Cleanup could not finish. History access or scan capacity may be limited. Scan again to retry.';
      job.pending = []; job.matches = []; job.scan = undefined;
    }
    await this.persist();
  }
  status() {
    const job = this.session.job;
    const groups = new Map<string, number>();
    for (const item of job?.matches ?? []) groups.set(item.domain, (groups.get(item.domain) ?? 0) + 1);
    return {
      settings: this.settings,
      dataset: { version: this.dataset.version, generatedAt: this.dataset.generatedAt, coverage: this.dataset.coverage, count: this.dataset.rules.length },
      job: job && { id: job.id, kind: job.kind, state: job.state, deleted: job.deleted, skipped: job.skipped,
        failed: job.failed.length, remaining: job.pending.length, checked: job.checked, message: job.message,
        groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([domain, count]) => ({ domain, count })) }
    };
  }
  details(id: string, domain: string) {
    this.expirePreview();
    const job = this.session.job;
    if (!job || job.id !== id || job.state !== 'ready') throw new Error('Preview expired.');
    return job.matches.filter(m => m.domain === domain).slice(0, 100).map(m => m.url);
  }
}
