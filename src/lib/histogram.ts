/** Below this many records a histogram isn't visually meaningful. */
export const MIN_FOR_HISTOGRAM = 8;

export interface Bin {
  label: string; // compact x-axis label, e.g. "$120k"
  range: string; // full range for tooltip/a11y, e.g. "$120k–$140k"
  lo: number;
  hi: number;
  n: number;
}

const k = (n: number) => `$${Math.round(n / 1000)}k`;

/**
 * Bin a list of salary values into ~6–10 bins scaled to the data range, so the
 * shape of the distribution reads clearly regardless of the title's pay spread.
 */
export function binSalaries(values: number[], maxBins = 10): Bin[] {
  const vals = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return [];
  const min = vals[0];
  const max = vals[vals.length - 1];
  if (max === min) return [{ label: k(min), range: k(min), lo: min, hi: max, n: vals.length }];

  const binCount = Math.min(maxBins, Math.max(6, Math.round(Math.sqrt(vals.length))));
  const width = (max - min) / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => {
    const lo = min + i * width;
    const hi = min + (i + 1) * width;
    return { lo, hi, n: 0, label: k(lo), range: `${k(lo)}–${k(hi)}` };
  });
  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1; // include the max in the last bin
    if (idx < 0) idx = 0;
    bins[idx].n++;
  }
  return bins;
}

/** Index of the bin a value falls in (clamped to the ends). */
export function binIndexFor(value: number, bins: Bin[]): number {
  for (let i = 0; i < bins.length; i++) {
    if (value <= bins[i].hi || i === bins.length - 1) return i;
  }
  return -1;
}
