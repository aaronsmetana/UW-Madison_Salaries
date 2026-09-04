import { describe, it, expect } from 'vitest';
import { salaryExpr, earningsExpr, personPay, basisEquivWhere, sameBasis, actualPay, FTE_MULT } from './queries';

describe('salary expressions', () => {
  it('salaryExpr returns the per-appointment rate for each metric', () => {
    expect(salaryExpr('full')).toBe('salary');
    expect(salaryExpr('fte')).toContain('salary_fte_adjusted');
    expect(salaryExpr('base')).toContain('base_pay');
  });

  it('earningsExpr prorates full/base by FTE; fte metric is already prorated', () => {
    expect(earningsExpr('full')).toBe(`salary * ${FTE_MULT}`);
    expect(earningsExpr('base')).toContain(`* ${FTE_MULT}`);
    expect(earningsExpr('fte')).toContain('salary_fte_adjusted');
    expect(earningsExpr('fte')).not.toMatch(/\)\s*\*\s*COALESCE\(NULLIF\(fte/); // not double-prorated
  });

  it('personPay blends only across >1 positive-salary appointment', () => {
    const p = personPay('full');
    expect(p).toContain('count(*) FILTER (WHERE salary > 0) > 1');
    expect(p).toContain(`sum(salary * ${FTE_MULT}) FILTER (WHERE salary > 0)`);
    expect(p).toContain('any_value(salary) FILTER (WHERE salary > 0)');
  });

  // Regression guard. `fte = 0` marks an hourly appointment with no recorded appointment percentage,
  // not someone who earns nothing; a plain COALESCE(fte, 1) leaves the 0 intact and multiplies 1,178
  // real people down to $0, which silently removed the lowest-paid group in the data from every
  // FTE-adjusted median, headcount, and Screening run. Assert on the shape rather than the exact
  // string so a rewrite of the expression still has to keep zero out of the multiplier.
  it('treats fte = 0 as unknown, never as a zero multiplier', () => {
    for (const expr of [FTE_MULT, earningsExpr('full'), earningsExpr('base'), earningsExpr('fte'), salaryExpr('fte')]) {
      expect(expr).toContain('NULLIF(fte, 0)');
      expect(expr).not.toMatch(/COALESCE\(fte,\s*1\)/);
    }
  });

  // The same defect one column up, and the one a reader actually reported: the Apr-2024 and Sep-2024
  // workbooks publish `salary_fte_adjusted` as a literal 0 on hourly rows, having already done
  // `rate x 0` themselves. COALESCE only falls through on NULL, so that zero won — 2,499 rows across
  // 1,591 people, all holding a real annualized rate, every one reading as $0.
  it('treats a reported FTE-adjusted salary of 0 as unknown, never as a reported figure', () => {
    for (const expr of [salaryExpr('fte'), earningsExpr('fte')]) {
      expect(expr).toContain('NULLIF(salary_fte_adjusted, 0)');
      expect(expr).not.toMatch(/COALESCE\(salary_fte_adjusted,/);
    }
  });
});

/**
 * `actualPay` is the JS half of the same rule, and the half that shipped broken: Person's trend and
 * history compute pay client-side and used `??`, which passes a zero straight through. The reported
 * symptom was a custodian on $16.50/hr — an annualized $34,320, fte 0 — whose page read "Current $0".
 */
describe('actualPay', () => {
  const row = (salary: number | null, adj: number | null, fte: number | null) =>
    ({ salary, salary_fte_adjusted: adj, fte });

  it('uses the reported FTE-adjusted figure when there is one', () => {
    expect(actualPay(row(100_000, 50_000, 0.5))).toBe(50_000);
  });

  it('falls back to rate x FTE when the adjusted figure is absent', () => {
    expect(actualPay(row(100_000, null, 0.5))).toBe(50_000);
  });

  it('reads fte = 0 as unrecorded, so an hourly rate stands at full value', () => {
    expect(actualPay(row(34_320, null, 0))).toBe(34_320);
  });

  it('reads an adjusted salary of 0 as unrecorded too — the source already multiplied by that zero', () => {
    expect(actualPay(row(33_009.6, 0, 0))).toBeCloseTo(33_009.6);
  });

  it('still returns 0 for a genuinely unpaid appointment', () => {
    expect(actualPay(row(0, 0, 0))).toBe(0);
    expect(actualPay(row(null, null, null))).toBe(0);
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
