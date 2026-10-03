import { describe, expect, it } from 'vitest';
import {
  COLS, colHeight, colLeft, fisheye, landEase, placePins, shareAt, squareAt, stackColumns, strataFromCounts, strataGrid, typeRanks, within,
} from './strata';

const PC = {
  lo100: 8,
  counts: [3, 0, 2, 1],
  categories: [
    { name: 'Faculty', over: 2, counts: [1, 0, 1, 0] },
    { name: 'Academic Staff', over: 1, counts: [2, 0, 1, 1] },
  ],
};

describe('strataFromCounts', () => {
  it('lays people out in the order dotSpots indexes them, each in its $1k column', () => {
    const s = strataFromCounts(PC)!;
    // $800 bucket: Faculty then Academic Staff; $1,000 and $1,100: column 1.
    expect([...s.kind]).toEqual([0, 1, 1, 0, 1, 1]);
    expect([...s.col]).toEqual([0, 0, 0, 1, 1, 1]);
    expect(s.colCount[0]).toBe(3);
    expect(s.colCount[1]).toBe(3);
    expect([...s.pileKind]).toEqual([0, 0, 1]);
  });
  it('refuses counts whose categories do not add up', () => {
    expect(strataFromCounts({ ...PC, counts: [4, 0, 2, 1] })).toBeNull();
    expect(strataFromCounts({ lo100: 0, counts: [1], categories: null })).toBeNull();
  });
  it('ranks the types in 3a order, any other after them', () => {
    expect([...typeRanks(['Faculty', 'Academic Staff', 'Other'])]).toEqual([3, 0, 7]);
  });
});

describe('stackColumns', () => {
  it('stacks by type rank from the floor, the same every time', () => {
    const s = strataFromCounts(PC)!;
    const a = stackColumns(s.col, s.kind, s.key, s.rank, null, COLS);
    const b = stackColumns(s.col, s.kind, s.key, s.rank, null, COLS);
    expect([...a.slot]).toEqual([...b.slot]);
    // Column 0: the two Academic Staff (rank 0) under the one Faculty (rank 3).
    expect(a.slot[0]).toBe(2);
    expect(new Set([a.slot[1], a.slot[2]])).toEqual(new Set([0, 1]));
  });
  it('sinks a filter\'s people to the floor, and leaves the column as tall', () => {
    const s = strataFromCounts(PC)!;
    const dim = new Uint8Array([0, 1, 1, 1, 1, 1]);
    const st = stackColumns(s.col, s.kind, s.key, s.rank, dim, COLS);
    expect(st.slot[0]).toBe(0);
    expect([...st.order.subarray(st.start[0], st.start[1])].length).toBe(3);
  });
});

describe('strataGrid', () => {
  it('is 3a\'s grid on a 1,125px plot at 2x: three a row, 1.5px apart, squares of two device pixels', () => {
    const g = strataGrid({ colW: 4.5, rowsH: 320, peak: 572, dpr: 2 });
    expect(g).toEqual({ per: 3, pitch: 1.5, sq: 1 });
    expect(colHeight(572, g)).toBeLessThanOrEqual(320);
  });
  it('fits the tallest column in the room on a phone, as a solid run', () => {
    const g = strataGrid({ colW: 310 / 250, rowsH: 215, peak: 572, dpr: 3 });
    expect(colHeight(572, g)).toBeLessThanOrEqual(215);
    expect(g.per * g.pitch).toBeLessThanOrEqual(310 / 250 + 1e-9);
  });
  it('keeps three a row on a 1x screen, where every choice is one pixel', () => {
    expect(strataGrid({ colW: 5.3, rowsH: 340, peak: 572, dpr: 1 })).toEqual({ per: 3, pitch: 1, sq: 1 });
  });
  it('grows the squares full page', () => {
    const page = strataGrid({ colW: 5.2, rowsH: 320, peak: 572, dpr: 2 });
    const full = strataGrid({ colW: 5.2, rowsH: 700, peak: 572, dpr: 2 });
    expect(full.pitch).toBeGreaterThan(page.pitch);
  });
  it('places squares on the pixel grid, row by row up from the baseline', () => {
    const g = { per: 3, pitch: 1.5, sq: 1 };
    const left = colLeft(10, 4.5, g, 2);
    expect(left * 2).toBe(Math.round(left * 2));
    expect(squareAt(left, 4, 3, 1.5, 300)).toEqual({ x: left + 1.5, y: 297 });
  });
});

describe('fisheye', () => {
  it('magnifies six times at the centre and leaves the rim where it was', () => {
    expect(fisheye(0, 0, 76)!.scale).toBe(6);
    const rim = fisheye(75.9, 0, 76)!;
    expect(rim.x).toBeCloseTo(75.9, 0);
    expect(rim.scale).toBeLessThan(0.3);
    expect(fisheye(80, 0, 76)).toBeNull();
  });
  it('pushes points outward along their own line', () => {
    const m = fisheye(10, 10, 76)!;
    expect(m.x).toBeGreaterThan(10);
    expect(m.x).toBeCloseTo(m.y, 6);
  });
});

describe('readout', () => {
  const cc = new Uint32Array(COLS);
  cc[10] = 4; cc[12] = 6; cc[20] = 10;
  it('counts ±$5k', () => expect(within(cc, 11)).toBe(10));
  it('takes lower columns and half its own', () => expect(shareAt(cc, 12, 20)).toBeCloseTo((4 + 3) / 20));
});

describe('placePins', () => {
  it('keeps every label clear of the others and inside the plot', () => {
    const out = placePins([{ x: 300, w: 110 }, { x: 260, w: 70 }, { x: 330, w: 70 }, { x: 990, w: 120 }], 1000);
    const boxes = out.map((o, i) => ({ row: o.row, l: o.left, r: o.left + [110, 70, 70, 120][i] }));
    for (const b of boxes) { expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(1000); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.row === b.row) expect(a.r + 12 <= b.l || b.r + 12 <= a.l).toBe(true);
    }
    // The first, the median, right of its line on the top row.
    expect(out[0]).toEqual({ row: 0, left: 305 });
    // The last turns left at the plot's edge.
    expect(out[3].left).toBe(990 - 5 - 120);
  });
});

describe('landEase', () => {
  it('falls, overshoots by a hop, and lands', () => {
    expect(landEase(0)).toBe(0);
    expect(landEase(0.8)).toBeCloseTo(1);
    expect(landEase(0.9)).toBeCloseTo(1 - 0.045);
    expect(landEase(1)).toBe(1);
  });
});
