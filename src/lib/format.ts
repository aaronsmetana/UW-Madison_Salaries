/** A negative figure with a true minus (U+2212), as every change on the site prints it, not a hyphen (G9). */
const minus = (s: string) => s.replace(/^-/, '−');

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return minus(Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }));
}

/** The hours in the full-time year every hourly figure in the source is annualized over (scripts/lib/normalize
 *  `HOURS_PER_YEAR`): an hourly appointment's `salary` is its rate times this. */
export const HOURS_PER_YEAR = 2080;

/** An hourly appointment's rate, from its annualized figure, to the cent: "$43.00/hr". */
export function hourly(annual: number | null | undefined): string {
  if (annual == null || !Number.isFinite(Number(annual))) return '—';
  return `$${(Number(annual) / HOURS_PER_YEAR).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`;
}

/** Abbreviated currency for large headline figures (e.g. 1_967_752_095 → "$1.97B"). */
export function usdCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return minus(Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }));
}

/**
 * "Nov 2021 – Mar 2026" from an ordered series of snapshot labels — the endpoints of what a chart
 * actually plots, which is not the dataset's full range once a filter or a sparse title narrows it.
 * Reads the plotted rows for exactly that reason. Feeds `SourceNote`'s `period`.
 */
export function spanLabel(labels: Array<string | null | undefined>): string | undefined {
  const l = labels.filter((x): x is string => !!x);
  if (!l.length) return undefined;
  return l.length === 1 ? l[0] : `${l[0]} – ${l[l.length - 1]}`;
}

/**
 * Headline money, to three figures: "$2.10B", "$51.9M", "$131M" (G10). Totals were printed to the dollar
 * ("$2,095,516,666") under a rounded "$2.1B", and Changes' tiles to the dollar while its chart said "$67.05M";
 * the exact figure goes in the tile's tooltip.
 */
export function usdShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  if (Math.abs(Number(n)) < 1000) return usd(n);
  return minus(Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', minimumSignificantDigits: 3, maximumSignificantDigits: 3,
  }));
}

export function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return minus(Number(n).toLocaleString('en-US'));
}

/** "1 peer", "3 peers" — count formatted with `num()`, singular/plural word chosen by count. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${num(n)} ${n === 1 ? singular : pluralForm}`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return minus(`${(Number(n) * 100).toFixed(digits)}%`);
}

/**
 * A change between two figures, as a reader should see it: "+2.0%", "-1.5%", or "0%" — never "+0.0%"
 * or "−0.0%". One formatter for every change the app prints (the trend chart's pills, both history
 * tables), which printed the same no-change step as "+0.0%" in one place and "0%" in another.
 * Anything smaller than half a displayed step (0.05%) is no change: the source's rate × FTE fallback
 * lands cents away from a reported figure, which used to render unchanged pay as a signed change.
 */
export function fmtChange(d: number | null | undefined): string {
  if (d == null || Number.isNaN(Number(d))) return '—';
  if (Math.abs(d) < 0.0005) return '0%';
  // A real minus (U+2212), as the raise bins print it, not a hyphen.
  return `${d > 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(1)}%`;
}

/** Tenure/duration in years as a figure, one decimal ("11.4 yrs") — one rendering wherever tenure is a
 *  figure (a stat, a table cell, a tooltip). It had drifted to "yrs" in twelve places and "yr" in five. In a
 *  sentence, write "years". */
