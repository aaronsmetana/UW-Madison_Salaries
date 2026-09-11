/**
 * Matching a person's appointments across snapshots, for the history table's "Raise" column.
 *
 * The public data carries no appointment id. A person's concurrent appointments arrive as separate
 * rows sharing a `person_key`, and two of them can share a `job_code` — 1,052 such groups across 455
 * people. That makes the obvious key ambiguous, and the obvious shortcut wrong: summing a snapshot's
 * rows per job code and then dividing ONE row's pay by that sum reported a 0.333-FTE Lecturer line as
 * a 70% pay cut, on a page where the person's pay had risen every cycle. 1,345 cells said that.
 *
 * What the source does support is the department, and after it the appointment percentage. 365 of
 * those groups separate cleanly on `(school, department)`; FTE then recovers most of the rest,
 * including the case where the source renames a department and the appointment is unchanged
 * underneath it. What survives both differs only by salary — the one field that moves between
 * snapshots, and so identifies nothing — and gets ONE change reported across the rows that did not
 * match, labelled as such.
 *
 * Every tier here pairs only what its key names uniquely on BOTH sides, and every one was measured
 * against the whole dataset before being admitted. A school tier was written and rejected: it paired
 * "Surgery" with "Medicine" and "Mechanical Engineering" with "Computer-Aided Engineering" about as
 * often as it caught a genuine rename. A plausible wrong number is worse here than an honest
 * combined one, so a tier earns its place by evidence, not by looking reasonable.
 */

import { reportingChange, sameBasis } from './queries';

/** The fields this module needs from one appointment row, whatever the caller's row type is. */
export interface ApptFields {
  snapshotId: string;
  jobCode: string | null;
  school: string | null;
  department: string | null;
  /** Appointment percentage, as recorded. See `MIN_TRACKABLE_FTE` for the values that mean nothing. */
  fte: number | null;
  /** Pay for THIS appointment alone. Callers differ on how they derive it (`actualPay` vs SQL). */
  pay: number;
  /** Snapshot date. The pre- and post-TTC twins share one, which is how a relabel is told apart from
   *  a title change. Optional: without it the snapshot ids' `-pre`/`-post` suffixes are used. */
  date?: string | null;
  /** Grade and its pay schedule, which decide whether a title change was a promotion. */
  grade?: number | null;
  gradeBasis?: string | null;
  /** `comp_basis`: a change across a basis or reporting change is not a change in pay. */
  basis?: string | null;
}

export type Raise =
  /** Matched to one prior appointment by department: a genuine per-appointment change. */
  | { kind: 'paired'; delta: number }
  /** Could not be matched one-to-one; `delta` spans the unmatched rows on both sides. */
  | { kind: 'combined'; delta: number; curCount: number; priorCount: number }
  /** A new appointment under a title the person already held — nothing to compare it to. */
  | { kind: 'newAppointment' }
  /**
   * The person's only appointment moved to a new job code. One row on each side cannot be anyone
   * else's, so the change is real and is reported — it used to be hidden behind a "promotion" badge
   * that went on every new job code, including the 3,316 of 8,879 that kept or lowered the grade.
   * `move` is "promotion" only when the grade rose within the same pay schedule. `delta` is null when
   * the basis or its reporting also changed, and `note` says which.
   */
  | { kind: 'titleChange'; delta: number | null; move: 'promotion' | 'title change'; note: string | null }
  /** No prior snapshot, no prior row under this title, or a prior pay of zero. */
  | { kind: 'none' };

/**
 * Half of `pct()`'s 0.1% step. Below this a change cannot be displayed at all, so it is reported as
 * no change rather than as a signed one — `salary_fte_adjusted` is populated in some snapshots and
 * null in others for the same appointment, and the `rate × fte` fallback lands cents away, which
 * rendered 867 unchanged salaries as pay CUTS ("−0.0%", in the decrease colour).
 */
/**
 * What one pass of the matcher learned about a person's history. `raises` is what the Raise column
 * renders; the other two are what lets the table draw the same appointment as the same line.
 */
