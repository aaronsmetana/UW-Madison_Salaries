import { useCallback, useEffect, useState } from 'react';

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

/** Write half of the persistence contract for callers that manage their own state (e.g. a value
 *  keyed dynamically per-record, where `usePref`'s mount-once read wouldn't refresh on key change). */
export function writePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // private browsing / storage full — the preference just won't stick this session
  }
}

/** Removes a persisted value (e.g. a "reset to defaults" action). */
export function clearPref(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Every mounted user of a key, told when any of them sets it. */
const listeners = new Map<string, Set<(v: unknown) => void>>();

/**
 * A small view preference that persists across pages and sessions in localStorage (e.g. "show real
 * dollars" or "log scale") — so a choice made on one chart carries to the next instead of resetting
 * per-card. Components sharing a key stay in step while mounted: a toggle in Divisions' control bar sets
 * the dollars every figure under it reads (D2), where each used to read the value once, at mount.
 */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));
  useEffect(() => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    const hear = (v: unknown) => setValue(v as T);
    set.add(hear);
    return () => { set!.delete(hear); };
  }, [key]);
  const set = useCallback(
    (v: T) => {
      writePref(key, v);
      for (const hear of listeners.get(key) ?? []) hear(v);
      setValue(v);
    },
    [key]
  );
  return [value, set];
}
