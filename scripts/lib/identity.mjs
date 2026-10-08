/**
 * One person split in two. The source has no employee ID, so a person is their name and hire date
 * (normalize `makePersonKey`); when the hire date a workbook gives someone changes — corrected, or a rehire —
 * they become a second person, the first "leaving" one snapshot and the second "joining" the next. Timothy
 * Vertein, IT Manager in the School of Medicine and Public Health, was hired 2013-09-23 in Sep 2024 and
 * 2017-05-08 from Apr 2025 on, at the same $120,000.
 *
 * Two keys are one person when all of these hold:
 *  - the same name, which no one else bears in either snapshot;
 *  - one's records end in the snapshot just before the other's begin;
 *  - in the same division, with the same title or the same department (each by their highest-paid
 *    appointment there).
 * Different people meet that by chance about once in all the snapshots (measured on the data, Oct 2026):
 * about 78 same-name pairs leave and join back to back by chance, and two unrelated people share a division
 * and a title or department 1.25% of the time. A name and the timing alone are not enough — of the pairs
 * with nothing else in common, about half are chance — and nor is an older hire date: a third of the people
 * who really are new arrive with one.
 *
 * Rows are `{ snapshot_date, person_key, school, title, department, salary }`. Returns each joined key's
 * canonical key — the latest in its chain, so a current person keeps their address — and the links.
 */
export function linkSplitPeople(rows) {
  const dates = [...new Set(rows.map((r) => r.snapshot_date))].sort();
  const rank = new Map(dates.map((d, i) => [d, i]));
  // Each key at each snapshot date (two snapshots can share one: pre- and post-TTC): its highest-paid row.
  const at = new Map();
  for (const r of rows) {
    const k = rank.get(r.snapshot_date);
    let m = at.get(r.person_key);
    if (!m) at.set(r.person_key, (m = new Map()));
    const cur = m.get(k);
    if (!cur || (r.salary ?? 0) > (cur.salary ?? 0)) m.set(k, r);
  }
  const nameOf = (key) => key.slice(0, key.lastIndexOf('|'));
  // Each name's keys, and how many bear it at each date.
  const byName = new Map(), bearers = new Map();
  for (const [key, m] of at) {
    const n = nameOf(key);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(key);
    for (const k of m.keys()) bearers.set(`${n}@${k}`, (bearers.get(`${n}@${k}`) ?? 0) + 1);
  }
  const next = new Map();
  const links = [];
  for (const [n, keys] of byName) {
    if (keys.length < 2) continue;
    for (const a of keys) {
      const ma = at.get(a), last = Math.max(...ma.keys());
      if (bearers.get(`${n}@${last}`) !== 1) continue;
      for (const b of keys) {
        const mb = at.get(b), first = Math.min(...mb.keys());
        if (b === a || first !== last + 1 || bearers.get(`${n}@${first}`) !== 1) continue;
        const x = ma.get(last), y = mb.get(first);
        if (!x.school || x.school !== y.school) continue;
        if (!(x.title && x.title === y.title) && !(x.department && x.department === y.department)) continue;
        next.set(a, b);
        links.push({ from: a, to: b, date: dates[first] });
      }
    }
  }
  const canon = new Map();
  for (const a of next.keys()) {
    let c = next.get(a);
    while (next.has(c)) c = next.get(c);
    canon.set(a, c);
  }
  return { canon, links };
}