export interface Matching<T> {
  /** Per-row change. */
  raises: Map<T, Raise>;
  /**
   * The previous snapshot's row that this row continues, where the matcher found one. Absent means
   * the appointment could not be followed — a new title, a new appointment, or a `combined` row the
   * source does not distinguish. The table draws that difference rather than implying continuity it
   * cannot support.
   */
  priorOf: Map<T, T>;
  /**
   * 1-based lane, held by the same appointment for as long as it can be followed. A row that
   * continues another inherits its lane; anything else takes the lowest lane free in its own
   * snapshot, so no two concurrent rows ever share one. A lane can be skipped (A and C, because B
   * ended) and can be reused later by an unrelated appointment — both are honest, and `laneStart` is
   * what says the lane starts over.
   */
  lane: Map<T, number>;
  /**
   * The rows that did NOT inherit their lane — the lane begins, or begins again, at this row.
   *
   * This is the fact the gutter draws a line's start from, and it is recorded here rather than
   * re-derived in the view as "has no `priorOf`". The two are equivalent on today's matcher, but
   * only via three separate invariants: two rows in a snapshot always hold distinct lanes, `matched`
   * blocks double-matching inside a job-code group, and a prior row belongs to exactly one such
   * group. Together those make the `used.has(inherited)` fallback below unreachable. If any of them
   * ever shifts, a row that took a fresh lane while holding a `priorOf` would quietly draw a
   * continuous line into whatever held its slot before — the one claim this module exists not to
   * make. Cheaper to return the fact than to keep the proof.
   */
  laneStart: Set<T>;
}

export const NEGLIGIBLE_CHANGE = 0.0005;

const snap = (d: number): number => (Math.abs(d) < NEGLIGIBLE_CHANGE ? 0 : d);

/**
 * The smallest appointment percentage that can identify an appointment.
 *
 * `fte = 0` is not a percentage. It means "no appointment percentage on file". The early workbooks
 * wrote the same thing as `fte = 0.00025`, **31,785 times across 10,406 people**, 85.4% of them with
 * `salary = 0`, on titles like "Honorary Associate/Fellow". The ETL now rewrites all but 42 of those to
 * 0 (`harmonizeHourly`), and the 42 it keeps are nominal titles. Matching on either value would pair
 * unrelated honorary appointments to each other on a shared magic number: it produced an "Emergency
 * Medicine" to "Social Work" pairing when this tier was first measured without the floor.
 */
export const MIN_TRACKABLE_FTE = 0.01;

/**
 * Display order for the appointments inside one snapshot.
 *
 * The table used to sort by snapshot date alone, so concurrent appointments came out in whatever
 * order the query returned — and **1,207 transitions across 678 people presented the same
 * appointments in a flipped order between one snapshot and the next**, which makes it impossible to
 * follow one appointment down the page. Ordering by the appointment's own size holds it in place:
 * measured over all 5,064 comparable transitions, this is stable in **5,020 of them (99.1%)**, and
 * the 44 exceptions are appointments whose FTE or pay genuinely crossed over.
 *
 * This is layout only. `matchAppointments` pairs on keys that are unique on both sides, so it never
 * depends on the order its rows arrive in, and sorting cannot change a reported figure.
 */
export function byAppointment<T>(get: (row: T) => ApptFields): (a: T, b: T) => number {
  return (a, b) => {
    const x = get(a);
    const y = get(b);
    return (
      (y.fte ?? 0) - (x.fte ?? 0) ||
      y.pay - x.pay ||
      (x.department ?? '').localeCompare(y.department ?? '') ||
      (x.jobCode ?? '').localeCompare(y.jobCode ?? '')
    );
  };
}

/**
 * Per-row change for a person's appointment history.
 *
 * `rows` must already be in the order the reader sees them — chronological, with the pre-TTC snapshot
 * ahead of the post-TTC one on their shared date (see `makeSnapshotComparator`). Snapshots are
 * compared to the caller's previous snapshot, not to a calendar date, so a person missing from a
 * snapshot is simply skipped rather than reported as a departure.
 *
 * Returns maps keyed by the caller's own row objects.
 */
