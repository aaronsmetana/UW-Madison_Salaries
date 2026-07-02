import type { Summary } from './manifest';

/** Nov 2021 shipped as two snapshots sharing one calendar date (pre/post the TTC title reclassification).
 *  0 for the pre-TTC snapshot, 1 for post-TTC, 0 for anything else — a tie-break, not a full ordering.
 *  Accepts either a snapshot id ('2021-11-pre') or a label ('Nov 2021 (Pre-TTC)'). */
export function ttcRank(idOrLabel: string): number {
  const s = idOrLabel.toLowerCase();
  if (s.endsWith('-pre') || s.includes('pre-ttc')) return 0;
  if (s.endsWith('-post') || s.includes('post-ttc')) return 1;
  return 0;
}

interface SnapRow {
  date?: string | null;
  id?: string | null;
  label?: string | null;
}

/** Builds a comparator that orders rows by the canonical snapshot sequence from summary.json (which
 *  already places pre-TTC before post-TTC on their shared date). Rows are matched by id first, then by
 *  label. When a row can't be resolved against `snapshots` (or `snapshots` is unavailable), falls back to
 *  a date compare with a ttcRank tie-break — so every chart that pivots snapshot rows sorts identically,
 *  instead of each query's own row order deciding ties independently. */
export function makeSnapshotComparator(
  snapshots?: Summary['snapshots'],
): <T extends SnapRow>(a: T, b: T) => number {
  const byId = new Map<string, number>();
  const byLabel = new Map<string, number>();
  (snapshots ?? []).forEach((s, i) => {
    byId.set(s.id, i);
    byLabel.set(s.label, i);
  });
  const indexOf = (r: SnapRow): number | undefined => {
    if (r.id != null && byId.has(r.id)) return byId.get(r.id);
    if (r.label != null && byLabel.has(r.label)) return byLabel.get(r.label);
    return undefined;
  };
  return <T extends SnapRow>(a: T, b: T) => {
    const ia = indexOf(a);
    const ib = indexOf(b);
    if (ia != null && ib != null) return ia - ib;
    return (
      String(a.date).localeCompare(String(b.date)) ||
      ttcRank(a.id ?? a.label ?? '') - ttcRank(b.id ?? b.label ?? '')
    );
  };
}
