import { describe, it, expect } from 'vitest';
import { matchAppointments, byAppointment, acrossLabel, combinedReason, type ApptFields, type Raise } from './payHistory';

/**
 * Fixtures are real rows from `public/data/salaries.parquet`, not invented ones — the bug this module
 * fixes was a plausible-looking rule meeting data that did not match the shape it assumed.
 */
interface Row extends ApptFields {
  note?: string;
}
const get = (r: Row): ApptFields => r;
const run = (rows: Row[]) => matchAppointments(rows, get);

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