export function matchAppointments<T>(rows: readonly T[], get: (row: T) => ApptFields): Matching<T> {
  const out = new Map<T, Raise>();
  const priorOf = new Map<T, T>();

  // Snapshots in the order supplied, each holding its rows grouped by job code.
  const order: string[] = [];
  const bySnapshot = new Map<string, Map<string, T[]>>();
  // The same rows again, ungrouped and in the order the caller will render them. Lanes are handed
  // out in reading order, and a row with no job code needs one too even though it can never pair.
  const shownBySnapshot = new Map<string, T[]>();
  for (const row of rows) {
    const f = get(row);
    let jobs = bySnapshot.get(f.snapshotId);
    if (!jobs) {
      jobs = new Map();
      bySnapshot.set(f.snapshotId, jobs);
      shownBySnapshot.set(f.snapshotId, []);
      order.push(f.snapshotId);
    }
    shownBySnapshot.get(f.snapshotId)!.push(row);
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
  const groupBy = (list: readonly T[], key: (row: T) => string | null): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const row of list) {
      const k = key(row);
      if (k == null) continue;
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
        priorOf.set(cur[0], pri[0]);
        out.set(
          cur[0],
          before > 0 ? { kind: 'paired', delta: snap((get(cur[0]).pay - before) / before) } : { kind: 'none' }
        );
        continue;
      }

      const matched = new Set<T>();
      let unpairedCur: T[] = [...cur];

      /**
       * Pair what `key` names uniquely on BOTH sides, and leave everything else to the next tier.
       * A key of `null` opts the row out of this tier entirely. Requiring uniqueness on both sides
       * is what keeps a tier from guessing: two rows sharing a key are never paired on it.
       */
      const pass = (key: (row: T) => string | null) => {
        const priLeft = pri.filter((row) => !matched.has(row));
        const here = groupBy(unpairedCur, key);
        const there = groupBy(priLeft, key);
        const still: T[] = [];
        for (const row of unpairedCur) {
          const k = key(row);
          const mine = k == null ? undefined : here.get(k);
          const theirs = k == null ? undefined : there.get(k);
          if (mine?.length !== 1 || theirs?.length !== 1) {
            still.push(row);
            continue;
          }
          const before = get(theirs[0]).pay;
          // Matched either way; a zero prior pay just leaves no ratio to report.
          matched.add(theirs[0]);
          priorOf.set(row, theirs[0]);
          out.set(
            row,
            before > 0 ? { kind: 'paired', delta: snap((get(row).pay - before) / before) } : { kind: 'none' }
          );
        }
        unpairedCur = still;
      };

      // Strongest key first. The department is what the source actually uses to distinguish a
      // person's concurrent appointments.
      pass(deptKey);
      // Then the appointment percentage, which survives a department being renamed — the case that
      // sent two correctly-tracked appointments to the combined fallback. Held out against the groups
      // the department already pairs, FTE picks the same partner 82 times out of 82; auditing all 373
      // pairings it adds, the cross-department ones read as renames ("Max Kade Inst" to "Max Kade
      // Institute") and produce ordinary raises rather than the wild ratios a mis-pairing would.
      // Deliberately NOT a school tier: that was measured too, and paired "Surgery" with "Medicine"
      // about as often as it caught a rename.
      pass((row) => {
        const { fte } = get(row);
        return fte != null && fte >= MIN_TRACKABLE_FTE ? `fte:${fte}` : null;
      });

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

    // One appointment on each side, under different job codes: the same job moved title. Every other
    // tier above keys on the job code, so this is the one case they leave as "none". Never across the
    // TTC twins — that is a relabel of everyone at once, not a move.
    if (i > 0) {
      const curShown = shownBySnapshot.get(order[i])!;
      const priShown = shownBySnapshot.get(order[i - 1])!;
      if (curShown.length === 1 && priShown.length === 1) {
        const fc = get(curShown[0]);
        const fp = get(priShown[0]);
        const ttcPair = fc.date != null && fp.date != null
          ? String(fc.date) === String(fp.date)
          : /-post$/.test(fc.snapshotId) && /-pre$/.test(fp.snapshotId);
        if (fc.jobCode != null && fp.jobCode != null && fc.jobCode !== fp.jobCode && !ttcPair) {
          out.set(curShown[0], titleChange(fp, fc));
        }
      }
    }
  }

  // Lanes, in reading order, one snapshot at a time. Two passes on purpose: an inherited lane is
  // claimed before any unmatched row is allowed to allocate, so a row that CAN be followed never has
  // its lane taken by one that cannot. A single pass down the rows would hand lane 1 to an unmatched
  // top row and then find the row below it inheriting the same 1.
  const lane = new Map<T, number>();
  const laneStart = new Set<T>();
  for (const id of order) {
    const shown = shownBySnapshot.get(id)!;
    const used = new Set<number>();
    for (const row of shown) {
      const prev = priorOf.get(row);
      const inherited = prev === undefined ? undefined : lane.get(prev);
      if (inherited === undefined || used.has(inherited)) continue;
      lane.set(row, inherited);
      used.add(inherited);
    }
    for (const row of shown) {
      if (lane.has(row)) continue;
      let n = 1;
      while (used.has(n)) n++;
      lane.set(row, n);
      used.add(n);
      // Allocated, not inherited: whatever this lane meant in the previous snapshot, it does not
      // mean it here.
      laneStart.add(row);
    }
  }

  return { raises: out, priorOf, lane, laneStart };
}

