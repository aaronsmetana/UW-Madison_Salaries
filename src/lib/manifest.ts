import type { Bin } from './distribution';

export interface SnapshotInfo {
  snapshot_id: string;
  snapshot_label: string;
  snapshot_date: string;
  snapshot_year: number;
  snapshot_month: number;
  ttc_variant: string | null;
  source_file: string;
  source_sheet: string;
  row_count: number;
  distinct_people: number;
  distinct_people_paid?: number;
  zero_or_null_salary: number;
  salary_min: number | null;
  salary_median: number | null;
  salary_max: number | null;
  detected_mapping: Record<string, string>;
  unmapped_headers: string[];
  status: 'ok' | 'warning' | 'error' | 'info';
  messages: string[];
  note?: string;
}

export interface Manifest {
  generated_at: string;
  schema_version: number;
  total_rows: number;
  snapshots: SnapshotInfo[];
}

export interface Summary {
  generated_at: string;
  total_rows: number;
  snapshot_count: number;
  /** `median` is over people (summed actual pay per person), like every median in the app;
   *  `median_rows` is the per-appointment figure, for the data-health page. */
  snapshots: { id: string; label: string; date: string; rows: number; median: number | null; median_rows?: number | null }[];
  latest: { id: string; label: string; headcount: number; median: number | null; median_rows?: number | null } | null;
}

/** Precomputed landing-page stats for the latest snapshot (see scripts/build-data.mjs). */
/** One step's continuing raises, campus-wide (scripts/lib/raise-steps.mjs). `hist` is [k, count]
 *  with the raise = k × `hist_step` (0.1%), tails lumped at −50% and +100%. */
export interface RaiseStepStats {
  from_id: string;
  to_id: string;
  from_date: string;
  to_date: string;
  n: number;
  med: number | null;
  p90: number | null;
  hist: [number, number][];
}
export interface RaiseSteps {
  hist_step: number;
  metrics: Record<'fte' | 'full' | 'base', RaiseStepStats[]>;
}

export interface HomeStats {
  snapshot_id: string;
  payroll_total: number | null;
  schools: number | null;
  titles: number | null;
  salary_lo: number | null;
  salary_hi: number | null;
  /** Raw histogram counts, one entry per $1k bucket. Drawn as a smoothed density, not as a polyline
   *  through these points — see `smoothBins` in ./distribution. */
  bins: Bin[];
  /** Upper edge of the histogram, in dollars — reported so the page can label the cap. */
  bin_cap: number | null;
  /** People at or above `bin_cap`, excluded from `bins` so outliers don't flatten the curve. */
  bins_overflow: number | null;
  /** Everyone under the cap as a count per $100 of pay (floored), from `lo100` × $100 up — the dots
   *  the landing page draws, one per person. Re-binned by $1k it is `bins`. */
  pay_counts?: { lo100: number; counts: number[] } | null;
  /** Quartiles over the same actual-pay measure `bins` describes (and the headline median uses). */
  p25: number | null;
  p50: number | null;
  p75: number | null;
  top_title: { title: string; n: number } | null;
  top_division: { school: string; n: number } | null;
  p90: number | null;
  median_tenure_years: number | null;
  category_medians: { category: string; median: number }[];
}

export async function fetchData<T>(file: string): Promise<T> {
  const resp = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!resp.ok) throw new Error(`Failed to load ${file} (HTTP ${resp.status})`);
  return (await resp.json()) as T;
}

/**
 * What search offers before the database loads (scripts/lib/search-index.mjs): every title and
 * division in the latest snapshot, with the headcount and median their own pages state.
 */
export interface SearchIndex {
  snapshot: string;
  label: string;
  /** [job code, title, headcount, median actual pay] */
  titles: [string, string | null, number, number | null][];
  /** [division, headcount, median actual pay] */
  divisions: [string, number, number | null][];
}
