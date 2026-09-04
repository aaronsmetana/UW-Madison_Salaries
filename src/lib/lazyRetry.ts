import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_FLAG = 'uwsal.chunk-reload';

/**
 * sessionStorage throws, not just fails, in browsers set to block site data — and this wrapper runs
 * on the success path of *every* lazily-loaded route. An unguarded read here would turn a working
 * app into one where no route can mount at all, which is a far worse failure than the stale-chunk
 * case this file exists to handle. Losing the flag only costs the reload-loop guard.
 */
const flag = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(RELOAD_FLAG);
    } catch {
      return null;
    }
  },
  set: (v: string | null): void => {
    try {
      if (v == null) sessionStorage.removeItem(RELOAD_FLAG);
      else sessionStorage.setItem(RELOAD_FLAG, v);
    } catch {
      /* no flag available; the reload guard degrades to "don't reload" below */
    }
  },
};

/**
 * Wraps React.lazy so a stale-deploy chunk-load failure (a new deploy renamed/removed the
 * hashed asset a cached tab is still asking for) triggers one full reload instead of leaving
 * a blank route. A fresh page load fetches the current index.html, which points at the
 * current chunk hashes. sessionStorage guards against a reload loop if the failure persists.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(() =>
    factory()
      .then((mod) => {
        flag.set(null);
        return mod;
      })
      .catch((error) => {
        if (flag.get() !== '1') {
          flag.set('1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {}); // page is reloading; never resolve
        }
        flag.set(null);
        throw error;
      })
  );
}
