import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { validateDataset } from '../src/shared/domains';
import { classify, type Candidate } from './collection';
const { values } = parseArgs({ options: { candidate: { type: 'string', default: 'data/candidate.json' }, reviewed: { type: 'string' } } });
if (!values.reviewed) throw new Error('Provide --reviewed file.json containing candidateSha256 and the explicitly reviewed domains.');
const raw = await readFile(values.candidate!, 'utf8');
const candidate: Candidate = JSON.parse(raw);
const review = JSON.parse(await readFile(values.reviewed, 'utf8'));
if (createHash('sha256').update(raw).digest('hex') !== review.candidateSha256) throw new Error('Review does not match this candidate file.');
if (candidate.errors.length || !candidate.rules.length) throw new Error('Failed or empty collections cannot be promoted.');
if (!Array.isArray(review.domains) || !review.domains.length) throw new Error('Review must name approved domains.');
const available = new Set(candidate.rules.map(r => r.domain));
if (review.domains.some((domain: string) => !available.has(domain))) throw new Error('Review contains a domain absent from the candidate.');
const approved = new Set<string>(review.domains);
const exclusions = JSON.parse(await readFile('data/exclusions.json', 'utf8')).domains;
for (const domain of approved) {
  if (classify(domain, exclusions).reason) throw new Error(`Review conflicts with the current exclusion policy: ${domain}`);
}
const rules = candidate.rules.filter(r => approved.has(r.domain));
const ruleDigest = createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 8);
const dataset = validateDataset({ schemaVersion: 1, version: `${candidate.generatedAt.slice(0, 10)}-${ruleDigest}`,
  generatedAt: candidate.generatedAt, source: candidate.source, coverage: candidate.coverage,
  rules });
await mkdir('data/archive', { recursive: true });
try { const old = await readFile('data/domains.json', 'utf8'); const version = JSON.parse(old).version.replace(/[^a-zA-Z0-9.-]/g, '_'); await writeFile(`data/archive/${version}.json`, old); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await writeFile('data/domains.json.tmp', JSON.stringify(dataset, null, 2) + '\n');
await rename('data/domains.json.tmp', 'data/domains.json');
await writeFile('data/provenance.json', JSON.stringify({ candidateSha256: review.candidateSha256, reviewedAt: new Date().toISOString(),
  evidence: candidate.evidence.filter(e => approved.has(e.domain)), excluded: [...candidate.excluded,
    ...candidate.rules.filter(r => !approved.has(r.domain)).map(r => ({ domain: r.domain, reason: 'Excluded during final scope review' }))],
  unresolved: candidate.unresolved, pages: candidate.pages }, null, 2) + '\n');
console.log(`Promoted ${dataset.rules.length} reviewed domains to ${dataset.version}.`);
