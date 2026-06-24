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
 * Pick a "nice" round bin width (…1k, 2k, 5k, 10k, 20k, 50k…) so that the data
 * range divides into roughly `targetBins` bins. Narrow/low ranges (e.g. custodians)
 * get small bins; wide ranges (e.g. professors) get larger ones.
 */
function niceStep(range: number, targetBins: number): number {
  const rough = range / targetBins;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 5, 10]) {
    const s = m * pow;
    if (range / s <= targetBins) return s;
  }
  return 10 * pow;
}

/**
 * Bin a list of salary values using a nice round, data-scaled step so the shape of
 * the distribution reads clearly regardless of the title's pay level or spread.
 *
 * Pass a fixed `domain` ([min, max]) to hold the x-axis steady across cohorts — e.g. so a
 * "same school" subset visibly thins against the full-title range instead of re-fitting to itself.
 */
export function binSalaries(values: number[], targetBins = 10, domain?: [number, number]): Bin[] {
  const vals = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const min = domain ? domain[0] : vals[0];
  const max = domain ? domain[1] : vals[vals.length - 1];
  if (min == null || max == null) return [];
  if (max === min) return [{ label: k(min), range: k(min), lo: min, hi: max, n: vals.length }];

  const step = niceStep(max - min, targetBins);
  const start = Math.floor(min / step) * step;
  const binCount = Math.max(1, Math.ceil((max + 1e-6 - start) / step));
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => {
    const lo = start + i * step;
    const hi = lo + step;
    return { lo, hi, n: 0, label: k(lo), range: `${k(lo)}–${k(hi)}` };
  });
  for (const v of vals) {
    let idx = Math.floor((v - start) / step);
    if (idx >= binCount) idx = binCount - 1; // include the max in the last bin
    if (idx < 0) idx = 0;
    bins[idx].n++;
  }
  return bins;
}
