import { useSyncExternalStore } from 'react';

/**
 * How far the data has got: the engine starting, the salary file downloading (bytes so far, of how many when
 * the server says), then ready. A person page waited seconds behind "Loading person…" and a spinner, with
 * nothing to say whether it was 6.9 MB away or stuck (G6); its skeleton reads this.
 */
export interface LoadProgress {
  stage: 'idle' | 'engine' | 'data' | 'opening' | 'ready';
  loaded: number;
  total: number | null;
}

let state: LoadProgress = { stage: 'idle', loaded: 0, total: null };
const listeners = new Set<() => void>();

export function setLoadProgress(next: Partial<LoadProgress>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function useLoadProgress(): LoadProgress {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => state,
  );
}

/** "Loading data · 4.1 of 6.9 MB", "Starting the data engine…", or null once ready. */
export function progressLine(p: LoadProgress): string | null {
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  switch (p.stage) {
    case 'engine': return 'Starting the data engine…';
    case 'data': return p.total ? `Loading data · ${mb(p.loaded)} of ${mb(p.total)} MB` : `Loading data · ${mb(p.loaded)} MB`;
    case 'opening': return 'Opening the data…';
    default: return null;
  }
}
