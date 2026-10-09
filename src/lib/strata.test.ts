import { describe, expect, it } from 'vitest';
import {
  BAR_MIN, FLOORS, FLOOR_GAP, FLOOR_PITCH, floorLabel, floorOf, floorPay, floorsGrid, COLS, COL_DOLLARS, GUTTER, GUTTER_SHARE, colHeight, colLeft, colX, fisheye, landEase, placePins, shareAt, snapReach, squareAt, standingIn, stepTiming, STEP_MS, STEP_WAVE_MS, squarePixels, stackColumns, strataFromCounts, strataGrid,
  tailColumns, typeRanks, within,
} from './strata';

const PC = {
  lo100: 48,
  counts: [3, 0, 2, 1],
  categories: [
    { name: 'Faculty', over: 2, counts: [1, 0, 1, 0], over_pays: [260_000, 410_000] },
    { name: 'Academic Staff', over: 1, counts: [2, 0, 1, 1], over_pays: [300_000] },
  ],
};

describe('strataFromCounts', () => {
  it('lays people out in the order dotSpots indexes them, each in its $5k column with its bucket’s pay', () => {
    const s = strataFromCounts(PC)!;
    // $4,800 bucket: Faculty then Academic Staff; $5,000 and $5,100: column 1.
    expect(COL_DOLLARS).toBe(5000);
    expect([...s.pay]).toEqual([4800, 4800, 4800, 5000, 5000, 5100]);
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
    expect([...typeRanks(['Faculty', 'Academic Staff', 'Other'])]).toEqual([2, 0, 7]);
  });
});

describe('stackColumns', () => {
  it('sorts each column by salary from the floor, ties by type, the same every time', () => {
    const s = strataFromCounts(PC)!;
    const a = stackColumns(s.col, s.pay, s.kind, s.key, s.rank, COLS);
    const b = stackColumns(s.col, s.pay, s.kind, s.key, s.rank, COLS);
    expect([...a.slot]).toEqual([...b.slot]);
    // Column 0, all at $4,800: the two Academic Staff (rank 0) under the one Faculty (rank 2).
    expect(a.slot[0]).toBe(2);
    expect(new Set([a.slot[1], a.slot[2]])).toEqual(new Set([0, 1]));
    // Column 1: pay first — the Academic Staff member on $5,100 over the Faculty member on $5,000.
    expect([a.slot[4], a.slot[3], a.slot[5]]).toEqual([0, 1, 2]);
  });
});

// 1,440px of plot: 51 columns of 28.2px; the tallest $5k column in any snapshot, 2,099 people.
const colW = 1440 / 51;

