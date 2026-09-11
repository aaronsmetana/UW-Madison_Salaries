import { describe, it, expect } from 'vitest';
import {
  matchAppointments, byAppointment, acrossLabel, combinedReason, laneGutter, laneLetter, laneReason,
  laneSlot, type ApptFields, type Raise,
  titleEras,
  sameTitleText,
} from './payHistory';

/**
 * Fixtures are real rows from `public/data/salaries.parquet`, not invented ones — the bug this module
 * fixes was a plausible-looking rule meeting data that did not match the shape it assumed.
 */
interface Row extends ApptFields {
  note?: string;
}
const get = (r: Row): ApptFields => r;
/** Most tests only care about the reported change. `full` is for the lane and pairing maps. */
const run = (rows: Row[]) => matchAppointments(rows, get).raises;
const full = (rows: Row[]) => matchAppointments(rows, get);

const L_AND_S = 'College of Letters & Science';
const INTL = 'International Division';
const GERMAN = 'German, Nordic & Slavic';
const SLAVIC = 'CTR for Rus East Eur Cent Asia';

/** `fte` defaults to 0.5 so a fixture that says nothing about it cannot pair on it by accident. */
const lecturer = (
  snapshotId: string, school: string, department: string, pay: number, fte: number | null = 0.5,
): Row => ({ snapshotId, jobCode: 'TL020', school, department, fte, pay });

/** The reported page: two concurrent Lecturer appointments, both TL020. */
const glowacki = [
  lecturer('2021-11-post', L_AND_S, GERMAN, 40079),
  lecturer('2021-11-post', INTL, SLAVIC, 16650),
  lecturer('2022-03', L_AND_S, GERMAN, 40880),
  lecturer('2022-03', INTL, SLAVIC, 16983),
];

const delta = (r: Raise | undefined): number | null =>
  r && (r.kind === 'paired' || r.kind === 'combined') ? Number((r.delta * 100).toFixed(1)) : null;

