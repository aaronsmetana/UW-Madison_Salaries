import { describe, it, expect } from 'vitest';
import { encodeSel, decodeSel, writeSel, readSel, selQuery } from './share';
import type { TrayItemInput } from '../state/tray';

describe('the tray in the address, one selection a parameter (C7)', () => {
  const items: TrayItemInput[] = [
    { type: 'person', id: 'aaronsmetana|2014-10-15', label: 'Aaron Smetana' },
    { type: 'title', id: 'FA020', label: 'Professor' },
    { type: 'school', id: 'College of Letters & Science', label: 'College of Letters & Science' },
  ];
  it('writes each as its kind and id, encoded once, no names', () => {
    const q = selQuery(items);
    expect(q).toBe('sel=p%3Aaaronsmetana%7C2014-10-15&sel=t%3AFA020&sel=s%3ACollege+of+Letters+%26+Science');
    expect(q).not.toMatch(/%25|Aaron\+Smetana/);
  });
  it('reads them back, the id standing in for a name until it is looked up', () => {
    const p = new URLSearchParams();
    writeSel(p, items);
    expect(readSel(new URLSearchParams(p.toString()))).toEqual(items.map((i) => ({ ...i, label: i.id })));
  });
  it('still reads an older link’s one value of them all, names and all', () => {
    const old = new URLSearchParams({ sel: encodeSel(items) });
    expect(readSel(old)).toEqual(items);
  });
});

describe('share', () => {
  it('round-trips a mixed tray of people, titles, and schools', () => {
    const items: TrayItemInput[] = [
      { type: 'person', id: 'aaronfield|2001-07-30', label: 'Aaron Field' },
      { type: 'title', id: 'FA020', label: 'Professor' },
      { type: 'school', id: 'School of Medicine and Public Health', label: 'School of Medicine and Public Health' },
    ];
    expect(decodeSel(encodeSel(items))).toEqual(items);
  });
  it('escapes delimiter characters embedded in a label so they cannot corrupt the split', () => {
    const items: TrayItemInput[] = [{ type: 'title', id: 'X1', label: 'Assistant Professor, Clinical | Adjunct' }];
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
