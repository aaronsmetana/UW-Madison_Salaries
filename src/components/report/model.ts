// Shared types + pure helpers for the comparison "equity review studio" (left setup pane + right brief).
import { usd, num } from '../../lib/format';

// ── Palette (mirrors the brief's strict three-color rule) ──
export const CAND = 'var(--mantine-color-indigo-6)'; // candidate / subject — slate blue
export const PEER = 'var(--mantine-color-gray-5)'; //  peers — neutral gray

// ── Cohort lenses ──
export type CohortMode = 'all' | 'school' | 'tenure' | 'grade' | 'curated';
export const COHORT_DEFS: { value: CohortMode; label: string; help: string }[] = [
  { value: 'all', label: 'All same-title at UW', help: 'The broad market benchmark — everyone in this job code campus-wide.' },
  { value: 'school', label: 'Same title + school/division', help: 'Same job code within the subject’s school/division.' },
  { value: 'tenure', label: 'Same title + similar tenure', help: 'Same-title peers within a tenure band of the subject.' },
  { value: 'grade', label: 'Same pay grade', help: 'Internal equity by pay grade, across titles.' },
  { value: 'curated', label: 'Only my curated set', help: 'Just the people you picked — your true comparators (e.g. peers who also supervise).' },
];

// ── Justification factors (each gets an optional +$ add-on) ──
export const FACTOR_DEFS = [
  { key: 'supervision', label: 'Supervisory scope', placeholder: 'e.g. 4 direct reports / team of 8' },
  { key: 'credentials', label: 'Certifications & education', placeholder: 'e.g. AWS Solutions Architect; M.S. 2024' },
  { key: 'scope', label: 'Expanded scope / out-of-class', placeholder: 'e.g. acting lead; duties above grade' },
  { key: 'market', label: 'Market & retention', placeholder: 'e.g. competing offer; actively recruited' },
  { key: 'performance', label: 'Performance & impact', placeholder: 'e.g. "Exceeds"; secured $1.2M grant' },
  { key: 'skills', label: 'Specialized skills & experience', placeholder: 'e.g. 6 yrs relevant prior experience' },
  // Research-university leverage (School of Medicine & Public Health and similar units)
  { key: 'grants', label: 'Sponsored research / grant infrastructure', placeholder: 'e.g. maintains data-compliance systems for a $4.2M NIH R01' },
  { key: 'spof', label: 'Sole system owner (single point of failure)', placeholder: 'e.g. only admin of the Epic interface — no internal backup' },
  { key: 'escalation', label: 'De-facto onboarding / Tier-III escalation', placeholder: 'e.g. senior code review + escalation for 6 Grade-25 staff' },
  { key: 'vendor', label: 'External vendor management', placeholder: 'e.g. owns the AWS / Microsoft / Epic technical contract' },
] as const;
export type FactorKey = (typeof FACTOR_DEFS)[number]['key'];

export interface FactorState { on: boolean; amount: number | ''; note: string }

export const SECTION_DEFS = [
  { value: 'highlights', label: 'Evidence (3 proofs)' },
  { value: 'peers', label: 'Peer comparison' },
  { value: 'history', label: 'Pay history' },
];

export interface ReportConfig {
  cohort: CohortMode;
  tenureBand: number; // ± years
  targetKey: string | null; // a curated peer whose pay becomes the base parity
  factors: Record<FactorKey, FactorState>;
  override: number | ''; // manual final-salary override
  headline: string; // optional manual headline override
  format: 'brief' | 'detailed';
  sections: string[];
}

export function defaultConfig(): ReportConfig {
  return {
    cohort: 'all',
    tenureBand: 3,
    targetKey: null,
    factors: Object.fromEntries(FACTOR_DEFS.map((f) => [f.key, { on: false, amount: '', note: '' }])) as Record<FactorKey, FactorState>,
    override: '',
    headline: '',
    format: 'brief',
    sections: SECTION_DEFS.map((s) => s.value),
  };
}

