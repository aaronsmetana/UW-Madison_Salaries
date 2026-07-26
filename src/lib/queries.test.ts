import { describe, it, expect } from 'vitest';
import { salaryExpr, earningsExpr, personPay, basisEquivWhere, sameBasis } from './queries';

describe('salary expressions', () => {
  it('salaryExpr returns the per-appointment rate for each metric', () => {
    expect(salaryExpr('full')).toBe('salary');
    expect(salaryExpr('fte')).toContain('salary_fte_adjusted');
    expect(salaryExpr('base')).toContain('base_pay');
  });

  it('earningsExpr prorates full/base by FTE; fte metric is already prorated', () => {
    expect(earningsExpr('full')).toBe('salary * COALESCE(fte, 1)');
    expect(earningsExpr('base')).toContain('* COALESCE(fte, 1)');
    expect(earningsExpr('fte')).toContain('salary_fte_adjusted');
    expect(earningsExpr('fte')).not.toMatch(/\)\s*\*\s*COALESCE\(fte/); // not double-prorated
  });

  it('personPay blends only across >1 positive-salary appointment', () => {
    const p = personPay('full');
    expect(p).toContain('count(*) FILTER (WHERE salary > 0) > 1');
    expect(p).toContain('sum(salary * COALESCE(fte, 1)) FILTER (WHERE salary > 0)');
    expect(p).toContain('any_value(salary) FILTER (WHERE salary > 0)');
  });
});

describe('basisEquivWhere', () => {
  it('matches every label in the subject’s equivalence class plus NULL-basis rows', () => {
    const w = basisEquivWhere('12 Month');
    // both relabeled spellings of the 12-month class are matched (lowercased)
    expect(w).toContain("'annual'");
    expect(w).toContain("'12 month'");
    // NULL-era rows (before the column existed) are kept, not dropped
    expect(w).toContain('comp_basis IS NULL');
    expect(w.startsWith('AND ')).toBe(true); // callers put the space before it in the template
  });

  it('is symmetric across the relabeling (Academic ↔ 9 Month)', () => {
    const fromNew = basisEquivWhere('9 Month');
    const fromOld = basisEquivWhere('Academic');
    expect(fromNew).toContain("'academic'");
    expect(fromNew).toContain("'9 month'");
    expect(fromOld).toBe(fromNew);
  });

  it('returns no filter for an unknown/blank basis', () => {
    expect(basisEquivWhere(null)).toBe('');
    expect(basisEquivWhere(undefined)).toBe('');
    expect(basisEquivWhere('   ')).toBe('');
  });

  it('passes an unrecognized label through as its own single-member class', () => {
    const w = basisEquivWhere('Hourly');
    expect(w).toContain("'hourly'");
    expect(w).toContain('comp_basis IS NULL');
    expect(w).not.toContain("'12 month'");
  });
});

describe('sameBasis', () => {
  it('treats relabeled equivalents as the same basis', () => {
    expect(sameBasis('12 Month', 'Annual')).toBe(true);
    expect(sameBasis('9 Month', 'Academic')).toBe(true);
  });
  it('separates genuinely different classes', () => {
    expect(sameBasis('12 Month', '9 Month')).toBe(false);
    expect(sameBasis('Annual', 'Academic')).toBe(false);
  });
  it('treats a missing basis on either side as "don’t exclude" (true)', () => {
    expect(sameBasis(null, '12 Month')).toBe(true);
    expect(sameBasis('12 Month', '')).toBe(true);
    expect(sameBasis(null, null)).toBe(true);
  });
});
