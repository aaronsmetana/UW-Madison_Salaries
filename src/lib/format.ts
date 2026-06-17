export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
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
