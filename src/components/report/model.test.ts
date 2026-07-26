import { describe, it, expect } from 'vitest';
import { cohortDocLabel, cohortStats, caseStrength, deficitBadge, defaultConfig, migrateConfig, buildSupervisoryCase, buildGuidelineCompression, fmtYearsToParity, type CohortRow } from './model';

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
  it('also reports the full quartile spread (min/p25/max) for the market-standing distribution bar', () => {
    const rows: CohortRow[] = [90_000, 100_000, 110_000, 120_000].map((pay) => ({ pay, tenure: null }));
    const stats = cohortStats(rows, 105_000, null);
    expect(stats.min).toBe(90_000);
    expect(stats.max).toBe(120_000);
    expect(stats.p25).not.toBeNull();
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

describe('defaultConfig', () => {
  it('does not enable the retention/replacement-cost section by default', () => {
    expect(defaultConfig().sections).not.toContain('risk');
  });
  it('enables the market-standing section by default', () => {
    expect(defaultConfig().sections).toContain('standing');
  });
  it('enables the UW-guideline-basis section by default', () => {
    expect(defaultConfig().sections).toContain('guidelineBasis');
  });
});

describe('migrateConfig', () => {
  it('returns fresh defaults for garbage input', () => {
    expect(migrateConfig(null)).toEqual(defaultConfig());
    expect(migrateConfig(undefined)).toEqual(defaultConfig());
    expect(migrateConfig('nope')).toEqual(defaultConfig());
  });
  it('strips a pre-v1 config\'s retention section (it was on by an old default, not a choice) and backfills market-standing', () => {
    const legacy = { sections: ['highlights', 'factors', 'peers', 'history', 'risk'] };
    const migrated = migrateConfig(legacy);
    expect(migrated.sections).not.toContain('risk');
    expect(migrated.sections).toContain('standing');
  });
  it('preserves the user\'s own edits (custom factors, cohort choice) through migration', () => {
    const legacy = {
      cohort: 'grade',
      customFactors: [{ id: 'custom-1', label: 'Led the migration', amount: 5000, note: 'Q1 2026' }],
      sections: ['highlights', 'peers'],
    };
    const migrated = migrateConfig(legacy);
    expect(migrated.cohort).toBe('grade');
    expect(migrated.customFactors).toEqual(legacy.customFactors);
  });
  it('is idempotent at the current version — a current config with retention deliberately re-enabled keeps it', () => {
    const current = { ...defaultConfig(), sections: [...defaultConfig().sections, 'risk'] };
    const migrated = migrateConfig(current);
    expect(migrated.sections).toContain('risk');
  });
  it('backfills the guideline-basis section for a v1 config once, preserving its other section edits', () => {
    const v1 = { configVersion: 1, sections: ['highlights', 'peers'], supervisorTarget: true };
    const migrated = migrateConfig(v1);
    expect(migrated.sections).toContain('guidelineBasis');
    expect(migrated.sections).toContain('peers');
    expect(migrated.supervisorTarget).toBe(true); // a real user choice survives
    expect(migrated.marketFloorTarget).toBe(false); // new field backfills to opt-out
  });
  it('respects a deliberate removal of the guideline-basis section at the current version', () => {
    const current = { ...defaultConfig(), sections: defaultConfig().sections.filter((s) => s !== 'guidelineBasis') };
    const migrated = migrateConfig(current);
    expect(migrated.sections).not.toContain('guidelineBasis');
  });
});

describe('buildSupervisoryCase', () => {
  it('returns an empty case with no subject pay or no named reports', () => {
    expect(buildSupervisoryCase(null, [{ key: 'a', name: 'A', pay: 100_000 }])).toEqual({ reports: [], invertedCount: 0, top: null, target15: null });
    expect(buildSupervisoryCase(100_000, [])).toEqual({ reports: [], invertedCount: 0, top: null, target15: null });
  });
  it('flags inversions, computes the guideline differential, and picks the highest-paid report as the 15% target base', () => {
    const c = buildSupervisoryCase(100_000, [
      { key: 'a', name: 'Above', pay: 115_000 },
      { key: 'b', name: 'Below', pay: 90_000 },
    ]);
    expect(c.invertedCount).toBe(1);
    const above = c.reports.find((r) => r.key === 'a')!;
    expect(above.inverted).toBe(true);
    expect(above.differential).toBeCloseTo(0.15, 5);
    expect(above.belowFloor).toBe(true); // subject (100k) < 115k * 1.15
    const below = c.reports.find((r) => r.key === 'b')!;
    expect(below.inverted).toBe(false);
    expect(c.top?.key).toBe('a'); // highest-paid report, regardless of inversion
    expect(c.target15).toBe(Math.round(115_000 * 1.15));
  });
});

describe('buildGuidelineCompression', () => {
  it('returns null without subject pay, tenure, or any distinctly-junior peer', () => {
    expect(buildGuidelineCompression(null, 10, [{ pay: 90_000, tenure: 2 }], true)).toBeNull();
    expect(buildGuidelineCompression(100_000, null, [{ pay: 90_000, tenure: 2 }], true)).toBeNull();
    // peer is only 3 years junior (< the 5-year "distinct difference" gap) → no basis
    expect(buildGuidelineCompression(100_000, 10, [{ pay: 90_000, tenure: 7 }], true)).toBeNull();
  });
  it('uses the 8% floor for exempt and flags peers within it despite ≥5 fewer years', () => {
    // subject 100k, 10 yrs; peer 95k at 3 yrs (7 yrs junior). 100k < 95k*1.08=102.6k → compressed.
    const c = buildGuidelineCompression(100_000, 10, [{ pay: 95_000, tenure: 3 }], true)!;
    expect(c.threshold).toBe(0.08);
    expect(c.n).toBe(1);
    expect(c.count).toBe(1);
    expect(c.invertedCount).toBe(0); // peer paid less, just not 8% less
    expect(c.maxPeerPay).toBe(95_000);
  });
  it('counts an out-earning junior peer as inverted, and uses the conservative 5% floor when FLSA is unknown', () => {
    // subject 100k; peer 105k at 2 yrs → inverted; another peer 96k at 1 yr: 100k<96k*1.05=100.8k → compressed
    const c = buildGuidelineCompression(100_000, 10, [
      { pay: 105_000, tenure: 2 },
      { pay: 96_000, tenure: 1 },
      { pay: 80_000, tenure: 1 }, // 5%+ below → NOT compressed
      { pay: 200_000, tenure: 9 }, // only 1 yr junior → not distinctly junior, excluded
    ], null)!;
    expect(c.threshold).toBe(0.05);
    expect(c.n).toBe(3); // three peers ≥5 yrs junior
    expect(c.count).toBe(2);
    expect(c.invertedCount).toBe(1);
  });
  it('skips peers with null tenure (can\'t establish a distinct difference)', () => {
    expect(buildGuidelineCompression(100_000, 10, [{ pay: 99_000, tenure: null }], false)).toBeNull();
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

describe('fmtYearsToParity', () => {
  it('rounds up and pluralizes normally under the cap', () => {
    expect(fmtYearsToParity(1)).toBe('~1 more year');
    expect(fmtYearsToParity(4.2)).toBe('~5 more years');
    expect(fmtYearsToParity(10)).toBe('~10 more years');
  });
  it('caps an unbounded projection at a round "10+" instead of an absurd figure', () => {
    expect(fmtYearsToParity(10.1)).toBe('10+ more years');
    expect(fmtYearsToParity(57)).toBe('10+ more years');
  });
});
