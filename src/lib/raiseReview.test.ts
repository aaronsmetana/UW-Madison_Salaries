import { describe, it, expect } from 'vitest';
import { categoryOf, usualRaises, usualCaseSql, filterSql, fmtBeyond, UNCATEGORIZED, USUAL_MIN_N } from './raiseReview';
import { familyOf, familyLabel, JOB_FAMILIES } from './jobFamilies';

describe('employee categories', () => {
  it('are spelled one way across releases, and codes are kept as recorded', () => {
    expect(categoryOf('Employee-In-Training')).toBe('Employees in Training');
    expect(categoryOf('Employee-in-Training')).toBe('Employees in Training');
    expect(categoryOf('Limited Appointee')).toBe('Limited');
    expect(categoryOf('CP')).toBe('CP');
    expect(categoryOf('  ')).toBe(UNCATEGORIZED);
    expect(categoryOf(null)).toBe(UNCATEGORIZED);
  });
});

describe('the usual raise', () => {
  const campus = { cat: null, n: 100, k: 0.02, c: 70, med: 0.02 };
  it('is nothing without raises to read', () => {
    expect(usualRaises([])).toBeNull();
    expect(usualRaises([{ ...campus, n: 0 }])).toBeNull();
  });
  it('orders the categories largest first', () => {
    const u = usualRaises([campus, { cat: 'B', n: 30, k: 0.02, c: 30, med: 0.02 }, { cat: 'A', n: 60, k: 0.02, c: 60, med: 0.02 }])!;
    expect(u.cats.map((c) => c.cat)).toEqual(['A', 'B']);
  });
  it('takes campus’s under the smallest category that has its own', () => {
    const u = usualRaises([campus, { cat: 'A', n: USUAL_MIN_N - 1, k: 0.05, c: USUAL_MIN_N - 1, med: 0.05 }, { cat: 'B', n: USUAL_MIN_N, k: 0.05, c: USUAL_MIN_N, med: 0.05 }])!;
    expect(u.cats.find((c) => c.cat === 'A')).toMatchObject({ how: 'campus', usual: 0.02 });
    expect(u.cats.find((c) => c.cat === 'B')).toMatchObject({ how: 'mode', usual: 0.05 });
  });
  it('is a SQL case by category, campus’s for any other', () => {
    const u = usualRaises([campus, { cat: "O'Neil", n: 30, k: 0.03, c: 30, med: 0.03 }])!;
    expect(usualCaseSql(u, 't.cat')).toBe(`CAST((CASE t.cat WHEN 'O''Neil' THEN 0.03 ELSE 0.02 END) AS DOUBLE)`);
  });
});

describe('filters', () => {
  it('take a department only inside its school', () => {
    expect(filterSql({ department: 'D1' })).toBe('TRUE');
    expect(filterSql({ school: 'S', department: 'D1' }, 't')).toBe(`t.school = 'S' AND t.department = 'D1'`);
  });
});

describe('job groups', () => {
  it('are a TTC code’s two letters', () => {
    expect(familyOf('IT031')).toBe('IT');
    expect(familyOf('IC010N')).toBe('IC');
    expect(familyOf('X01NN')).toBeNull();
    expect(familyOf('94680')).toBeNull();
    expect(familyOf(null)).toBeNull();
  });
  it('are named as HR names them, or by what they hold', () => {
    expect(familyLabel('IT')).toBe('Information Technology (IT)');
    expect(familyLabel('QQ', 'Widget Maker')).toBe('QQ (Widget Maker and others)');
    expect(familyLabel('QQ')).toBe('QQ');
    expect(Object.keys(JOB_FAMILIES).every((k) => /^[A-Z]{2}$/.test(k))).toBe(true);
  });
});

describe('points above the usual', () => {
  it('are read at the printed tenth', () => {
    expect(fmtBeyond(0.0512, 0.02)).toBe('+3.1 pts');
    expect(fmtBeyond(0.02008, 0.02)).toBe('+0.0 pts');
  });
});
