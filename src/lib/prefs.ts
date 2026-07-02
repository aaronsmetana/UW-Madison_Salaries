import { useCallback, useState } from 'react';

const PREFIX = 'uwsal.pref.';

/** Exported for direct unit testing — the read side of the persistence contract, without needing a
 *  React render. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A small view preference that persists across pages and sessions in localStorage (e.g. "show real
 * dollars" or "log scale") — so a choice made on one chart carries to the next instead of resetting
 * per-card. Reads once at mount; components sharing the same key don't live-sync with each other
 * mid-session, but each freshly-mounted page picks up the latest saved value.
 */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v));
      } catch {
        // private browsing / storage full — the preference just won't stick this session
      }
    },
    [key]
  );
  return [value, set];
}
