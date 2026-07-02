import { describe, it, expect } from 'vitest';
import { ttcRank, makeSnapshotComparator } from './snapshotOrder';
import type { Summary } from './manifest';

describe('ttcRank', () => {
  it('ranks pre-TTC before post-TTC by id', () => {
    expect(ttcRank('2021-11-pre')).toBeLessThan(ttcRank('2021-11-post'));
  });
  it('ranks pre-TTC before post-TTC by label', () => {
    expect(ttcRank('Nov 2021 (Pre-TTC)')).toBeLessThan(ttcRank('Nov 2021 (Post-TTC)'));
  });
  it('defaults to 0 for ids/labels with no ttc marker', () => {
    expect(ttcRank('2022-03')).toBe(0);
  });
});

describe('makeSnapshotComparator', () => {
  const snapshots: Summary['snapshots'] = [
    { id: '2021-11-pre', label: 'Nov 2021 (Pre-TTC)', date: '2021-11-01', rows: 1, median: null },
    { id: '2021-11-post', label: 'Nov 2021 (Post-TTC)', date: '2021-11-01', rows: 1, median: null },
    { id: '2022-03', label: 'Mar 2022', date: '2022-03-01', rows: 1, median: null },
  ];

  it('orders pre-TTC before post-TTC on their shared date, resolving by id', () => {
    const cmp = makeSnapshotComparator(snapshots);
    const rows = [{ id: '2021-11-post', date: '2021-11-01' }, { id: '2021-11-pre', date: '2021-11-01' }];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(['2021-11-pre', '2021-11-post']);
  });

  it('orders pre-TTC before post-TTC resolving by label when id is absent', () => {
    const cmp = makeSnapshotComparator(snapshots);
    const rows = [{ label: 'Nov 2021 (Post-TTC)', date: '2021-11-01' }, { label: 'Nov 2021 (Pre-TTC)', date: '2021-11-01' }];
    expect([...rows].sort(cmp).map((r) => r.label)).toEqual(['Nov 2021 (Pre-TTC)', 'Nov 2021 (Post-TTC)']);
  });

  it('honors the canonical order even against shuffled input', () => {
    const cmp = makeSnapshotComparator(snapshots);
    const rows = [{ id: '2022-03', date: '2022-03-01' }, { id: '2021-11-post', date: '2021-11-01' }, { id: '2021-11-pre', date: '2021-11-01' }];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(['2021-11-pre', '2021-11-post', '2022-03']);
  });

  it('falls back to date + ttcRank when snapshots is undefined', () => {
    const cmp = makeSnapshotComparator(undefined);
    const rows = [{ id: '2021-11-post', date: '2021-11-01' }, { id: '2021-11-pre', date: '2021-11-01' }];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(['2021-11-pre', '2021-11-post']);
  });

  it('falls back to date compare for ids unknown to the canonical list', () => {
    const cmp = makeSnapshotComparator(snapshots);
    const rows = [{ id: 'unknown-2', date: '2023-01-01' }, { id: 'unknown-1', date: '2020-01-01' }];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(['unknown-1', 'unknown-2']);
  });
});
