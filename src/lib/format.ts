export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** Abbreviated currency for large headline figures (e.g. 1_967_752_095 → "$1.97B"). */
export function usdCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  });
}

export function num(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US');
}

/** "1 peer", "3 peers" — count formatted with `num()`, singular/plural word chosen by count. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${num(n)} ${n === 1 ? singular : pluralForm}`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(digits)}%`;
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

/**
 * Normalizes `comp_basis` display values. The source data relabeled this column mid-series — 'Annual'
 * (used through the Apr 2024 snapshot) and '12 Month' (used from Sep 2025 on) never co-occur in the
 * same snapshot and mean the same thing; likewise 'Academic' → '9 Month'. Everything else passes
 * through unchanged; blank/missing renders as an em dash like the app's other formatters.
 */
const BASIS_ALIASES: Record<string, string> = {
  annual: '12-month',
  '12 month': '12-month',
  academic: '9-month (academic year)',
  '9 month': '9-month (academic year)',
};
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
