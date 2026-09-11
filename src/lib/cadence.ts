import { reportingChange } from './queries';
import { titleChange } from './payHistory';

/** One of a person's snapshots, in date order: pay summed across what they held, and their primary title. */
export interface CadencePoint {
  id: string;
  date: string;
  pay: number;
  /** Appointments held in the snapshot. */
  appts: number;
  jobCode: string | null;
  grade: number | null;
  gradeBasis: string | null;
  basis: string | null;
}

/**
 * What happened between two of a person's snapshots:
 * - `raise` / `no raise`: a continuing raise (R2, `continuingRaisesSql`) above zero, or not;
 * - `promotion` / `title change`: a lone appointment that moved title (R3, payHistory's `titleChange`);
 * - `reporting`: the only change was how the pay is reported (the Sep 2025 ×11/9), never a raise;
 * - `not comparable`: several appointments, a changed FTE or basis, or a snapshot missing between.
 */
export type StepKind = 'raise' | 'no raise' | 'promotion' | 'title change' | 'reporting' | 'not comparable';

export interface CadenceStep {
  toId: string;
  months: number;
  kind: StepKind;
  /** The continuing raise, for `raise` and `no raise`. */
  r: number | null;
}

export interface Cadence {
  steps: CadenceStep[];
  raises: number;
  promotions: number;
  /** Steps that say whether there was a raise: continuing ones, and reporting changes with nothing else. */
  judged: number;
  avgRaise: number | null;
  /** The longest run of months known to have passed with neither a raise nor a promotion. */
  longestMonths: number;
}

const DAY = 86_400_000;
/** Whole months between two snapshot dates, as the date axis measures them. */
export const monthsBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY / 30.4375);

/**
 * A person's raise cadence. `continuing` maps the snapshot a continuing raise ends at to its size.
 *
 * The Nov 2021 relabel is never a step: the pre-TTC twin is dropped, so the first step starts from
 * the post-TTC snapshot. A reporting change is never a raise; it continues a run without one only
 * when pay moved by the reporting factor alone, since any other movement is a change this cannot size.
 */
export function cadenceOf(points: readonly CadencePoint[], continuing: ReadonlyMap<string, number>): Cadence {
  const canon = points.filter((p) => !p.id.endsWith('-pre') && p.pay > 0);
  const steps: CadenceStep[] = [];
  let raises = 0, promotions = 0, judged = 0, sum = 0, run = 0, longest = 0;
  for (let i = 1; i < canon.length; i++) {
    const a = canon[i - 1];
    const b = canon[i];
    const months = monthsBetween(a.date, b.date);
    const rep = reportingChange(a.basis, b.basis);
    let kind: StepKind;
    let r: number | null = null;
    // Whether the run of months without a raise carries on through this step.
    let quiet: boolean;
    if (rep) {
      kind = 'reporting';
      quiet = Math.abs(b.pay / (a.pay * rep.factor) - 1) < 0.001;
      if (quiet) judged++;
    } else if (continuing.has(b.id)) {
      r = continuing.get(b.id)!;
      kind = r > 0 ? 'raise' : 'no raise';
      judged++;
      if (r > 0) { raises++; sum += r; }
      quiet = !(r > 0);
    } else if (a.appts === 1 && b.appts === 1 && a.jobCode && b.jobCode && a.jobCode !== b.jobCode) {
      const appt = (p: CadencePoint) => ({ snapshotId: p.id, date: p.date, jobCode: p.jobCode, school: null, department: null, fte: null, pay: p.pay, grade: p.grade, gradeBasis: p.gradeBasis, basis: p.basis });
      kind = titleChange(appt(a), appt(b)).move;
      if (kind === 'promotion') promotions++;
      quiet = kind !== 'promotion' && !(b.pay > a.pay);
    } else {
      kind = 'not comparable';
      quiet = false;
    }
    steps.push({ toId: b.id, months, kind, r });
    run = quiet ? run + months : 0;
    longest = Math.max(longest, run);
  }
  return { steps, raises, promotions, judged, avgRaise: raises ? sum / raises : null, longestMonths: longest };
}
