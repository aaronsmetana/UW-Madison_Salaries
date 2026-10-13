import { test, expect, type Page } from '@playwright/test';
import { oracle } from './oracle';

/**
 * The History tab's table (P30–P35): newest first, its appointment lines the same picture turned over; the school
 * named once over a table that never leaves it, and at the top of each run where it does; FTE as a percentage; a
 * missing pay basis said in words; and each raise's comparison as a sentence.
 */

const AARON = 'aaronsmetana|2014-10-15';
const SMPH = 'School of Medicine and Public Health';
test.use({ viewport: { width: 1440, height: 1000 } });

async function history(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}?tab=history`);
  await expect(page.locator('table.appt-history tbody tr').first()).toBeVisible({ timeout: 60_000 });
}

/** A column's cells, by its header, as the screen shows them. */
async function column(page: Page, header: string) {
  const heads = (await page.locator('table.appt-history thead th').allInnerTexts()).map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase());
  const i = heads.indexOf(header);
  expect(i, `no "${header}" column in ${heads.join(' | ')}`).toBeGreaterThanOrEqual(0);
  return page.locator('table.appt-history tbody tr').evaluateAll((trs, i) => trs.map((tr) => (tr.children[i] as HTMLElement).innerText.trim()), i);
}

test('the newest snapshot is the top row, and the rest run back in time', async ({ page }) => {
  const snaps = await oracle<{ lbl: string }>(
    `SELECT any_value(snapshot_label) lbl FROM $SAL WHERE person_key = '${AARON}'
     GROUP BY snapshot_id, snapshot_date ORDER BY snapshot_date DESC, snapshot_id LIKE '%-pre'`
  );
  await history(page, AARON);
  // Each snapshot's label is the first badge in its first row's cell (a "New" may follow it).
  const drawn = await page.locator('table.appt-history td.appt-snapshot').evaluateAll((tds) =>
    tds.flatMap((td) => { const b = td.querySelector('.mantine-Badge-root'); return b ? [(b as HTMLElement).innerText.trim()] : []; }));
  expect(drawn).toEqual(snaps.map((s) => s.lbl));
});

test('turned over, a line that begins at a station runs up from it toward the newer rows', async ({ page }) => {
  // Someone whose lines restart after the first snapshot: the TTC relabel reissued every job code.
  const [p] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, count(*) k FROM $SAL WHERE salary > 0 GROUP BY 1, 2)
     SELECT person_key pk FROM s GROUP BY 1 HAVING max(k) = 2 AND count(*) >= 8 ORDER BY pk LIMIT 1`
  );
  await history(page, p.pk);
  const tracks = await page.locator('table.appt-history .appt-gutter-track[data-draw="from-node"]').evaluateAll((ts) => ts.map((t) => {
    const r = t.getBoundingClientRect();
    const cell = t.closest('td')!.getBoundingClientRect();
    return { top: r.top - cell.top, bottom: r.bottom - cell.top, mid: cell.height / 2 };
  }));
  expect(tracks.length, 'no line begins after the first snapshot here').toBeGreaterThan(0);
  for (const t of tracks) {
    expect(t.bottom, 'a beginning line runs down from its station, into the older rows').toBeLessThanOrEqual(t.mid + 1.5);
    expect(t.top, 'a beginning line does not reach the newer row above').toBeLessThan(2);
  }
  // The key and the method say which way the table runs.
  await expect(page.locator('.appt-history-card')).toContainText('continues the same appointment from the snapshot below');
  await expect(page.locator('.appt-history-card .history-method')).toContainText('Rows run newest first, and each “Change” is measured from the snapshot below it.');
});

