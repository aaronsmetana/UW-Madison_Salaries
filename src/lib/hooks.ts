import { useQuery } from '@tanstack/react-query';
import { query, getDB } from './duckdb';
import { fetchData, type HomeStats, type Manifest, type Summary } from './manifest';
import { useControls } from '../state/controls';

/** Resolves once DuckDB-WASM + the Parquet have loaded; errors if the dataset can't be loaded. */
export function useDbReady() {
  return useQuery({ queryKey: ['db-ready'], queryFn: () => getDB().then(() => true), retry: 1 });
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
  status: 'ok' | 'stale' | 'missing';
}

/** Freshness of the pay-band reference table (drives the staleness banner). */
export function useReferenceStatus() {
  return useQuery({ queryKey: ['ref-status'], queryFn: () => fetchData<ReferenceStatus>('reference-status.json') });
}

/** Run an arbitrary SQL query against the Parquet via DuckDB-WASM. */
export function useSql<T = Record<string, unknown>>(
  key: readonly unknown[],
  sql: string,
  enabled = true
) {
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
