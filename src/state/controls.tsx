import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export type Scope =
  | { kind: 'all' }
  | { kind: 'school'; value: string }
  /**
   * A department is only ever named WITHIN its school. The source reuses department names across
   * schools — "Administration" is a department in 12 of them, and 16 names repeat, covering 2,885
   * people — so a name alone silently merged unrelated units: SMPH's Administration (439 people) opened
   * as an 800-person unit spanning Nursing, Athletics and ten others. `school: null` is kept only so a
   * legacy `?dept=` link still resolves; it is labelled as spanning every school that uses the name.
   */
  | { kind: 'department'; value: string; school: string | null };

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
    // `dept` wins when present, and takes `school` with it: `?school=A&dept=B` is department B OF
    // school A. It used to be read the other way round — `school` first — so a link naming both
    // opened the whole school and dropped the department.
    const school = params.get('school');
    const dept = params.get('dept');
    const scope: Scope = dept
      ? { kind: 'department', value: dept, school: school || null }
      : school
        ? { kind: 'school', value: school }
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
          else if (s.kind === 'department') {
            if (s.school) p.set('school', s.school);
            p.set('dept', s.value);
          }
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

/**
 * The scope as a reader should see it. A department always says which school it is in; a legacy
 * name-only department says how many schools it spans (`spans`, when the caller knows it), so it can
 * never pass for one unit.
 */
export function scopeLabel(scope: Scope, spans?: number | null): string {
  if (scope.kind === 'school') return scope.value;
  if (scope.kind === 'department') {
    if (scope.school) return `${scope.value} · ${scope.school}`;
    return spans != null && spans > 1 ? `${scope.value} · in ${spans} divisions` : scope.value;
  }
  return 'All UW';
}

/** Stable string key for the active scope (for query caching). */
export function scopeKey(scope: Scope): string {
  if (scope.kind === 'all') return 'all';
  if (scope.kind === 'department') return `department:${scope.school ?? '*'}:${scope.value}`;
  return `${scope.kind}:${scope.value}`;
}
