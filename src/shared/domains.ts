import { parse } from 'tldts';
import type { Dataset, Rule, Settings } from './model';

export function normalizeDomain(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Enter a domain name.');
  const value = input.trim();
  if (!value || value.length > 254 || /[\s/:@?#%\\*]/.test(value))
    throw new Error('Use a domain such as example.com, without a URL, path, port, or wildcard.');
  const host = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, '');
  if (!host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))
    throw new Error('Invalid domain name.');
  const info = parse(host, { allowPrivateDomains: true });
  if (!info.domain || info.isIp || !info.isIcann && !info.isPrivate)
    throw new Error('Enter a registrable domain, not an IP address or public suffix.');
  return host;
}
export function hostname(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch { return undefined; }
}
export function matchesHost(host: string, rule: Rule): boolean {
  return host === rule.domain || rule.includeSubdomains && host.endsWith(`.${rule.domain}`);
}
export function validateRules(input: unknown): Rule[] {
  if (!Array.isArray(input) || input.length > 50000) throw new Error('Invalid domain list.');
  const result = new Map<string, Rule>();
  for (const item of input) {
    if (!item || typeof item.includeSubdomains !== 'boolean') throw new Error('Invalid domain rule.');
    const domain = normalizeDomain(item.domain);
    const existing = result.get(domain);
    result.set(domain, { domain, includeSubdomains: item.includeSubdomains || existing?.includeSubdomains || false });
  }
  return [...result.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('Settings could not be read. Restore a valid configuration.');
  const value = input as Settings;
  if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean') throw new Error('Unsupported settings format.');
  return { schemaVersion: 1, enabled: value.enabled,
    customRules: validateRules(value.customRules), exceptions: validateRules(value.exceptions) };
}
export function validateDataset(input: unknown): Dataset {
  const d = input as Dataset;
  if (!d || d.schemaVersion !== 1 || typeof d.version !== 'string' || !d.version ||
      typeof d.generatedAt !== 'string' || !Number.isFinite(Date.parse(d.generatedAt)) ||
      typeof d.source !== 'string' || typeof d.coverage !== 'string') throw new Error('Invalid bundled domain list.');
  const rules = validateRules(d.rules);
  if (!rules.length) throw new Error('The bundled domain list is empty.');
  return { schemaVersion: 1, version: d.version, generatedAt: d.generatedAt, source: d.source, coverage: d.coverage, rules };
}
export function createMatcher(rules: Rule[], exceptions: Rule[]) {
  const index = (entries: Rule[]) => new Map(entries.map(r => [r.domain, r]));
  const include = index(validateRules(rules));
  const exclude = index(validateRules(exceptions));
  const find = (host: string, map: Map<string, Rule>) => {
    let suffix = host;
    while (suffix.includes('.')) {
      const rule = map.get(suffix);
      if (rule && (suffix === host || rule.includeSubdomains)) return rule.domain;
      suffix = suffix.slice(suffix.indexOf('.') + 1);
    }
    return undefined;
  };
  return (url: string): string | undefined => {
    const host = hostname(url);
    if (!host || find(host, exclude)) return undefined;
    return find(host, include);
  };
}
