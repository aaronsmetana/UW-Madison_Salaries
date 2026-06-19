import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

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

function parseFilters(raw: string | null): Filters {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
}

/** Controls live in the URL query string → every view is shareable/bookmarkable. */
export function ControlsProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const key = params.toString();

  const value = useMemo<ControlsState>(() => {
    const scope: Scope = params.get('school')
      ? { kind: 'school', value: params.get('school')! }
      : params.get('dept')
        ? { kind: 'department', value: params.get('dept')! }
        : { kind: 'all' };
    const metric = (params.get('metric') as Metric) || 'fte';
    const activeSnapshot = params.get('snap');
    const filters = parseFilters(params.get('filt'));

    const update = (mut: (p: URLSearchParams) => void) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          mut(n);
          return n;
        },
        { replace: true }
      );

    return {
      scope,
      metric,
      activeSnapshot,
      filters,
      setScope: (s) =>
        update((p) => {
          p.delete('school');
          p.delete('dept');
          if (s.kind === 'school') p.set('school', s.value);
          else if (s.kind === 'department') p.set('dept', s.value);
        }),
      setMetric: (m) => update((p) => (m === 'fte' ? p.delete('metric') : p.set('metric', m))),
      setActiveSnapshot: (id) => update((p) => (id ? p.set('snap', id) : p.delete('snap'))),
      setFilter: (field, values) =>
        update((p) => {
          const cur = parseFilters(p.get('filt'));
          if (values.length) cur[field] = values;
          else delete cur[field];
          if (Object.keys(cur).length) p.set('filt', JSON.stringify(cur));
          else p.delete('filt');
        }),
      clearFilters: () => update((p) => p.delete('filt')),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useControls(): ControlsState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useControls must be used within ControlsProvider');
  return c;
}

export const METRIC_LABEL: Record<Metric, string> = {
  full: 'Full-time rate',
  fte: 'Actual pay',
  base: 'Base pay',
};

export function scopeLabel(scope: Scope): string {
  if (scope.kind === 'school') return scope.value;
  if (scope.kind === 'department') return scope.value;
  return 'All UW';
}

/** Stable string key for the active scope (for query caching). */
export function scopeKey(scope: Scope): string {
  return scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.value}`;
}