/** The change for a lone appointment that moved title — see the `titleChange` kind of `Raise`. */
export function titleChange(prior: ApptFields, cur: ApptFields): Extract<Raise, { kind: 'titleChange' }> {
  const reporting = reportingChange(prior.basis, cur.basis);
  const note = reporting ? reporting.note : !sameBasis(prior.basis, cur.basis) ? 'basis changed' : null;
  const delta = note != null || !(prior.pay > 0) ? null : snap((cur.pay - prior.pay) / prior.pay);
  const promoted =
    prior.grade != null && cur.grade != null &&
    (prior.gradeBasis ?? '').trim().toLowerCase() === (cur.gradeBasis ?? '').trim().toLowerCase() &&
    cur.grade > prior.grade;
  return { kind: 'titleChange', delta, move: promoted ? 'promotion' : 'title change', note };
}

/**
 * The label on a cell whose change spans appointments. Sized by the LARGER side: a lone row measured
 * against the two appointments that preceded it still covers both of them, and reporting its own
 * count read "across all 1".
 */
export function acrossLabel(curCount: number, priorCount: number): string {
  const n = Math.max(curCount, priorCount);
  return n === 2 ? 'across both' : `across all ${n}`;
}

/** The tooltip behind an "across both" cell. Reads correctly at any count, including one per side. */
export function combinedReason(curCount: number, priorCount: number): string {
  const appt = (n: number) => `${n} appointment${n === 1 ? '' : 's'}`;
  return (
    `${appt(curCount)} under this title here, ${appt(priorCount)} in the previous snapshot, and nothing ` +
    'in the source tells them apart — same department and same appointment percentage. The change is ' +
    'shown across them together rather than guessed at for each line.'
  );
}

/** How many lane colours the stylesheet defines; lanes past that cycle, and the letter disambiguates. */
const LANE_SLOTS = 4;

/** The lane's letter. Identity has to survive being read aloud, and colour alone would fail WCAG 1.4.1. */
export function laneLetter(lane: number): string {
  return String.fromCharCode(65 + ((lane - 1) % 26));
}

/** Which of the stylesheet's lane colours this lane takes. */
export function laneSlot(lane: number): number {
  return ((lane - 1) % LANE_SLOTS) + 1;
}

/**
 * The tooltip behind a lane letter. `tracked` is whether the matcher found this line in the previous
 * snapshot — the difference between a filled station and a dashed one, and the whole reason the line
 * is worth following when it is filled.
 */
export function laneReason(lane: number, count: number, tracked: boolean): string {
  // At one appointment the letter still names the line, but "A of 1" would read as a count.
  const which = count === 1
    ? `Appointment ${laneLetter(lane)}, the only one in this snapshot. `
    : `Appointment ${laneLetter(lane)} of ${count} in this snapshot. `;
  return (
    which +
    (tracked
      ? 'Followed from the same appointment in the previous snapshot.'
      : 'Nothing in the source connects this line to the previous snapshot, so its line starts here.')
  );
}

/** One appointment's vertical segment through one row of the table. */
export interface LaneSegment {
  /**
   * The lane the segment belongs to, which is also the slot it draws in. Keyed to the lane number
   * and never to the row's position: if slots were handed out in row order, then the moment an
   * appointment ended every line below it would jog sideways into the freed slot — the same
   * renumbering that made the old "1 of 2" badge useless. An ended appointment leaves its slot empty.
   */
  lane: number;
  /**
   * `full` runs the height of the row. `from-node` starts halfway down, at this row's station: the line
   * begins here and there is nothing above it to connect to.
   */
  draw: 'full' | 'from-node';
  /**
   * Whether the next row draws this lane too. A segment may only bridge the 1px row border when this
   * is true — bridging unconditionally paints a stub of a dead appointment into the snapshot below,
   * which is a continuity claim in miniature.
   */
  continues: boolean;
  /**
   * The appointment ends here: the next snapshot exists and does not hold this lane at all.
   *
   * Deliberately narrower than `!continues`, twice over. Every segment in the LAST snapshot also
   * fails to continue — but nothing has ended there; those are the appointments the person holds now
   * and the data simply stops at the most recent snapshot. And a lane that RESTARTS below also fails
   * to continue, yet "ended" is more than is known: at the Nov 2021 TTC boundary every job code was
   * renumbered, so the matcher loses every thread while the appointments themselves carry straight
   * on. That case is already said honestly by the dashed station on the row below — this line could
   * not be followed — and a terminus would upgrade it to a claim the source does not support.
   */
  ends: boolean;
}

