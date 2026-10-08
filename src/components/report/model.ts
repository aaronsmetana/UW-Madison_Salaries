// Shared types + pure helpers for the raise case studio (left setup pane + right brief).
import type { ReactNode } from 'react';
import { usd, pct, plural, fmtGrade } from '../../lib/format';
import { percentile as percentileOf } from '../../lib/stats';
import { POLICY } from './sources';
import type { ScatterPoint } from '../TenurePayScatter';

// ── Palette (mirrors the brief's strict three-color rule) ──
export const CAND = 'var(--mantine-color-accent-6)'; // candidate / subject — teal accent
export const PEER = 'var(--mantine-color-gray-5)'; //  peers — neutral gray

// ── Cohort lenses ──
export type CohortMode = 'all' | 'school' | 'tenure' | 'grade' | 'curated';

/** The groups a case can be benchmarked against, in the order the setup offers their medians. */
export const COHORT_MODES: CohortMode[] = ['all', 'school', 'tenure', 'grade', 'curated'];

/** A cohort in words, the same in the setup and in the document handed to a supervisor or HR: plain and in the
 *  third person. The setup's own labels ("Only my curated set", "All same-title at UW") were notes to self. */
export function cohortDocLabel(mode: CohortMode, ctx: { school?: string | null; grade?: number | null; gradeBasis?: string | null; tenureBand?: number }): string {
  switch (mode) {
    case 'all': return 'all UW–Madison employees with this title';
    case 'school': return `same-title peers in ${ctx.school ?? 'this school/division'}`;
    case 'tenure': return `same-title peers within ±${ctx.tenureBand ?? 3} years of tenure`;
    case 'grade': return `employees in grade ${fmtGrade(ctx.grade, ctx.gradeBasis)}`;
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
  { key: 'skills', label: 'Specialized skills & experience', placeholder: 'e.g. 6 years of relevant prior experience' },
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

/**
 * The order the brief's sections appear in — on screen, in print and in the .doc — one list, so the
 * three cannot drift. The brief and the export each kept their own copy, and both put the guideline
 * basis ahead of the evidence it rests on: the grounds come first, then the provisions they support.
 */
export const SECTION_ORDER = ['highlights', 'guidelineBasis', 'standing', 'factors', 'peers', 'history', 'risk'] as const;
export type SectionKey = (typeof SECTION_ORDER)[number];

const SECTION_LABEL: Record<SectionKey, string> = {
  highlights: 'Evidence & proof points',
  guidelineBasis: 'Basis under UW salary guidelines',
  standing: 'Market standing',
  factors: 'Documented qualifications & responsibilities',
  peers: 'Peer comparison',
  history: 'Pay history',
  risk: 'Retention & replacement cost',
};
export const SECTION_DEFS: { value: SectionKey; label: string }[] = SECTION_ORDER.map((value) => ({ value, label: SECTION_LABEL[value] }));

/** Bump when `ReportConfig`'s shape or defaults change in a way that needs one-time migration of
 *  already-saved (localStorage) configs — see `migrateConfig`. */
export const CONFIG_VERSION = 2;

export interface ReportConfig {
  configVersion: number;
  cohort: CohortMode;
  tenureBand: number; // ± years
  targetKey: string | null; // a curated peer whose pay becomes the base parity
  factors: Record<FactorKey, FactorState>;
  customFactors: CustomFactor[]; // open-ended, user-typed justifications (label + optional +$)
  supervisees: string[]; // person_keys of named direct reports (report-local, not tray items)
  /** Whom the case compares its subject with: the case's own, not the compare set's. Null until chosen (a new
   *  case, or one saved before cases kept their people), when `casePeople` starts it. */
  peers: CasePerson[] | null;
  /** When the case asks to match someone: the factors they have too, which their pay already reflects and so
   *  are not added to the ask (factor keys and custom factor ids). */
  sharedFactors: string[];
  /** When the case asks to match someone: the duties the requester attests the two share (words: never in a link). */
  sharedDuties: string;
  supervisorTarget: boolean; // opt-in: raise base parity to ≥15% above the highest-paid supervisee
  marketFloorTarget: boolean; // opt-in: raise base parity to the SAG market-competitive floor (85% of band midpoint)
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
    peers: null,
    sharedFactors: [],
    sharedDuties: '',
    supervisorTarget: false,
    marketFloorTarget: false,
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
 * A raise case in its link: what builds it — whom it is compared with and how, which factors and for how
 * much, the targets, the ask and the document's shape — so a copied link reopens the same case in another
 * browser. Not what the reader wrote in their own words (a factor's note, a custom factor, a headline): that
 * stays in the browser it was written in, as a salary pinned on Titles does, since a link can end up in a
 * history or a message. Only what differs from a new case, as JSON in base64url.
 */
export function encodeCase(c: ReportConfig): string {
  const d = defaultConfig();
  const o: Record<string, unknown> = {};
  if (c.cohort !== d.cohort) o.c = c.cohort;
  if (c.tenureBand !== d.tenureBand) o.t = c.tenureBand;
  if (c.targetKey) o.k = c.targetKey;
  const f = (Object.entries(c.factors) as [FactorKey, FactorState][]).filter(([, v]) => v.on).map(([k, v]) => (v.amount === '' ? k : `${k}:${v.amount}`));
  if (f.length) o.f = f;
  if (c.supervisees.length) o.s = c.supervisees;
  if (c.supervisorTarget) o.st = 1;
  if (c.marketFloorTarget) o.mf = 1;
  if (c.override !== '') o.o = c.override;
  if (c.sharedFactors.length) o.sf = c.sharedFactors;
  if (c.format !== d.format) o.fm = c.format;
  if (c.sections.join() !== d.sections.join()) o.sc = c.sections;
  if (c.anonymize) o.an = 1;
  if (!Object.keys(o).length) return '';
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A case read back from its link (`encodeCase`) onto `base` — the case as this browser last left it, or a new
 *  one: the link's settings win, and the words written here (notes, custom factors, a headline) are kept.
 *  `base` unchanged where the link is missing or will not read. */
export function applyCase(base: ReportConfig, param: string | null | undefined): ReportConfig {
  if (!param || param.length > 4000) return base;
  let o: Record<string, unknown>;
  try {
    const bin = atob(param.replace(/-/g, '+').replace(/_/g, '/'));
    o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (!o || typeof o !== 'object') return base;
  } catch {
    return base;
  }
  const d = defaultConfig();
  const cohorts = COHORT_MODES as string[];
  const keys = FACTOR_DEFS.map((x) => x.key) as string[];
  const sections = SECTION_DEFS.map((x) => x.value) as string[];
  const on = new Map<string, number | ''>();
  for (const v of Array.isArray(o.f) ? o.f : []) {
    if (typeof v !== 'string') continue;
    const [k, amt] = v.split(':');
    if (keys.includes(k)) on.set(k, amt != null && Number.isFinite(Number(amt)) ? Number(amt) : '');
  }
  return {
    ...base,
    cohort: typeof o.c === 'string' && cohorts.includes(o.c) ? (o.c as CohortMode) : d.cohort,
    tenureBand: typeof o.t === 'number' && Number.isFinite(o.t) ? o.t : d.tenureBand,
    targetKey: typeof o.k === 'string' ? o.k : null,
    factors: Object.fromEntries((Object.entries(base.factors) as [FactorKey, FactorState][]).map(([k, v]) =>
      [k, { ...v, on: on.has(k), amount: on.has(k) ? on.get(k)! : '' }])) as Record<FactorKey, FactorState>,
    supervisees: Array.isArray(o.s) ? o.s.filter((x): x is string => typeof x === 'string') : [],
    supervisorTarget: o.st === 1,
    marketFloorTarget: o.mf === 1,
    override: typeof o.o === 'number' && Number.isFinite(o.o) ? o.o : '',
    sharedFactors: Array.isArray(o.sf) ? o.sf.filter((x): x is string => typeof x === 'string') : [],
    format: o.fm === 'detailed' ? 'detailed' : d.format,
    sections: Array.isArray(o.sc) ? o.sc.filter((x): x is string => typeof x === 'string' && sections.includes(x)) : d.sections,
    anonymize: o.an === 1,
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
    peers: Array.isArray(s.peers) ? casePeople('', s.peers, []) : null,
    sharedFactors: Array.isArray(s.sharedFactors) ? s.sharedFactors.filter((x): x is string => typeof x === 'string') : [],
    sharedDuties: typeof s.sharedDuties === 'string' ? s.sharedDuties : '',
    supervisorTarget: s.supervisorTarget ?? false,
    marketFloorTarget: s.marketFloorTarget ?? false,
    configVersion: CONFIG_VERSION,
  };
  const savedVersion = typeof s.configVersion === 'number' ? s.configVersion : 0;
  if (savedVersion < 1) {
    // Retention defaulted ON before v1 — force it off (this directive), and backfill the new
    // market-standing section, for any config saved under the old default.
    merged.sections = merged.sections.filter((v) => v !== 'risk');
    if (!merged.sections.includes('standing')) merged.sections.push('standing');
  }
  if (savedVersion < 2) {
    // The "Basis under UW salary guidelines" section is new in v2 and default-on; backfill it for
    // configs saved before it existed (a deliberate removal at v2+ then sticks).
    if (!merged.sections.includes('guidelineBasis')) merged.sections.push('guidelineBasis');
  }
  return merged;
}

export interface CasePerson { key: string; name: string }

/** A case's people, never its subject and each once: those it has, else those it starts from (a link's, the
 *  case it was switched from, or the compare set). */
export function casePeople(subject: string, has: unknown[] | null, from: CasePerson[]): CasePerson[] {
  const seen = new Set([subject]);
  const out: CasePerson[] = [];
  for (const p of has ?? from) {
    const q = p as Partial<CasePerson> | null;
    if (!q || typeof q.key !== 'string' || !q.key || seen.has(q.key)) continue;
    seen.add(q.key);
    out.push({ key: q.key, name: typeof q.name === 'string' ? q.name : '' });
  }
  return out;
}

// ── A named comparator: who is most like the subject, and what tenure accounts for between them ──

export interface MatchCandidate { key: string; name: string; school: string | null; tenure: number | null; pay: number }

/** The people with the subject's title most like them, closest first: the same school or division, then the
 *  nearest UW tenure. Not the best paid: a comparator picked for their pay is the one a reader discounts.
 *  `outEarns` marks those paid more with less tenure, the strongest comparators a case can name. */
export function closestMatches(
  rows: MatchCandidate[], subject: { school: string | null; tenure: number | null; pay: number | null }, exclude: Set<string>, n = 5,
): (MatchCandidate & { outEarns: boolean })[] {
  const far = (r: MatchCandidate) => (subject.tenure == null || r.tenure == null ? Infinity : Math.abs(r.tenure - subject.tenure));
  const away = (r: MatchCandidate) => (subject.school != null && r.school === subject.school ? 0 : 1);
  return rows
    .filter((r) => !exclude.has(r.key) && r.pay > 0)
    .sort((a, b) => away(a) - away(b) || far(a) - far(b) || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((r) => ({
      ...r,
      outEarns: subject.pay != null && subject.tenure != null && r.tenure != null && r.pay > subject.pay && r.tenure < subject.tenure,
    }));
}

/** The person a case asks to match, beside its subject, for the brief and the .doc alike. */
export interface MatchModel {
  key: string; name: string;
  /** The subject, then the person matched. */
  sides: [MatchSide, MatchSide];
  /** Their pay less the subject's. */
  gap: number;
  /** What UW tenure accounts for in the gap: the title's pay per year of tenure (the slope of the fit the
   *  brief's tenure line draws, over `n` others) times the years between them. Null without a fit. */
  tenure: { n: number; perYear: number; years: number; explained: number; rest: number } | null;
  /** The gap at each snapshot both were paid in, oldest first. */
  history: { label: string; subject: number; peer: number; gap: number }[];
  /** The duties the requester attests the two share. */
  duties: string;
  /** The subject's factors the person matched has too (not added to the ask), and those beyond them (added). */
  shared: string[];
  beyond: { label: string; amount: number | null }[];
}
export interface MatchSide { title: string | null; school: string | null; tenure: number | null; pay: number }

export function tenureExplains(perYear: number, subjectTenure: number, peerTenure: number, gap: number) {
  const years = peerTenure - subjectTenure;
  const explained = perYear * years;
  return { years, explained, rest: gap - explained };
}

export function gapHistory(hist: { person_key: string; date: string; snapshot_label?: string | null; pay: number | null }[], subject: string, peer: string) {
  const at = (k: string) => new Map(hist.filter((r) => r.person_key === k && r.pay != null && r.pay > 0).map((r) => [r.date, r]));
  const s = at(subject), p = at(peer);
  return [...s.keys()].filter((d) => p.has(d)).sort().map((d) => {
    const a = s.get(d)!.pay as number, b = p.get(d)!.pay as number;
    return { label: s.get(d)!.snapshot_label ?? d, subject: a, peer: b, gap: b - a };
  });
}

/** What tenure accounts for in the gap to the person matched, said once for the brief and the .doc. */
export function matchTenureSentence(m: MatchModel, subjectFirst: string, peerName: string): string | null {
  const t = m.tenure;
  if (!t) return null;
  const yrs = (y: number) => `${Math.abs(y).toFixed(1)} years`;
  if (t.perYear <= 0) return `Among the ${t.n} others with this title, longer UW tenure does not go with higher pay, so tenure accounts for none of the ${usd(Math.abs(m.gap))} gap.`;
  const rate = `Among the ${t.n} others with this title, each year of UW tenure goes with about ${usd(t.perYear)} more pay.`;
  if (Math.abs(t.years) < 0.5) return `${rate} ${peerName} and ${subjectFirst} have about the same UW tenure, so tenure accounts for almost none of the gap.`;
  if (t.years < 0) return `${rate} ${peerName} has ${yrs(t.years)} less UW tenure than ${subjectFirst}: on tenure alone, ${peerName} would be paid about ${usd(-t.explained)} less, not ${usd(m.gap)} more.`;
  if (t.explained >= m.gap) return `${rate} ${peerName} has ${yrs(t.years)} more UW tenure than ${subjectFirst}, which accounts for all of the ${usd(m.gap)} gap.`;
  return `${rate} ${peerName} has ${yrs(t.years)} more UW tenure than ${subjectFirst}, which accounts for about ${usd(t.explained)} of the ${usd(m.gap)} gap; the other ${usd(t.rest)} is not explained by tenure.`;
}

/** "2024-03-15" → "Mar 2024": a snapshot's month, as the brief's history and the .doc both name it. */
export function monthLabel(d: string): string {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MON[Number(d.slice(5, 7)) - 1] ?? ''} ${d.slice(0, 4)}`;
}

/** What the brief's pay-vs-tenure chart shows, in words, for a page that has no chart (the .doc). */
export function tenureTrendSentence(t: { n: number; expected: number; gap: number; perYear?: number }, subjectFirst: string, tenure: number, pay: number): string {
  const rise = t.perYear != null && t.perYear > 0 ? `, rising about ${usd(t.perYear)} a year of tenure` : '';
  const off = Math.round(Math.abs(pay - t.expected));
  const where = off === 0 ? 'on it' : `${usd(off)} ${pay < t.expected ? 'below' : 'above'} it`;
  return `Among the ${t.n} others with this title, the trend of pay on UW tenure puts pay at ${usd(t.expected)} for ${subjectFirst}'s ${tenure.toFixed(1)} years${rise}. ${subjectFirst} is paid ${usd(pay)}, ${where}.`;
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

/** "~4 more years" / "~1 more year" / "10+ more years" — the raw log-compounding estimate is
 *  unbounded (a slow observed raise rate against a large gap can project 50+ years), which reads as
 *  absurd rather than persuasive; capped at a round "10+" past that point. */
export function fmtYearsToParity(years: number): string {
  const n = Math.ceil(years);
  if (n > 10) return '10+ more years';
  return `~${n} more ${n === 1 ? 'year' : 'years'}`;
}

export interface CohortRow { pay: number; tenure: number | null }
export interface CohortStats {
  n: number;
  min: number | null;
  p25: number | null;
  med: number | null;
  p75: number | null;
  max: number | null;
  expMed: number | null; // tenure-adjusted median (peers with ≥ subject tenure)
  percentile: number | null;
  gapToMed: number | null; // med − subjectPay  (positive = subject below market = deficit)
  invCount: number; // peers with strictly less tenure but higher pay
  invMaxGap: number;
}

export function cohortStats(rows: CohortRow[], subjectPay: number | null, tenureYears: number | null): CohortStats {
  const pays = rows.map((r) => r.pay).filter((p) => p > 0).sort((a, b) => a - b);
  const n = pays.length;
  const min = n ? pays[0] : null;
  const p25 = quantile(pays, 0.25);
  const med = median(pays);
  const p75 = quantile(pays, 0.75);
  const max = n ? pays[n - 1] : null;
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
  return { n, min, p25, med, p75, max, expMed, percentile, gapToMed, invCount, invMaxGap };
}

/**
 * What a raise case asks for, as the setup's one choice: a group's median, a named person's pay, a guideline
 * figure, or a figure of one's own. It was four controls in three places (a benchmark radio whose badges said
 * "−$3,828 deficit" beside a $28,492 ask, a target Select, two guideline boxes and an override card), whose
 * precedence a reader had to work out. Read back from the fields that hold it, so saved cases and links keep
 * their shape.
 */
export type AskValue = `cohort:${CohortMode}` | `peer:${string}` | 'marketFloor' | 'supervisor' | 'own';
export interface AskOption { value: AskValue; label: string; pay: number | null; disabled?: boolean; help?: string }

/** The choice a case's settings make, as the math reads them: an own figure wins, then a guideline figure that
 *  raised the ask, then a named person, then the benchmark group's median. */
export function askValueOf(a: { override: number | null; anchor: 'supervisor' | 'marketFloor' | null; target: string | null; cohort: CohortMode }): AskValue {
  if (a.override != null) return 'own';
  if (a.anchor) return a.anchor;
  if (a.target) return `peer:${a.target}`;
  return `cohort:${a.cohort}`;
}

/** The choices, each with its figure. A guideline figure no higher than the median it would replace is shown
 *  but not offered: those exist to raise an ask, never to lower it. */
export function askOptions(ctx: {
  cohorts: { mode: CohortMode; label: string; pay: number | null; adjusted: boolean }[];
  peers: { key: string; name: string; pay: number | null }[];
  marketFloor: { floorPay: number; floorAsk: number; compa: number; grade: number } | null;
  supervisor: { name: string; pay: number } | null;
  /** The median of everyone with the title: what a guideline figure replaces, so what it must beat. */
  median: number | null;
}): AskOption[] {
  const notAbove = (pay: number) => ctx.median != null && pay <= ctx.median;
  const lower = 'No higher than the median of everyone with this title, so it would not raise the ask.';
  const out: AskOption[] = ctx.cohorts.map((c) => ({
    value: `cohort:${c.mode}`, label: `The ${c.adjusted ? 'tenure-adjusted ' : ''}median of ${c.label}`, pay: c.pay,
  }));
  for (const p of ctx.peers) out.push({ value: `peer:${p.key}`, label: `Match ${p.name}`, pay: p.pay });
  const f = ctx.marketFloor;
  if (f) {
    out.push({
      value: 'marketFloor', label: `The market-competitive floor for grade ${f.grade}`, pay: f.floorAsk, disabled: notAbove(f.floorAsk),
      help: notAbove(f.floorAsk) ? lower
        : `85% of the grade's midpoint${f.floorAsk !== f.floorPay ? ` (${usd(f.floorPay)} full-time, carried to this appointment)` : ''}, per the UW salary guideline: the full-time rate is a ${f.compa.toFixed(2)} compa-ratio, below its 0.85 floor.`,
    });
  }
  const v = ctx.supervisor;
  if (v) {
    out.push({
      value: 'supervisor', label: `15% above ${v.name}`, pay: v.pay, disabled: notAbove(v.pay),
      help: notAbove(v.pay) ? lower : 'The UW salary guideline’s differential between a supervisor and the people they supervise.',
    });
  }
  out.push({ value: 'own', label: 'A figure of my own', pay: null });
  return out;
}

/** A case with its ask chosen, and nothing of the other choices left behind. A group's median is also the group
 *  the brief measures standing against; any other ask is measured against everyone with the title. A figure of
 *  one's own starts from the ask as it stands. */
export function applyAsk(c: ReportConfig, value: AskValue, current: number | null): ReportConfig {
  // What another person has too is theirs, not the next person's.
  const base: ReportConfig = { ...c, cohort: 'all', targetKey: null, supervisorTarget: false, marketFloorTarget: false, override: '', sharedFactors: [] };
  if (value.startsWith('cohort:')) return { ...base, cohort: value.slice('cohort:'.length) as CohortMode };
  if (value.startsWith('peer:')) return { ...base, targetKey: value.slice('peer:'.length) };
  if (value === 'marketFloor') return { ...base, marketFloorTarget: true };
  if (value === 'supervisor') return { ...base, supervisorTarget: true };
  return { ...base, override: current != null ? Math.round(current) : '' };
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

// ── Guideline compression — the SAG's suggested minimum differential (≥5% non-exempt / ≥8% exempt)
//    between same-title employees with "distinct differences" in experience. We operationalize
//    "distinct differences" as a peer with ≥5 fewer years of UW tenure (the guideline's own 3-vs-8-year
//    example), then flag any such peer the subject is NOT paid at least the guideline's floor above. ──
export interface GuidelineCompression {
  threshold: number; // the applicable floor (0.05 or 0.08)
  gapYears: number; // the tenure gap that qualifies a peer as "distinctly less experienced"
  count: number; // distinctly-junior peers within `threshold` of the subject's pay (or above it)
  invertedCount: number; // of `count`, those actually paid MORE than the subject
  n: number; // distinctly-junior peers considered (the "of n" denominator)
  maxPeerPay: number | null; // highest-paid compressed peer
  exempt: boolean | null; // subject's FLSA status (drives the threshold; null → conservative 5%)
}
export function buildGuidelineCompression(
  subjectPay: number | null,
  tenureYears: number | null,
  peers: { pay: number; tenure: number | null }[],
  exempt: boolean | null,
): GuidelineCompression | null {
  if (subjectPay == null || tenureYears == null) return null;
  const threshold = POLICY.compressionFloor(exempt);
  const gapYears = POLICY.distinctExperienceGapYears;
  // Peers with distinctly less UW tenure (null-tenure rows can't establish a "distinct difference").
  const juniorPeers = peers.filter((p) => p.tenure != null && p.tenure <= tenureYears - gapYears && p.pay > 0);
  const n = juniorPeers.length;
  if (n === 0) return null; // no basis to assess compression
  // Compressed = the subject is NOT paid at least the guideline's differential above this junior peer.
  const compressed = juniorPeers.filter((p) => subjectPay < p.pay * (1 + threshold));
  const invertedCount = compressed.filter((p) => p.pay > subjectPay).length;
  const maxPeerPay = compressed.reduce<number | null>((best, p) => (best == null || p.pay > best ? p.pay : best), null);
  return { threshold, gapYears, count: compressed.length, invertedCount, n, maxPeerPay, exempt };
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
  guidelineCompressionCount?: number; // a below-guideline-differential junior peer is a compression signal too
}): CaseStrength {
  const { gapToMed, med, invCount, streakYears, activeFactors, supervisoryInvertedCount = 0, guidelineCompressionCount = 0 } = opts;
  const below = gapToMed != null && gapToMed > 0 && med ? Math.min(1, gapToMed / (0.1 * med)) : 0;
  const inv = Math.min(1, (invCount + supervisoryInvertedCount + guidelineCompressionCount) / 3);
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
export type ProofKind = 'market' | 'inversion' | 'sustained' | 'gradeband' | 'compression' | 'supervisory' | 'tenureTrend' | 'guidelineCompression' | 'marketFloor';
// `label`/`detail` are ReactNode (not string) so a footnote `<Sup n={..}/>` marker can be embedded
// inline; `value` (the big headline number/text on the card) stays a plain string.
export interface ProofModel { kind: ProofKind; value: string; label: ReactNode; detail: ReactNode }
export interface PayHistoryPoint { date: string; pay: number | null; med: number | null }

// ── Guideline basis — the SAG provisions the document's evidence actually supports, rendered in the
//    guideline's own vocabulary (one row per supported provision, auto-derived from the evidence). ──
export interface GuidelineProvision {
  key: string;
  name: string; // the provision's guideline-cased name (e.g. "Parity adjustment")
  quote: string; // the guideline's own one-line definition or remedy language
  supportedBy: string; // which evidence in THIS document invokes it
  selfReported?: boolean; // performance / change-in-duties provisions rest on self-reported input
}

// ── Market-competitive position — the SAG's compa-ratio / PIR framework for a graded role. ──
export interface MarketPosition {
  grade: number;
  mid: number; // band midpoint
  compa: number; // full-time rate ÷ midpoint
  pir: number; // (rate − min) ÷ (max − min)
  rate: number; // the full-time rate of the graded appointment — what the band is read against
  position: 'Emerging in Grade' | 'Established in Grade' | 'Advanced in Grade';
  belowCompetitive: boolean; // compa < 85% OR pir < 25% → the guideline's market-request trigger
  floorPay: number; // 85% of midpoint, rounded — the market-competitive floor, as a full-time rate
  floorAsk: number; // the same raise carried to the subject's pay — the opt-in target
}

// ── Market standing — a distribution view of the active cohort + a multi-pool percentile table. ──
export interface StandingPool { label: string; n: number; med: number | null; percentile: number | null; gapToMed: number | null }
export interface StandingModel {
  min: number | null; p25: number | null; med: number | null; p75: number | null; max: number | null;
  values: number[];
  cohortLabel: string;
  pools: StandingPool[];
}

export interface BriefModel {
  subjectName: string; subjectFirst: string; subjectPay: number | null;
  /** Beside the grade-band and market-floor grounds (PayBandNote): where the ranges come from, or how much
   *  of UW they cover while that is partial, and whether they postdate the snapshot read. */
  payBandNote?: string | null;
  headerMeta: string;
  generated: string; snapLabel: string; // for the provenance line ("Data through {snapLabel} · generated {generated}")
  recommended: number | null; belowTarget: boolean; targetDelta: number; targetPct: number;
  basisLabel: string;
  receipt: ReceiptLine[];
  activeFactors: { key: string; label: string; note: string; amount: number | null; shared?: boolean }[];
  proofs: ProofModel[];
  yearsToParity: number | null;
  yearsToParityRate: number; // the annual rate actually used (observed title raise rate, or the 2% fallback)
  yearsToParityObserved: boolean; // true when yearsToParityRate came from the raise-cycle data, not the fallback
  realErosion: { firstYear: number; nominalPct: number; realPct: number } | null;
  rows: ComparatorRow[]; maxPay: number; showTenure: boolean;
  anonymize: boolean;
  attrition: { leftN: number; ofN: number; fromLabel: string; toLabel: string } | null;
  divergence: { avgAbs: number; subjAbs: number } | null;
  history: PayHistoryPoint[];
  format: 'brief' | 'detailed'; sections: string[];
  jobCode: string | null;
  supervisory: SupervisoryCase;
  guidelineCompression: GuidelineCompression | null;
  marketPosition: MarketPosition | null;
  guidelineProvisions: GuidelineProvision[];
  /** True when every same-title cohort query (proofs, standing, peer suggestions, pay history,
   *  raise cycle) was scoped to the subject's own pay basis — false when the subject's comp_basis
   *  is unknown, so no basis filter could be applied (drives a methodology note, not a claim gate). */
  cohortBasisScoped: boolean;
  standing: StandingModel | null;
  tenureRegression: { n: number; expected: number; gap: number; perYear?: number } | null;
  tenureScatterPoints: ScatterPoint[];
  /** The person the case asks to match, when it names one. */
  match: MatchModel | null;
  raiseCycle: {
    n: number; medianPct: number; subjectPct: number | null; fromLabel: string; toLabel: string;
    annualRate: number | null; dist: { bucket: number; n: number }[]; subjectBucket: number | null;
  } | null;
}

/** Copy-ready talking points (left-pane only — never part of the printed brief). */
export function buildTalkingPoints(o: {
  subjectName: string; current: number | null; recommended: number | null; delta: number; pct: number;
  cohortLabel: string; percentile: number | null; invCount: number; invMaxGap: number;
  streakYears: number; factors: { label: string; note: string; amount: number | null }[];
  supervisory?: SupervisoryCase;
  guidelineCompression?: GuidelineCompression | null;
}): string {
  const lines: string[] = [];
  lines.push(`Subject: ${o.subjectName}`);
  if (o.recommended != null && o.current != null) {
    lines.push(`Ask: ${usd(o.current)} → ${usd(o.recommended)} (+${usd(o.delta)}, ${(o.pct * 100).toFixed(1)}%).`);
  }
  lines.push('');
  lines.push('Why:');
  if (o.percentile != null) lines.push(`• Paid more than ${o.percentile}% of ${o.cohortLabel}.`);
  if (o.invCount > 0) lines.push(`• ${plural(o.invCount, 'peer has', 'peers have')} less UW tenure and higher pay (up to +${usd(o.invMaxGap)}).`);
  const gc = o.guidelineCompression;
  if (gc && gc.count > 0) {
    lines.push(`• ${plural(gc.count, 'same-title peer is', 'same-title peers are')} within ${pct(gc.threshold, 0)} of the subject's pay despite ≥${gc.gapYears} fewer years at UW — under the UW guideline's ${pct(gc.threshold, 0)} compression differential.`);
  }
  if (o.streakYears >= 1) lines.push(`• Below the title median ${o.streakYears} consecutive year${o.streakYears === 1 ? '' : 's'}.`);
  for (const r of o.supervisory?.reports ?? []) {
    if (r.inverted && o.current != null) {
      lines.push(`• Supervises ${r.name}, who is paid +${usd(r.pay - o.current)} more (UW guideline: ≥15% differential for supervisors over non-managing subordinates).`);
    }
  }
  for (const f of o.factors) lines.push(`• ${f.label}${f.note ? `: ${f.note}` : ''}${f.amount ? ` (+${usd(f.amount)})` : ''}.`);
  if (o.recommended != null && o.current != null && o.recommended > o.current) {
    const hasCompression = (o.guidelineCompression?.count ?? 0) > 0 || o.invCount > 0 || (o.supervisory?.invertedCount ?? 0) > 0;
    lines.push('');
    lines.push(`Framing: request a parity adjustment${hasCompression ? ' (with a compression review)' : ''} under the UW Salary Administration Guidelines — the guideline's own remedy language, not an "equity adjustment" (which the guideline reserves for protected-category inequities).`);
  }
  return lines.join('\n');
}
