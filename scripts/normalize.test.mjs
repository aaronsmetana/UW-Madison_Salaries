import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  norm, excelSerialToISO, parseDate, parseMoney, parseNum, parseGrade,
  makePersonKey, snapshotFromSheetName, snapshotFromFilename, snapshotMeta, median,
  latestGradeBands, harmonizeHourly, isAnnualizedRate, prepareSheet, HOURS_PER_YEAR, FTE_PLACEHOLDER,
  mapDepartment, departmentChanges, structureChange, releasedWith, divisionReorganizations,
} from './lib/normalize.mjs';

describe('dates', () => {
  it('converts Excel serials (44713 → 2022-06-01)', () => {
    expect(excelSerialToISO(44713)).toBe('2022-06-01');
    expect(parseDate(44713)).toBe('2022-06-01');
  });
  it('parses DDMonYYYY strings', () => {
    expect(parseDate('01Jun2022')).toBe('2022-06-01');
  });
  it('rejects junk / empty', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(5)).toBeNull(); // out of serial range
  });
});

describe('money & numbers', () => {
  it('parses $/comma/float/number salary forms', () => {
    expect(parseMoney('$189,461.00')).toBe(189461);
    expect(parseMoney('49940.0')).toBe(49940);
    expect(parseMoney(49940)).toBe(49940);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('N/A')).toBeNull();
  });
  it('parseNum handles 1.0 / 0.667 / 0', () => {
    expect(parseNum('1.0')).toBe(1);
    expect(parseNum('0.667')).toBeCloseTo(0.667);
    expect(parseNum(0)).toBe(0);
  });
});

describe('salary grades (bare + verbose + non-numeric)', () => {
  it('verbose with basis', () => {
    expect(parseGrade('Grade 079 Madison 12 Month')).toMatchObject({ number: 79, basis: 'annual_12mo', isNumeric: true });
    expect(parseGrade('Grade 015 Madison Hourly')).toMatchObject({ number: 15, basis: 'hourly' });
  });
  it('bare grade with basis from comp_basis', () => {
    expect(parseGrade('055', '12 Month', null)).toMatchObject({ number: 55, basis: 'annual_12mo' });
    expect(parseGrade('061', '9 Month', null)).toMatchObject({ number: 61, basis: 'annual_9mo' });
  });
  it('pre-TTC alphanumeric grade is non-numeric', () => {
    const g = parseGrade('I01', null, null);
    expect(g.number).toBeNull();
    expect(g.isNumeric).toBe(false);
  });
});

describe('snapshot date resolution', () => {
  it('from sheet name (month words + TTC variant)', () => {
    expect(snapshotFromSheetName('Updated October 2023')).toMatchObject({ year: 2023, month: 10 });
    expect(snapshotFromSheetName('Post-Nov.7, 2021 (Post-TTC)')).toMatchObject({ year: 2021, month: 11, variant: 'post' });
    expect(snapshotFromSheetName('Pre-Nov. 7, 2021 (Pre-TTC)')).toMatchObject({ variant: 'pre' });
    expect(snapshotFromSheetName('Results')).toBeNull();
  });
  it('from filename (year-month, day ambiguity, month-year)', () => {
    expect(snapshotFromFilename('Updated 2022-03 All Faculty.xlsx')).toMatchObject({ year: 2022, month: 3 });
    expect(snapshotFromFilename('Updated 2023-10-09 All Faculty.xlsx')).toMatchObject({ year: 2023, month: 10 });
    expect(snapshotFromFilename('UW-Madison_Salary_05-2026.xlsx')).toMatchObject({ year: 2026, month: 5 });
  });
  it('builds id + label', () => {
    const m = snapshotMeta({ year: 2021, month: 11, variant: 'post' });
    expect(m.id).toBe('2021-11-post');
    expect(m.label).toBe('Nov 2021 (Post-TTC)');
  });
});

describe('person key', () => {
  it('is case/punctuation-insensitive and includes hire date', () => {
    expect(makePersonKey('Lars', 'Aalsma', '2018-09-03')).toBe('larsaalsma|2018-09-03');
    expect(makePersonKey('LARS', 'AALSMA', '2018-09-03')).toBe(makePersonKey('Lars', 'Aalsma', '2018-09-03'));
  });
});

