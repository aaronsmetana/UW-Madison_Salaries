import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Scope =
  | { kind: 'all' }
  | { kind: 'school'; value: string }
  | { kind: 'department'; value: string };

export type Metric = 'full' | 'fte' | 'base';

/** facet field (canonical column) -> selected values */
export type Filters = Record<string, string[]>;

export interface ControlsState {
  scope: Scope;
  setScope: (s: Scope) => void;
  metric: Metric;
  setMetric: (m: Metric) => void;
  /** active snapshot id for cross-sectional views; null = latest */
  activeSnapshot: string | null;
  setActiveSnapshot: (id: string | null) => void;
  filters: Filters;
  setFilter: (field: string, values: string[]) => void;
  clearFilters: () => void;
}

const Ctx = createContext<ControlsState | null>(null);

export function ControlsProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [metric, setMetric] = useState<Metric>('full');
  const [activeSnapshot, setActiveSnapshot] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});

  const value = useMemo(
    () => ({
      scope, setScope, metric, setMetric, activeSnapshot, setActiveSnapshot,
      filters,
      setFilter: (field: string, values: string[]) =>
        setFilters((p) => {
          const next = { ...p };
          if (values.length) next[field] = values;
          else delete next[field];
          return next;
        }),
      clearFilters: () => setFilters({}),
    }),
    [scope, metric, activeSnapshot, filters]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControls(): ControlsState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useControls must be used within ControlsProvider');
  return c;
}

export const METRIC_LABEL: Record<Metric, string> = {
  full: 'Full annual $',
  fte: 'FTE-adjusted $',
  base: 'Base pay',
};

export function scopeLabel(scope: Scope): string {
  if (scope.kind === 'school') return scope.value;
  if (scope.kind === 'department') return scope.value;
  return 'All UW';
}