describe('matchAppointments', () => {
  it('compares each appointment to its own department, not to the pair total', () => {
    const m = run(glowacki);
    // Both lines rose 2.0%. Dividing each by the $56,729 pair total gave -70.1% and -27.9%, which is
    // what the page reported before this module existed.
    expect(m.get(glowacki[2])).toEqual({ kind: 'paired', delta: expect.closeTo(0.01999, 4) });
    expect(delta(m.get(glowacki[2]))).toBe(2.0);
    expect(delta(m.get(glowacki[3]))).toBe(2.0);
  });

  it('leaves the first snapshot with nothing to compare against', () => {
    const m = run(glowacki);
    expect(m.get(glowacki[0])).toEqual({ kind: 'none' });
    expect(m.get(glowacki[1])).toEqual({ kind: 'none' });
  });

  it('tracks a rise in one appointment and a fall in the other independently', () => {
    // The whole point of pairing: a combined figure would average these into +1.2% and show it twice.
    const rows = [
      ...glowacki.slice(2),
      lecturer('2023-10', L_AND_S, GERMAN, 51100), // +25%
      lecturer('2023-10', INTL, SLAVIC, 12737), // -25%
    ];
    const m = run(rows);
    expect(delta(m.get(rows[2]))).toBe(25.0);
    expect(delta(m.get(rows[3]))).toBe(-25.0);
  });

  it('combines rows that share a department, because nothing distinguishes them', () => {
    // aaronenright, Apr 2024: two Information School Lecturer lines, same job code, same 0.334 FTE,
    // differing only in salary — and salary is the field that moves, so it identifies nothing.
    const rows = [
      lecturer('2023-10', 'Information School', 'Information School', 50000),
      lecturer('2024-04', 'Information School', 'Information School', 26159),
      lecturer('2024-04', 'Information School', 'Information School', 25153),
    ];
    const m = run(rows);
    const expected = { kind: 'combined', delta: expect.closeTo(0.02624, 4), curCount: 2, priorCount: 1 };
    expect(m.get(rows[1])).toEqual(expected);
    expect(m.get(rows[2])).toEqual(expected);
    // Both lines carry the same figure, and neither is ever labelled a per-appointment change.
    expect(m.get(rows[1])!.kind).not.toBe('paired');
  });

  it('divides a combined change by the unmatched remainder, not by the whole title', () => {
    // 92 of 986 split groups pair some rows and not others. Using the job-code total as the
    // denominator would count the already-paired $40,880 line twice.
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 40000),
      lecturer('2022-03', INTL, SLAVIC, 10000),
      lecturer('2023-10', L_AND_S, GERMAN, 44000), // pairs by department: +10%
      lecturer('2023-10', INTL, 'Regional Centers', 11000), // renamed: no match
      lecturer('2023-10', INTL, 'Regional Centers', 4000), // and a second unmatched line
    ];
    const m = run(rows);
    expect(delta(m.get(rows[2]))).toBe(10.0);
    // (11,000 + 4,000) / 10,000 - 1 = +50%. Against the group total it would read -25.5%.
    expect(m.get(rows[3])).toEqual({ kind: 'combined', delta: expect.closeTo(0.5, 6), curCount: 2, priorCount: 1 });
    expect(m.get(rows[4])).toEqual(m.get(rows[3]));
  });

  it('reads a dropped appointment as no change on the one that remains', () => {
    // Glowacki's Mar 2026: the second appointment ends. The surviving line's own pay did not move,
    // so it reads 0% — the summed denominator reported this as a 28.7% pay cut.
    const rows = [
      lecturer('2025-09', L_AND_S, GERMAN, 57356),
      lecturer('2025-09', INTL, 'Regional Centers', 23133),
      lecturer('2026-03', L_AND_S, GERMAN, 57356),
    ];
    const m = run(rows);
    expect(m.get(rows[2])).toEqual({ kind: 'paired', delta: 0 });
  });

  it('marks a genuinely new appointment rather than comparing it to something else', () => {
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 40000),
      lecturer('2023-10', L_AND_S, GERMAN, 42000),
      lecturer('2023-10', INTL, SLAVIC, 15000),
    ];
    const m = run(rows);
    expect(delta(m.get(rows[1]))).toBe(5.0);
    expect(m.get(rows[2])).toEqual({ kind: 'newAppointment' });
  });

  it('treats a change too small to display as no change, not as a cut', () => {
    // salary_fte_adjusted is populated in one snapshot and null in the next for the same appointment,
    // so actualPay falls back to rate x fte: 45,561 -> 68,307 x 0.667 = 45,560.77. That rendered as
    // "-0.0%" in the decrease colour on 867 cells across the app.
    const rows = [
      lecturer('2024-09', L_AND_S, GERMAN, 45561),
      lecturer('2025-04', L_AND_S, GERMAN, 45560.769),
    ];
    const m = run(rows);
    expect(m.get(rows[1])).toEqual({ kind: 'paired', delta: 0 });
    // Not merely small: exactly zero, so the caller's sign and colour tests cannot pick a direction.
    expect(Object.is((m.get(rows[1]) as { delta: number }).delta, -0)).toBe(false);
  });

  it('keeps a lone appointment paired when it changes department', () => {
    // 14,963 cells across 12,889 people are one appointment that moved or was renamed while keeping
    // its title. One row on each side is never ambiguous, so the department must not gate it — an
    // earlier draft matched by department first and demoted every one of these to "combined".
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 40000),
      lecturer('2023-10', INTL, 'Regional Centers', 44000),
    ];
    expect(run(rows).get(rows[1])).toEqual({ kind: 'paired', delta: expect.closeTo(0.1, 6) });
  });

  it('never pairs on the school alone', () => {
    // The rejected tier: keyed on the school, this pairs "Surgery" with "Medicine", which across the
    // dataset it did about as often as it caught a genuine rename. Sharing a school is not evidence,
    // so two rows that share ONLY a school must not pair even when one is left on each side.
    const MED = 'School of Medicine and Public Health';
    const rows = [
      { ...lecturer('2022-03', MED, 'Surgery', 40000, 0.7), jobCode: 'AN001' },
      { ...lecturer('2022-03', MED, 'Anesthesiology', 30000, 0.3), jobCode: 'AN001' },
      { ...lecturer('2023-10', MED, 'Medicine', 44000, 0.5), jobCode: 'AN001' },
      { ...lecturer('2023-10', MED, 'Anesthesiology', 31000, 0.3), jobCode: 'AN001' },
    ];
    const m = run(rows);
    // Anesthesiology is unchanged in both name and size, so it pairs on its own.
    expect(delta(m.get(rows[3]))).toBe(3.3);
    // Medicine shares neither a department nor an appointment percentage with Surgery.
    expect(m.get(rows[2])).toEqual({ kind: 'combined', delta: expect.closeTo(0.1, 6), curCount: 1, priorCount: 1 });
  });

  it('pairs through a department rename when the appointment percentage is unchanged', () => {
    // Glowacki's Sep 2025: the source renamed BOTH her departments in one snapshot, which sent two
    // correctly-tracked appointments to the combined fallback. Their FTEs never moved.
    const rows = [
      lecturer('2025-04', L_AND_S, GERMAN, 45561, 0.667),
      lecturer('2025-04', INTL, SLAVIC, 18376, 0.333),
      lecturer('2025-09', L_AND_S, 'German, Nordic, & Slavic', 57356, 0.667),
      lecturer('2025-09', INTL, 'Regional Centers', 23133, 0.333),
    ];
    const m = run(rows);
    expect(delta(m.get(rows[2]))).toBe(25.9);
    expect(delta(m.get(rows[3]))).toBe(25.9);
    expect(m.get(rows[2])!.kind).toBe('paired');
  });

  it('separates two appointments in the SAME department by their appointment percentage', () => {
    // adamtrunzo, OE009: two lines both in "Positive Yth Inst" at 0.4 and 0.6 FTE. The department
    // cannot tell them apart; the percentage can. 329 of the 335 FTE pairings discriminate like this
    // rather than merely pairing a last one standing.
    const YTH = 'Positive Yth Inst';
    const rows = [
      lecturer('2023-10', L_AND_S, YTH, 20000, 0.4),
      lecturer('2023-10', L_AND_S, YTH, 30000, 0.6),
      lecturer('2024-04', L_AND_S, YTH, 22000, 0.4), // +10%
      lecturer('2024-04', L_AND_S, YTH, 30900, 0.6), // +3%
    ];
    const m = run(rows);
    expect(delta(m.get(rows[2]))).toBe(10.0);
    expect(delta(m.get(rows[3]))).toBe(3.0);
  });

  it('does not match on an FTE that means "no percentage on file"', () => {
    // 0.00025 is a sentinel on 31,785 rows across 10,406 people — honorary and courtesy
    // appointments. Matching on it paired "Emergency Medicine" to "Social Work".
    for (const sentinel of [0.00025, 0, null]) {
      const rows = [
        lecturer('2023-10', L_AND_S, 'Emergency Medicine', 1000, sentinel),
        lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.5),
        lecturer('2024-04', L_AND_S, 'Social Work', 2000, sentinel),
        lecturer('2024-04', L_AND_S, GERMAN, 41000, 0.5),
      ];
      const m = run(rows);
      expect(delta(m.get(rows[3])), `FTE ${sentinel}: the real appointment still pairs`).toBe(2.5);
      expect(m.get(rows[2])!.kind, `FTE ${sentinel} must not identify an appointment`).not.toBe('paired');
    }
  });

  it('lets the department win over a conflicting appointment percentage', () => {
    // Both lines kept their department but swapped which one is larger. The department is the
    // stronger key, so it decides and the FTE tier never runs.
    const rows = [
      lecturer('2023-10', L_AND_S, GERMAN, 30000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.4),
      lecturer('2024-04', L_AND_S, GERMAN, 21000, 0.4),
      lecturer('2024-04', INTL, SLAVIC, 31500, 0.6),
    ];
    const m = run(rows);
    expect(delta(m.get(rows[2]))).toBe(-30.0); // German to German, not German to Slavic
    expect(delta(m.get(rows[3]))).toBe(57.5);
  });

  it('reports no change rather than Infinity when the prior pay is zero', () => {
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 0),
      lecturer('2023-10', L_AND_S, GERMAN, 40000),
    ];
    expect(run(rows).get(rows[1])).toEqual({ kind: 'none' });
  });

  it('reports no change for a row carrying no job code', () => {
    const rows = [{ snapshotId: '2022-03', jobCode: null, school: L_AND_S, department: GERMAN, fte: 1, pay: 40000 }];
    expect(run(rows).get(rows[0])).toEqual({ kind: 'none' });
  });

  it('compares against the previous snapshot present, not a fixed cadence', () => {
    // A person absent from a snapshot must not be reported as a departure and a re-hire.
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 40000),
      lecturer('2025-09', L_AND_S, GERMAN, 44000),
    ];
    expect(delta(run(rows).get(rows[1]))).toBe(10.0);
  });

  it('keeps titles apart: two job codes in one snapshot never compare to each other', () => {
    const rows = [
      { ...lecturer('2021-11-pre', L_AND_S, GERMAN, 40079), jobCode: 'D80BN' },
      { ...lecturer('2021-11-post', L_AND_S, GERMAN, 40079), jobCode: 'TL020' },
    ];
    // The TTC reclassification: a different code, so there is nothing to compare — the caller badges
    // it "Reclassified (TTC)" instead.
    expect(run(rows).get(rows[1])).toEqual({ kind: 'none' });
  });
});

