// Shared types + pure helpers for the comparison "equity review studio" (left setup pane + right brief).
import type { ReactNode } from 'react';
import { usd, plural } from '../../lib/format';
import { percentile as percentileOf } from '../../lib/stats';
import { POLICY } from './sources';

// ── Palette (mirrors the brief's strict three-color rule) ──
export const CAND = 'var(--mantine-color-accent-6)'; // candidate / subject — teal accent
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

/** Document-facing phrasing for the active cohort — distinct from `COHORT_DEFS[].label`, which is
 *  UI-only text for the setup pane's radio group. Internal labels like "Only my curated set" or "All
 *  same-title at UW" read as first-person notes-to-self and shouldn't appear in a document handed to
 *  a supervisor or HR — this renders the same cohort as a plain, third-person description instead. */
export function cohortDocLabel(mode: CohortMode, ctx: { school?: string | null; grade?: number | null; tenureBand?: number }): string {
  switch (mode) {
    case 'all': return 'all UW–Madison employees with this title';
    case 'school': return `same-title peers in ${ctx.school ?? 'this school/division'}`;
    case 'tenure': return `same-title peers within ±${ctx.tenureBand ?? 3} years of tenure`;
    case 'grade': return `employees in pay grade ${ctx.grade ?? '—'}`;
    case 'curated': return 'the peers listed in this comparison';
  }
}

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

// ── Custom (user-typed) factors — an open-ended list alongside the fixed FACTOR_DEFS checklist. ──
export interface CustomFactor { id: string; label: string; amount: number | ''; note: string }
export function newCustomFactor(): CustomFactor {
  return { id: `custom-${Math.random().toString(36).slice(2, 10)}`, label: '', amount: '', note: '' };
}

export const SECTION_DEFS = [
  { value: 'highlights', label: 'Evidence & proof points' },
  { value: 'standing', label: 'Market standing' },
  { value: 'factors', label: 'Documented qualifications & responsibilities' },
  { value: 'peers', label: 'Peer comparison' },
  { value: 'history', label: 'Pay history' },
  { value: 'risk', label: 'Retention & replacement cost' },
];

/** Bump when `ReportConfig`'s shape or defaults change in a way that needs one-time migration of
 *  already-saved (localStorage) configs — see `migrateConfig`. */
export const CONFIG_VERSION = 1;

export interface ReportConfig {
  configVersion: number;
  cohort: CohortMode;
  tenureBand: number; // ± years
  targetKey: string | null; // a curated peer whose pay becomes the base parity
  factors: Record<FactorKey, FactorState>;
  customFactors: CustomFactor[]; // open-ended, user-typed justifications (label + optional +$)
  supervisees: string[]; // person_keys of named direct reports (report-local, not tray items)
  supervisorTarget: boolean; // opt-in: raise base parity to ≥15% above the highest-paid supervisee
  override: number | ''; // manual final-salary override
  headline: string; // optional manual headline override
  format: 'brief' | 'detailed';
  sections: string[];
  anonymize: boolean; // render peers (not the subject) as "Peer A/B/C…" in the document
}

export function defaultConfig(): ReportConfig {
  return {
    configVersion: CONFIG_VERSION,
    cohort: 'all',
    tenureBand: 3,
    targetKey: null,
    factors: Object.fromEntries(FACTOR_DEFS.map((f) => [f.key, { on: false, amount: '', note: '' }])) as Record<FactorKey, FactorState>,
    customFactors: [],
    supervisees: [],
    supervisorTarget: false,
    override: '',
    headline: '',
    format: 'brief',
    // Retention/replacement-cost is opt-in, not default-on — it reads as abrasive in a document handed
    // to a supervisor; every other section (incl. the new market-standing panel) stays default-on.
    sections: SECTION_DEFS.map((s) => s.value).filter((v) => v !== 'risk'),
    anonymize: false,
  };
}

/**
 * Upgrades a saved (localStorage) `ReportConfig` — of any prior shape — to the current one. Missing
 * fields backfill from `defaultConfig()`; a `configVersion` below the current one also applies
 * one-time migrations (rather than just defaulting new fields), since those configs got their old
 * values from a since-changed *default*, not a deliberate user choice.
 */
