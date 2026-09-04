import { describe, it, expect } from 'vitest';
import { dotRows, DOT_R, DOT_GAP, MAX_ROWS } from './swarm';

/** The mapping the strip uses: value -> 0..1 across the axis. */
const scale = (min: number, max: number) => (v: number) => (max > min ? (v - min) / (max - min) : 0);

/** Every pair of dots sharing a row must clear each other by at least the gap. */
function overlapsOnAnyRow(values: number[], rows: number[], at: (v: number) => number, w: number): string | null {
  const need = DOT_R * 2 + DOT_GAP;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (rows[i] !== rows[j]) continue;
      const gap = Math.abs(at(values[i]) * w - at(values[j]) * w);
      if (gap < need) return `${values[i]} and ${values[j]} share row ${rows[i]} but are ${gap.toFixed(1)}px apart`;
    }
  }
  return null;
}

describe('dotRows', () => {
  it('never puts two overlapping dots on the same row', () => {
    // A realistic cohort: a tight cluster around the median with a long right tail.
    const values = [
      98699, 101000, 103200, 104000, 104100, 106500, 108000, 109000, 110400, 111000,
      111200, 111900, 112000, 112050, 112100, 113000, 114207, 115000, 115400, 116000,
      117000, 117200, 118000, 119000, 120000, 121000, 122500, 125000, 128000, 131000,
      136000, 142140, 147107,
    ];
    const at = scale(98699, 147107);
    for (const w of [280, 375, 640, 1100]) {
      const rows = dotRows(values, at, w);
      expect(rows).toHaveLength(values.length);
      expect(overlapsOnAnyRow(values, rows, at, w)).toBeNull();
    }
  });

  it('stacks identical salaries rather than hiding them behind each other', () => {
    const values = [80000, 80000, 80000, 80000];
    const rows = dotRows(values, scale(70000, 90000), 600);
    expect(new Set(rows).size).toBe(4);
  });

  it('needs more rows as the axis narrows', () => {
    const values = Array.from({ length: 120 }, (_, i) => 100000 + i * 400);
    const at = scale(100000, 147600);
    const wide = Math.max(...dotRows(values, at, 1100)) + 1;
    const narrow = Math.max(...dotRows(values, at, 300)) + 1;
    expect(narrow).toBeGreaterThan(wide);
  });

  it('overflows MAX_ROWS when a cohort clusters, which is what selects the ribbon', () => {
    // Headcount alone cannot decide this. These two cohorts are the same size on the same axis; only
    // the spread differs, and only the packed height tells them apart.
    const at = scale(100000, 200000);
    const spread = Array.from({ length: 120 }, (_, i) => 100000 + i * 800);
    const clustered = Array.from({ length: 120 }, (_, i) => 110000 + i * 16);
    expect(Math.max(...dotRows(spread, at, 900)) + 1).toBeLessThanOrEqual(MAX_ROWS);
    expect(Math.max(...dotRows(clustered, at, 900)) + 1).toBeGreaterThan(MAX_ROWS);
  });

  it('returns nothing before the container has been measured', () => {
    expect(dotRows([1, 2, 3], scale(1, 3), 0)).toEqual([]);
    expect(dotRows([], scale(0, 1), 500)).toEqual([]);
  });
});
