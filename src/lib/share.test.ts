import { describe, it, expect } from 'vitest';
import { encodeSel, decodeSel } from './share';
import type { TrayItem } from '../state/tray';

describe('share', () => {
  it('round-trips a mixed tray of people, titles, and schools', () => {
    const items: TrayItem[] = [
      { type: 'person', id: 'aaronfield|2001-07-30', label: 'Aaron Field' },
      { type: 'title', id: 'FA020', label: 'Professor' },
      { type: 'school', id: 'School of Medicine and Public Health', label: 'School of Medicine and Public Health' },
    ];
    expect(decodeSel(encodeSel(items))).toEqual(items);
  });
  it('escapes delimiter characters embedded in a label so they cannot corrupt the split', () => {
    const items: TrayItem[] = [{ type: 'title', id: 'X1', label: 'Assistant Professor, Clinical | Adjunct' }];
    expect(decodeSel(encodeSel(items))).toEqual(items);
  });
  it('returns null for missing, empty, or malformed input', () => {
    expect(decodeSel(null)).toBeNull();
    expect(decodeSel(undefined)).toBeNull();
    expect(decodeSel('')).toBeNull();
    expect(decodeSel('not-a-valid-encoding')).toBeNull();
    expect(decodeSel('z,foo,bar')).toBeNull(); // unknown type code
    expect(decodeSel('p')).toBeNull(); // missing id field
  });
  it('rejects a value past the length guard', () => {
    const huge = `p,${'a'.repeat(2000)},label`;
    expect(decodeSel(huge)).toBeNull();
  });
  it('returns null for an empty item list', () => {
    expect(encodeSel([])).toBe('');
    expect(decodeSel('')).toBeNull();
  });
});
