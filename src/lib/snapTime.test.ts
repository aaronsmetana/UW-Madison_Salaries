import { describe, it, expect } from 'vitest';
import { snapX, snapTicks, snapAxisProps, reportingBreaks, KNOWN_BREAKS, TTC_OFFSET_DAYS } from './snapTime';

const DAY = 864e5;

describe('snapX', () => {
  it('puts each snapshot at its own date, so the gaps between them are real', () => {
    const mar = snapX('2022-03-01', '2022-03');
    const aug = snapX('2022-08-01', '2022-08');
    const oct = snapX('2023-10-01', '2023-10');
    // 14 months against 5: the even spacing drew these two gaps the same width.
    expect((oct - aug) / (aug - mar)).toBeCloseTo(426 / 153, 2);
  });
  it('separates the TTC twins by a sliver either side of their shared date, pre first', () => {
    const pre = snapX('2021-11-01', '2021-11-pre');
    const post = snapX('2021-11-01', '2021-11-post');
    expect(post - pre).toBe(2 * TTC_OFFSET_DAYS * DAY);
    expect(pre).toBeLessThan(post);
  });
  it('reads a label as well as an id', () => {
    expect(snapX('2021-11-01', 'Nov 2021 (Pre-TTC)')).toBe(snapX('2021-11-01', '2021-11-pre'));
  });
});

describe('snapTicks', () => {
  it('gives the TTC twins one tick, without the pre/post suffix', () => {
    const ticks = snapTicks([
      { date: '2021-11-01', label: 'Nov 2021 (Pre-TTC)' },
      { date: '2021-11-01', label: 'Nov 2021 (Post-TTC)' },
      { date: '2022-03-01', label: 'Mar 2022' },
    ]);
    expect(ticks.map((t) => t.label)).toEqual(["Nov '21", "Mar '22"]);
  });
});

describe('snapAxisProps', () => {
  it('is a numeric time axis spanning the snapshots, labelled at each date', () => {
    const rows = [
      { date: '2021-11-01', label: 'Nov 2021 (Pre-TTC)' },
      { date: '2026-03-01', label: 'Mar 2026' },
    ];
    const ax = snapAxisProps(rows);
    expect(ax.type).toBe('number');
    expect(ax.domain[0]).toBe(snapX('2021-11-01', 'Nov 2021 (Pre-TTC)'));
    expect(ax.tickFormatter(ax.ticks[1])).toBe("Mar '26");
  });
});

describe('reportingBreaks', () => {
  it('breaks a series exactly where 9-month pay changes footing', () => {
    expect(reportingBreaks([{ basis: 'Academic' }, { basis: 'Academic' }, { basis: '9 Month' }, { basis: '9 Month' }])).toEqual([2]);
    expect(reportingBreaks([{ basis: 'Annual' }, { basis: '12 Month' }])).toEqual([]);
  });
});

describe('KNOWN_BREAKS', () => {
  it('lists the three breaks that are not changes in pay or staff', () => {
    expect(KNOWN_BREAKS.map((b) => b.snapshotId)).toEqual(['2021-11-post', '2023-10', '2025-09']);
  });
});
