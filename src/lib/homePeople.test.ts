import { describe, expect, it } from 'vitest';
import { dotSpots, emphasis, filterPeopleSql, homePeopleSql, medianOf, type HomePerson, type PayCounts } from './homePeople';
import { peopleFromCounts } from './dotLayout';

const CAP = 250000;
const CATS = ['Academic Staff', 'University Staff', 'Faculty'];

/** People with pays that share buckets and tie exactly, some over the cap and some unpaid. */
function crowd(n: number): HomePerson[] {
  const out: HomePerson[] = [];
  for (let i = 0; i < n; i++) {
    const pay = i % 97 === 0 ? 0 : i % 41 === 0 ? CAP + ((i * 7919) % 900000) : 20000 + ((i * 7919) % 180000) - (i % 5 === 0 ? (i % 3) * 0.5 : 0);
    out.push({ person_key: `p${String(i).padStart(4, '0')}`, pay: i % 13 === 0 ? 60416 : pay, cat: CATS[(i * 31) % CATS.length] });
  }
  return out;
}

/** The counts home-stats.mjs would ship for `people`: per $100 under the cap, per category (largest first),
 *  and each category's count over the cap. */
function countsOf(people: HomePerson[]): PayCounts {
  const paid = people.filter((p) => p.pay != null && p.pay > 0);
  const under = paid.filter((p) => p.pay! < CAP);
  const lo100 = Math.min(...under.map((p) => Math.floor(p.pay! / 100)));
  const hi100 = Math.max(...under.map((p) => Math.floor(p.pay! / 100)));
  const counts = new Array(hi100 - lo100 + 1).fill(0);
  for (const p of under) counts[Math.floor(p.pay! / 100) - lo100]++;
  const names = [...new Set(paid.map((p) => p.cat))].sort((a, b) => paid.filter((p) => p.cat === b).length - paid.filter((p) => p.cat === a).length || a.localeCompare(b));
  const categories = names.map((name) => {
    const own = new Array(counts.length).fill(0);
    for (const p of under) if (p.cat === name) own[Math.floor(p.pay! / 100) - lo100]++;
    return { name, over: paid.filter((p) => p.cat === name && p.pay! >= CAP).length, counts: own };
  });
  return { lo100, counts, categories };
}

describe('dotSpots', () => {
  const people = crowd(4000);
  const pc = countsOf(people);
  const spots = dotSpots(people, pc, CAP)!;

  it('gives every paid person one dot, and every dot one person', () => {
    expect(spots).not.toBeNull();
    const paid = people.filter((p) => p.pay! > 0);
    expect(spots.size).toBe(paid.length);
    const main = [...spots.values()].filter((s) => s.field === 'main').map((s) => s.index).sort((a, b) => a - b);
    const pile = [...spots.values()].filter((s) => s.field === 'pile').map((s) => s.index).sort((a, b) => a - b);
    expect(main).toEqual(main.map((_, i) => i));
    expect(pile).toEqual(pile.map((_, i) => i));
    expect(main.length).toBe(pc.counts.reduce((t, n) => t + n, 0));
    for (const p of people) if (!(p.pay! > 0)) expect(spots.has(p.person_key)).toBe(false);
  });

  it("puts each person on a dot of their own $100 and their own category, as the page draws it", () => {
    const { pays, kinds } = peopleFromCounts(pc.lo100, pc.counts, pc.categories);
    const catIndex = new Map(pc.categories!.map((c, i) => [c.name, i]));
    for (const p of people) {
      const s = spots.get(p.person_key);
      if (!s || s.field !== 'main') continue;
      expect(Math.floor(pays[s.index] / 100), p.person_key).toBe(Math.floor(p.pay! / 100));
      expect(kinds![s.index], p.person_key).toBe(catIndex.get(p.cat));
    }
  });

  it('puts the people over the cap in their category\'s block of the pile, lowest pay first', () => {
    const catIndex = new Map(pc.categories!.map((c, i) => [c.name, i]));
    const starts = pc.categories!.map((_, c) => pc.categories!.slice(0, c).reduce((t, x) => t + x.over, 0));
    const over = people.filter((p) => p.pay! >= CAP);
    expect(over.length).toBeGreaterThan(20);
    for (const p of over) {
      const s = spots.get(p.person_key)!;
      const c = catIndex.get(p.cat)!;
      expect(s.field).toBe('pile');
      expect(s.index).toBeGreaterThanOrEqual(starts[c]);
      expect(s.index).toBeLessThan(starts[c] + pc.categories![c].over);
    }
    const block = over.filter((p) => p.cat === pc.categories![0].name).sort((a, b) => spots.get(a.person_key)!.index - spots.get(b.person_key)!.index);
    for (let k = 1; k < block.length; k++) expect(block[k].pay!).toBeGreaterThanOrEqual(block[k - 1].pay!);
  });

  it('is the same whatever order the people come in', () => {
    const shuffled = [...people].sort((a, b) => ((a.person_key.charCodeAt(4) * 7) % 11) - ((b.person_key.charCodeAt(4) * 7) % 11) || b.person_key.localeCompare(a.person_key));
    const again = dotSpots(shuffled, pc, CAP)!;
    for (const [k, s] of spots) expect(again.get(k)).toEqual(s);
  });

  it('refuses people the counts do not describe, rather than mark the wrong dot', () => {
    expect(dotSpots(people.slice(1), pc, CAP)).toBeNull();
    expect(dotSpots([...people, { person_key: 'extra', pay: 61000, cat: CATS[0] }], pc, CAP)).toBeNull();
    // Someone moved a $100 along: every count still sums, but two buckets no longer match.
    const moved = people.map((p) => (p.person_key === 'p0001' ? { ...p, pay: p.pay! + 100 } : p));
    expect(dotSpots(moved, pc, CAP)).toBeNull();
    // Someone in another category: a bucket's counts by category no longer match.
    const recat = people.map((p) => (p.person_key === 'p0001' ? { ...p, cat: CATS.find((c) => c !== p.cat)! } : p));
    expect(dotSpots(recat, pc, CAP)).toBeNull();
    expect(dotSpots(people.map((p) => (p.person_key === 'p0001' ? { ...p, cat: 'Nobody' } : p)), pc, CAP)).toBeNull();
    expect(dotSpots(people, { ...pc, categories: null }, CAP)).toBeNull();
  });
});