export function migrateConfig(saved: unknown): ReportConfig {
  const base = defaultConfig();
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<ReportConfig> & { factors?: Record<string, unknown> };
  const merged: ReportConfig = {
    ...base,
    ...s,
    factors: { ...base.factors, ...(s.factors ?? {}) } as ReportConfig['factors'],
    customFactors: s.customFactors ?? [],
    sections: Array.isArray(s.sections) ? s.sections : base.sections,
    supervisees: Array.isArray(s.supervisees) ? s.supervisees : [],
    supervisorTarget: s.supervisorTarget ?? false,
    configVersion: CONFIG_VERSION,
  };
  const savedVersion = typeof s.configVersion === 'number' ? s.configVersion : 0;
  if (savedVersion < 1) {
    // Retention defaulted ON before v1 — force it off (this directive), and backfill the new
    // market-standing section, for any config saved under the old default.
    merged.sections = merged.sections.filter((v) => v !== 'risk');
    if (!merged.sections.includes('standing')) merged.sections.push('standing');
  }
  return merged;
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
  // Same "share strictly below, subject included" definition as the Person page's standing bars
  // (src/lib/stats.ts) — `pays` here is peers-only, so the subject is appended just for this calc.
  const percentile = subjectPay != null && n ? percentileOf(subjectPay, [...pays, subjectPay]) : null;
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

// ── Supervisory pay-inversion — anchored to the UW Salary Administration Guidelines' own
//    "Supervisors or Managers and Subordinates" differential (see ./sources.tsx POLICY). ──
export interface SupervisoryReport {
  key: string; name: string; pay: number;
  differential: number; // POLICY.payDifferential(max, min) of (subject, this report)'s pay
  inverted: boolean; // this report is paid MORE than the subject
  belowFloor: boolean; // subject is paid less than this report's pay × (1 + guideline differential)
}
export interface SupervisoryCase {
  reports: SupervisoryReport[];
  invertedCount: number;
  top: SupervisoryReport | null; // the highest-paid named direct report
  target15: number | null; // top's pay × 1.15, rounded — an opt-in base-parity target
}
export function buildSupervisoryCase(subjectPay: number | null, rows: { key: string; name: string; pay: number }[]): SupervisoryCase {
  if (subjectPay == null || !rows.length) return { reports: [], invertedCount: 0, top: null, target15: null };
  const reports: SupervisoryReport[] = rows.map((r) => ({
    key: r.key,
    name: r.name,
    pay: r.pay,
    differential: POLICY.payDifferential(Math.max(subjectPay, r.pay), Math.min(subjectPay, r.pay)),
    inverted: r.pay > subjectPay,
    belowFloor: subjectPay < r.pay * (1 + POLICY.supervisorDifferential),
  }));
  const invertedCount = reports.filter((r) => r.inverted).length;
  const top = reports.reduce<SupervisoryReport | null>((best, r) => (!best || r.pay > best.pay ? r : best), null);
  const target15 = top ? Math.round(top.pay * (1 + POLICY.supervisorDifferential)) : null;
  return { reports, invertedCount, top, target15 };
}

// ── Receipt (itemized "base parity + value-adds = total") ──
export interface ReceiptLine { id: string; label: string; amount: number; kind: 'base' | 'addon' | 'negotiated' }

// ── Case-strength meter ──
export type StrengthKey = 'market' | 'inversion' | 'sustained' | 'added';
export interface CaseStrength {
  score: number; // 0–100 (= sum of part contributions)
  label: 'Strong' | 'Moderate' | 'Developing';
  parts: { key: StrengthKey; label: string; value: number; max: number }[]; // value = weighted contribution; max = its cap
}
export function caseStrength(opts: {
  gapToMed: number | null; med: number | null; invCount: number; streakYears: number; activeFactors: number;
  supervisoryInvertedCount?: number; // an out-earning direct report counts at least as much as a peer tenure inversion
}): CaseStrength {
  const { gapToMed, med, invCount, streakYears, activeFactors, supervisoryInvertedCount = 0 } = opts;
  const below = gapToMed != null && gapToMed > 0 && med ? Math.min(1, gapToMed / (0.1 * med)) : 0;
  const inv = Math.min(1, (invCount + supervisoryInvertedCount) / 3);
  const sustained = Math.min(1, streakYears / 5);
  const support = Math.min(1, activeFactors / 3);
  // Each bar is that signal's weighted CONTRIBUTION to the total (so the four bars sum to the score).
  const W = { below: 35, inv: 30, sustained: 20, support: 15 };
  const parts = [
    { key: 'market' as StrengthKey, label: 'Market deficit', value: Math.round(below * W.below), max: W.below },
    { key: 'inversion' as StrengthKey, label: 'Tenure inversion', value: Math.round(inv * W.inv), max: W.inv },
    { key: 'sustained' as StrengthKey, label: 'Sustained deficit', value: Math.round(sustained * W.sustained), max: W.sustained },
    { key: 'added' as StrengthKey, label: 'Added value', value: Math.round(support * W.support), max: W.support },
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
export type ProofKind = 'market' | 'inversion' | 'sustained' | 'gradeband' | 'compression' | 'supervisory';
// `label`/`detail` are ReactNode (not string) so a footnote `<Sup n={..}/>` marker can be embedded
// inline; `value` (the big headline number/text on the card) stays a plain string.
export interface ProofModel { kind: ProofKind; value: string; label: ReactNode; detail: ReactNode }
export interface PayHistoryPoint { date: string; pay: number | null; med: number | null }
export interface BriefModel {
  subjectName: string; subjectFirst: string; subjectPay: number | null;
  headerMeta: string;
  recommended: number | null; belowTarget: boolean; targetDelta: number; targetPct: number;
  basisLabel: string;
  receipt: ReceiptLine[];
  activeFactors: { key: string; label: string; note: string; amount: number | null }[];
  proofs: ProofModel[];
  yearsToParity: number | null;
  realErosion: { firstYear: number; nominalPct: number; realPct: number } | null;
  rows: ComparatorRow[]; maxPay: number; showTenure: boolean;
  anonymize: boolean;
  netSavings: number;
  divergence: { avgAbs: number; subjAbs: number } | null;
  history: PayHistoryPoint[];
  format: 'brief' | 'detailed'; sections: string[];
  jobCode: string | null;
  supervisory: SupervisoryCase;
}

/** Copy-ready talking points (left-pane only — never part of the printed brief). */
export function buildTalkingPoints(o: {
  subjectName: string; current: number | null; recommended: number | null; delta: number; pct: number;
  cohortLabel: string; percentile: number | null; invCount: number; invMaxGap: number;
  streakYears: number; factors: { label: string; note: string; amount: number | null }[];
  supervisory?: SupervisoryCase;
}): string {
  const lines: string[] = [];
  lines.push(`Subject: ${o.subjectName}`);
  if (o.recommended != null && o.current != null) {
    lines.push(`Ask: ${usd(o.current)} → ${usd(o.recommended)} (+${usd(o.delta)}, ${(o.pct * 100).toFixed(1)}%).`);
  }
  lines.push('');
  lines.push('Why:');
  if (o.percentile != null) lines.push(`• Paid at the ${ordinal(o.percentile)} percentile of ${o.cohortLabel}.`);
  if (o.invCount > 0) lines.push(`• ${plural(o.invCount, 'peer has', 'peers have')} less UW tenure and higher pay (up to +${usd(o.invMaxGap)}).`);
  if (o.streakYears >= 1) lines.push(`• Below the title median ${o.streakYears} consecutive year${o.streakYears === 1 ? '' : 's'}.`);
  for (const r of o.supervisory?.reports ?? []) {
    if (r.inverted && o.current != null) {
      lines.push(`• Supervises ${r.name}, who is paid +${usd(r.pay - o.current)} more (UW guideline: ≥15% differential for supervisors over non-managing subordinates).`);
    }
  }
  for (const f of o.factors) lines.push(`• ${f.label}${f.note ? `: ${f.note}` : ''}${f.amount ? ` (+${usd(f.amount)})` : ''}.`);
  return lines.join('\n');
}
