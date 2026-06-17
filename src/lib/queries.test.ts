import { describe, it, expect } from 'vitest';
import { salaryExpr, earningsExpr, personPay } from './queries';

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
