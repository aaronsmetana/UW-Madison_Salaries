import { describe, it, expect } from 'vitest';
import { cohortDocLabel, cohortStats, caseStrength, deficitBadge, type CohortRow } from './model';

describe('cohortDocLabel', () => {
  it('renders document-facing (third-person) phrasing for every cohort mode', () => {
    const ctx = { school: 'School of Medicine and Public Health', grade: 27, tenureBand: 3 };
    expect(cohortDocLabel('all', ctx)).toBe('all UW–Madison employees with this title');
    expect(cohortDocLabel('school', ctx)).toBe('same-title peers in School of Medicine and Public Health');
    expect(cohortDocLabel('tenure', ctx)).toBe('same-title peers within ±3 years of tenure');
    expect(cohortDocLabel('grade', ctx)).toBe('employees in pay grade 27');
    expect(cohortDocLabel('curated', ctx)).toBe('the peers listed in this comparison');
  });
  it('falls back sensibly when context is missing', () => {
    expect(cohortDocLabel('school', {})).toBe('same-title peers in this school/division');
    expect(cohortDocLabel('grade', {})).toBe('employees in pay grade —');
    expect(cohortDocLabel('tenure', {})).toBe('same-title peers within ±3 years of tenure');
  });
});

describe('cohortStats percentile', () => {
  it('matches the shared "strictly below" definition used on the Person page', () => {
    // Peers at 90/100/110/120k; subject at 105k → 2 of the OTHER 4 people are strictly below 105k,
    // and with the subject folded in there are 4 "other" values relative to the subject (n=5, n-1=4).
    const rows: CohortRow[] = [90_000, 100_000, 110_000, 120_000].map((pay) => ({ pay, tenure: null }));
    const stats = cohortStats(rows, 105_000, null);
    expect(stats.percentile).toBe(50); // 2 of 4 peers below → 50%
  });
  it('returns null percentile with fewer than 2 total people', () => {
    expect(cohortStats([], 100_000, null).percentile).toBeNull();
  });
});

describe('deficitBadge', () => {
  it('labels a positive gap as a deficit and a negative gap as a weak case', () => {
    expect(deficitBadge(5000)?.tone).toBe('deficit');
    expect(deficitBadge(-5000)?.tone).toBe('surplus');
    expect(deficitBadge(0)?.tone).toBe('neutral');
    expect(deficitBadge(null)).toBeNull();
  });
});

describe('caseStrength', () => {
  it('sums weighted parts into a 0-100 score with the right label bands', () => {
    const weak = caseStrength({ gapToMed: null, med: null, invCount: 0, streakYears: 0, activeFactors: 0 });
    expect(weak.score).toBe(0);
    expect(weak.label).toBe('Developing');

    const strong = caseStrength({ gapToMed: 20_000, med: 100_000, invCount: 3, streakYears: 5, activeFactors: 3 });
    expect(strong.score).toBe(100);
    expect(strong.label).toBe('Strong');
  });
});
