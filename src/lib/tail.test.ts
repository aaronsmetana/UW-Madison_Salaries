import { describe, expect, it } from 'vitest';
import { squeezeFactor, tailHeights } from './tail';

describe('squeezeFactor', () => {
  it("draws the graph at its true share of an axis run out to the top salary", () => {
    // $0-$250k across 1000px of a 1040px row; unrolled to $3M, $250k lands at 1040 / 12 px.
    const s = squeezeFactor(0, 250000, 3000000, 1000, 1040);
    expect(250000 / 250000 * 1000 * s).toBeCloseTo(1040 / 12, 9);
    expect(s).toBeCloseTo(1040 / 12000, 12);
  });
  it('leaves the graph as it is when there is no tail to run out to', () => {
    expect(squeezeFactor(0, 250000, 250000, 1000, 1040)).toBe(1);
    expect(squeezeFactor(0, 250000, 3e6, 0, 1040)).toBe(1);
  });
});

describe('tailHeights', () => {
  const xs = [...Array.from({ length: 300 }, (_, k) => 90 + (k % 40)), ...Array.from({ length: 20 }, (_, k) => 400 + k * 10), 999.5];
  const h = tailHeights(xs, 1000, 5, 300);

  it('holds as much room as its dots need, at the graph\'s own packing', () => {
    let area = 0;
    for (const v of h) area += v;
    // All of it but what the evening-out carries past the ends.
    expect(area).toBeLessThanOrEqual(xs.length * 5 + 1e-3);
    expect(area).toBeGreaterThan(xs.length * 5 * 0.99);
  });
  it('rises where the dots crowd, and is nothing far from any', () => {
    expect(h[110]).toBeGreaterThan(h[450]);
    expect(h[50]).toBe(0);
    expect(h[700]).toBe(0);
    // Even the one dot alone at the edge has a column to stand in.
    expect(h[999]).toBeGreaterThan(0);
  });
  it('never rises past the room it is given', () => {
    const tall = tailHeights(Array.from({ length: 5000 }, () => 100), 1000, 5, 120);
    expect(Math.max(...tall)).toBeLessThanOrEqual(120);
  });
});
