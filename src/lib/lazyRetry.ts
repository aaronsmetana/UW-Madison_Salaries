import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_FLAG = 'uwsal.chunk-reload';

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
        sessionStorage.removeItem(RELOAD_FLAG);
        return mod;
      })
      .catch((error) => {
        if (sessionStorage.getItem(RELOAD_FLAG) !== '1') {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {}); // page is reloading; never resolve
        }
        sessionStorage.removeItem(RELOAD_FLAG);
        throw error;
      })
  );
}
