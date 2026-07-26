import { describe, it, expect } from 'vitest';
import { niceCurrencyTicks, fmtSnapTick, assignLabelRows } from './chartStyle';

describe('niceCurrencyTicks', () => {
  it('picks round ticks for an all-negative range abutting zero', () => {
    expect(niceCurrencyTicks(-28500, 0)).toEqual([-30000, -20000, -10000, 0]);
  });
  it('picks round ticks for an all-positive range', () => {
    expect(niceCurrencyTicks(100000, 150000)).toEqual([100000, 120000, 140000, 160000]);
  });
  it('includes 0 automatically when the range crosses zero', () => {
    const ticks = niceCurrencyTicks(-5000, 15000);
    expect(ticks).toContain(0);
    expect(ticks).toEqual([-5000, 0, 5000, 10000, 15000]);
  });
  it('returns a small symmetric range for a degenerate min === max', () => {
    const ticks = niceCurrencyTicks(50000, 50000);
    expect(ticks).toEqual([40000, 50000, 60000]);
  });
  it('handles a degenerate range at exactly zero', () => {
    const ticks = niceCurrencyTicks(0, 0);
    expect(ticks.length).toBe(3);
    expect(ticks[1]).toBe(0);
  });
});

describe('fmtSnapTick', () => {
  it('shortens a plain snapshot label to "Mon \'YY"', () => {
    expect(fmtSnapTick('Mar 2026')).toBe("Mar '26");
  });
  it('adds a lowercase pre/post suffix when the label carries a TTC variant', () => {
    expect(fmtSnapTick('Nov 2021 (Pre-TTC)')).toBe("Nov '21·pre");
    expect(fmtSnapTick('Nov 2021 (Post-TTC)')).toBe("Nov '21·post");
  });
  it('passes an unrecognized label through unchanged', () => {
    expect(fmtSnapTick('Q1')).toBe('Q1');
  });
});

describe('assignLabelRows', () => {
  /** Rebuilds each label's span and asserts nothing sharing a row overlaps. */
  const noRowOverlaps = (centers: number[], widths: number[], rows: number[]) => {
    const spans = centers.map((c, i) => ({ row: rows[i], left: c - widths[i] / 2, right: c + widths[i] / 2 }));
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spans[i].row !== spans[j].row) continue;
        expect(spans[i].right <= spans[j].left || spans[j].right <= spans[i].left).toBe(true);
      }
    }
  };

  it('keeps every label on one row when they are well separated', () => {
    const centers = [100, 400, 700];
    const widths = [50, 67, 50];
    expect(assignLabelRows(centers, widths)).toEqual([0, 0, 0]);
  });

  it('drops only the colliding middle label to a second row', () => {
    // The real desktop geometry from the Person page: p25/median/p75 of a long-tailed "Professor" cohort.
    const centers = [242.9, 286.9, 342.9];
    const widths = [50, 67, 50];
    const rows = assignLabelRows(centers, widths);
    expect(rows).toEqual([0, 1, 0]);
    noRowOverlaps(centers, widths, rows);
  });

  it('opens a third row when all three labels mutually collide', () => {
    // The same cohort at mobile width — two rows are not enough, p25 would still sit on p75.
    const centers = [72, 85, 101];
    const widths = [50, 67, 50];
    const rows = assignLabelRows(centers, widths);
    expect(rows).toEqual([0, 1, 2]);
    noRowOverlaps(centers, widths, rows);
  });

  it('never leaves two labels overlapping on the same row', () => {
    // Sweep a range of crowding levels; the invariant must hold for every one of them.
    for (let spacing = 2; spacing <= 120; spacing += 2) {
      const centers = [0, spacing, spacing * 2, spacing * 3];
      const widths = [40, 60, 40, 55];
      noRowOverlaps(centers, widths, assignLabelRows(centers, widths));
    }
  });

  it('honours the gap argument as minimum breathing room', () => {
    // 60px apart with 50px-wide labels: 10px of slack, so a 4px gap fits but a 20px gap does not.
    const centers = [0, 60];
    const widths = [50, 50];
    expect(assignLabelRows(centers, widths, 4)).toEqual([0, 0]);
    expect(assignLabelRows(centers, widths, 20)).toEqual([0, 1]);
  });

  it('collapses to a single row before anything has been measured', () => {
    expect(assignLabelRows([0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
  });
});
