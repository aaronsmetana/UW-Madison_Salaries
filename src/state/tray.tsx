import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface TrayItem {
  type: 'person' | 'school' | 'title';
  id: string;
  label: string;
}

interface TrayState {
  items: TrayItem[];
  add: (i: TrayItem) => void;
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

export function TrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]') as TrayItem[];
    } catch {
      return [];
    }
  });
  const [primaryId, setPrimaryId] = useState<string | null>(() => localStorage.getItem(KEY_PRIMARY) || null);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  // Keep the subject valid: if it isn't a person still in the tray, fall back to the first person (or null).
  // This also auto-selects the first added person and reassigns when the current subject is removed.
  useEffect(() => {
    const persons = items.filter((i) => i.type === 'person');
    setPrimaryId((prev) => (prev && persons.some((p) => p.id === prev) ? prev : (persons[0]?.id ?? null)));
  }, [items]);

  useEffect(() => {
    if (primaryId) localStorage.setItem(KEY_PRIMARY, primaryId);
    else localStorage.removeItem(KEY_PRIMARY);
  }, [primaryId]);

  const value = useMemo<TrayState>(
    () => ({
      items,
      add: (i) => setItems((p) => (p.some((x) => x.id === i.id && x.type === i.type) ? p : [...p, i])),
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
