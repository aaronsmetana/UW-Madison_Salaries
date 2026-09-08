/**
 * Matching a person's appointments across snapshots, for the history table's "Raise" column.
 *
 * The public data carries no appointment id. A person's concurrent appointments arrive as separate
 * rows sharing a `person_key`, and two of them can share a `job_code` — 1,052 such groups across 455
 * people. That makes the obvious key ambiguous, and the obvious shortcut wrong: summing a snapshot's
 * rows per job code and then dividing ONE row's pay by that sum reported a 0.333-FTE Lecturer line as
 * a 70% pay cut, on a page where the person's pay had risen every cycle. 1,345 cells said that.
 *
 * What the source does support is the department. 365 of those groups separate cleanly on
 * `(school, department)`; the remaining 687 differ only by salary, which is the one field that moves
 * between snapshots and so cannot identify anything. Where a department pairs one-to-one we report a
 * real per-appointment change; where it does not we report ONE change across the rows that did not
 * match, labelled as such. There is no third tier: matching on the school alone was measured against
 * the whole dataset and paired "Surgery" with "Medicine" and "Mechanical Engineering" with
 * "Computer-Aided Engineering" about as often as it caught a genuine rename, and a plausible wrong
 * number is worse here than an honest combined one.
 */

/** The fields this module needs from one appointment row, whatever the caller's row type is. */
export interface ApptFields {
  snapshotId: string;
  jobCode: string | null;
  school: string | null;
  department: string | null;
  /** Pay for THIS appointment alone. Callers differ on how they derive it (`actualPay` vs SQL). */
  pay: number;
}

export type Raise =
  /** Matched to one prior appointment by department: a genuine per-appointment change. */
  | { kind: 'paired'; delta: number }
  /** Could not be matched one-to-one; `delta` spans the unmatched rows on both sides. */
  | { kind: 'combined'; delta: number; curCount: number; priorCount: number }
  /** A new appointment under a title the person already held — nothing to compare it to. */
  | { kind: 'newAppointment' }
  /** No prior snapshot, no prior row under this title, or a prior pay of zero. */
  | { kind: 'none' };

/**
 * Half of `pct()`'s 0.1% step. Below this a change cannot be displayed at all, so it is reported as
 * no change rather than as a signed one — `salary_fte_adjusted` is populated in some snapshots and
 * null in others for the same appointment, and the `rate × fte` fallback lands cents away, which
 * rendered 867 unchanged salaries as pay CUTS ("−0.0%", in the decrease colour).
 */
export const NEGLIGIBLE_CHANGE = 0.0005;

const snap = (d: number): number => (Math.abs(d) < NEGLIGIBLE_CHANGE ? 0 : d);

/**
 * Per-row change for a person's appointment history.
 *
 * `rows` must already be in the order the reader sees them — chronological, with the pre-TTC snapshot
 * ahead of the post-TTC one on their shared date (see `makeSnapshotComparator`). Snapshots are
 * compared to the caller's previous snapshot, not to a calendar date, so a person missing from a
 * snapshot is simply skipped rather than reported as a departure.
 *
 * Returns a map keyed by the caller's own row objects.
 */