describe('median', () => {
  it('handles even/odd/empty', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('column-map covers all observed header variants', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const map = JSON.parse(fs.readFileSync(path.join(dir, '..', 'data', 'column-map.json'), 'utf8'));
  const aliasSet = (field) => new Set(map.fields[field].map(norm));

  it('salary headers across all dumps map to `salary`', () => {
    const salary = aliasSet('salary');
    for (const h of ['Current Annual Contracted Salary', 'Annual_Full_Salary', 'Annualized_Rate_Amount']) {
      expect(salary.has(norm(h))).toBe(true);
    }
  });
  it('job_code / fte / date_of_hire header variants resolve', () => {
    expect(aliasSet('job_code').has(norm('Job Code'))).toBe(true);
    expect(aliasSet('job_code').has(norm('Jobcode'))).toBe(true);
    expect(aliasSet('fte').has(norm('Full_Time_Equivalent'))).toBe(true);
    expect(aliasSet('date_of_hire').has(norm('DATE_OF_HIRE'))).toBe(true);
  });
});

describe('pay-band reference dedupe', () => {
  const band = (grade, basis, year, min) => ({ grade, basis, effective_year: year, min, max: min + 1000 });

  it('keeps one row per (grade, basis), newest effective_year wins', () => {
    const out = latestGradeBands([
      band(15, 'annual_12mo', 2024, 34000),
      band(15, 'annual_12mo', 2025, 35360),
      band(15, 'annual_9mo', 2025, 28000),
      band(27, 'annual_12mo', 2025, 95824),
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((g) => g.grade === 15 && g.basis === 'annual_12mo').min).toBe(35360);
  });

  it('a row with no effective_year loses to one that has it, but survives alone', () => {
    expect(latestGradeBands([band(15, 'annual_12mo', null, 34000), band(15, 'annual_12mo', 2025, 35360)]))
      .toEqual([expect.objectContaining({ min: 35360 })]);
    expect(latestGradeBands([band(15, 'annual_12mo', null, 34000)])).toHaveLength(1);
  });

  it('treats a null basis as its own key rather than dropping the row', () => {
    const out = latestGradeBands([band(15, null, 2025, 34000), band(15, 'annual_12mo', 2025, 35360)]);
    expect(out).toHaveLength(2);
  });
});

/**
 * One property per test, and the keep/clear decision is tested from both sides with figures whose
 * shape is asserted in the same test, so a test cannot pass because its fixture happened to be the
 * other kind of number.
 */
describe('hourly pay in the early workbooks', () => {
  const row = (salary, fte) => ({ salary, fte, _flags: [] });

  it('recognises an annualized hourly rate to the cent and rounded to the dollar', () => {
    expect(isAnnualizedRate(39332.8)).toBe(true); // $18.91 x 2,080, as the later workbooks print it
    expect(isAnnualizedRate(86570)).toBe(true);   // $41.62 x 2,080 = $86,569.60, as the early ones do
    expect(isAnnualizedRate(36400)).toBe(true);
  });

  it('does not mistake an ordinary salary for one', () => {
    expect([202000, 154595, 86580].map(isAnnualizedRate)).toEqual([false, false, false]);
  });

  it('annualizes an hourly rate at 2,080 hours and flags it', () => {
    const { rows, annualized } = harmonizeHourly([row(19, 1), row(105, 0.5)]);
    expect(rows.map((r) => r.salary)).toEqual([19 * HOURS_PER_YEAR, 105 * HOURS_PER_YEAR]);
    expect(rows.map((r) => r._flags)).toEqual([['hourly_rate_annualized'], ['hourly_rate_annualized']]);
    expect(annualized).toBe(2);
  });

  it('leaves annual salaries and $0 rows alone, down to the smallest annual figure in the data', () => {
    const { rows, annualized } = harmonizeHourly([row(1683, 1), row(36400, 1), row(0, 1), row(null, 1)]);
    expect(rows.map((r) => r.salary)).toEqual([1683, 36400, 0, null]);
    expect(annualized).toBe(0);
  });

  it('reads the placeholder FTE as none on file beside an hourly figure, or no figure at all', () => {
    const { rows, cleared } = harmonizeHourly([row(36400, FTE_PLACEHOLDER), row(86570, FTE_PLACEHOLDER), row(0, FTE_PLACEHOLDER)]);
    expect(rows.map((r) => r.fte)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r._flags)).toEqual([['fte_placeholder'], ['fte_placeholder'], ['fte_placeholder']]);
    expect(cleared).toBe(3);
  });

  it('keeps the placeholder beside a figure that is not an hourly rate', () => {
    // An associate dean's line and a professor emeritus: nominal titles, Non-Paid in later workbooks.
    const { rows, kept, cleared } = harmonizeHourly([row(202000, FTE_PLACEHOLDER), row(154595, FTE_PLACEHOLDER)]);
    expect(rows.map((r) => r.fte)).toEqual([FTE_PLACEHOLDER, FTE_PLACEHOLDER]);
    expect(rows.map((r) => r._flags)).toEqual([[], []]);
    expect([kept, cleared]).toEqual([2, 0]);
  });

  it('applies both rewrites to a row that needs both', () => {
    const [r] = harmonizeHourly([row(19, FTE_PLACEHOLDER)]).rows;
    expect([r.salary, r.fte]).toEqual([19 * HOURS_PER_YEAR, 0]);
    expect(r._flags).toEqual(['hourly_rate_annualized', 'fte_placeholder']);
  });

  it('leaves a real small appointment percentage alone', () => {
    const { rows, cleared } = harmonizeHourly([row(47132.8, 0.0065)]);
    expect(rows[0].fte).toBe(0.0065);
    expect(cleared).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = [row(19, FTE_PLACEHOLDER)];
    harmonizeHourly(input);
    expect([input[0].salary, input[0].fte, input[0]._flags]).toEqual([19, FTE_PLACEHOLDER, []]);
  });
});

describe('preparing a sheet', () => {
  const line = (salary, fte) => ({ person: 'kj', job_code: 'PD013', title: 'Research Intern', salary, fte, _flags: [] });
  const prep = (rows) => prepareSheet(rows, (r) => r.person).rows;

  it('drops exact duplicate rows', () => {
    expect(prep([line(31200, 1), line(31200, 1)])).toHaveLength(1);
  });

  it('keeps an hourly line whose annualized rate equals a second appointment\'s figure', () => {
    // $15 x 2,080 = $31,200: two appointments, one written as a rate and one as an annual figure.
    const rows = prep([line(15, 0.25), line(31200, FTE_PLACEHOLDER)]);
    expect(rows.map((r) => [r.salary, r.fte])).toEqual([[31200, 0.25], [31200, 0]]);
  });
});

describe('department renames', () => {
  it('maps a department by school and name, ignoring case, and leaves every other alone', () => {
    const map = { 'School A|Human Oncology': 'Radiation Medicine' };
    expect(mapDepartment(map, 'School A', 'Human Oncology')).toBe('Radiation Medicine');
    expect(mapDepartment(map, 'school a', 'HUMAN ONCOLOGY')).toBe('Radiation Medicine');
    // The same name in another school is another unit.
    expect(mapDepartment(map, 'School B', 'Human Oncology')).toBe('Human Oncology');
    expect(mapDepartment(map, 'School A', null)).toBeNull();
    expect(mapDepartment(undefined, 'School A', 'Human Oncology')).toBe('Human Oncology');
  });

  // Each unit is one way a department can change name, or not.
  const at = (school, department, ...keys) => keys.map((person_key) => ({ person_key, school, department }));
  const before = [
    ...at('S', 'Botany', 'b1', 'b2', 'b3', 'b4'),
    ...at('S', 'Integrative Biology', 'i1', 'i2', 'i3', 'i4', 'i5'),
    ...at('S', 'Old', 'o1', 'o2', 'o3'),
    ...at('S', 'Small', 's1', 's2', 's3'),
    ...at('S', 'Stays', ...Array.from({ length: 20 }, (_, i) => `t${i}`)),
    ...at('S', 'Stat', 'x1', 'x2', 'x3'),
    ...at('S', 'Tiny', 'y1', 'y2'),
  ];
  const after = [
    // A merger of equals: both send their people to a new unit made of them. One of Integrative
    // Biology's stays under the old name.
    ...at('S', 'Biology', 'b1', 'b2', 'b3', 'b4', 'i1', 'i2', 'i3', 'i4', 'n1'),
    ...at('S', 'Integrative Biology', 'i5'),
    ...at('S', 'New', 'o1', 'o2', 'o3'),
    // Absorbed: Small's people all went to Big, but Big is mostly people from Stays, which still exists.
    ...at('S', 'Big', 's1', 's2', 's3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'),
    ...at('S', 'Stays', ...Array.from({ length: 13 }, (_, i) => `t${i + 7}`)),
    // Moved to another school, keeping its name: a real move, not a rename.
    ...at('T', 'Stat', 'x1', 'x2', 'x3'),
    // Too few people to tell.
    ...at('S', 'Tiny2', 'y1', 'y2'),
  ];

  it('carries a rename, with its evidence', () => {
    const { renames } = departmentChanges(before, after);
    expect(renames).toEqual([{ school: 'S', from: 'Old', to: 'New', carried: 3, share: 1, reverse: 1 }]);
  });

  it('reports a merger without carrying it: carrying would file both old units under the new name', () => {
    const { renames, mergers, gone } = departmentChanges(before, after);
    expect(mergers).toEqual([{
      school: 'S', to: 'Biology', reverse: 1,
      // Four of Integrative Biology's five continuing people went; the fifth stayed under the old name.
      from: [{ department: 'Botany', carried: 4, share: 1 }, { department: 'Integrative Biology', carried: 5, share: 0.8 }],
    }]);
    expect(renames.some((r) => r.to === 'Biology')).toBe(false);
    expect(gone.some((g) => g.department === 'Botany')).toBe(false);
  });

  it('does not carry a unit absorbed into another, a move between schools, or too few people', () => {
    const { renames, gone } = departmentChanges(before, after);
    expect(renames.some((r) => ['Small', 'Stat', 'Tiny'].includes(r.from))).toBe(false);
    const by = Object.fromEntries(gone.map((g) => [g.department, g]));
    expect(Object.keys(by).sort()).toEqual(['Small', 'Stat', 'Tiny']);
    expect(by.Small).toMatchObject({ to: 'Big', share: 1, reverse: 0.3 });
    expect(by.Stat).toMatchObject({ to: 'Stat', to_school: 'T', share: 1 });
    expect(by.Tiny).toMatchObject({ to: 'Tiny2', carried: 2 });
  });

  it('follows a chain of renames to the name in use now, and stops on a loop', () => {
    const map = { 'S|A': 'B', 'S|B': 'C', 'S|X': 'Y', 'S|Y': 'X' };
    expect(mapDepartment(map, 'S', 'A')).toBe('C');
    expect(mapDepartment(map, 'S', 'B')).toBe('C');
    expect(['X', 'Y']).toContain(mapDepartment(map, 'S', 'X'));
  });
});

describe('pay-band reference: the structure change and the release it came with', () => {
  const rows = [
    { grade: 15, basis: 'annual_12mo', min: 35360, max: 65770, effective_year: 2025 },
    { grade: 27, basis: 'annual_12mo', min: 95824, max: 178232, effective_year: 2025 },
    { grade: 15, basis: 'annual_12mo', min: 36421, max: 67743, effective_year: 2026 },
    { grade: 27, basis: 'annual_12mo', min: 98699, max: 183579, effective_year: 2026 },
    // Published for the first time: no earlier figure to measure from, so not in the median.
    { grade: 16, basis: 'annual_12mo', min: 39335, max: 73162, effective_year: 2026 },
    // A minimum only: a floor, kept.
    { grade: 61, basis: 'annual_12mo', min: 45250, max: null, effective_year: 2026 },
  ];

  it('measures the change over the grades published in both years', () => {
    expect(structureChange(rows)).toBe(0.03);
    expect(structureChange(rows.filter((r) => r.effective_year === 2026))).toBeNull();
  });

  it('keeps a floor as the newest row for its grade', () => {
    const latest = latestGradeBands(rows);
    expect(latest.find((g) => g.grade === 61)).toMatchObject({ min: 45250, max: null });
    expect(latest.filter((g) => g.grade === 15)).toEqual([rows[2]]);
  });

  it('dates the ranges to the newest snapshot on or before the day they were read', () => {
    const snaps = [
      { snapshot_id: '2026-03', snapshot_date: '2026-03-01' },
      { snapshot_id: '2026-09', snapshot_date: '2026-09-01' },
      { snapshot_id: '2027-03', snapshot_date: '2027-03-01' },
    ];
    expect(releasedWith(snaps, '2026-09-26')).toBe('2026-09');
    expect(releasedWith(snaps, '2026-09-01')).toBe('2026-09');
    expect(releasedWith(snaps, '2026-08-31')).toBe('2026-03');
    expect(releasedWith(snaps, null)).toBeNull();
  });
});

describe('division reorganizations', () => {
  const at = (school, department, ...keys) => keys.map((person_key) => ({ person_key, school, department }));
  const before = [
    ...at('LS', 'CS', 'c1', 'c2', 'c3', 'c4'),
    ...at('LS', 'Stat', 's1', 's2', 's3'),
    ...at('LS', 'Admin', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'),
    ...at('LS', 'History', 'h1', 'h2', 'h3'),
    ...at('BUS', 'BUS', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'),
  ];
  const after = [
    // CS and Statistics move whole, with two of eight from L&S's administration and one from Business.
    ...at('CCAI', 'CS', 'c1', 'c2', 'c3', 'c4'),
    ...at('CCAI', 'Stat', 's1', 's2', 's3'),
    ...at('CCAI', 'Admin', 'a1', 'a2', 'b1', 'n1'),
    ...at('LS', 'Admin', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'),
    ...at('LS', 'History', 'h1', 'h2', 'h3'),
    ...at('BUS', 'BUS', 'b2', 'b3', 'b4', 'b5', 'b6'),
    // A new division no whole department moved into is new, not a reorganization.
    ...at('NEWBIE', 'X', 'h1', 'x2', 'x3'),
  ];

  it('names a new division formed from whole departments, and who came from where', () => {
    expect(divisionReorganizations(before, after)).toEqual([
      { school: 'CCAI', people: 11, from: [{ school: 'LS', people: 9, departments: ['CS', 'Stat'] }] },
    ]);
  });

  it('finds none when no division is new', () => {
    expect(divisionReorganizations(before, before)).toEqual([]);
  });
});