describe('strataGrid', () => {
  it('takes the largest whole-pixel pitch that still stands the tallest column in the room', () => {
    for (const dpr of [1, 2]) {
      const g = strataGrid({ colW, rowsH: 450, peak: 2099, dpr });
      const pd = Math.round(g.pitch * dpr);
      expect(g.pitch * dpr, `${dpr}x`).toBeCloseTo(pd, 9);
      expect(g.rowPitch).toBe(g.pitch);
      expect(colHeight(2099, g), `${dpr}x`).toBeLessThanOrEqual(450);
      // A pixel more, and the column would not fit in the room (or a row would not hold a square).
      const room = Math.floor(colW * dpr) - Math.max(1, Math.round(Math.min(GUTTER, colW * GUTTER_SHARE) * dpr)), per = Math.floor(room / (pd + 1));
      expect(per < 1 || Math.ceil(2099 / per) * (pd + 1) > Math.floor(450 * dpr), `${dpr}x: ${pd + 1}px would fit`).toBe(true);
      // As few a row as stand it in the room, the bar no narrower than BAR_MIN of its column.
      expect(g.per).toBeLessThanOrEqual(Math.floor(room / pd));
      expect(g.per * pd).toBeGreaterThanOrEqual(BAR_MIN * room - pd);
      if (g.per > Math.ceil((BAR_MIN * room) / pd)) expect(Math.ceil(2099 / (g.per - 1)) * pd, `${dpr}x: one fewer a row would fit`).toBeGreaterThan(Math.floor(450 * dpr));
    }
  });
  it('draws each square a device pixel short of its pitch, so a gap always parts it from the next', () => {
    for (const dpr of [1, 2]) {
      const g = strataGrid({ colW, rowsH: 450, peak: 2099, dpr });
      expect(g.gap).toBe(1);
      expect(g.sq * dpr).toBeCloseTo(g.pitch * dpr - 1, 9);
      expect(g.sqW).toBe(g.sq);
    }
  });
  it('centres each column’s squares, a gutter of a few pixels between one column and the next', () => {
    const dpr = 2, g = strataGrid({ colW, rowsH: 450, peak: 2099, dpr });
    const cw = Math.floor(colW * dpr), used = g.per * g.pitch * dpr;
    expect(cw - used).toBeGreaterThanOrEqual(2 * 2);
    expect(Math.abs(cw - used - 2 * g.off)).toBeLessThanOrEqual(1);
    expect(colX(3, colW, g, dpr) * dpr).toBe(Math.round(3 * colW * dpr) + g.off);
  });
  it('stands the tallest column in most of the room: 1440x900 at 2x', () => {
    // A 1,360px plot and 341px of room: whole-pixel squares at their widest stood it at 62% of it.
    const g = strataGrid({ colW: 1360 / 51, rowsH: 341, peak: 2099, dpr: 2 });
    expect(colHeight(2099, g)).toBeGreaterThan(0.8 * 341);
    expect(colHeight(2099, g)).toBeLessThanOrEqual(341);
  });
  it('where no pitch of two pixels fits (a phone; a 1x screen), stands solid bars of single pixels in the room', () => {
    for (const [colW, rowsH, dpr] of [[343 / 51, 240, 2], [1360 / 51, 341, 1]] as const) {
      const g = strataGrid({ colW, rowsH, peak: 2099, dpr });
      expect(g.pitch * dpr).toBeCloseTo(1, 9);
      expect(g.gap).toBe(0);
      expect(colHeight(2099, g)).toBeLessThanOrEqual(rowsH + 1e-9);
      expect(colHeight(2099, g)).toBeGreaterThan(0.95 * rowsH);
      expect(g.per).toBeGreaterThanOrEqual(BAR_MIN * (Math.floor(colW * dpr) - Math.max(1, Math.round(Math.min(GUTTER, colW * GUTTER_SHARE) * dpr))));
    }
  });
  it('grows the squares full page', () => {
    const page = strataGrid({ colW, rowsH: 320, peak: 2099, dpr: 2 });
    const full = strataGrid({ colW, rowsH: 700, peak: 2099, dpr: 2 });
    expect(full.sq).toBeGreaterThan(page.sq);
  });
  it('places squares row by row up from the baseline, each column on its own device pixel', () => {
    const g = { pitch: 2, rowPitch: 2 };
    expect(colLeft(10, 28.3, 2)).toBeCloseTo(283, 9);
    expect(colLeft(1, 28.3, 2)).toBeCloseTo(28.5, 9);
    expect(squareAt(100, 13, 12, g, 300)).toEqual({ x: 102, y: 296 });
  });
});

describe('squarePixels', () => {
  it('puts every square on whole pixels, its side the pitch less the gap, the gaps all alike across and up', () => {
    for (const dpr of [1, 2]) {
      const g = strataGrid({ colW, rowsH: 450, peak: 2099, dpr });
      const x0 = colX(7, colW, g, dpr), seen = new Set<string>();
      let prev: { X: number; Y: number; w: number; h: number } | null = null;
      for (let slot = 0; slot < g.per * 4; slot++) {
        const at = squareAt(x0, slot, g.per, g, 400);
        const b = squarePixels(at.x, at.y, g, dpr, { X: 0, Y: 0, w: 0, h: 0 });
        expect([b.w, b.h]).toEqual([g.pitch * dpr - 1, g.pitch * dpr - 1].map(Math.round));
        if (prev && slot % g.per) { expect(b.X - (prev.X + prev.w), `${dpr}x`).toBe(1); expect(b.Y).toBe(prev.Y); }
        if (slot >= g.per) {
          const below = squarePixels(...(Object.values(squareAt(x0, slot - g.per, g.per, g, 400)) as [number, number]), g, dpr);
          expect(below.Y - (b.Y + b.h), `${dpr}x`).toBe(1);
        }
        seen.add(`${b.X},${b.Y}`);
        prev = b;
      }
      expect(seen.size).toBe(g.per * 4);
    }
  });
});

