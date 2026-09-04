import { useQuery } from '@tanstack/react-query';
import { query, getDB } from './duckdb';
import { fetchData, type HomeStats, type Manifest, type Summary } from './manifest';
import { useControls } from '../state/controls';

/**
 * Resolves once DuckDB-WASM + the Parquet have loaded; errors if the dataset can't be loaded.
 *
 * `enabled` is the whole point of this hook's shape. Booting DuckDB costs ~13.8 MB over the wire
 * (7.5 MB wasm + 6.0 MB Parquet + ~250 KB of worker/JS), so only a caller that actually intends to
 * query may start it. `useSql` passes its own `enabled` straight through, which makes the boot
 * follow real demand for every query in the app without any call site having to think about it.
 *
 * Pass `false` to *observe* without starting anything: the query still subscribes to the shared
 * ['db-ready'] cache entry and reports an error raised by a real consumer, but fetches nothing
 * itself. That is what `DataErrorBanner` wants — it renders on every route, including the ones
 * (Home, /data, 404) that serve entirely from precomputed JSON and never touch the Parquet.
 */
export function useDbReady(enabled = true) {
  return useQuery({ queryKey: ['db-ready'], queryFn: () => getDB().then(() => true), retry: 1, enabled });
}

/** Headline KPIs + snapshot list (static JSON — works even if DuckDB/Parquet fail to load). */
export function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => fetchData<Summary>('summary.json') });
}

export function useManifest() {
  return useQuery({ queryKey: ['manifest'], queryFn: () => fetchData<Manifest>('manifest.json') });
}

/**
 * Precomputed landing-page stats (see scripts/build-data.mjs). Lets Home render without booting
 * DuckDB-WASM. `retry: false` so a missing artifact (e.g. local dev before `npm run data`) fails
 * fast and Home can fall back to live SQL instead of retrying a 404.
 */
export function useHomeStats() {
  return useQuery({ queryKey: ['home-stats'], queryFn: () => fetchData<HomeStats>('home-stats.json'), retry: false });
}

export interface GradeRange {
  grade: number;
  basis: string;
  min: number;
  max: number;
  effective_year: number | null;
}

/** Pay-band reference (grade → range); empty array if none provided. */
export function useGrades() {
  return useQuery({ queryKey: ['grades'], queryFn: () => fetchData<GradeRange[]>('grades.json') });
}

export interface ReferenceStatus {
  generated_at: string;
  grades_count: number;
  max_effective_year: number | null;
  latest_snapshot_year: number | null;
  /** Latest-snapshot rows carrying a grade in the source — the population the reference should band. */
  graded_rows: number;
  /** Of those, how many matched a grade→range row in the reference table. */
  matched_rows: number;
  /** matched_rows / graded_rows, or null when nothing in the snapshot carries a grade. */
  coverage: number | null;
  status: 'ok' | 'stale' | 'missing' | 'sparse';
}

/** Freshness *and* coverage of the pay-band reference table (drives the pay-band banner). */
export function useReferenceStatus() {
  return useQuery({ queryKey: ['ref-status'], queryFn: () => fetchData<ReferenceStatus>('reference-status.json') });
}

/** Run an arbitrary SQL query against the Parquet via DuckDB-WASM. */
export function useSql<T = Record<string, unknown>>(
  key: readonly unknown[],
  sql: string,
  enabled = true
) {
  // Booting DuckDB is this app's single largest cost, so it follows demand: a query that will not
  // run must not pay for it. Threading the same `enabled` through means Home — whose eight queries
  // are all gated behind `needsSql` — loads nothing, while any page that really queries still marks
  // the dataset as needed so `DataErrorBanner` has something to observe.
  useDbReady(enabled);
  // Include the SQL text in the key so changing a query without changing its key can't serve stale data.
  return useQuery({ queryKey: ['sql', ...key, sql], queryFn: () => query<T>(sql), enabled });
}

/** The active snapshot id, resolving the `latest` default from the summary. */
export function useActiveSnapshotId(): string | undefined {
  const { activeSnapshot } = useControls();
  const { data } = useSummary();
  const latest = data?.snapshots[data.snapshots.length - 1]?.id;
  return activeSnapshot ?? latest;
}

/**
 * The active snapshot's human label ("Mar 2026") — the counterpart to `useActiveSnapshotId()` for
 * anything a reader sees. A snapshot-scoped chart needs this to say what period it describes; the
 * id ("2026-03") is a key, not a date anyone should be shown.
 */
export function useActiveSnapshotLabel(): string | undefined {
  const id = useActiveSnapshotId();
  const { data } = useSummary();
  return data?.snapshots.find((s) => s.id === id)?.label;
}
