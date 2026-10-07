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
  /** `published` is the day the release went up on the site (data/releases.json), where one is recorded. */
  snapshots: { id: string; label: string; date: string; published?: string | null; rows: number; headcount?: number | null; median: number | null; median_rows?: number | null }[];
  latest: { id: string; label: string; headcount: number; median: number | null; median_rows?: number | null } | null;
  /** Divisions formed from whole departments of others, step by step (normalize `divisionReorganizations`). */
  reorganizations?: Reorganization[];
}

/** A division new at `to_id`, formed from whole departments of the divisions in `from`. */
export interface Reorganization {
  from_id: string;
  to_id: string;
  school: string;
  /** Its people at `to_id`. */
  people: number;
  /** Each division whole departments came from: how many people came from it, and which departments. */
  from: { school: string; people: number; departments: string[] }[];
}

/** departments.json: each step's department renames carried, mergers left apart, and others that ended. */
export interface DepartmentChanges {
  generated_at: string;
  rule: { share: number; min: number };
  /** Renames carried in value-map.json's `department` block. */
  mapped: number;
  steps: {
    from: string;
    to: string;
    carried: { school: string | null; from: string; to: string; carried: number; share: number; reverse: number }[];
    uncarried: { school: string | null; from: string; to: string; carried: number; share: number; reverse: number }[];
    mergers: { school: string | null; to: string; reverse: number; from: { department: string; carried: number; share: number }[] }[];
    gone: { school: string | null; department: string; people: number; carried: number; to: string | null; to_school: string | null; share: number; reverse?: number }[];
  }[];
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
  /** The most people in one $1k column under `bin_cap` in any snapshot: the scale the landing graph is drawn to,
   *  so the latest and each snapshot of its timeline draw a person the same height. Absent from older builds. */
  column_peak?: number | null;
  /** People at or above `bin_cap`, excluded from `bins` so outliers don't flatten the curve. */
  bins_overflow: number | null;
  /** Everyone under the cap as a count per $100 of pay (floored), from `lo100` × $100 up — the dots
   *  the landing page draws, one per person. Re-binned by $1k it is `bins`. */
  pay_counts?: {
    lo100: number;
    counts: number[];
    /** The same people by staff category, largest first: each person once, in the category of their
     *  highest-paid appointment. `counts` sum to the parent's bin by bin; `over` counts those at or
     *  above the cap; `n` and `median` cover everyone paid in the category. */
    categories?: { name: string; n: number; median: number; over: number; counts: number[];
      /** The pays of the people at or above the cap, by pay then person — the pile's own order, so its
       *  dots can unroll each to its own pay. */
      over_pays?: number[] }[];
  } | null;
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
  /** [job code, title, headcount, median actual pay, the code's other names (matched, never shown)] */
  titles: [string, string | null, number, number | null, string[]?][];
  /** [division, headcount, median actual pay] */
  divisions: [string, number, number | null][];
}