describe('byAppointment', () => {
  const order = (rows: Row[]) => [...rows].sort(byAppointment(get)).map((r) => r.department);

  it('holds a person\u2019s appointments in the same order across every snapshot', () => {
    // The table sorted by snapshot date alone, so concurrent rows came out in query order and the
    // 0.667 line was second in Mar 2022 and first in Sep 2024. 1,207 transitions across 678 people
    // flipped like that, and an appointment you cannot follow down the page cannot be tracked.
    const snapshots = [
      [lecturer('2022-03', INTL, SLAVIC, 16983, 0.333), lecturer('2022-03', L_AND_S, GERMAN, 40880, 0.667)],
      [lecturer('2023-10', L_AND_S, GERMAN, 42949, 0.667), lecturer('2023-10', INTL, SLAVIC, 17323, 0.333)],
      // Apr 2024: the German line rises to a full appointment. It must stay first, not jump.
      [lecturer('2024-04', INTL, SLAVIC, 18016, 0.333), lecturer('2024-04', L_AND_S, GERMAN, 66968, 1)],
      [lecturer('2024-09', L_AND_S, GERMAN, 45561, 0.667), lecturer('2024-09', INTL, SLAVIC, 18376, 0.333)],
    ];
    for (const snap of snapshots) {
      expect(order(snap), `input order ${snap.map((r) => r.department).join(' then ')}`)
        .toEqual([GERMAN, SLAVIC]);
    }
  });

  it('is a total order, so equal appointments never shuffle between renders', () => {
    // Same FTE and same pay: without the department and job-code tie-breaks the comparator returns 0
    // and the rows keep whatever order they arrived in, which is the bug this replaces.
    const a = { ...lecturer('2024-04', L_AND_S, 'Alpha', 30000, 0.5), jobCode: 'AA001' };
    const b = { ...lecturer('2024-04', L_AND_S, 'Beta', 30000, 0.5), jobCode: 'BB001' };
    expect(order([a, b])).toEqual(['Alpha', 'Beta']);
    expect(order([b, a])).toEqual(['Alpha', 'Beta']);
  });

  it('sorts an unrecorded appointment percentage last rather than first', () => {
    const real = lecturer('2024-04', L_AND_S, GERMAN, 40000, 0.667);
    const honorary = lecturer('2024-04', L_AND_S, 'Honorary', 0, null);
    expect(order([honorary, real])).toEqual([GERMAN, 'Honorary']);
  });
});