describe('filterPeopleSql', () => {
  it('counts only paid appointments, as the dots do, and asks for the title and the school of one appointment', () => {
    const sql = filterPeopleSql('2026-03', { jobCode: 'FA020', school: 'School of Medicine and Public Health' });
    const hit = sql.slice(sql.indexOf('hit AS'));
    expect(hit).toContain("snapshot_id = '2026-03'");
    expect(hit).toContain('salary > 0');
    // Both conditions on the same rows: one appointment that is both, not one of each.
    expect(hit).toMatch(/job_code = 'FA020' AND school = 'School of Medicine and Public Health'/);
    // The pay is the dot's, from the same rows the dots are counted from.
    expect(sql).toContain(homePeopleSql('2026-03'));
    expect(sql).toMatch(/WHERE pay > 0/);
  });
  it('takes either alone, and will not run with neither', () => {
    expect(filterPeopleSql('s', { jobCode: 'FA020' })).not.toContain('school =');
    expect(filterPeopleSql('s', { school: 'L&S' })).not.toContain('job_code =');
    expect(() => filterPeopleSql('s', {})).toThrow();
  });
  it('quotes what it is given', () => {
    expect(filterPeopleSql('s', { school: "O'Brien Hall" })).toContain("school = 'O''Brien Hall'");
  });
});

describe('medianOf', () => {
  it('is the continuous median: the middle one, or halfway between the middle two', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([5])).toBe(5);
    expect(medianOf([1, 2, 9])).toBe(2);
    expect(medianOf([1, 2, 9, 10])).toBe(5.5);
  });
});

describe('emphasis', () => {
  const spots = new Map<string, { field: 'main' | 'pile'; index: number }>([
    ['a', { field: 'main', index: 0 }],
    ['b', { field: 'main', index: 3 }],
    ['c', { field: 'pile', index: 1 }],
  ]);
  it('lights the group in both fields and dims everyone else', () => {
    const e = emphasis(spots, [{ person_key: 'a', pay: 50000 }, { person_key: 'c', pay: 300000 }], { main: 5, pile: 2 });
    expect([...e.main]).toEqual([0, 1, 1, 1, 1]);
    expect([...e.pile]).toEqual([1, 0]);
    expect(e.count).toBe(2);
    expect(e.median).toBe(175000);
    expect(e.pays).toEqual([50000, 300000]);
  });
  it('counts and medians only the people it lit: someone with no dot changes neither', () => {
    const e = emphasis(spots, [{ person_key: 'b', pay: 70000 }, { person_key: 'nobody', pay: 1 }], { main: 5, pile: 2 });
    expect(e.count).toBe(1);
    expect(e.median).toBe(70000);
    expect(e.main.reduce((t, v) => t + v, 0)).toBe(4);
  });
  it('lights a dot once however often its person is listed, and ignores a place past the field', () => {
    const odd = new Map([['a', { field: 'main' as const, index: 0 }], ['z', { field: 'main' as const, index: 9 }]]);
    const e = emphasis(odd, [{ person_key: 'a', pay: 1 }, { person_key: 'a', pay: 1 }, { person_key: 'z', pay: 2 }], { main: 2, pile: 0 });
    expect(e.count).toBe(1);
  });
});