/** What one row's gutter cell draws. */
export interface GutterCell {
  /** This row's own lane — which slot carries its station. */
  lane: number;
  /** Dashed station: this row did not inherit its lane, so its line starts here. */
  start: boolean;
  /** Every lane drawing something on this row, in slot order. Lanes drawing nothing are omitted. */
  segments: LaneSegment[];
}

export interface Gutter<T> {
  /** Per row. Empty when no snapshot in this history holds concurrent appointments. */
  byRow: Map<T, GutterCell>;
  /**
   * How many slots the gutter needs: the largest lane NUMBER anywhere in the history, not the
   * largest number of concurrent appointments. A line can only be followed down the page if it sits
   * at the same x on every row, so a lane 3 surviving alone still occupies slot 3.
   */
  slots: number;
}

/**
 * Lay out the lanes as parallel vertical tracks, one slot each, so a reader can follow one
 * appointment down the table instead of re-reading which line is which at every snapshot.
 *
 * Every row draws a segment for every lane alive in its own snapshot — that is what makes a line
 * continuous, since lane A is painted through lane B's rows as well. A lane absent from the next
 * snapshot simply stops at the group boundary.
 *
 * `rows` must be in the caller's display order; it is grouped by snapshot the way the table renders.
 */
export function laneGutter<T>(
  rows: readonly T[],
  snapshotOf: (row: T) => string,
  matching: Pick<Matching<T>, 'lane' | 'laneStart'>
): Gutter<T> {
  const byRow = new Map<T, GutterCell>();

  // Groups in display order.
  const groups: T[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && snapshotOf(last[0]) === snapshotOf(row)) last.push(row);
    else groups.push([row]);
  }

  // Nothing to tell apart anywhere in this history: no gutter, and the table renders exactly as it
  // did before lanes existed. That is most person pages.
  if (!groups.some((group) => group.length > 1)) return { byRow, slots: 0 };

  let slots = 0;
  // Per group: which row index each lane's node sits on, and whether that lane begins there.
  const plans = groups.map((group) => {
    const nodeAt = new Map<number, number>();
    const starts = new Set<number>();
    group.forEach((row, i) => {
      const lane = matching.lane.get(row);
      if (lane == null) return;
      nodeAt.set(lane, i);
      if (matching.laneStart.has(row)) starts.add(lane);
      slots = Math.max(slots, lane);
    });
    return { nodeAt, starts };
  });

  // Single-appointment snapshots inside a split history draw their one track too. The person still
  // holds that appointment; stopping the line at the last snapshot that happened to have two would
  // read as the appointment ending, and the collapse from two lines to one is worth seeing. The
  // LETTER is still gated on the snapshot holding more than one row — "appointment A of 1" says
  // nothing — which the caller decides.
  groups.forEach((group, g) => {
    const { nodeAt, starts } = plans[g];
    const lanes = [...nodeAt.keys()].sort((a, b) => a - b);

    group.forEach((row, i) => {
      const own = matching.lane.get(row);
      if (own == null) return;
      const segments: LaneSegment[] = [];
      for (const lane of lanes) {
        const at = nodeAt.get(lane)!;
        // A line only needs capping where it could otherwise be read as continuing across a snapshot
        // boundary. The FIRST group has no boundary above it, so capping there says nothing and only
        // leaves every split person's table starting on a row of stubs. Later restarts — the Nov 2021
        // TTC pair, where every job code was renumbered — keep their cap: there the break IS the
        // information.
        const capped = g > 0 && starts.has(lane);
        if (capped && i < at) continue;
        const next = plans[g + 1];
        const nextAt = next?.nodeAt.get(lane);
        // Inside a group the next row always draws the lanes this row draws. At the last row it
        // depends on the next snapshot — and a lane that RESTARTS there does not connect to this
        // one whatever its node index, so the segment must not bridge into it.
        const continues =
          i < group.length - 1 ? true : nextAt !== undefined && !next!.starts.has(lane);
        segments.push({
          lane,
          draw: capped && i === at ? 'from-node' : 'full',
          continues,
          // Absent below, not merely uncontinued. See the field's own note.
          ends: next !== undefined && nextAt === undefined && i === group.length - 1,
        });
      }
      byRow.set(row, { lane: own, start: matching.laneStart.has(row), segments });
    });
  });

  return { byRow, slots };
}