export function matchAppointments<T>(rows: readonly T[], get: (row: T) => ApptFields): Map<T, Raise> {
  const out = new Map<T, Raise>();

  // Snapshots in the order supplied, each holding its rows grouped by job code.
  const order: string[] = [];
  const bySnapshot = new Map<string, Map<string, T[]>>();
  for (const row of rows) {
    const f = get(row);
    let jobs = bySnapshot.get(f.snapshotId);
    if (!jobs) {
      jobs = new Map();
      bySnapshot.set(f.snapshotId, jobs);
      order.push(f.snapshotId);
    }
    // A row with no job code has no title to compare across snapshots.
    if (f.jobCode == null) {
      out.set(row, { kind: 'none' });
      continue;
    }
    const group = jobs.get(f.jobCode);
    if (group) group.push(row);
    else jobs.set(f.jobCode, [row]);
  }

  // NUL-separated: it cannot occur in a department name, so no pair of field values can collide with
  // a different pair the way a printable separator allows. This key decides whether two rows are the
  // same appointment, so a collision would silently pair unrelated jobs.
  const deptKey = (row: T): string => {
    const f = get(row);
    return `${f.school ?? ''}\u0000${f.department ?? ''}`;
  };
  const groupBy = (list: readonly T[], key: (row: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const row of list) {
      const k = key(row);
      const g = m.get(k);
      if (g) g.push(row);
      else m.set(k, [row]);
    }
    return m;
  };
  const total = (list: readonly T[]): number => list.reduce((s, row) => s + get(row).pay, 0);

  for (let i = 0; i < order.length; i++) {
    const jobs = bySnapshot.get(order[i])!;
    const prior = i > 0 ? bySnapshot.get(order[i - 1])! : null;

    for (const [code, cur] of jobs) {
      const pri = prior?.get(code);
      if (!pri?.length) {
        // The title itself is new to this snapshot — the caller badges that separately.
        for (const row of cur) out.set(row, { kind: 'none' });
        continue;
      }

      // One appointment on each side is not ambiguous, whatever the department says. 14,963 cells
      // across 12,889 people are a single appointment that changed department while keeping its
      // title — a reorg or a rename, both of which the department key reads as "no match". Pairing
      // by department FIRST would have demoted every one of them to a combined figure: ten times as
      // many cells as the split-appointment bug this module exists to fix.
      if (cur.length === 1 && pri.length === 1) {
        const before = get(pri[0]).pay;
        out.set(
          cur[0],
          before > 0 ? { kind: 'paired', delta: snap((get(cur[0]).pay - before) / before) } : { kind: 'none' }
        );
        continue;
      }

      // A department pairs only when it names exactly one row on each side. Two rows sharing a
      // department are the ambiguous case this module exists to refuse to guess at.
      const curByDept = groupBy(cur, deptKey);
      const priByDept = groupBy(pri, deptKey);
      const matched = new Set<T>();
      const unpairedCur: T[] = [];
      for (const row of cur) {
        const here = curByDept.get(deptKey(row))!;
        const there = priByDept.get(deptKey(row));
        if (here.length !== 1 || there?.length !== 1) {
          unpairedCur.push(row);
          continue;
        }
        const before = get(there[0]).pay;
        // Matched either way; a zero prior pay just leaves no ratio to report.
        matched.add(there[0]);
        out.set(
          row,
          before > 0 ? { kind: 'paired', delta: snap((get(row).pay - before) / before) } : { kind: 'none' }
        );
      }
      if (unpairedCur.length === 0) continue;

      const unpairedPri = pri.filter((row) => !matched.has(row));
      if (unpairedPri.length === 0) {
        for (const row of unpairedCur) out.set(row, { kind: 'newAppointment' });
        continue;
      }

      // The remainder on each side, NOT the whole job-code total — 92 of 986 split groups pair some
      // of their rows, and the group total would count those twice.
      const before = total(unpairedPri);
      const raise: Raise =
        before > 0
          ? {
              kind: 'combined',
              delta: snap((total(unpairedCur) - before) / before),
              curCount: unpairedCur.length,
              priorCount: unpairedPri.length,
            }
          : { kind: 'none' };
      for (const row of unpairedCur) out.set(row, raise);
    }
  }

  return out;
}

/** The tooltip behind a `combined` cell. Reads correctly at any count, including one on each side. */
export function combinedReason(curCount: number, priorCount: number): string {
  const appt = (n: number) => `${n} appointment${n === 1 ? '' : 's'}`;
  return (
    `This title's appointments could not be matched one-to-one between snapshots — ${appt(curCount)} here, ` +
    `${appt(priorCount)} before — because the source carries no appointment id and these share a department. ` +
    'The change is shown across them together.'
  );
}
