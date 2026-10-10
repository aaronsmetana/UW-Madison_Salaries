import { describe, expect, it } from 'vitest';
import {
  BAR_MIN, MAG_COLS, MAG_LEFT_MAX, magLeftFor, FLOORS, FLOOR_GAP, FLOOR_PITCH, floorLabel, floorOf, floorPay, floorsGrid, COLS, COL_DOLLARS, GUTTER, GUTTER_SHARE, colHeight, colLeft, colX, placePins, shareAt, snapReach, squareAt, standingIn, squarePixels, DOWN, FAST_MS, LEFT, NEW, STAY, UP, moveTiming, pacePlan, sortTiming, stagedSlots, hermite, monoTangent, stackColumns, strataFromCounts, strataGrid,
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

describe('magnify', () => {
  it('centres a $30k window on a pay’s column, as far as the axis goes', () => {
    expect(MAG_COLS * 5000).toBe(30_000);
    expect(magLeftFor(92_000)).toBe(77_500);
    expect(magLeftFor(3_000)).toBe(0);
    expect(magLeftFor(900_000)).toBe(MAG_LEFT_MAX);
    expect(MAG_LEFT_MAX + MAG_COLS * 5000).toBe(51 * 5000);
  });
  it('magnified, the squares grow past the histogram’s cap, the columns a wider gutter apart', () => {
    const page = strataGrid({ colW: 1360 / 51, rowsH: 341, peak: 2099, dpr: 2 });
    const mag = strataGrid({ colW: 1360 / 6, rowsH: 300, peak: 2099, dpr: 2, maxPitch: 30, gutter: 12 });
    expect(mag.pitch).toBeGreaterThan(2 * page.pitch);
    expect(colHeight(2099, mag)).toBeLessThanOrEqual(300);
    expect(Math.floor((1360 / 6) * 2) - mag.per * mag.pitch * 2).toBeGreaterThanOrEqual(24);
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

describe('pacePlan', () => {
  it('stages raises and cuts at Slow and Medium — move, countdown, re-sort, pause — with Slow’s countdown the reader’s', () => {
    expect(pacePlan('slow', 'change')).toEqual({ mv: 2600, cd: 3000, so: 1700, re: 1600, staged: true });
    expect(pacePlan('slow', 'change', 5).cd).toBe(5000);
    expect(pacePlan('medium', 'change')).toEqual({ mv: 1500, cd: 1000, so: 900, re: 700, staged: true });
  });
  it('moves straight between sorted places by employment type, and at Fast in either mode without a pause', () => {
    expect(pacePlan('slow', 'type')).toEqual({ mv: 2600, cd: 0, so: 0, re: 1600, staged: false });
    expect(pacePlan('medium', 'type')).toEqual({ mv: 1700, cd: 0, so: 0, re: 900, staged: false });
    for (const md of ['change', 'type'] as const) expect(pacePlan('fast', md)).toEqual({ mv: FAST_MS, cd: 0, so: 0, re: 0, staged: false });
    expect(FAST_MS).toBe(250);
  });
});

describe('moveTiming', () => {
  const end = (t: { dl: number; du: number }) => t.dl + t.du;
  it('has every square of a step at rest by the move’s end, wherever it stands and however far it goes', () => {
    for (const k of [STAY, UP, DOWN, NEW, LEFT]) for (const w of [0, 0.5, 1]) for (const h of [0, 0.99]) for (const dx of [0, 100, 1000]) {
      expect(end(moveTiming(k, w, h, dx))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it('sets off left to right, the movers first, those who joined once the rest are on their way, and who left soonest out', () => {
    expect(moveTiming(UP, 1, 0).dl).toBeGreaterThan(moveTiming(UP, 0, 0).dl);
    expect(moveTiming(NEW, 0, 0).dl).toBeGreaterThan(moveTiming(STAY, 0, 0).dl + 0.1);
    for (const w of [0, 1]) expect(end(moveTiming(LEFT, w, 0.99))).toBeLessThan(end(moveTiming(NEW, w, 0)));
  });
  it('arcs a mover higher the farther it goes, up to 110px, and takes it a little longer', () => {
    expect(moveTiming(UP, 0, 0, 40).arc).toBeLessThan(moveTiming(UP, 0, 0, 300).arc);
    expect(moveTiming(DOWN, 0, 0, -5000).arc).toBe(110);
    expect(moveTiming(UP, 0, 0, 260).du).toBeGreaterThan(moveTiming(UP, 0, 0, 0).du);
    expect(moveTiming(STAY, 0, 0, 300).arc).toBe(0);
  });
});

describe('sortTiming', () => {
  it('ripples up each column from the bottom, every square sorted by the re-sort’s end', () => {
    expect(sortTiming(0, 10, 0).dl).toBe(0);
    expect(sortTiming(9, 10, 0).dl).toBeGreaterThan(sortTiming(1, 10, 0).dl);
    for (const k of [0, 5, 10]) expect(sortTiming(k, 10, 0.99).dl + sortTiming(k, 10, 0.99).du).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('monoTangent and hermite (Fast’s flow)', () => {
  it('meets each place exactly, at either end of its step', () => {
    expect(hermite(10, 30, 7, -3, 0)).toBe(10);
    expect(hermite(10, 30, 7, -3, 1)).toBeCloseTo(30, 12);
  });
  it('is flat where the path turns back or a neighbour is unknown, so a square slows into a turn', () => {
    expect(monoTangent(0, 10, 5)).toBe(0);
    expect(monoTangent(10, 10, 20)).toBe(0);
    expect(monoTangent(NaN, 10, 20)).toBe(0);
    expect(monoTangent(0, 10, NaN)).toBe(0);
  });
  it('never overshoots: on a path that keeps one way, every point of every step lies between its two places', () => {
    const paths = [[0, 1, 100, 101], [0, 100, 101, 300], [500, 20, 19, 0], [0, 0.5, 200, 200.5, 1000]];
    for (const P of paths) for (let s = 0; s + 1 < P.length; s++) {
      const m0 = monoTangent(P[s - 1] ?? NaN, P[s], P[s + 1]), m1 = monoTangent(P[s], P[s + 1], P[s + 2] ?? NaN);
      const lo = Math.min(P[s], P[s + 1]), hi = Math.max(P[s], P[s + 1]);
      for (let t = 0; t <= 1; t += 0.01) {
        const v = hermite(P[s], P[s + 1], m0, m1, t);
        expect(v, `step ${s} of [${P}] at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v, `step ${s} of [${P}] at ${t.toFixed(2)}`).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
  it('runs on from one step into the next at the same speed: one tangent ends the first and starts the second', () => {
    const P = [0, 40, 100], m = monoTangent(P[0], P[1], P[2]), h = 1e-6;
    const end = (hermite(P[0], P[1], 0, m, 1) - hermite(P[0], P[1], 0, m, 1 - h)) / h;
    const start = (hermite(P[1], P[2], m, 0, h) - hermite(P[1], P[2], m, 0, 0)) / h;
    expect(m).toBeGreaterThan(0);
    expect(end).toBeCloseTo(m, 3);
    expect(start).toBeCloseTo(m, 3);
  });
});

describe('stagedSlots', () => {
  it('keeps who stayed at the bottom of their column in their old order, then stacks cuts, raises and new hires on top', () => {
    // Column 0: two who stayed (old slots 5 and 2), a raise, a new hire, a cut. Column 1: one who stayed.
    const group = [0, 0, 0, 0, 0, 1], kind = [STAY, STAY, UP, NEW, DOWN, STAY], prev = [5, 2, 0, 0, 0, 7], key = [1, 2, 3, 4, 5, 6];
    expect([...stagedSlots(group, kind, prev, key)]).toEqual([1, 0, 3, 4, 2, 0]);
  });
  it('orders each arriving kind by key', () => {
    expect([...stagedSlots([0, 0, 0], [UP, UP, UP], [0, 0, 0], [30, 10, 20])]).toEqual([2, 0, 1]);
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

