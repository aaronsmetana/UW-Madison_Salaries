import { describe, expect, it } from 'vitest';
import { BIG_STEP, CODED, bigMoves, buildTimeline, followText, quantileCont, snapStats, strataFromPeople, timelineSql, type SnapPeople } from './timeline';
import { stableKey } from './strata';

const NAMES = ['Academic Staff', 'University Staff', 'Faculty'];
const snap = (rows: [id: number, pay: number, kind: number][]): SnapPeople => ({
  id: Int32Array.from(rows, (r) => r[0]), pay: Float64Array.from(rows, (r) => r[1]), kind: Uint8Array.from(rows, (r) => r[2]),
});

describe('timelineSql', () => {
  it('folds the spellings of one category into the latest name, and puts the codes in a kind of their own', () => {
    const sql = timelineSql(['2022-03', '2024-04'], ['Academic Staff', 'Employees in Training', 'Limited']);
    expect(sql).toContain("WHEN 'Employee-In-Training' THEN 'Employees in Training'");
    expect(sql).toContain("WHEN 'Limited Appointee' THEN 'Limited'");
    expect(sql).toContain('ELSE 3 END');
    expect(sql).not.toMatch(/'CP'|'CL'/);
  });
});

describe('buildTimeline', () => {
  it('splits the rows by snapshot, and names the codes last', () => {
    const t = buildTimeline(
      { snap: [0, 0, 1], id: [0, 2, 2], pay: [50_000, 60_000, 66_000], kind: [0, 3, 1] },
      ['a', 'b', 'c'], [{ id: 's0', label: 'S0' }, { id: 's1', label: 'S1' }], NAMES,
    );
    expect(t.names).toEqual([...NAMES, CODED]);
    expect([...t.at[0].id]).toEqual([0, 2]);
    expect([...t.at[1].pay]).toEqual([66_000]);
    expect([...t.at[0].kind]).toEqual([0, 3]);
  });
});

describe('strataFromPeople', () => {
  const p = snap([[7, 51_200, 0], [3, 51_900, 2], [9, 300_000, 2], [4, 260_000, 0], [5, 12_000, 1]]);
  it('puts each person in their $1k column, the pile in kind blocks, and keeps who each square is', () => {
    const s = strataFromPeople(p, NAMES, 250_000);
    expect([...s.mainId]).toEqual([5, 7, 3]);
    expect([...s.col]).toEqual([12, 51, 51]);
    expect(s.colCount[51]).toBe(2);
    expect([...s.pileId]).toEqual([4, 9]);
    expect([...s.pilePay!]).toEqual([260_000, 300_000]);
    expect([...s.mainPay]).toEqual([12_000, 51_200, 51_900]);
  });
  it('places a person in their band by their own number, the same in every snapshot', () => {
    const s = strataFromPeople(p, NAMES, 250_000);
    expect(s.key[1]).toBe(stableKey(7));
  });
});

describe('quantileCont and snapStats', () => {
  it('interpolate as DuckDB quantile_cont does', () => {
    expect(quantileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileCont([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantileCont([], 0.5)).toBeNull();
  });
  it('count a snapshot, its pile and each kind', () => {
    const st = snapStats(snap([[1, 40_000, 0], [2, 60_000, 0], [3, 300_000, 2], [4, 80_000, 3]]), 4, 250_000);
    expect(st.headcount).toBe(4);
    expect(st.median).toBe(70_000);
    expect(st.over).toBe(1);
    expect(st.byKind.map((k) => k.n)).toEqual([2, 0, 1, 1]);
    expect(st.byKind[0].median).toBe(50_000);
  });
});

describe('bigMoves', () => {
  it('names those whose pay moved 8% or more either way between two snapshots, and no one new or gone', () => {
    const a = snap([[1, 100_000, 0], [2, 100_000, 0], [3, 100_000, 0], [4, 100_000, 0]]);
    const b = snap([[1, 100_000 * BIG_STEP, 0], [2, 107_000, 0], [3, 100_000 / BIG_STEP, 0], [5, 90_000, 0]]);
    expect([...bigMoves(a, b, 6)]).toEqual([0, 1, 0, -1, 0, 0]);
  });
});

describe('followText', () => {
  it('counts the pay from the snapshot before as the square travels, and once there gives the change', () => {
    const f = { name: 'Ada Lovelace', pay: 104_000, from: 100_000 };
    expect(followText(f, 0)).toBe('Ada Lovelace · $100,000');
    expect(followText(f, 0.5)).toBe('Ada Lovelace · $102,000');
    expect(followText(f, 1)).toBe('Ada Lovelace · $104,000 (+4.0%)');
    expect(followText({ ...f, pay: 96_000 }, 1)).toBe('Ada Lovelace · $96,000 (−4.0%)');
    expect(followText({ ...f, pay: 100_000 }, 1)).toBe('Ada Lovelace · $100,000 (no change)');
    expect(followText({ ...f, from: null }, 1)).toBe('Ada Lovelace · $104,000');
  });
});
