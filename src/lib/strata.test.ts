import { describe, expect, it } from 'vitest';
import {
  COLS, colHeight, colLeft, fisheye, landEase, placePins, shareAt, snapReach, squareAt, squarePixels, stackColumns, strataFromCounts, strataGrid,
  tailColumns, typeRanks, within, type Grid,
} from './strata';

const PC = {
  lo100: 8,
  counts: [3, 0, 2, 1],
  categories: [
    { name: 'Faculty', over: 2, counts: [1, 0, 1, 0], over_pays: [260_000, 410_000] },
    { name: 'Academic Staff', over: 1, counts: [2, 0, 1, 1], over_pays: [300_000] },
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
    // Each one past the cap with their own pay, in the pile's order.
    expect([...s.pilePay!]).toEqual([260_000, 410_000, 300_000]);
  });
  it('leaves a pile without its pays a pile, where the counts do not carry them all', () => {
    const cats = PC.categories.map((c, i) => (i ? { ...c, over_pays: undefined } : c));
    expect(strataFromCounts({ ...PC, categories: cats })!.pilePay).toBeNull();
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
    const a = stackColumns(s.col, s.kind, s.key, s.rank, COLS);
    const b = stackColumns(s.col, s.kind, s.key, s.rank, COLS);
    expect([...a.slot]).toEqual([...b.slot]);
    // Column 0: the two Academic Staff (rank 0) under the one Faculty (rank 3).
    expect(a.slot[0]).toBe(2);
    expect(new Set([a.slot[1], a.slot[2]])).toEqual(new Set([0, 1]));
  });
});

describe('strataGrid', () => {
  it('runs the lattice across a column to the hundredth of a pixel, so columns meet with no seam; rows on whole device pixels', () => {
    // 1,654px of plot at 2x (a 1,800px window): 6.616px a column, three a row.
    const g = strataGrid({ colW: 6.616, rowsH: 450, peak: 576, dpr: 2 });
    expect(g.per).toBe(3);
    expect(g.per * g.pitch).toBeCloseTo(6.616, 9);
    expect(g.rowPitch * 2).toBe(Math.round(g.rowPitch * 2));
    expect(g.gap).toBe(1);
    expect(colHeight(576, g)).toBeLessThanOrEqual(450);
  });
  it('fits the tallest column in the room on a phone, as a solid run', () => {
    const g = strataGrid({ colW: 310 / 250, rowsH: 215, peak: 572, dpr: 3 });
    expect(colHeight(572, g)).toBeLessThanOrEqual(215);
    expect(g.per * g.pitch).toBeCloseTo(310 / 250, 9);
    expect(g.gap).toBe(0);
  });
  it('keeps three a row on a 1x screen, a pixel square and a pixel gap where there is room for both', () => {
    const g = strataGrid({ colW: 6.616, rowsH: 450, peak: 576, dpr: 1 });
    expect(g).toMatchObject({ per: 3, rowPitch: 2, gap: 1, sq: 1 });
    expect(strataGrid({ colW: 5.3, rowsH: 340, peak: 572, dpr: 1 })).toMatchObject({ per: 3, rowPitch: 1, gap: 0 });
  });
  it('grows the squares full page', () => {
    const page = strataGrid({ colW: 5.2, rowsH: 320, peak: 572, dpr: 2 });
    const full = strataGrid({ colW: 5.2, rowsH: 700, peak: 572, dpr: 2 });
    expect(full.sq).toBeGreaterThan(page.sq);
  });
  it('places squares row by row up from the baseline, each column at its own share of the axis', () => {
    const g = { pitch: 6.616 / 3, rowPitch: 2 };
    expect(colLeft(10, 6.616)).toBeCloseTo(66.16, 9);
    expect(squareAt(colLeft(10, 6.616), 4, 3, g, 300)).toEqual({ x: colLeft(10, 6.616) + g.pitch, y: 296 });
  });
});