describe('matchAppointments is independent of row order within a snapshot', () => {
  it('reports the same figures however the rows arrive', () => {
    // The display sort must be able to reorder rows freely: it changes layout, never a number.
    const build = (flip: boolean) => {
      const s1 = [lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6), lecturer('2023-10', INTL, SLAVIC, 10000, 0.4)];
      const s2 = [lecturer('2024-04', L_AND_S, GERMAN, 44000, 0.6), lecturer('2024-04', INTL, SLAVIC, 11000, 0.4)];
      return [...(flip ? [...s1].reverse() : s1), ...(flip ? [...s2].reverse() : s2)];
    };
    const readOff = (rows: Row[]) => {
      const m = run(rows);
      return rows.map((r) => `${r.department}:${JSON.stringify(m.get(r))}`).sort();
    };
    expect(readOff(build(false))).toEqual(readOff(build(true)));
  });
});

describe('combinedReason', () => {
  it('reads correctly when a side holds one appointment', () => {
    expect(combinedReason(1, 2)).toContain('1 appointment under this title here, 2 appointments in the previous');
  });

  it('pluralises both sides', () => {
    expect(combinedReason(2, 2)).toContain('2 appointments under this title here, 2 appointments in the previous');
  });
});

describe('acrossLabel', () => {
  it('says "both" whichever side holds the two appointments', () => {
    expect(acrossLabel(2, 2)).toBe('across both');
    expect(acrossLabel(2, 1)).toBe('across both');
    // One row measured against the two that preceded it still spans both of them. Sizing the label
    // by its own side printed "across all 1" on a real page.
    expect(acrossLabel(1, 2)).toBe('across both');
  });

  it('counts up past two', () => {
    expect(acrossLabel(3, 1)).toBe('across all 3');
    expect(acrossLabel(1, 4)).toBe('across all 4');
  });
});

/**
 * The lane is what lets a reader follow one appointment down the page. It is derived from the
 * matching, not from the row's position: `1 of 2` was positional, so it renumbered whenever an
 * appointment ended (2,415 many-to-one transitions across the data) and could swap when two
 * appointments crossed over in size.
 */
