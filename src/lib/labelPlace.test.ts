import { describe, it, expect } from 'vitest';
import { placeLabel, sampleVertical } from './labelPlace';

const bounds = { x0: 0, y0: 0, x1: 600, y1: 176 };
const size = { w: 110, h: 25 };
const boxAt = (p: { x: number; y: number }) => ({ x0: p.x - size.w / 2, y0: p.y - size.h / 2, x1: p.x + size.w / 2, y1: p.y + size.h / 2 });
const near = (b: ReturnType<typeof boxAt>, p: { x: number; y: number }) =>
  Math.hypot(Math.max(b.x0, Math.min(b.x1, p.x)) - p.x, Math.max(b.y0, Math.min(b.y1, p.y)) - p.y);

describe('placeLabel', () => {
  it('stays inside the plot and keeps its nearest edge 8px or more from the dot', () => {
    for (const anchor of [{ x: 300, y: 88 }, { x: 5, y: 88 }, { x: 595, y: 10 }, { x: 300, y: 170 }]) {
      const p = placeLabel({ anchor, size, bounds });
      const b = boxAt(p);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(600);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.y1).toBeLessThanOrEqual(176);
      expect(near(b, anchor)).toBeGreaterThanOrEqual(8 - 1e-6);
    }
  });

  // A label wider than it is tall cannot sit up and to the right close to its dot (its lower edge would hang
  // over the dot), so with nothing round it the nearest of the preferred side wins: beside it, to the right.
  it('with nothing round it, sits close on the right, never below or to the left, with no leader', () => {
    const anchor = { x: 300, y: 88 };
    const p = placeLabel({ anchor, size, bounds });
    expect(p.x).toBeGreaterThan(anchor.x);
    expect(p.y).toBeLessThanOrEqual(anchor.y);
    expect(near(boxAt(p), anchor)).toBeLessThan(11);
    expect(p.leader).toBeNull();
  });

  it('moves off the people it would cover, and away from words already there', () => {
    const anchor = { x: 300, y: 88 };
    const free = placeLabel({ anchor, size, bounds });
    const crowd = [...Array(40)].map((_, i) => ({ x: free.x - 60 + (i % 10) * 12, y: free.y - 12 + Math.floor(i / 10) * 8, r: 5 }));
    const moved = placeLabel({ anchor, size, bounds, dots: crowd });
    const covers = (p: { x: number; y: number }) => crowd.filter((d) => near(boxAt(p), d) < d.r).length;
    expect(covers(moved)).toBeLessThan(covers(free));
    const words = boxAt(free);
    const clear = placeLabel({ anchor, size, bounds, boxes: [words] });
    const b = boxAt(clear);
    expect(b.x0 < words.x1 && words.x0 < b.x1 && b.y0 < words.y1 && words.y0 < b.y1).toBe(false);
  });

  it('keeps off a line it would lie along', () => {
    const anchor = { x: 300, y: 88 };
    const free = placeLabel({ anchor, size, bounds });
    const line = { points: sampleVertical(free.x, 0, 176), weight: 0.6 };
    const p = placeLabel({ anchor, size, bounds, lines: [line] });
    const b = boxAt(p);
    expect(line.points.filter((q) => q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1).length).toBe(0);
  });

  it('draws a leader only when the label sits away from its dot, from 7px out to the label', () => {
    const anchor = { x: 300, y: 88 };
    const crowd = [...Array(200)].map((_, i) => ({ x: 200 + (i % 20) * 10, y: 40 + Math.floor(i / 20) * 10, r: 5 }));
    const p = placeLabel({ anchor, size, bounds, dots: crowd });
    if (near(boxAt(p), anchor) >= 11) {
      expect(p.leader).not.toBeNull();
      expect(Math.hypot(p.leader!.x1 - anchor.x, p.leader!.y1 - anchor.y)).toBeCloseTo(7, 5);
    } else expect(p.leader).toBeNull();
  });

  it('is the same placement every time', () => {
    const args = { anchor: { x: 120, y: 60 }, size, bounds, dots: [{ x: 150, y: 50, r: 5 }] };
    expect(placeLabel(args)).toEqual(placeLabel(args));
  });
});
