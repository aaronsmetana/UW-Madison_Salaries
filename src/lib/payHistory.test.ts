import { describe, it, expect } from 'vitest';
import { matchAppointments, combinedReason, type ApptFields, type Raise } from './payHistory';

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

const lecturer = (snapshotId: string, school: string, department: string, pay: number): Row => ({
  snapshotId,
  jobCode: 'TL020',
  school,
  department,
  pay,
});

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

  it('refuses to pair different departments inside one school', () => {
    // The rejected second tier. Keyed on the school alone, this pairs "Surgery" with "Medicine" —
    // and across the dataset it did that about as often as it caught a genuine rename.
    const MED = 'School of Medicine and Public Health';
    const rows = [
      { ...lecturer('2022-03', MED, 'Surgery', 40000), jobCode: 'AN001' },
      { ...lecturer('2022-03', MED, 'Anesthesiology', 30000), jobCode: 'AN001' },
      { ...lecturer('2023-10', MED, 'Medicine', 44000), jobCode: 'AN001' },
      { ...lecturer('2023-10', MED, 'Anesthesiology', 31000), jobCode: 'AN001' },
    ];
    const m = run(rows);
    // Anesthesiology is unchanged, so it pairs on its own name.
    expect(delta(m.get(rows[3]))).toBe(3.3);
    // Medicine is not Surgery. Its figure is combined against the leftover, never called "paired".
    expect(m.get(rows[2])).toEqual({ kind: 'combined', delta: expect.closeTo(0.1, 6), curCount: 1, priorCount: 1 });
  });

  it('reports no change rather than Infinity when the prior pay is zero', () => {
    const rows = [
      lecturer('2022-03', L_AND_S, GERMAN, 0),
      lecturer('2023-10', L_AND_S, GERMAN, 40000),
    ];
    expect(run(rows).get(rows[1])).toEqual({ kind: 'none' });
  });

  it('reports no change for a row carrying no job code', () => {
    const rows = [{ snapshotId: '2022-03', jobCode: null, school: L_AND_S, department: GERMAN, pay: 40000 }];
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

describe('combinedReason', () => {
  it('reads correctly when a side holds one appointment', () => {
    expect(combinedReason(1, 2)).toContain('1 appointment here, 2 appointments before');
  });

  it('pluralises both sides', () => {
    expect(combinedReason(2, 2)).toContain('2 appointments here, 2 appointments before');
  });
});