describe('appointment lanes', () => {
  const other = (snapshotId: string, jobCode: string, department: string, pay: number, fte: number): Row => ({
    snapshotId, jobCode, school: L_AND_S, department, fte, pay,
  });

  it('holds one lane for an appointment that can be followed', () => {
    const { lane } = full(glowacki);
    expect(lane.get(glowacki[2])).toBe(lane.get(glowacki[0]));
    expect(lane.get(glowacki[3])).toBe(lane.get(glowacki[1]));
    expect(lane.get(glowacki[0])).not.toBe(lane.get(glowacki[1]));
  });

  it('never gives two concurrent rows the same lane', () => {
    const rows = [
      ...glowacki,
      other('2022-03', 'AD006', 'Language Institute', 0, 0.00025),
      other('2022-03', 'RE015', 'Institute on Aging', 30000, 0.5),
    ];
    const { lane } = full(rows);
    const here = rows.filter((r) => r.snapshotId === '2022-03').map((r) => lane.get(r));
    expect(new Set(here).size).toBe(here.length);
    expect(here.every((n) => n !== undefined)).toBe(true);
  });

  it('gives a lane to a row with no job code, which can never pair', () => {
    const rows = [lecturer('2024-04', L_AND_S, GERMAN, 40000, 0.6), { ...other('2024-04', 'X', 'Medicine', 1000, 0.1), jobCode: null }];
    const { lane, priorOf } = full(rows);
    expect(lane.get(rows[1])).toBeDefined();
    expect(lane.get(rows[1])).not.toBe(lane.get(rows[0]));
    expect(priorOf.has(rows[1])).toBe(false);
  });

  /**
   * The two-pass allocation, and the reason for it. A new appointment can arrive ABOVE a continuing
   * one — `byAppointment` sorts on size, and a new appointment is often the larger. Allocating in
   * reading order would hand it lane 1 and leave the appointment that has held lane 1 all along to
   * collide with it.
   */
  it('lets a continuing appointment keep its lane against a larger new one', () => {
    const held = lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6);
    const stillHeld = lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6);
    const arrived = other('2024-04', 'RE015', 'Institute on Aging', 90000, 0.9);
    const { lane } = full([held, arrived, stillHeld]);
    expect(lane.get(held)).toBe(1);
    expect(lane.get(stillHeld)).toBe(1);
    expect(lane.get(arrived)).toBe(2);
  });

  it('keeps the survivors in place when an appointment ends', () => {
    const s1 = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      other('2023-10', 'AD006', 'Language Institute', 0, 0.00025),
    ];
    const s2 = [
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
      other('2024-04', 'AD006', 'Language Institute', 0, 0.00025),
    ];
    const { lane } = full([...s1, ...s2]);
    expect([lane.get(s1[0]), lane.get(s1[1]), lane.get(s1[2])]).toEqual([1, 2, 3]);
    // The middle lane ends. The other two hold their own rather than shuffling up into the gap, so
    // the reader's eye stays on the line it was following.
    expect(lane.get(s2[0])).toBe(1);
    expect(lane.get(s2[1])).toBe(3);
  });

  it('reports no partner for rows the source cannot tell apart', () => {
    // Same department, same job code, same appointment percentage: nothing but salary separates
    // them, and salary is the field that moves. This is the `combined` case, and the table draws its
    // lane dotted precisely because the lane here is position, not evidence.
    const s1 = [lecturer('2023-10', L_AND_S, GERMAN, 30000), lecturer('2023-10', L_AND_S, GERMAN, 20000)];
    const s2 = [lecturer('2024-04', L_AND_S, GERMAN, 31000), lecturer('2024-04', L_AND_S, GERMAN, 21000)];
    const { raises, priorOf, lane } = full([...s1, ...s2]);
    expect(raises.get(s2[0])?.kind).toBe('combined');
    expect(priorOf.has(s2[0])).toBe(false);
    expect(priorOf.has(s2[1])).toBe(false);
    // Still laned, so the two lines are still distinguishable within the snapshot.
    expect(new Set([lane.get(s2[0]), lane.get(s2[1])]).size).toBe(2);
  });

  it('records the partner even when a zero prior pay leaves no ratio to report', () => {
    const before = lecturer('2023-10', L_AND_S, GERMAN, 0, 0.6);
    const after = lecturer('2024-04', L_AND_S, GERMAN, 50000, 0.6);
    const { raises, priorOf, lane } = full([before, after]);
    // The appointment was identified; only the percentage is missing. A dotted rail here would say
    // the opposite.
    expect(raises.get(after)).toEqual({ kind: 'none' });
    expect(priorOf.get(after)).toBe(before);
    expect(lane.get(after)).toBe(lane.get(before));
  });
});

