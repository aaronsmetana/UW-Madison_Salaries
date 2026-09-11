import { describe, expect, it } from 'vitest';
import { cadenceOf, monthsBetween, type CadencePoint } from './cadence';

const pt = (id: string, date: string, pay: number, extra: Partial<CadencePoint> = {}): CadencePoint => ({
  id, date, pay, appts: 1, jobCode: 'J1', grade: 10, gradeBasis: 'Madison 12 Month', basis: 'Annual', ...extra,
});

describe('monthsBetween', () => {
  it('counts calendar months between snapshot dates', () => {
    expect(monthsBetween('2024-09-01', '2025-04-01')).toBe(7);
    expect(monthsBetween('2022-08-01', '2023-10-01')).toBe(14);
  });
});

describe('cadenceOf', () => {
  it('never makes the Nov 2021 relabel a step', () => {
    const c = cadenceOf([pt('2021-11-pre', '2021-11-01', 50000, { jobCode: 'OLD' }), pt('2021-11-post', '2021-11-01', 50000), pt('2022-03', '2022-03-01', 51000)], new Map([['2022-03', 0.02]]));
    expect(c.steps.map((s) => s.toId)).toEqual(['2022-03']);
  });

  it('counts a promotion as a promotion, not a raise', () => {
    const c = cadenceOf([pt('a', '2022-03-01', 73682, { grade: 20 }), pt('b', '2022-08-01', 86496, { jobCode: 'J2', grade: 21 })], new Map());
    expect(c.steps[0].kind).toBe('promotion');
    expect(c.raises).toBe(0);
    expect(c.promotions).toBe(1);
  });

  it('never counts the 9-month reporting change as a raise', () => {
    const c = cadenceOf([pt('a', '2025-04-01', 90000, { basis: 'Academic' }), pt('b', '2025-09-01', 110000, { basis: '9 Month' })], new Map());
    expect(c.steps[0].kind).toBe('reporting');
    expect(c.raises).toBe(0);
  });

  it('measures the longest run without a raise in months, through a reporting change that moved nothing else', () => {
    const c = cadenceOf([
      pt('s1', '2024-09-01', 90000, { basis: 'Academic' }),
      pt('s2', '2025-04-01', 90000, { basis: 'Academic' }),
      pt('s3', '2025-09-01', 110000, { basis: '9 Month' }),
      pt('s4', '2026-03-01', 115500, { basis: '9 Month' }),
    ], new Map([['s2', 0], ['s4', 0.05]]));
    expect(c.steps.map((s) => s.kind)).toEqual(['no raise', 'reporting', 'raise']);
    expect(c.longestMonths).toBe(12);
    expect(c.judged).toBe(3);
  });

  it('ends a run where pay cannot be compared, rather than claiming it', () => {
    const c = cadenceOf([
      pt('s1', '2024-09-01', 90000), pt('s2', '2025-04-01', 90000), pt('s3', '2025-09-01', 95000, { appts: 2 }), pt('s4', '2026-03-01', 95000, { appts: 2 }),
    ], new Map([['s2', 0]]));
    expect(c.steps.map((s) => s.kind)).toEqual(['no raise', 'not comparable', 'not comparable']);
    expect(c.longestMonths).toBe(7);
  });

  it('averages only the raises', () => {
    const c = cadenceOf([pt('s1', '2024-04-01', 100000), pt('s2', '2024-09-01', 102000), pt('s3', '2025-04-01', 102000), pt('s4', '2025-09-01', 106080)], new Map([['s2', 0.02], ['s3', 0], ['s4', 0.04]]));
    expect(c.raises).toBe(2);
    expect(c.avgRaise).toBeCloseTo(0.03, 10);
  });
});
