export interface Rule { domain: string; includeSubdomains: boolean }
export interface Dataset {
  schemaVersion: 1; version: string; generatedAt: string; source: string;
  coverage: string; rules: Rule[];
}
export interface Settings {
  schemaVersion: 1; enabled: boolean; customRules: Rule[]; exceptions: Rule[];
}
export interface Window { start: number; end: number; limit: number }
export interface HistoryEntry { url?: string; lastVisitTime?: number }
export interface ScanState { windows: Window[]; queries: number; checked: number }
export interface Match { url: string; domain: string }
export interface Job {
  id: string; kind: 'auto' | 'preview' | 'delete';
  state: 'running' | 'ready' | 'complete' | 'cancelled' | 'incomplete';
  datasetVersion: string; startedAt: number; scan?: ScanState;
  matches: Match[]; pending: Match[]; failed: Match[];
  deleted: number; skipped: number; checked: number; message: string;
}
export interface Session { job?: Job; visits: string[] }
export interface Port {
  loadSettings(): Promise<unknown>;
  saveSettings(settings: Settings): Promise<void>;
  loadSession(): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
  search(query: { text: string; startTime: number; endTime: number; maxResults: number }): Promise<HistoryEntry[]>;
  deleteUrl(url: string): Promise<void>;
  remains(url: string): Promise<boolean>;
  now(): number;
}
