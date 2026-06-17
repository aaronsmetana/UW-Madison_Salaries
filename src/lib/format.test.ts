import { describe, it, expect } from 'vitest';
import { usd, num, pct, formatName, fullName } from './format';

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
});
