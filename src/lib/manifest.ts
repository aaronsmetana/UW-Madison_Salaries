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
  snapshots: { id: string; label: string; date: string; rows: number; median: number | null }[];
  latest: { id: string; label: string; headcount: number; median: number | null } | null;
}

/** Precomputed landing-page stats for the latest snapshot (see scripts/build-data.mjs). */
export interface HomeStats {
  snapshot_id: string;
  payroll_total: number | null;
  schools: number | null;
  titles: number | null;
  salary_lo: number | null;
  salary_hi: number | null;
  bins: { bucket: number; n: number }[];
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
