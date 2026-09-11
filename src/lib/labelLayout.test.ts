import { describe, expect, it } from 'vitest';
import { overlaps, packLabelRows, placeChips, type Box } from './labelLayout';

const plot: Box = { left: 0, right: 400, top: 0, bottom: 200 };

describe('packLabelRows', () => {
  it('keeps labels that fit on one row', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 60, right: 100 }], { left: 0, right: 200 })).toEqual([0, 0]);
  });

  it('lifts a label that would touch its neighbour onto the next row', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 40, right: 90 }], { left: 0, right: 200 })).toEqual([0, 1]);
  });

  it('returns to the first row as soon as it has room', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 40, right: 90 }, { left: 60, right: 80 }], { left: 0, right: 200 })).toEqual([0, 1, 0]);
  });

  it('gives up when three labels crowd two rows', () => {
    expect(packLabelRows([{ left: 0, right: 50 }, { left: 10, right: 60 }, { left: 20, right: 70 }], { left: 0, right: 200 })).toBeNull();
  });

  it('gives up when a label leaves the chart', () => {
    expect(packLabelRows([{ left: -10, right: 40 }], { left: 0, right: 200 })).toBeNull();
    expect(packLabelRows([{ left: 180, right: 230 }], { left: 0, right: 200 })).toBeNull();
  });
});

describe('placeChips', () => {
  it('puts a chip above its point, or below when that is preferred', () => {
    const [a] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0 }], [], plot);
    expect(a.cy).toBe(78);
    const [b] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0, preferBelow: true }], [], plot);
    expect(b.cy).toBe(122);
  });

  it('drops below the point when above would leave the plot', () => {
    const [a] = placeChips([{ id: 0, x: 100, y: 10, width: 40, priority: 0 }], [], plot);
    expect(a.cy).toBe(32);
  });

  it('nudges a chip inward at the edges', () => {
    const [a] = placeChips([{ id: 0, x: 395, y: 100, width: 40, priority: 0 }], [], plot);
    expect(a.box.right).toBe(400);
  });

  it('never covers an obstacle', () => {
    const marker: Box = { left: 89, right: 111, top: 67, bottom: 89 };
    const [a] = placeChips([{ id: 0, x: 100, y: 100, width: 40, priority: 0 }], [marker], plot);
    expect(overlaps(a.box, marker)).toBe(false);
    expect(a.cy).toBe(122);
  });

  it('never places two chips on each other, and drops the lower-priority one', () => {
    const chips = [
      { id: 0, x: 100, y: 100, width: 40, priority: 1 },
      { id: 1, x: 110, y: 100, width: 40, priority: 5 },
      { id: 2, x: 120, y: 100, width: 40, priority: 3 },
    ];
    const placed = placeChips(chips, [], plot);
    expect(placed.map((p) => p.id)).toEqual([1, 2]);
    expect(overlaps(placed[0].box, placed[1].box)).toBe(false);
  });
});
