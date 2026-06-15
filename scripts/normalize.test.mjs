import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  norm, excelSerialToISO, parseDate, parseMoney, parseNum, parseGrade,
  makePersonKey, snapshotFromSheetName, snapshotFromFilename, snapshotMeta, median,
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
    expect(m.label).toBe('Nov 2021 (POST-TTC)');
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