// ── Pure stats helpers ──
export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function quantile(sortedAsc: number[], q: number): number | null {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}
export function ordinal(n: number): string {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface CohortRow { pay: number; tenure: number | null }
export interface CohortStats {
  n: number;
  med: number | null;
  p75: number | null;
  expMed: number | null; // tenure-adjusted median (peers with ≥ subject tenure)
  percentile: number | null;
  gapToMed: number | null; // med − subjectPay  (positive = subject below market = deficit)
  invCount: number; // peers with strictly less tenure but higher pay
  invMaxGap: number;
}

export function cohortStats(rows: CohortRow[], subjectPay: number | null, tenureYears: number | null): CohortStats {
  const pays = rows.map((r) => r.pay).filter((p) => p > 0).sort((a, b) => a - b);
  const n = pays.length;
  const med = median(pays);
  const p75 = quantile(pays, 0.75);
  const expRows = tenureYears != null ? rows.filter((r) => r.tenure != null && r.tenure >= tenureYears - 1).map((r) => r.pay) : [];
  const expMed = expRows.length >= 5 ? median(expRows) : null;
  const percentile = subjectPay != null && n ? Math.round((100 * pays.filter((p) => p <= subjectPay).length) / n) : null;
  const gapToMed = med != null && subjectPay != null ? med - subjectPay : null;
  let invCount = 0;
  let invMaxGap = 0;
  if (subjectPay != null && tenureYears != null) {
    for (const r of rows) {
      if (r.tenure != null && r.tenure < tenureYears && r.pay > subjectPay) {
        invCount++;
        invMaxGap = Math.max(invMaxGap, r.pay - subjectPay);
      }
    }
  }
  return { n, med, p75, expMed, percentile, gapToMed, invCount, invMaxGap };
}

/** Short deficit/surplus badge for a cohort radio label (tone drives semantic-scenting color). */
export type BadgeTone = 'best' | 'deficit' | 'surplus' | 'neutral';
export function deficitBadge(gapToMed: number | null): { text: string; tone: BadgeTone } | null {
  if (gapToMed == null) return null;
  if (gapToMed > 0) return { text: `−${usd(gapToMed)} deficit`, tone: 'deficit' };
  if (gapToMed < 0) return { text: `+${usd(-gapToMed)} — weak case`, tone: 'surplus' };
  return { text: 'at the median', tone: 'neutral' };
}

// ── Receipt (itemized "base parity + value-adds = total") ──
export interface ReceiptLine { id: string; label: string; amount: number; kind: 'base' | 'addon' | 'negotiated' }

// ── Case-strength meter ──
export interface CaseStrength {
  score: number; // 0–100 (= sum of part contributions)
  label: 'Strong' | 'Moderate' | 'Developing';
  parts: { label: string; value: number; max: number }[]; // value = weighted contribution; max = its cap
}
export function caseStrength(opts: {
  gapToMed: number | null; med: number | null; invCount: number; streakYears: number; activeFactors: number;
}): CaseStrength {
  const { gapToMed, med, invCount, streakYears, activeFactors } = opts;
  const below = gapToMed != null && gapToMed > 0 && med ? Math.min(1, gapToMed / (0.1 * med)) : 0;
  const inv = Math.min(1, invCount / 3);
  const sustained = Math.min(1, streakYears / 5);
  const support = Math.min(1, activeFactors / 3);
  // Each bar is that signal's weighted CONTRIBUTION to the total (so the four bars sum to the score).
  const W = { below: 35, inv: 30, sustained: 20, support: 15 };
  const parts = [
    { label: 'Market deficit', value: Math.round(below * W.below), max: W.below },
    { label: 'Tenure inversion', value: Math.round(inv * W.inv), max: W.inv },
    { label: 'Sustained deficit', value: Math.round(sustained * W.sustained), max: W.sustained },
    { label: 'Added value', value: Math.round(support * W.support), max: W.support },
  ];
  const score = parts.reduce((s, p) => s + p.value, 0);
  const label = score >= 67 ? 'Strong' : score >= 34 ? 'Moderate' : 'Developing';
  return { score, label, parts };
}

// ── The model handed to the right-pane brief (plain data; pristine + screen-share-safe) ──
export interface ComparatorRow {
  key: string; name: string; title: string | null; pay: number; tenure: number | null;
  isSubject: boolean; isAnomaly: boolean; lessTenure: boolean; gap: number;
}
export type ProofKind = 'market' | 'inversion' | 'sustained';
export interface ProofModel { kind: ProofKind; value: string; label: string; detail: string }
export interface BriefModel {
  subjectName: string; subjectFirst: string; subjectPay: number | null;
  headerMeta: string;
  recommended: number | null; belowTarget: boolean; targetDelta: number; targetPct: number;
  basisLabel: string;
  receipt: ReceiptLine[];
  activeFactors: { key: string; label: string; note: string; amount: number | null }[];
  proofs: ProofModel[];
  rows: ComparatorRow[]; maxPay: number; showTenure: boolean; cohortLabel: string;
  netSavings: number;
  divergence: { avgAbs: number; subjAbs: number } | null;
  format: 'brief' | 'detailed'; sections: string[];
  jobCode: string | null;
}

/** Copy-ready talking points (left-pane only — never part of the printed brief). */
export function buildTalkingPoints(o: {
  subjectName: string; current: number | null; recommended: number | null; delta: number; pct: number;
  cohortLabel: string; percentile: number | null; invCount: number; invMaxGap: number;
  streakYears: number; factors: { label: string; note: string; amount: number | null }[];
}): string {
  const lines: string[] = [];
  lines.push(`Subject: ${o.subjectName}`);
  if (o.recommended != null && o.current != null) {
    lines.push(`Ask: ${usd(o.current)} → ${usd(o.recommended)} (+${usd(o.delta)}, ${(o.pct * 100).toFixed(1)}%).`);
  }
  lines.push('');
  lines.push('Why:');
  if (o.percentile != null) lines.push(`• Paid at the ${ordinal(o.percentile)} percentile of ${o.cohortLabel}.`);
  if (o.invCount > 0) lines.push(`• ${num(o.invCount)} peers with less UW tenure are paid more (up to +${usd(o.invMaxGap)}).`);
  if (o.streakYears >= 1) lines.push(`• Below the title median ${o.streakYears} consecutive year${o.streakYears === 1 ? '' : 's'}.`);
  for (const f of o.factors) lines.push(`• ${f.label}${f.note ? `: ${f.note}` : ''}${f.amount ? ` (+${usd(f.amount)})` : ''}.`);
  return lines.join('\n');
}
