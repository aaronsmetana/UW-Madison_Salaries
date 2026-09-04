import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CHART_SERIES } from '../lib/chartStyle';

export interface TrayItem {
  type: 'person' | 'school' | 'title';
  id: string;
  label: string;
  /** Index into CHART_SERIES, assigned once at add-time and kept for the item's lifetime — so a
   *  series' color follows the entity, not its position in the tray (removing one item doesn't
   *  repaint every later series). Slots beyond CHART_SERIES.length reuse the last index. */
  colorIdx: number;
}
export type TrayItemInput = Omit<TrayItem, 'colorIdx'>;

interface TrayState {
  items: TrayItem[];
  add: (i: TrayItemInput) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  /** The "Subject" person for the Equity Report (always a person currently in the tray, or null). */
  primaryId: string | null;
  setPrimary: (id: string) => void;
}

const Ctx = createContext<TrayState | null>(null);
const KEY = 'uwsal.tray.v1';
const KEY_PRIMARY = 'uwsal.tray.primary.v1';

/**
 * Every localStorage touch in this file goes through these.
 *
 * `TrayProvider` mounts in `App.tsx` above the router and above the `ErrorBoundary`, so anything
 * that throws here takes the whole app down to a blank page with no recovery. And localStorage does
 * throw: browsers configured to block site data (Safari's "Block All Cookies", enterprise policy)
 * raise a SecurityError on *read*, not just on write, and a full quota raises on write. `prefs.ts`
 * already guards all four of its accesses for the same reason.
 */
function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked or full — the tray just won't survive this session.
  }
}

/** The lowest CHART_SERIES index not already used by `existing` — so colors are assigned densely
 *  from the front and a removed item's slot gets reclaimed by the next addition, rather than every
 *  item marching forward forever. Exported for direct unit testing (no React/localStorage needed). */
export function nextColorIdx(existing: { colorIdx: number }[]): number {
  const used = new Set(existing.map((i) => i.colorIdx));
  for (let i = 0; i < CHART_SERIES.length; i++) if (!used.has(i)) return i;
  return CHART_SERIES.length - 1;
}

export function TrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>(() => {
    try {
      const raw = JSON.parse(readStore(KEY) || '[]') as (Partial<TrayItem> & TrayItemInput)[];
      // Migrate tray items persisted before colorIdx existed: assign densely, in stored order.
      const withColors: TrayItem[] = [];
      for (const it of raw) {
        const colorIdx = typeof it.colorIdx === 'number' ? it.colorIdx : nextColorIdx(withColors);
        withColors.push({ ...it, colorIdx });
      }
      return withColors;
    } catch {
      return [];
    }
  });
  const [primaryId, setPrimaryId] = useState<string | null>(() => readStore(KEY_PRIMARY) || null);

  useEffect(() => {
    writeStore(KEY, JSON.stringify(items));
  }, [items]);

  // Keep the subject valid: if it isn't a person still in the tray, fall back to the first person (or null).
  // This also auto-selects the first added person and reassigns when the current subject is removed.
  useEffect(() => {
    const persons = items.filter((i) => i.type === 'person');
    setPrimaryId((prev) => (prev && persons.some((p) => p.id === prev) ? prev : (persons[0]?.id ?? null)));
  }, [items]);

  useEffect(() => {
    writeStore(KEY_PRIMARY, primaryId);
  }, [primaryId]);

  const value = useMemo<TrayState>(
    () => ({
      items,
      add: (i) => setItems((p) => (p.some((x) => x.id === i.id && x.type === i.type) ? p : [...p, { ...i, colorIdx: nextColorIdx(p) }])),
      remove: (id) => setItems((p) => p.filter((x) => x.id !== id)),
      clear: () => setItems([]),
      has: (id) => items.some((x) => x.id === id),
      primaryId,
      setPrimary: (id) => setPrimaryId(id),
    }),
    [items, primaryId]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTray(): TrayState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTray must be used within TrayProvider');
  return c;
}
