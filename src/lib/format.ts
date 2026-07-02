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
