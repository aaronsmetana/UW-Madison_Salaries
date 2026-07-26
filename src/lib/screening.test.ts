import { describe, it, expect } from 'vitest';
import { computeScreeningResults, type ScreeningSubject, type CohortMember, type PayPoint, type GradeBand } from './screening';

const noReal = (amount: number) => amount; // identity toReal for tests that don't exercise erosion

function subject(overrides: Partial<ScreeningSubject> = {}): ScreeningSubject {
  return {
    person_key: 'subj', name: 'Jordan Rivers', title: 'Senior Analyst', job_code: 'J1',
    school: 'College of Letters & Science', department: 'Statistics', pay: 60_000, tenure: 8,
    grade_number: 10, grade_basis: '12mo', comp_basis: '12 Month', flsa_status: 'Exempt',
    ...overrides,
  };
}

describe('computeScreeningResults', () => {
  it('flags a below-median, compressed subject with a meaningful score', () => {
    const cohortRows: CohortMember[] = [
      { person_key: 'p1', job_code: 'J1', comp_basis: '12 Month', pay: 78_000, tenure: 1 }, // distinctly junior, paid more
      { person_key: 'p2', job_code: 'J1', comp_basis: '12 Month', pay: 80_000, tenure: 2 },
      { person_key: 'p3', job_code: 'J1', comp_basis: '12 Month', pay: 90_000, tenure: 12 },
      { person_key: 'p4', job_code: 'J1', comp_basis: '12 Month', pay: 95_000, tenure: 15 },
    ];
    const results = computeScreeningResults({
      subjects: [subject()],
      cohortRows,
      payHistory: [],
      grades: [],
      minCohortN: 4,
      toReal: noReal,
    });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.tooFewPeers).toBe(false);
    expect(r.gapToMed).toBeGreaterThan(0); // below the cohort median
    expect(r.compressionCount).toBeGreaterThan(0); // p1/p2 are distinctly junior and paid more
    expect(r.score).toBeGreaterThan(0);
  });

  it('excludes the subject itself and mismatched pay-basis peers from its own cohort', () => {
    const cohortRows: CohortMember[] = [
      { person_key: 'subj', job_code: 'J1', comp_basis: '12 Month', pay: 60_000, tenure: 8 }, // self
      { person_key: 'p1', job_code: 'J1', comp_basis: '9 Month', pay: 200_000, tenure: 8 }, // different basis
      { person_key: 'p2', job_code: 'J1', comp_basis: '12 Month', pay: 62_000, tenure: 8 },
    ];
    const results = computeScreeningResults({
      subjects: [subject()],
      cohortRows,
      payHistory: [],
      grades: [],
      minCohortN: 1,
      toReal: noReal,
    });
    expect(results[0].cohortN).toBe(1); // only p2 counts
  });

  it('treats relabeled-equivalent pay bases (Annual ↔ 12 Month) as the same cohort', () => {
    const cohortRows: CohortMember[] = [
      { person_key: 'p1', job_code: 'J1', comp_basis: 'Annual', pay: 62_000, tenure: 8 }, // old label
      { person_key: 'p2', job_code: 'J1', comp_basis: '12 Month', pay: 63_000, tenure: 8 }, // new label
      { person_key: 'p3', job_code: 'J1', comp_basis: null, pay: 61_000, tenure: 8 }, // NULL-era, kept
    ];
    const results = computeScreeningResults({
      subjects: [subject({ comp_basis: '12 Month' })],
      cohortRows,
      payHistory: [],
      grades: [],
      minCohortN: 1,
      toReal: noReal,
    });
    expect(results[0].cohortN).toBe(3); // all three count as the same 12-month basis
  });

  it('marks tooFewPeers below the minimum and skips parity/compression scoring', () => {
    const cohortRows: CohortMember[] = [
      { person_key: 'p1', job_code: 'J1', comp_basis: '12 Month', pay: 90_000, tenure: 1 },
    ];
    const results = computeScreeningResults({
      subjects: [subject()],
      cohortRows,
      payHistory: [],
      grades: [],
      minCohortN: 4,
      toReal: noReal,
    });
    const r = results[0];
    expect(r.tooFewPeers).toBe(true);
    expect(r.percentile).toBeNull();
    expect(r.compressionCount).toBe(0);
  });

  it('flags below-market-floor pay against the grade band', () => {
    const grades: GradeBand[] = [{ grade: 10, basis: '12mo', min: 80_000, max: 120_000 }]; // mid=100k, 85% floor=85k
    const results = computeScreeningResults({
      subjects: [subject({ pay: 70_000 })], // compa = 0.70, well under 0.85
      cohortRows: [],
      payHistory: [],
      grades,
      minCohortN: 4,
      toReal: noReal,
    });
    expect(results[0].belowMarket).toBe(true);
    expect(results[0].marketCompa).toBeCloseTo(0.7, 2);
  });

  it('does not flag a subject within the market-competitive range', () => {
    const grades: GradeBand[] = [{ grade: 10, basis: '12mo', min: 80_000, max: 120_000 }];
    const results = computeScreeningResults({
      subjects: [subject({ pay: 100_000 })], // compa = 1.0
      cohortRows: [],
      payHistory: [],
      grades,
      minCohortN: 4,
      toReal: noReal,
    });
    expect(results[0].belowMarket).toBe(false);
  });

  it('flags real-dollar erosion when nominal pay rose but real pay fell', () => {
    const payHistory: PayPoint[] = [
      { person_key: 'subj', year: 2021, pay: 50_000 },
      { person_key: 'subj', year: 2026, pay: 54_000 }, // +8% nominal
    ];
    const toRealHalved = (amount: number, year: number) => (year === 2021 ? amount * 1.3 : amount); // heavy inflation since 2021
    const results = computeScreeningResults({
      subjects: [subject()],
      cohortRows: [],
      payHistory,
      grades: [],
      minCohortN: 4,
      toReal: toRealHalved,
    });
    expect(results[0].realErosion).toBe(true);
  });

  it('does not flag erosion with fewer than two pay-history points', () => {
    const results = computeScreeningResults({
      subjects: [subject()],
      cohortRows: [],
      payHistory: [{ person_key: 'subj', year: 2026, pay: 60_000 }],
      grades: [],
      minCohortN: 4,
      toReal: noReal,
    });
    expect(results[0].realErosion).toBe(false);
  });
});
