import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface TrayItem {
  type: 'person' | 'school';
  id: string;
  label: string;
}

interface TrayState {
  items: TrayItem[];
  add: (i: TrayItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

const Ctx = createContext<TrayState | null>(null);
const KEY = 'uwsal.tray.v1';

export function TrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]') as TrayItem[];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const value = useMemo<TrayState>(
    () => ({
      items,
      add: (i) => setItems((p) => (p.some((x) => x.id === i.id && x.type === i.type) ? p : [...p, i])),
      remove: (id) => setItems((p) => p.filter((x) => x.id !== id)),
      clear: () => setItems([]),
      has: (id) => items.some((x) => x.id === id),
    }),
    [items]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTray(): TrayState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTray must be used within TrayProvider');
  return c;
}
