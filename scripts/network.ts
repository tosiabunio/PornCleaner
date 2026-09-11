import { request } from 'node:https';
import { isIP } from 'node:net';
import { lookup } from 'node:dns';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export function isPublicIPv4(address: string) {
  const bytes = address.split('.').map(Number);
  if (bytes.length !== 4 || bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = bytes;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 0 || a === 198 && (b === 18 || b === 19) ||
    a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
}
export interface Reply { status: number; location?: string; body: string; contentType: string }
export function get(url: string): Promise<Reply> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.port && target.port !== '443') throw new Error('Unsupported source URL.');
  if (isIP(target.hostname) || target.hostname.startsWith('[')) throw new Error('IP-literal source URLs are not supported.');
  return new Promise((resolve, reject) => {
    const req = request(target, {
      headers: { 'User-Agent': 'PornCleanerDomainCollector/0.1', Accept: 'text/html,text/plain' },
      // Validate the addresses in the actual connection lookup, avoiding a
      // second DNS resolution after validation. This collector uses IPv4 only.
      family: 4,
      lookup(host, options, callback) {
        lookup(host, { family: 4, all: true }, (error, addresses) => {
          if (error) { callback(error, '', 4); return; }
          if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) {
            callback(new Error('Source resolves to a private or reserved address.'), '', 4); return;
          }
          if (typeof options === 'object' && options.all) callback(null, addresses);
          else callback(null, addresses[0].address, 4);
        });
      }
    }, response => {
      const status = response.statusCode ?? 0;
      const contentType = response.headers['content-type'] ?? '';
      if (status >= 300 && status < 400) {
        resolve({ status, location: response.headers.location, body: '', contentType }); response.destroy(); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 4_000_000) req.destroy(new Error('Source response exceeds 4 MB.')); else chunks.push(chunk); });
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), contentType }));
      response.on('error', reject);
    });
    req.setTimeout(20000, () => req.destroy(new Error('Source request timed out.')));
    req.on('error', reject); req.end();
  });
}
export class Client {
  private last = 0;
  constructor(private cacheDir = '.cache/source', private delay = 1200) {}
  async get(url: string): Promise<Reply> {
    await mkdir(this.cacheDir, { recursive: true });
    const path = `${this.cacheDir}/${createHash('sha256').update(url).digest('hex')}.json`;
    try { const cached = JSON.parse(await readFile(path, 'utf8')); if (Date.now() - cached.savedAt < 24 * 60 * 60_000) return cached.reply; } catch { /* miss */ }
    let reply: Reply | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, this.last + this.delay - Date.now()) + attempt * 2000));
      this.last = Date.now(); reply = await get(url);
      if (![429, 500, 502, 503, 504].includes(reply.status)) break;
    }
    if ([200, 301, 302, 303, 307, 308].includes(reply!.status)) await writeFile(path, JSON.stringify({ savedAt: Date.now(), reply }));
    return reply!;
  }
}
