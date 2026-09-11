import { useMemo } from 'react';
import type { Metric } from '../state/controls';
import type { RaiseStepStats } from './manifest';
import { useRaiseSteps, useSql } from './hooks';
import { sqlStr } from './duckdb';
import { continuingRaisesSql, reportingChange } from './queries';
import { fmtChange } from './format';
import { whereTheDifferenceCameFrom, MIN_TITLE_STEP, type GapShare, type PathStep } from './raises';
import { titleChange } from './payHistory';

/**
 * A person's raises in the context of everyone else's: how each continuing raise compares with that
 * step's raises across campus, what their pay would be had every raise been typical, and where the
 * difference between the two came from. One hook for the person page and the printed report, so the
 * two cannot tell a reader different things about the same raise.
 */

/** How one of this person's continuing raises compares with that step's, campus-wide. */
export interface RaiseComparison {
  r: number;
  /** Share of the OTHER continuing raises strictly smaller, and exactly the same (to 0.1%). */
  below: number;
  equal: number;
  n: number;
  med: number | null;
  /** "larger than 99% · typical +4.0%", "the same as 58% · typical 0%". */
  text: string;
  /** The same step for this person's own title, where enough people continued in it to say. */
  title?: { med: number; n: number } | null;
}

/** Past this share of people on the exact same figure, "larger than X%" hides the real story. */
const SAME_SHARE = 0.2;

export function compareRaise(r: number, step: RaiseStepStats, histStep: number): RaiseComparison {
  const k = Math.max(-500, Math.min(1000, Math.round(r / histStep)));
  let below = 0;
  let equal = 0;
  for (const [key, c] of step.hist) {
    if (key < k) below += c;
    else if (key === k) equal += c;
  }
  // The person's own raise is in the distribution; they are compared with everyone else (n − 1).
  const others = Math.max(1, step.n - 1);
  const eq = Math.max(0, equal - 1) / others;
  const lo = below / others;
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;
  const vs = eq >= SAME_SHARE
    ? `the same as ${pctOf(eq)}`
    : lo >= 0.5
      ? `larger than ${pctOf(lo)}`
      : `smaller than ${pctOf(1 - lo - eq)}`;
  return { r, below: lo, equal: eq, n: step.n, med: step.med, text: `${vs} · typical ${step.med == null ? '—' : fmtChange(step.med)}` };
}

export interface TrendPointLike {
  id: string;
  date: string;
  label: string;
  salary: number;
  basis: string | null;
  /** The primary appointment's title and grade, which name a step a promotion or a title change. */
  job_code?: string | null;
  grade?: number | null;
  gradeBasis?: string | null;
}

export interface RaiseContext {
  /** By snapshot id, for the snapshot each continuing raise ends at. */
  comparisons: Map<string, RaiseComparison>;
  /** Pay had every step been the campus median, by snapshot id, from the first canonical snapshot. */
  typical: Map<string, number>;
  /** Where the gap between actual and typical came from, and the two end points. */
  breakdown: { actual: number; typical: number; shares: (GapShare & { label: string })[] } | null;
  ready: boolean;
}

/**
 * `trend` is the person's pay per snapshot in date order (the page's own series, on `metric`).
 * The typical path starts at their first snapshot after the TTC relabel and compounds every campus
 * step up to each of their snapshots — including any they were not in — and applies a reporting
 * change's factor where their own pay crosses one, so the ×11/9 cancels instead of reading as a gap.
 */
export function useRaiseContext(personKey: string, trend: readonly TrendPointLike[], metric: Metric): RaiseContext {
  const { data: steps } = useRaiseSteps();
  const { data: own } = useSql<{ to_id: string; r: number; job_code: string }>(
    ['own-continuing', personKey, metric],
    `SELECT to_id, r, job_code FROM (${continuingRaisesSql({ metric, where: `person_key = ${sqlStr(personKey)}` })})`,
    !!personKey
  );
  // The same steps within this person's own titles. Filtered to those job codes before the self-join,
  // so it reads a few hundred rows rather than every raise on campus.
  const jobs = useMemo(() => [...new Set((own ?? []).map((o) => o.job_code))].sort(), [own]);
  const { data: titleSteps } = useSql<{ to_id: string; job_code: string; n: number; med: number }>(
    ['title-continuing', metric, jobs.join(',')],
    `SELECT to_id, job_code, count(*) n, median(r) med FROM (${continuingRaisesSql({ metric, where: `job_code IN (${jobs.map(sqlStr).join(', ')})` })}) GROUP BY ALL`,
    jobs.length > 0
  );
  return useMemo(() => {
    const campus = steps?.metrics[metric] ?? [];
    const histStep = steps?.hist_step ?? 0.001;
    const comparisons = new Map<string, RaiseComparison>();
    for (const o of own ?? []) {
      const step = campus.find((s) => s.to_id === o.to_id);
      if (!step || step.n <= 1) continue;
      const t = titleSteps?.find((x) => x.to_id === o.to_id && x.job_code === o.job_code);
      comparisons.set(o.to_id, { ...compareRaise(o.r, step, histStep), title: t && t.n >= MIN_TITLE_STEP ? { med: t.med, n: t.n } : null });
    }

    const canon = trend.filter((t) => !t.id.endsWith('-pre') && t.salary > 0);
    const typical = new Map<string, number>();
    const path: PathStep[] = [];
    const labels = new Map<string, string>();
    if (campus.length && canon.length) {
      let t = canon[0].salary;
      typical.set(canon[0].id, t);
      for (let i = 1; i < canon.length; i++) {
        const prev = canon[i - 1];
        const cur = canon[i];
        const d0 = String(prev.date).slice(0, 10);
        const d1 = String(cur.date).slice(0, 10);
        let growth = 1;
        for (const s of campus) if (s.from_date >= d0 && s.to_date <= d1 && s.med != null) growth *= 1 + s.med;
        const rep = reportingChange(prev.basis, cur.basis)?.factor ?? 1;
        t *= growth * rep;
        typical.set(cur.id, t);
        path.push({ toId: cur.id, from: prev.salary, to: cur.salary, typical: growth * rep, reporting: rep });
        // What the step was, in the history table's own words (payHistory's titleChange).
        const move = prev.job_code && cur.job_code && prev.job_code !== cur.job_code
          ? titleChange(
            { snapshotId: prev.id, jobCode: prev.job_code, school: null, department: null, fte: null, pay: prev.salary, grade: prev.grade, gradeBasis: prev.gradeBasis, basis: prev.basis },
            { snapshotId: cur.id, jobCode: cur.job_code, school: null, department: null, fte: null, pay: cur.salary, grade: cur.grade, gradeBasis: cur.gradeBasis, basis: cur.basis },
          ).move
          : 'raise';
        labels.set(cur.id, `${cur.label} · ${move}`);
        const change = reportingChange(prev.basis, cur.basis);
        if (change) labels.set(`reporting:${cur.id}`, `${cur.label} · ${change.note}, in both lines`);
      }
    }
    const b = path.length ? whereTheDifferenceCameFrom(path) : null;
    const breakdown = b && {
      ...b,
      shares: b.shares.map((s) => ({ ...s, label: (s.kind === 'reporting' ? labels.get(`reporting:${s.toId}`) : labels.get(s.toId)) ?? s.toId })),
    };
    return { comparisons, typical, breakdown, ready: !!steps && !!own };
  }, [steps, own, titleSteps, trend, metric]);
}