describe('floors', () => {
  it('puts everyone in a $10k band: under $30k, $30–40k … $190–200k, and $200k or more', () => {
    expect(FLOORS).toBe(19);
    expect([29_999, 30_000, 39_999.5, 40_000, 199_999, 200_000, 1_400_000].map(floorOf)).toEqual([0, 1, 1, 2, 17, 18, 18]);
    expect([0, 1, 5, 17, 18].map(floorLabel)).toEqual(['Under $30k', '$30–40k', '$70–80k', '$190–200k', '$200k+']);
    for (let f = 1; f < FLOORS; f++) expect(floorOf(floorPay(f))).toBe(f);
    expect(floorPay(0)).toBe(0);
  });
  // The latest's floors, from the bottom up.
  const counts = [631, 961, 1859, 2039, 3288, 2557, 1974, 1704, 1269, 930, 755, 574, 592, 400, 336, 273, 243, 207, 1370];
  const height = (g: { per: number; pitch: number; gap: number }, least: number, k = 1) =>
    counts.reduce((t, n) => t + Math.max(least, Math.max(1, Math.ceil((n * k) / g.per)) * g.pitch), 0) + (counts.length - 1) * g.gap;
  it('takes the largest whole-pixel square up to 3a’s 6px with which every floor fits the room, with room for another snapshot', () => {
    for (const [width, room, dpr, least, gapLeast] of [[1144, 394, 2, 14, 3], [1144, 394, 1, 14, 3], [1800, 900, 2, 14, 3], [276, 293, 2, 13, 2]] as const) {
      const g = floorsGrid({ width, room, counts, least, dpr, gapLeast });
      const pd = Math.round(g.pitch * dpr);
      expect(g.pitch * dpr, `${width}@${dpr}x`).toBeCloseTo(pd, 9);
      expect(g.pitch).toBeLessThanOrEqual(FLOOR_PITCH);
      expect(g.per).toBe(Math.floor(width / g.pitch));
      expect(height(g, least), `${width}@${dpr}x: past the room`).toBeLessThanOrEqual(room + 1e-9);
      expect(g.gap).toBeGreaterThanOrEqual(gapLeast);
      expect(g.gap).toBeLessThanOrEqual(FLOOR_GAP.most);
      // A pixel more, and it would not fit (or would pass 6px).
      const p1 = (pd + 1) / dpr, per1 = Math.floor(width / p1);
      if (p1 <= FLOOR_PITCH) expect(height({ per: per1, pitch: p1, gap: gapLeast }, least, 1.05), `${width}@${dpr}x: ${pd + 1}px would fit`).toBeGreaterThan(room);
    }
    // Room to spare: 3a's own 6px, the floors a most-gap apart.
    const roomy = floorsGrid({ width: 1144, room: 2000, counts, least: 14, dpr: 2 });
    expect(roomy.pitch).toBe(FLOOR_PITCH);
    expect(roomy.gap).toBe(FLOOR_GAP.most);
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

describe('stepTiming', () => {
  const W = 1000;
  const end = (t: { wait: number; ms: number }) => t.wait + t.ms;
  it('fades who left out before anyone who joined is in, and starts the joiners once the rest are on their way', () => {
    for (const x of [0, 500, 1000]) {
      expect(end(stepTiming('leave', x, W))).toBeLessThan(end(stepTiming('join', x, W)));
      expect(stepTiming('join', x, W).wait).toBeGreaterThan(stepTiming('stay', x, W).wait + STEP_MS * 0.3);
    }
  });
  it('has every square at rest by the wave and a square’s time, inside a playing step’s 1.5 s, with a beat to spare', () => {
    for (const role of ['stay', 'arc', 'join', 'leave'] as const) for (const x of [0, 400, 1000, 1200]) {
      expect(end(stepTiming(role, x, W))).toBeLessThanOrEqual(STEP_WAVE_MS + STEP_MS + 1e-9);
    }
    expect(STEP_WAVE_MS + STEP_MS).toBeLessThanOrEqual(1500 - 200);
  });
  it('runs at half the pace the timeline first had (450 ms a square, a 130 ms sweep)', () => {
    expect(STEP_MS).toBeGreaterThanOrEqual(1.5 * 450);
  });
  it('at 2× and 4× sets every square off and lands it that much sooner, still at rest before the next step', () => {
    for (const speed of [2, 4]) for (const role of ['stay', 'arc', 'join', 'leave'] as const) for (const x of [0, 400, 1000]) {
      const one = stepTiming(role, x, W), fast = stepTiming(role, x, W, speed);
      expect(fast.wait).toBeCloseTo(one.wait / speed, 9);
      expect(fast.ms).toBeCloseTo(one.ms / speed, 9);
      expect(end(fast)).toBeLessThanOrEqual(1500 / speed - 200 / speed);
    }
  });
});

describe('standingIn', () => {
  it('ranks by how many are paid more and counts how many are paid less, ties neither', () => {
    const desc = [90, 80, 80, 70, 60];
    expect(standingIn(desc, 90)).toEqual({ rank: 1, below: 4 });
    expect(standingIn(desc, 80)).toEqual({ rank: 2, below: 2 });
    expect(standingIn(desc, 60)).toEqual({ rank: 5, below: 0 });
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
