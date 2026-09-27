import { describe, it, expect } from 'vitest';
import { payBandNote, payBandSource, olderSnapshotNote } from './PayBandNote';
import type { ReferenceStatus } from '../lib/hooks';

const REF: ReferenceStatus = {
  generated_at: '2026-09-27T00:00:00Z', grades_count: 22, floors_count: 23, max_effective_year: 2026, latest_snapshot_year: 2026,
  graded_rows: 22357, matched_rows: 13423, coverage: 0.6, floor_rows: 7000, floor_coverage: 0.31,
  retrieved_at: '2026-09-26', source_url: 'https://hr.wisc.edu/pay/salary-structure/', structure_change: 0.03, released_with: '2026-09', status: 'ok',
};

describe('payBandNote', () => {
  it('names the source and the day it was read when the structure is whole', () => {
    expect(payBandNote(REF)).toBe('Official ranges: UW–Madison salary structure, retrieved Sep 26, 2026.');
    expect(payBandSource({ ...REF, retrieved_at: null })).toBeNull();
  });
  it('says what a partial reference covers, and says nothing before it loads', () => {
    expect(payBandNote({ ...REF, status: 'sparse', grades_count: 2, matched_rows: 631, graded_rows: 22385, coverage: 0.028 }))
      .toBe("Official pay-band ranges are loaded for only 2 of UW's grades, covering 631 of 22,385 graded appointments (3%). Pay-band figures describe that slice, not the whole population.");
    expect(payBandNote(undefined)).toBeNull();
  });
});

describe('olderSnapshotNote', () => {
  const mar = { id: '2026-03', label: 'Mar 2026', date: '2026-03-01' };
  const sep = { id: '2026-09', label: 'Sep 2026', date: '2026-09-01' };
  it('says a band read in an older snapshot is today’s, and by how much the last change raised it', () => {
    expect(olderSnapshotNote(REF, mar, sep.label, sep.date))
      .toBe('Compared with the current ranges (Sep 2026); the ranges in force in Mar 2026 were likely lower — the last change measured was +3.0%.');
  });
  it('says nothing in the release the ranges came with, or later, or without a release to date them', () => {
    expect(olderSnapshotNote(REF, sep, sep.label, sep.date)).toBeNull();
    expect(olderSnapshotNote(REF, { id: '2027-03', label: 'Mar 2027', date: '2027-03-01' }, sep.label, sep.date)).toBeNull();
    expect(olderSnapshotNote({ ...REF, released_with: null }, mar, sep.label, sep.date)).toBeNull();
    expect(olderSnapshotNote(REF, null, sep.label, sep.date)).toBeNull();
  });
});