describe('squarePixels', () => {
  /** A row of squares across many columns, as device-pixel runs: each square's width, and each gap's. */
  const row = (g: Grid, dpr: number, y: number, cols = 60) => {
    const runs: { w: number; gap: number }[] = [];
    let end: number | null = null;
    for (let c = 0; c < cols; c++) for (let k = 0; k < g.per; k++) {
      const b = squarePixels(colLeft(c, g.pitch * g.per) + k * g.pitch, y, g, dpr);
      if (end != null) runs[runs.length - 1].gap = b.X - end;
      runs.push({ w: b.w, gap: 0 });
      end = b.X + b.w;
    }
    runs.pop();
    return runs;
  };
  it('parts every square from the next by the same gap, inside a column and between columns alike', () => {
    for (const [colW, dpr] of [[6.616, 2], [5.204, 2], [4.1, 3]] as const) {
      const g = strataGrid({ colW, rowsH: 450, peak: 576, dpr });
      for (const y of [298, 300]) {
        const runs = row(g, dpr, y);
        expect(new Set(runs.map((r) => r.gap)), `${colW}px at ${dpr}x`).toEqual(new Set([g.gap]));
        // A square is its pitch less the gap, or a pixel either side.
        for (const r of runs) expect(Math.abs(r.w - g.sqW * dpr)).toBeLessThan(1);
      }
    }
  });
  it('on a 1x screen draws every square the same, and scatters the gaps a pixel wider so they never line up into a stripe', () => {
    const g = strataGrid({ colW: 6.616, rowsH: 450, peak: 576, dpr: 1 });
    const rows = Array.from({ length: 40 }, (_, r) => row(g, 1, 300 - 2 * r));
    for (const r of rows) {
      expect(new Set(r.map((x) => x.w))).toEqual(new Set([1]));
      expect([...new Set(r.map((x) => x.gap))].every((n) => n === g.gap || n === g.gap + 1)).toBe(true);
    }
    expect(rows[0].filter((x) => x.gap > g.gap).length, 'no gap is wider, so nothing here is tested').toBeGreaterThan(5);
    // In how many rows each place along the lattice is followed by a wider gap: lined up, some would be in every row.
    const share = rows[0].map((_, k) => rows.filter((r) => r[k].gap > g.gap).length / rows.length);
    expect(Math.max(...share)).toBeLessThan(0.5);
  });
  it('is the same rows on a 2x screen, where a pixel either side is a small part of a square', () => {
    const g = strataGrid({ colW: 6.616, rowsH: 450, peak: 576, dpr: 2 });
    expect(row(g, 2, 300).map((r) => r.w)).toEqual(row(g, 2, 296).map((r) => r.w));
  });
});

describe('tailColumns', () => {
  it('puts each of the pile\'s people in the lattice column their own pay falls in', () => {
    // An axis to $3M across 1,500px: $2,000 a px; two px a column.
    expect([...tailColumns([250_000, 251_000, 3_000_000], 1500 / 3_000_000, 2)]).toEqual([62, 62, 750]);
  });
});

describe('snapReach', () => {
  it('names the one under the pointer where people crowd, and reaches across the lens where a filter leaves a few', () => {
    // A lens of 76px over the crowded middle: a few thousand people in it, about two px apart.
    expect(snapReach(3700, 76, 1.5)).toBeLessThan(6);
    expect(snapReach(3700, 76, 1.5)).toBeGreaterThanOrEqual(1.5);
    // Up to twenty of a filter's people in it: anywhere in the lens.
    expect(snapReach(2, 76, 1.5)).toBe(76);
    expect(snapReach(20, 76, 1.5)).toBeGreaterThan(70);
    // Thinner, further.
    expect(snapReach(40, 76, 1.5)).toBeGreaterThan(snapReach(400, 76, 1.5));
    expect(snapReach(0, 76, 1.5)).toBe(0);
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