describe('lane labelling', () => {
  it('letters lanes from A and cycles the four rail colours', () => {
    expect([1, 2, 3, 4, 5].map(laneLetter)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect([1, 2, 3, 4, 5, 8].map(laneSlot)).toEqual([1, 2, 3, 4, 1, 4]);
  });

  it('says whether the lane was followed or starts here', () => {
    expect(laneReason(1, 2, true)).toBe(
      'Appointment A of 2 in this snapshot. Followed from the same appointment in the previous snapshot.'
    );
    expect(laneReason(2, 3, false)).toContain('so its line starts here');
  });

  // Every row of a split history is lettered now, including a snapshot that holds only one line, and
  // "A of 1" reads as a count rather than a name.
  it('names a lone appointment without counting it', () => {
    const text = laneReason(1, 1, true);
    expect(text).toContain('Appointment A, the only one in this snapshot.');
    expect(text).not.toMatch(/of 1\b/);
    expect(text).toContain('Followed from the same appointment');
  });
});

/**
 * The gutter turns the lanes into parallel vertical tracks. Each test below owns ONE rule, and each
 * selects its rows without using the property another test verifies — a guard whose subject is
 * chosen by the thing its neighbour checks is not a second guard, it is the same one twice.
 */
describe('lane gutter', () => {
  const other = (snapshotId: string, jobCode: string, department: string, pay: number, fte: number): Row => ({
    snapshotId, jobCode, school: L_AND_S, department, fte, pay,
  });
  const gutter = (rows: Row[]) => laneGutter(rows, (r) => r.snapshotId, matchAppointments(rows, get));
  /** The slots a row draws, in order — the shape every assertion here is written against. */
  const drawn = (g: ReturnType<typeof gutter>, row: Row) =>
    (g.byRow.get(row)?.segments ?? []).map((sg) => `${sg.lane}:${sg.draw}`);

  it('renders no gutter at all for a history that never holds two appointments at once', () => {
    const solo = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
    ];
    const g = gutter(solo);
    expect(g.slots).toBe(0);
    expect([...g.byRow.keys()]).toEqual([]);
  });

  /**
   * Rule 1, and the whole reason a slot is keyed to the lane NUMBER. Lane 2 ends; lane 3 must stay in
   * slot 3. Keying slots to the row's position would slide it into slot 2 and the line a reader was
   * following would jog sideways — the renumbering that made "1 of 2" useless in the first place.
   */
  it('leaves an ended appointment\'s slot empty instead of shifting the survivor left', () => {
    const rows = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      other('2023-10', 'AD006', 'Language Institute', 0, 0.00025),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
      other('2024-04', 'AD006', 'Language Institute', 0, 0.00025),
    ];
    const g = gutter(rows);
    expect(drawn(g, rows[3])).toEqual(['1:full', '3:full']);
    expect(drawn(g, rows[4])).toEqual(['1:full', '3:full']);
  });

  it('sizes the gutter by the largest lane number, not the most appointments at once', () => {
    const rows = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      other('2023-10', 'AD006', 'Language Institute', 0, 0.00025),
      other('2024-04', 'AD006', 'Language Institute', 0, 0.00025),
    ];
    // One row in the last snapshot, but it is lane 3 and has to draw in slot 3.
    expect(gutter(rows).slots).toBe(3);
  });

  it('draws a line the matcher followed at full height through every row of the snapshot', () => {
    const g = gutter(glowacki);
    expect(drawn(g, glowacki[2])).toEqual(['1:full', '2:full']);
    expect(drawn(g, glowacki[3])).toEqual(['1:full', '2:full']);
  });

  /**
   * Rule 3. `pre` and `post` share no job code, so nothing pairs across them and every lane in `post`
   * restarts — the Nov 2021 TTC boundary. Lane 2's line must begin at its own row and draw NOTHING on
   * the row above it, where it would otherwise imply a continuity the matcher refused.
   */
  it('starts a restarted line at its own row, with nothing above it', () => {
    const rows = [
      lecturer('2021-11-pre', L_AND_S, GERMAN, 40079),
      lecturer('2021-11-pre', INTL, SLAVIC, 16650),
      other('2021-11-post', 'TL999', GERMAN, 40079, 0.5),
      other('2021-11-post', 'TL999', SLAVIC, 16650, 0.3),
    ];
    const g = gutter(rows);
    expect(drawn(g, rows[2])).toEqual(['1:from-node']);
    expect(drawn(g, rows[3])).toEqual(['1:full', '2:from-node']);
  });

  /**
   * Rule 3b. The same restart, one snapshot earlier, carries no information: there is nothing above
   * the first group for a line to be read as continuing from. Both halves live in ONE test so the
   * exemption cannot quietly widen to later groups without failing here.
   */
  it('exempts only the first snapshot from capping, not every all-new one', () => {
    const rows = [
      lecturer('2021-11-pre', L_AND_S, GERMAN, 40079),
      lecturer('2021-11-pre', INTL, SLAVIC, 16650),
      other('2021-11-post', 'TL999', GERMAN, 40079, 0.5),
      other('2021-11-post', 'TL999', SLAVIC, 16650, 0.3),
    ];
    const g = gutter(rows);
    // First group: full height even though both lines start here.
    expect(drawn(g, rows[0])).toEqual(['1:full', '2:full']);
    expect(drawn(g, rows[1])).toEqual(['1:full', '2:full']);
    // Second group: capped, because there the break is the information.
    expect(g.byRow.get(rows[3])?.segments.map((sg) => sg.draw)).toEqual(['full', 'from-node']);
  });

  /** Rule 2's bridging flag: a segment may only cross the row border into a line that continues. */
  it('stops a segment bridging where its appointment ends or restarts below', () => {
    const rows = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
      other('2024-04', 'RE015', 'Institute on Aging', 90000, 0.9),
    ];
    const g = gutter(rows);
    const last = (row: Row) =>
      Object.fromEntries((g.byRow.get(row)?.segments ?? []).map((sg) => [sg.lane, sg.continues]));
    // Bottom of the first snapshot: lane 1 carries on below, lane 2's appointment does not — the
    // 0.3 FTE Slavic line ends and lane 2 is re-used by a brand new appointment.
    expect(last(rows[1])).toEqual({ 1: true, 2: false });
    // Inside a snapshot the row below always draws the same lanes.
    expect(last(rows[0])).toEqual({ 1: true, 2: true });
    // Last row of the table: nothing below it at all.
    expect(last(rows[3])).toEqual({ 1: false, 2: false });

    // The other half of the rule, and the one a sabotage slipped past when this guard only covered
    // the restart branch: a lane that simply ENDS. Nothing below draws lane 2 at all, so the segment
    // above it must not bridge into the snapshot below either.
    const ends = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
    ];
    const ge = gutter(ends);
    expect(
      Object.fromEntries((ge.byRow.get(ends[1])?.segments ?? []).map((sg) => [sg.lane, sg.continues]))
    ).toEqual({ 1: true, 2: false });
  });

  /**
   * `ends` is NOT `!continues`, and this covers both branches in one test so a sabotage cannot pass
   * by satisfying the easy half. A lane the history carries on without has ended; a lane still held
   * in the final snapshot has not, however abruptly the table stops.
   */
  it('marks only an appointment the next snapshot does not hold', () => {
    const ends = (g: ReturnType<typeof gutter>, row: Row) =>
      Object.fromEntries((g.byRow.get(row)?.segments ?? []).map((sg) => [sg.lane, sg.ends]));

    // (a) Gone below, and the history carries on: ended.
    const gone = gutter([
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
    ]);
    expect(ends(gone, gone && [...gone.byRow.keys()][1])).toEqual({ 1: false, 2: true });

    // (b) A different appointment takes the lane below. The run stops — `continues` is false — but
    // "ended" is more than is known, and the dashed station below already says the line could not be
    // followed. This is the TTC boundary's shape, where nothing ends and everything is renumbered.
    const restart = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
      other('2024-04', 'RE015', 'Institute on Aging', 90000, 0.9),
    ];
    const gr = gutter(restart);
    expect(ends(gr, restart[1])).toEqual({ 1: false, 2: false });
    expect(
      (gr.byRow.get(restart[1])?.segments ?? []).map((sg) => sg.continues),
      'lane 2 must still report no continuation here — ends is narrower than !continues, not equal'
    ).toEqual([true, false]);

    // (c) The final snapshot: fails to continue, has not ended — the person holds these now.
    expect(ends(gr, restart[3])).toEqual({ 1: false, 2: false });
  });

  it('keeps drawing the line through a snapshot where only one appointment is left', () => {
    const rows = [
      lecturer('2023-10', L_AND_S, GERMAN, 40000, 0.6),
      lecturer('2023-10', INTL, SLAVIC, 20000, 0.3),
      lecturer('2024-04', L_AND_S, GERMAN, 42000, 0.6),
    ];
    const g = gutter(rows);
    expect(drawn(g, rows[2])).toEqual(['1:full']);
    expect(g.byRow.get(rows[2])?.start).toBe(false);
  });

  /**
   * `laneStart` is the fact the cap is drawn from, and `!priorOf` is what the view used to infer it
   * from. They agree on today's matcher only because its `used.has(inherited)` fallback is
   * unreachable. Assert the equivalence here, so that if it ever stops holding it fails in one
   * obvious place rather than as a wrong line on a page.
   */
  it('marks exactly the rows that could not be followed as starting a line', () => {
    const rows = [
      ...glowacki,
      other('2022-08', 'AD006', 'Language Institute', 0, 0.00025),
      lecturer('2022-08', L_AND_S, GERMAN, 40880),
      lecturer('2022-08', INTL, SLAVIC, 16983),
    ];
    const m = matchAppointments(rows, get);
    expect(rows.filter((r) => m.laneStart.has(r))).toEqual(rows.filter((r) => !m.priorOf.has(r)));
  });
});

