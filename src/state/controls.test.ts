import { describe, expect, it } from 'vitest';
import { readFilters, FILTER_PARAMS } from './controls';
import { filterWhere, deptValue, splitDeptValue } from '../lib/queries';

describe('the facet filters in the address (I3)', () => {
  it('reads one parameter a facet, repeated for more than one value', () => {
    const p = new URLSearchParams('cat=Faculty&cat=Limited&flsa=Exempt');
    expect(readFilters(p)).toEqual({ employee_category: ['Faculty', 'Limited'], flsa_status: ['Exempt'] });
  });
  it('still reads an older link’s JSON, and merges it with the flat ones', () => {
    const p = new URLSearchParams(`filt=${encodeURIComponent(JSON.stringify({ employee_category: ['Faculty'] }))}&cat=Limited`);
    expect(readFilters(p)).toEqual({ employee_category: ['Faculty', 'Limited'] });
  });
  it('knows every parameter it writes, so a reset can clear them', () => {
    expect(FILTER_PARAMS).toEqual(expect.arrayContaining(['filt', 'cat', 'etype', 'flsa', 'paytype', 'unit']));
  });
});

describe('a department filter is one school’s unit (I1)', () => {
  it('keeps its school with its name', () => {
    expect(splitDeptValue(deptValue('Libraries', 'Gender & Womens Studies'))).toEqual({ school: 'Libraries', department: 'Gender & Womens Studies' });
    expect(splitDeptValue('Administration')).toEqual({ school: null, department: 'Administration' });
  });
  it('matches the name in its own school only; a bare name, from an older link, anywhere', () => {
    expect(filterWhere({ department: [deptValue('Law School', 'Administration')] }))
      .toBe("((school = 'Law School' AND department = 'Administration'))");
    expect(filterWhere({ department: ['Administration'] })).toBe("(department = 'Administration')");
    expect(filterWhere({ department: [deptValue('A', 'X'), deptValue('B', 'Y')], employee_category: ['Faculty'] }))
      .toBe("((school = 'A' AND department = 'X') OR (school = 'B' AND department = 'Y')) AND employee_category IN ('Faculty')");
  });
});