test('every followed letter is joined by its own line to its letter in the snapshot below', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, count(*) k FROM $SAL WHERE salary > 0 GROUP BY 1, 2)
     SELECT person_key pk FROM s GROUP BY 1 HAVING max(k) = 2 AND count(*) >= 8 ORDER BY pk LIMIT 1`
  );
  // And Gulnara, whose lines restart at the TTC relabel and end in Aug 2022 and Sep 2025.
  for (const key of [p.pk, 'gulnaraglowacki|2020-06-06']) {
    await history(page, key);
    const gaps = await page.locator('table.appt-history').evaluate((table) => {
      const slot = (e: HTMLElement) => e.style.getPropertyValue('--slot');
      // Each lane's painted track, as runs of y; a pixel apart is one run (row borders).
      const runs = new Map<string, [number, number][]>();
      for (const t of table.querySelectorAll<HTMLElement>('.appt-gutter-track')) {
        const r = t.getBoundingClientRect();
        runs.set(slot(t), [...(runs.get(slot(t)) ?? []), [r.top, r.bottom]]);
      }
      for (const [k, rs] of runs) {
        rs.sort((a, b) => a[0] - b[0]);
        const merged: [number, number][] = [];
        for (const r of rs) {
          const last = merged[merged.length - 1];
          if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
          else merged.push([...r]);
        }
        runs.set(k, merged);
      }
      const stations = [...table.querySelectorAll<HTMLElement>('.appt-station')].map((e) => {
        const r = e.getBoundingClientRect();
        return { slot: slot(e), y: (r.top + r.bottom) / 2, followed: e.dataset.start === 'no', letter: e.textContent ?? '' };
      });
      const out: string[] = [];
      stations.forEach((st, i) => {
        if (!st.followed) return;
        const below = stations.slice(i + 1).find((b) => b.slot === st.slot);
        if (!below) return;
        const joined = (runs.get(st.slot) ?? []).some(([a, b]) => a <= st.y && b >= below.y);
        if (!joined) out.push(`${st.letter} at ${Math.round(st.y)} to ${Math.round(below.y)}`);
      });
      return { out, followed: stations.filter((s) => s.followed).length };
    });
    expect(gaps.followed, `${key}: no followed letters to join`).toBeGreaterThan(4);
    expect(gaps.out, `${key}: a line breaks between a letter and its own below`).toEqual([]);
  }
});

test('one school throughout is the table’s header, not its first row’s', async ({ page }) => {
  await history(page, AARON);
  await expect(page.locator('.appt-history-card .history-school')).toHaveText(`All in ${SMPH}`);
  await expect(page.locator('table.appt-history .appt-school')).toHaveCount(0);
  expect(await column(page, 'department')).not.toContain('');
});

test('where the school changes, each run names it on its top row', async ({ page }) => {
  const [p] = await oracle<{ pk: string }>(
    `WITH s AS (SELECT person_key, snapshot_id, count(*) k, any_value(school) sch FROM $SAL GROUP BY 1, 2)
     SELECT person_key pk FROM s GROUP BY 1 HAVING max(k) = 1 AND count(DISTINCT sch) = 2 AND count(*) >= 6 ORDER BY pk LIMIT 1`
  );
  const rows = await oracle<{ sch: string }>(
    `SELECT school sch FROM $SAL WHERE person_key = '${p.pk.replaceAll("'", "''")}' ORDER BY snapshot_date DESC, snapshot_id LIKE '%-pre'`
  );
  const runs = rows.map((r) => r.sch).filter((s, i, a) => i === 0 || s !== a[i - 1]);
  expect(runs.length).toBeGreaterThan(1);
  await history(page, p.pk);
  await expect(page.locator('.appt-history-card .history-school')).toHaveCount(0);
  await expect(page.locator('table.appt-history .appt-school')).toHaveText(runs);
  // Each on the first row of its run.
  const at = await page.locator('table.appt-history tbody tr').evaluateAll((trs) => trs.map((tr) => !!tr.querySelector('.appt-school')));
  const starts = rows.map((r, i) => i === 0 || r.sch !== rows[i - 1].sch);
  expect(at).toEqual(starts);
});

test('FTE is a percentage, and a missing basis says so in muted text', async ({ page }) => {
  await history(page, AARON);
  const fte = await column(page, 'fte');
  for (const f of fte) expect(f).toMatch(/^(\d+%|—)$/);
  expect(fte).toContain('100%');
  const basis = await column(page, 'basis');
  expect(basis, 'a basis drawn as a dash').not.toContain('—');
  expect(basis).toContain('Not reported');
  const [said, reported] = await Promise.all([
    page.locator('table.appt-history .basis-not-reported').first().evaluate((e) => getComputedStyle(e).color),
    page.locator('table.appt-history tbody tr').first().locator('td').last().locator('p').first().evaluate((e) => getComputedStyle(e).color),
  ]);
  expect(said, '"Not reported" is set like a value').not.toBe(reported);
  await page.locator('table.appt-history .basis-not-reported').first().hover();
  await expect(page.getByRole('tooltip')).toContainText('did not report a pay basis');
});

test('a raise’s comparison is a sentence that wraps in its column', async ({ page }) => {
  await history(page, AARON);
  const notes = page.locator('table.appt-history [data-raise-compare="yes"]');
  await expect(notes.first()).toBeVisible({ timeout: 60_000 });
  for (const t of await notes.allInnerTexts()) expect(t.replace(/\s+/g, ' ').trim()).toMatch(/^(Bigger than|Smaller than|Matched) \d+% of UW raises \(typical (0%|[+−][\d.]+%)\)$/);
  for (const w of await notes.evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().width))) expect(w).toBeLessThanOrEqual(191);
});