describe('a lone appointment that moves title', () => {
  // The subject of the page this came from: IT Professional III (grade 20) to System Engineer IV
  // (grade 27), +17.4%, with one appointment on each side.
  const before = { snapshotId: '2022-03', date: '2022-03-01', jobCode: 'IT082', school: 'SMPH', department: 'Neurology', fte: 1, pay: 73682, grade: 20, gradeBasis: 'Madison 12 Month', basis: null };
  const after = { ...before, snapshotId: '2022-08', date: '2022-08-01', jobCode: 'IT040', pay: 86496, grade: 27 };

  it('reports the change and calls a grade rise in the same schedule a promotion', () => {
    const r = run([before, after]).get(after);
    expect(r).toMatchObject({ kind: 'titleChange', move: 'promotion', note: null });
    expect((r as Extract<Raise, { kind: 'titleChange' }>).delta).toBeCloseTo(86496 / 73682 - 1, 6);
  });

  it('calls it a title change when the grade stayed or fell', () => {
    const same = { ...after, grade: 20 };
    expect(run([before, same]).get(same)).toMatchObject({ move: 'title change' });
    const down = { ...after, grade: 18 };
    expect(run([before, down]).get(down)).toMatchObject({ move: 'title change' });
  });

  it('does not compare grade numbers across pay schedules', () => {
    const other = { ...after, grade: 80, gradeBasis: 'Madison 9 Month' };
    expect(run([before, other]).get(other)).toMatchObject({ move: 'title change' });
  });

  it('draws no figure across the 9-month reporting change, and says why', () => {
    const a = { ...before, basis: 'Academic' };
    const b = { ...after, basis: '9 Month', pay: before.pay * (11 / 9) * 1.03 };
    expect(run([a, b]).get(b)).toMatchObject({ kind: 'titleChange', delta: null, note: '9-month pay reported differently' });
  });

  it('is only for one appointment on each side', () => {
    const second = { ...before, jobCode: 'IT099', department: 'Pediatrics', pay: 20000 };
    expect(run([before, second, after]).get(after)).toEqual({ kind: 'none' });
  });

  it('never pairs the TTC twins, which share a date', () => {
    const pre = { ...before, snapshotId: '2021-11-pre', date: '2021-11-01' };
    const post = { ...after, snapshotId: '2021-11-post', date: '2021-11-01', pay: pre.pay };
    expect(run([pre, post]).get(post)).toEqual({ kind: 'none' });
  });

  it('claims no continuity: the lane still starts over at a new title', () => {
    const { priorOf } = full([before, after]);
    expect(priorOf.has(after)).toBe(false);
  });
});

