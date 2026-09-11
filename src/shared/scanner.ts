import type { Port, ScanState } from './model';
export const PAGE_SIZE = 1000;
export const MAX_PAGE_SIZE = 32000;
export function newScan(now: number): ScanState {
  return { windows: [{ start: 0, end: now + 1, limit: PAGE_SIZE }], queries: 0, checked: 0 };
}
// The overlap covers timestamp boundaries. Saturated pages are subdivided before
// any entries are consumed, so a capped response cannot silently skip history.
export async function scanStep(port: Pick<Port, 'search'>, original: ScanState) {
  const state = structuredClone(original);
  const window = state.windows.pop();
  if (!window) return { state, urls: [] as string[] };
  if (++state.queries > 20000) throw new Error('Scan stopped at its query limit. Coverage is incomplete.');
  const items = await port.search({ text: '', startTime: window.start, endTime: window.end, maxResults: window.limit });
  if (items.length >= window.limit) {
    if (window.end - window.start > 4) {
      const middle = Math.floor((window.start + window.end) / 2);
      state.windows.push({ ...window, end: middle + 1 }, { ...window, start: middle });
    } else if (window.limit < MAX_PAGE_SIZE) {
      state.windows.push({ ...window, limit: Math.min(window.limit * 2, MAX_PAGE_SIZE) });
    } else throw new Error('Too many URLs share a timestamp. Coverage is incomplete.');
    return { state, urls: [] as string[] };
  }
  state.checked += items.length;
  return { state, urls: [...new Set(items.flatMap(item => item.url ? [item.url] : []))] };
}