export function fmtYears(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(digits)} yrs`;
}

/** One date format everywhere ("Jul 2, 2026") instead of each call site picking its own — an ISO
 *  slice reads as a bug next to a long-form date rendered elsewhere in the app. Renders in UTC: these
 *  are calendar/build dates (snapshot dates, generated-at timestamps), not viewer-local wall-clock
 *  times, so the date shown shouldn't shift depending on the reader's timezone. */
export function fmtDate(d: string | number | Date | null | undefined): string {
  if (d == null) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Today, as the reader's own calendar has it ("Sep 29, 2026"): the day a report was generated. Not
 *  `fmtDate`, which reads in UTC for data dates — through it, a report made after 7pm in Madison said
 *  it was generated tomorrow. */
export function fmtToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Normalizes `comp_basis` display values. The source data relabeled this column mid-series — 'Annual'
 * (used through the Apr 2024 snapshot) and '12 Month' (used from Sep 2025 on) never co-occur in the
 * same snapshot and mean the same thing. 'Academic' → '9 Month' is not a rename alone: from Sep 2025 a
 * 9-month appointment's pay is reported as its 12-month equivalent (×11/9, queries REPORTING_CHANGES),
 * and the label says so (E9) — it called a 12-month figure 9-month. Everything else passes through
 * unchanged; blank/missing renders as an em dash like the app's other formatters.
 */
const BASIS_ALIASES: Record<string, string> = {
  annual: '12-month',
  '12 month': '12-month',
  academic: '9-month (academic year)',
  '9 month': '9-month (12-month equivalent)',
};

/** Whether a `comp_basis` reports a 9-month appointment's pay as its 12-month equivalent (Sep 2025 on). */
export const twelveOfNine = (s: string | null | undefined) => s?.trim().toLowerCase() === '9 month';
export function fmtBasis(s: string | null | undefined): string {
  if (!s || !s.trim()) return '—';
  return BASIS_ALIASES[s.trim().toLowerCase()] ?? s;
}

/**
 * Title-case a name for display. The source data is inconsistent — some records are ALL CAPS
 * (e.g. "AARON ALMEIDA") while others are already cased. Only fully-uppercase words are converted
 * (→ "Aaron Almeida"); mixed-case words are left untouched so we don't mangle e.g. "McIntosh".
 * Hyphenated parts ("GANNON-LOEW" → "Gannon-Loew") are handled since the match is per word.
 */
export function formatName(s: string | null | undefined): string {
  if (!s) return '';
  return String(s).replace(/[\p{L}'’]+/gu, (w) =>
    w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w
  );
}

/** Convenience: format a first + last name for display (see `formatName`). */
export function fullName(fn?: string | null, ln?: string | null): string {
  return formatName(`${fn ?? ''} ${ln ?? ''}`.trim());
}

/** A `grade_basis` as a reader says it: the schedule a grade number belongs to. */
export function fmtGradeBasis(b: string | null | undefined): string | null {
  if (!b) return null;
  const known: Record<string, string> = { annual_12mo: '12-month', annual_9mo: '9-month', hourly: 'hourly' };
  return known[b.trim().toLowerCase()] ?? b.replace(/_/g, ' ');
}

/**
 * A grade as the app writes it (G7): its number — "27", never the source's "Grade 027 Madison 12 Month" — after
 * "Grade" or "grade", and its schedule in brackets, "27 (12-month)", where `schedule` is given: wherever the
 * schedule is part of what is said, since a grade number is a grade only on its own schedule (grade 18 is hourly,
 * 12-month and 9-month pay at once).
 */
export function fmtGrade(grade: number | null | undefined, schedule?: string | null): string {
  if (grade == null) return '—';
  const s = fmtGradeBasis(schedule);
  return s ? `${grade} (${s})` : String(grade);
}

/**
 * How a group's median sits against the campus one, in words: "19% below campus", "34% above campus", or
 * "about the campus median" within a point either way, a gap too small to be worth a number. Empty when
 * there is nothing to compare.
 */
export function vsCampus(group: number | null | undefined, campus: number | null | undefined): string {
  if (group == null || campus == null || !(campus > 0) || !Number.isFinite(group)) return '';
  // The size rounded, then the side: `Math.round` alone takes -1.5 to -1 but 1.5 to 2, which would call
  // the same gap "about the median" below campus and "2%" above it.
  const gap = (100 * (group - campus)) / campus;
  const pct = Math.sign(gap) * Math.round(Math.abs(gap));
  if (Math.abs(pct) <= 1) return 'about the campus median';
  return pct < 0 ? `${-pct}% below campus` : `${pct}% above campus`;
}

/** The source's pre-TTC abbreviations, spelled out. Only words the old titles used, each checked against a title
 *  that wrote it out in full ("SR INFORM PROC CONSLT" is the Senior Information Processing Consultant). */
const LEGACY_WORDS: Record<string, string> = {
  ADMIN: 'Administrative', ADV: 'Advisor', ANAL: 'Analyst', ASSOC: 'Associate', ASST: 'Assistant', CLIN: 'Clinical',
  CONSLT: 'Consultant', CONSULT: 'Consultant', CORD: 'Coordinator', COORD: 'Coordinator', DEV: 'Development', DIR: 'Director',
  EMER: 'Emeritus', ENGR: 'Engineer', INFORM: 'Information', INSTR: 'Instructor', MGR: 'Manager', PRG: 'Program',
  PRGM: 'Program', PROC: 'Processing', PROCESS: 'Processing', PROF: 'Professor', PROG: 'Program', SERV: 'Services',
  SPEC: 'Specialist', SR: 'Senior', STU: 'Student', SUPV: 'Supervisor', SVC: 'Service', SVCS: 'Services', TECH: 'Technician',
  UNIV: 'University',
};
/** Kept as written: acronyms and roman numerals. */
const LEGACY_KEEP = new Set(['CHS', 'LTE', 'UW', 'IT', 'HR', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);

/** A pre-TTC title as a reader would write it (P5): "INFORM PROCESS CONSLT" → "Information Processing Consultant".
 *  Only an all-capitals title is rewritten; one the source already cased is left alone. */
export function legacyTitle(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  return t.replace(/[A-Z]+/g, (w) => LEGACY_WORDS[w] ?? (LEGACY_KEEP.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
}