describe('titleEras', () => {
  const row = (id: string, job_code: string, title: string) => ({ id, job_code, title });
  it('keeps one era across a relabel that only re-spells the title', () => {
    expect(titleEras([row('2021-11-pre', 'A0301', 'ASSOCIATE PROFESSOR'), row('2021-11-post', 'FA030', 'Associate Professor'), row('2022-03', 'FA030', 'Associate Professor')]))
      .toEqual([0, 0, 0]);
  });
  it('starts one at a relabel that changes the title, and at any later change of code', () => {
    expect(titleEras([row('2021-11-pre', 'S44DN', 'INFORM PROCESS CONSLT'), row('2021-11-post', 'IT082', 'IT Professional III'), row('2022-08', 'IT040', 'System Engineer IV')]))
      .toEqual([0, 1, 2]);
    // Outside the relabel a new code is a new era, even with the same words.
    expect(titleEras([row('2024-04', 'FA030', 'Associate Professor'), row('2024-09', 'FA031', 'Associate Professor')])).toEqual([0, 1]);
  });
});

describe('sameTitleText', () => {
  it('ignores case and spacing only', () => {
    expect(sameTitleText('ASSOCIATE  PROFESSOR ', 'Associate Professor')).toBe(true);
    expect(sameTitleText('Associate Professor', 'Assistant Professor')).toBe(false);
    expect(sameTitleText(null, 'Associate Professor')).toBe(false);
  });
});
