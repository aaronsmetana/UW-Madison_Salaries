import { describe, it, expect } from 'vitest';
import { usd, num, pct, plural, formatName, fullName, fmtDate, fmtBasis, fmtYears, fmtChange, vsCampus } from './format';

describe('format', () => {
  it('usd formats whole dollars and handles null/NaN', () => {
    expect(usd(120000)).toBe('$120,000');
    expect(usd(0)).toBe('$0');
    expect(usd(null)).toBe('—');
    expect(usd(undefined)).toBe('—');
    expect(usd(Number.NaN)).toBe('—');
  });
  it('num formats with thousands separators', () => {
    expect(num(1234567)).toBe('1,234,567');
    expect(num(null)).toBe('—');
  });
  it('fmtYears formats tenure with one decimal and a yr suffix', () => {
    expect(fmtYears(11.4)).toBe('11.4 yr');
    expect(fmtYears(0)).toBe('0.0 yr');
    expect(fmtYears(16.83, 1)).toBe('16.8 yr');
    expect(fmtYears(null)).toBe('—');
    expect(fmtYears(Number.NaN)).toBe('—');
  });
  it('plural picks the singular/plural word by count', () => {
    expect(plural(1, 'peer')).toBe('1 peer');
    expect(plural(3, 'peer')).toBe('3 peers');
    expect(plural(0, 'peer')).toBe('0 peers');
    expect(plural(1, 'peer has', 'peers have')).toBe('1 peer has');
    expect(plural(2, 'peer has', 'peers have')).toBe('2 peers have');
  });
  it('pct scales a fraction to a percentage', () => {
    expect(pct(0.025)).toBe('2.5%');
    expect(pct(1)).toBe('100.0%');
    expect(pct(null)).toBe('—');
  });
  it('formatName title-cases ALL-CAPS words but leaves already-cased names alone', () => {
    expect(formatName('AARON ALMEIDA')).toBe('Aaron Almeida');
    expect(formatName('GANNON-LOEW')).toBe('Gannon-Loew');
    expect(formatName('McIntosh')).toBe('McIntosh'); // mixed case preserved
    expect(formatName('Aaron Abraha')).toBe('Aaron Abraha');
    expect(formatName(null)).toBe('');
  });
  it('fullName joins and formats first + last', () => {
    expect(fullName('AARON', 'BACH')).toBe('Aaron Bach');
    expect(fullName('Aaron', null)).toBe('Aaron');
  });
  it('fmtDate renders one long-form date for ISO strings, Date objects, and timestamps', () => {
    expect(fmtDate('2026-07-02')).toBe('Jul 2, 2026');
    expect(fmtDate(new Date(Date.UTC(2026, 6, 2)))).toBe('Jul 2, 2026');
    expect(fmtDate('2026-07-02T00:00:00Z')).toBe('Jul 2, 2026');
  });
  it('fmtDate falls back to an em dash for null, undefined, or unparsable input', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('not-a-date')).toBe('—');
  });
  it('fmtBasis unifies the pre/post-relabel synonyms (Annual/12 Month, Academic/9 Month)', () => {
    expect(fmtBasis('Annual')).toBe(fmtBasis('12 Month'));
    expect(fmtBasis('Academic')).toBe(fmtBasis('9 Month'));
  });
  it('fmtBasis passes unrelated values through unchanged', () => {
    expect(fmtBasis('Hourly')).toBe('Hourly');
    expect(fmtBasis('Seasonal')).toBe('Seasonal');
  });
  it('fmtBasis renders an em dash for blank/missing values', () => {
    expect(fmtBasis(null)).toBe('—');
    expect(fmtBasis(undefined)).toBe('—');
    expect(fmtBasis('')).toBe('—');
    expect(fmtBasis('   ')).toBe('—');
  });
});

describe('fmtChange', () => {
  it('signs a change and keeps one decimal', () => {
    expect(fmtChange(0.174)).toBe('+17.4%');
    expect(fmtChange(-0.015)).toBe('−1.5%');
  });
  it('prints no change as "0%", never "+0.0%" or "-0.0%"', () => {
    expect(fmtChange(0)).toBe('0%');
    expect(fmtChange(0.0004)).toBe('0%');
    expect(fmtChange(-0.0004)).toBe('0%');
  });
  it('prints a dash for a missing figure', () => {
    expect(fmtChange(null)).toBe('—');
  });
});

describe('vsCampus', () => {
  it('says how far below or above, in whole percent', () => {
    expect(vsCampus(62000, 76694)).toBe('19% below campus');
    expect(vsCampus(102000, 76694)).toBe('33% above campus');
  });
  it('calls a gap of a point or less "about the campus median", and a point and a half a number', () => {
    expect(vsCampus(100, 100)).toBe('about the campus median');
    expect(vsCampus(101, 100)).toBe('about the campus median');
    expect(vsCampus(99, 100)).toBe('about the campus median');
    expect(vsCampus(101.5, 100)).toBe('2% above campus');
  });
  it('rounds a gap the same way either side of campus', () => {
    // Math.round alone takes -1.5 to -1 and 1.5 to 2.
    expect(vsCampus(98.5, 100)).toBe('2% below campus');
    expect(vsCampus(97.5, 100)).toBe('3% below campus');
    expect(vsCampus(102.5, 100)).toBe('3% above campus');
  });
  it('says nothing with nothing to compare', () => {
    expect(vsCampus(null, 76694)).toBe('');
    expect(vsCampus(50000, 0)).toBe('');
    expect(vsCampus(50000, null)).toBe('');
  });
});
