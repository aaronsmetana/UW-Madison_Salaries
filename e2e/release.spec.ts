import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { oracle, PAY, GRADED, usd, latestSnapshot } from './oracle';

/**
 * Saying what the newest release brought: the landing page's line, the Data page's account of it and of
 * the salary ranges, "New" on the newest snapshot, and what a band read in an older snapshot is compared
 * with. Every figure is checked against the build's own files or SQL written here, never a number typed
 * in, so the next release changes what these expect without changing them.
 */

const DATA = new URL('../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'));
interface Summary { snapshots: { id: string; label: string; date: string; published?: string | null; headcount: number; median: number }[]; reorganizations: { to_id: string; school: string; people: number; from: { school: string; people: number; departments: string[] }[] }[] }
interface Ref { status: string; retrieved_at: string; released_with: string; structure_change: number; coverage: number; floor_coverage: number; matched_rows: number; graded_rows: number }
interface Grade { grade: number; basis: string; min: number; max: number | null }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const month = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
/** Noon, `days` after the day a release went up, on the reader's calendar. */
const dayAfter = (published: string, days: number) => new Date(Date.parse(`${published}T12:00:00`) + days * 86_400_000);
const AARON = 'aaronsmetana|2014-10-15';
const change = (x: number) => (Math.abs(x) < 0.0005 ? '0%' : `${x > 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(1)}%`);

/** People whose full-time rate on their graded appointment is below its minimum, to HR's rounding: the
 *  hourly minimum as published, to the cent, annualized; an annual one to the dollar. */
async function belowMinimum(snap: string) {
  const grades = read<Grade[]>('grades.json');
  const g = `(SELECT * FROM (VALUES ${grades.map((x) => `(${x.grade}, '${x.basis}', ${x.min})`).join(', ')}) t(grade, basis, mn))`;
  const [r] = await oracle<{ n: number; hourly: number }>(
    `WITH p AS (SELECT person_key, ${GRADED} gr FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key),
          b AS (SELECT gr.basis basis, gr.rate rate,
                  mn * CASE WHEN lower(gr.comp) = 'academic' THEN 9.0 / 11 ELSE 1 END mn FROM p JOIN ${g} g ON g.grade = gr.grade AND g.basis = gr.basis)
     SELECT count(*) FILTER (WHERE rate < CASE WHEN basis = 'hourly' THEN round(mn / 2080, 2) * 2080 ELSE mn - 0.5 END - 0.005) n,
            count(*) FILTER (WHERE basis = 'hourly' AND rate < round(mn / 2080, 2) * 2080 - 0.005) hourly FROM b`,
  );
  return r;
}

test.describe('the newest release, said', () => {
  test.setTimeout(180_000);

  /**
   * Which release the app holds, beside its name on every page, and "New" for 30 days from the day it went
   * up (data/releases.json) and then not: the landing page's pill said the month on one page only, and
   * "New" until the next release, six months on. The day is pinned on the page's clock, so this reads the
   * same on the day the release lands and a year later.
   */
  test("beside the app's name on every page: the release, new for 30 days, then plainly", async ({ page }) => {
    const s = read<Summary>('summary.json');
    const ref = read<Ref>('reference-status.json');
    const latest = s.snapshots.at(-1)!;
    expect(latest.published, `no publication date for ${latest.id} in data/releases.json`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const withRanges = ref.released_with === latest.id;
    const routes = ['./', `./person/${encodeURIComponent(AARON)}`, `./school/${encodeURIComponent('School of Medicine and Public Health')}`];
    const tag = page.locator('.release-tag');

    await page.clock.setFixedTime(dayAfter(latest.published!, 5));
    for (const route of routes) {
      await page.goto(route);
      await expect(tag, route).toBeVisible({ timeout: 60_000 });
      await expect(tag.locator('.new-badge'), route).toBeVisible();
      await expect(tag.locator('.release-tag-long'), route).toHaveText(`Salary data as of ${month(latest.date)}${withRanges ? ' · salary ranges updated' : ''}`);
      await expect(tag, route).toHaveAttribute('aria-label', `Salary data as of ${month(latest.date)}, new${withRanges ? ', with updated salary ranges' : ''}. What's new`);
      await expect(tag, route).toHaveAttribute('href', /\/data#whats-new$/);
    }
    // The pill it replaced is gone from the landing page.
    await page.goto('./');
    await expect(tag).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.home-news')).toHaveCount(0);
    await tag.click();
    await expect(page.locator('#whats-new')).toBeInViewport({ timeout: 60_000 });
    const head = await page.evaluate(() => {
      const nav = document.querySelector('.data-jumpnav')!.getBoundingClientRect();
      return document.getElementById('whats-new')!.getBoundingClientRect().top - nav.bottom;
    });
    expect(head, 'the section landed under the jump nav').toBeGreaterThanOrEqual(0);

    await page.clock.setFixedTime(dayAfter(latest.published!, 31));
    for (const route of routes) {
      await page.goto(route);
      await expect(tag, route).toBeVisible({ timeout: 60_000 });
      await expect(tag.locator('.new-badge'), route).toHaveCount(0);
      await expect(tag.locator('.release-tag-long'), route).toHaveText(`Salary data as of ${month(latest.date)}`);
      await expect(tag, route).toHaveAttribute('aria-label', `Salary data as of ${month(latest.date)}. About the data`);
      await expect(tag, route).toHaveAttribute('href', /\/data$/);
    }
  });

  /**
   * On a phone there is no room beside the name — the tag ran off the screen and pushed the colour switch
   * with it — so it is the line over the name, the one place anything sits over it.
   */
  test('on a phone the release is the line over the name, and the header still fits', async ({ page }) => {
    const latest = read<Summary>('summary.json').snapshots.at(-1)!;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.clock.setFixedTime(dayAfter(latest.published!, 5));
    await page.goto('./');
    const eyebrow = page.locator('.release-eyebrow');
    await expect(eyebrow).toBeVisible({ timeout: 60_000 });
    await expect(eyebrow).toContainText(`Data as of ${latest.label}`);
    await expect(eyebrow.locator('.new-badge')).toBeVisible();
    await expect(page.locator('.release-tag')).toBeHidden();
    const g = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { eyebrow: r('.release-eyebrow'), name: r('.app-wordmark') };
    });
    expect(g.eyebrow.bottom, 'the release is not over the name').toBeLessThanOrEqual(g.name.bottom - 10);
  });

  /**
   * At every width the header holds the name on one line, the release beside or over it, and the credit,
   * inside its 64px and the screen, with room between the release and the controls opposite. Squeezed by
   * the release, the name broke into four lines at 1024px and spilled out of the header; on a phone the
   * release ran off the screen.
   */
  test('the header fits at every width, the name on one line', async ({ page }) => {
    const latest = read<Summary>('summary.json').snapshots.at(-1)!;
    await page.clock.setFixedTime(dayAfter(latest.published!, 5));
    for (const width of [375, 768, 991, 992, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`./person/${encodeURIComponent(AARON)}`);
      await expect(page.locator('.release-tag, .release-eyebrow').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
      const g = await page.evaluate(() => {
        const header = document.querySelector('.mantine-AppShell-header')!.getBoundingClientRect();
        const kids = [...document.querySelectorAll('.mantine-AppShell-header > .mantine-Group-root *')].map((e) => e.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.height > 0);
        const name = document.querySelector('.app-name')!.getBoundingClientRect();
        // The room between the release, where it is beside the name, and the controls and credit opposite.
        const tag = document.querySelector('.release-tag');
        const opposite = document.querySelector('.mantine-AppShell-header > .mantine-Group-root > :last-child')!.getBoundingClientRect();
        const gap = tag && getComputedStyle(tag).display !== 'none' ? opposite.left - tag.getBoundingClientRect().right : null;
        const shown = (e: Element | null) => !!e && getComputedStyle(e).display !== 'none';
        return {
          h: header.height, right: Math.max(...kids.map((b) => b.right)), top: Math.min(...kids.map((b) => b.top)), bottom: Math.max(...kids.map((b) => b.bottom)), nameH: name.height, gap,
          forms: [tag, document.querySelector('.release-eyebrow')].filter(shown).length,
          eyebrow: document.querySelector('.mantine-AppShell-header')!.textContent!.toLowerCase().includes('open record salary data'),
        };
      });
      // One release, beside the name or over it; the old "Open record salary data" line over the name is gone.
      expect(g.forms, `${width}px: the release is said ${g.forms} times`).toBe(1);
      expect(g.eyebrow, `${width}px: "Open record salary data" is back over the name`).toBe(false);
      expect(g.right, `${width}px: something in the header runs off the screen`).toBeLessThanOrEqual(width);
      expect(g.top, `${width}px: something in the header spills above it`).toBeGreaterThanOrEqual(0);
      expect(g.bottom, `${width}px: something in the header spills below it`).toBeLessThanOrEqual(g.h);
      expect(g.nameH, `${width}px: the name broke onto a second line`).toBeLessThan(30);
      // Not merely inside the header: at 1024px "· salary ranges updated" ran into the colour switch
      // (−3px). The floor is the header's own gap between its controls (16px, `gap="md"`), not a margin
      // picked for this one font rendering: CI's Linux text sits a few tenths of a pixel wider, and at
      // 992px its gap measured 23.8px against the 24 this first asked for.
      if (g.gap != null) expect(g.gap, `${width}px: the release runs into the controls opposite`).toBeGreaterThanOrEqual(16);
    }
  });

  /**
   * The snapshots the data spans, at the foot of every page, in place of the build's date ("data generated
   * Sep 29, 2026"), which read as the data's and changed with every deploy. Said once: the landing page's
   * "Data based on…" line and Divisions' own span are gone.
   */
  test('the footer names the snapshots the data spans, on every page, and no page says it again', async ({ page }) => {
    const s = read<Summary>('summary.json');
    const bare = (l: string) => l.replace(/\s*\((?:Pre|Post)-TTC\)/, '');
    const span = `${s.snapshots.length} snapshots, ${bare(s.snapshots[0].label)} – ${bare(s.snapshots.at(-1)!.label)}`;
    for (const route of ['./', `./person/${encodeURIComponent(AARON)}`, './explore', './data']) {
      await page.goto(route);
      const foot = page.locator('.mantine-AppShell-footer');
      await expect(foot, route).toContainText(span, { timeout: 60_000 });
      await expect(foot, route).not.toContainText('generated');
    }
    await page.goto('./');
    await expect(page.locator('.hero-dist-main')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Data based on/)).toHaveCount(0);
    // Divisions' own line keeps what is the page's: its rows, and the way to the data's health.
    await page.goto('./explore');
    await expect(page.locator('p', { hasText: 'data health →' })).toHaveText(/^[\d,]+ rows · data health →$/, { timeout: 60_000 });
  });

  test("What's new states the release against the one before, from the build and the data", async ({ page }) => {
    const s = read<Summary>('summary.json');
    const ref = read<Ref>('reference-status.json');
    const steps = read<{ hist_step: number; metrics: { fte: { from_id: string; to_id: string; hist: [number, number][] }[] } }>('raise-steps.json');
    const [prev, latest] = s.snapshots.slice(-2);
    const snap = await latestSnapshot();
    expect(snap).toBe(latest.id);
    const [people] = await oracle<{ n: number; med: number }>(
      `SELECT count(*) n, median(pay) med FROM (SELECT person_key, sum(${PAY}) FILTER (WHERE salary > 0) pay FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1) WHERE pay > 0`,
    );
    await page.goto('./data');
    const card = page.locator('#whats-new');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`The ${month(latest.date)} release`);
    await expect(card).toContainText(`Against ${prev.label}, the release before it.`);
    await expect(card.locator('[data-figure="people"]')).toContainText(people.n.toLocaleString('en-US'));
    await expect(card.locator('[data-figure="people"]')).toContainText(`${change(people.n / prev.headcount - 1)} vs ${prev.label}`);
    await expect(card.locator('[data-figure="median"]')).toContainText(usd(people.med));

    const st = steps.metrics.fte.at(-1)!;
    const total = st.hist.reduce((t, [, c]) => t + c, 0);
    const [k, c] = st.hist.reduce((b, h) => (h[1] > b[1] ? h : b), [0, 0] as [number, number]);
    if (c / total >= 0.5) {
      await expect(card.locator('[data-item="step"]')).toContainText(
        `${Math.round((c / total) * 100)}% of the ${total.toLocaleString('en-US')} people who kept the same title and appointment since ${prev.label} were raised exactly ${(k * steps.hist_step * 100).toFixed(1)}%`,
      );
    }
    if (ref.released_with === latest.id) {
      await expect(card.locator('[data-figure="ranges"]')).toContainText(change(ref.structure_change));
      await expect(card.locator('[data-item="ranges"]')).toContainText(`a range for ${Math.round(ref.coverage * 100)}% of graded appointments`);
    }
    // Job codes whose most common wording changed — case aside — and the example, the one most people hold.
    const named = (id: string) => `SELECT job_code, first(title ORDER BY c DESC, title) t, sum(c) n FROM (
        SELECT job_code, title, count(*) c FROM $SAL WHERE snapshot_id = '${id}' AND job_code IS NOT NULL AND title IS NOT NULL GROUP BY 1, 2) GROUP BY 1`;
    const [re] = await oracle<{ codes: number; was: string; now: string }>(
      `WITH a AS (${named(prev.id)}), b AS (${named(latest.id)}), d AS (SELECT a.t was, b.t now, b.n FROM a JOIN b USING (job_code) WHERE lower(a.t) <> lower(b.t))
       SELECT count(*) codes, arg_max(was, n) was, arg_max(now, n) now FROM d`,
    );
    if (re.codes > 0) {
      await expect(card.locator('[data-item="retitled"]')).toContainText(`${re.codes.toLocaleString('en-US')} job titles are worded differently`);
      await expect(card.locator('[data-item="retitled"]')).toContainText(`“${re.was}” is now “${re.now}”`);
    }
    for (const r of s.reorganizations.filter((x) => x.to_id === latest.id)) {
      const item = card.locator('[data-item="reorganization"]').filter({ hasText: r.school });
      await expect(item).toContainText(`(${r.people.toLocaleString('en-US')} people)`);
      for (const f of r.from) for (const d of f.departments) await expect(item).toContainText(d);
    }
  });

  test('the people paid below their grade minimum are counted by the rule, and the link screens exactly them', async ({ page }) => {
    const snap = await latestSnapshot();
    const want = await belowMinimum(snap);
    expect(want.n, 'no one is below a minimum, so there is no link to follow').toBeGreaterThan(0);
    await page.goto('./data');
    const item = page.locator('#whats-new [data-item="below-min"]');
    await expect(item).toBeVisible({ timeout: 60_000 });
    await expect(item).toContainText(`${want.n.toLocaleString('en-US')} ${want.n === 1 ? 'person is' : 'people are'} paid below their grade's minimum`);
    await expect(item).toContainText(`${want.hourly.toLocaleString('en-US')} of them hourly`);
    await item.locator('.below-min-link').click();
    await expect(page).toHaveURL(/\/screening\?run=1&flag=below-min$/);
    await expect(page.locator('.screen-count')).toHaveText(new RegExp(`^${want.n} (people|person) paid below their grade's minimum, ranked`), { timeout: 120_000 });
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    await expect(page.locator('table tbody tr')).toHaveCount(want.n);
    // Every one of them carries the flag.
    await expect(page.locator('table tbody tr').filter({ hasNot: page.getByText('Below grade minimum') })).toHaveCount(0);
  });

  test('the salary ranges table is grades.json, and HR’s published figures', async ({ page }) => {
    const grades = read<Grade[]>('grades.json').filter((g) => g.basis === 'annual_12mo');
    await page.goto('./data#salary-ranges');
    const card = page.locator('#salary-ranges');
    await expect(card).toBeInViewport({ timeout: 60_000 });
    const ranges = card.locator('table[data-kind="range"] tbody tr');
    const minimums = card.locator('table[data-kind="minimum"] tbody tr');
    await expect(ranges).toHaveCount(grades.filter((g) => g.max != null).length);
    await expect(minimums).toHaveCount(grades.filter((g) => g.max == null).length);
    // Two grades spot-checked against hr.wisc.edu/pay/salary-structure/ as read on Sep 26, 2026.
    await expect(ranges.filter({ has: page.locator('td:first-child', { hasText: /^15$/ }) })).toHaveText(/^15\$36,421\$52,082\$67,743$/);
    await expect(ranges.filter({ has: page.locator('td:first-child', { hasText: /^35$/ }) })).toHaveText(/^35\$301,921\$431,747\$561,572$/);
    await expect(minimums.filter({ has: page.locator('td:first-child', { hasText: /^61$/ }) })).toHaveText(/^61\$45,250$/);
  });

  // Every "New" is the header's: the newest snapshot, and only it, in the picker, a person's history and
  // the ingestion table while the release is new, and in none of them a day past its 30.
  test('"New" marks the newest snapshot, and only it, in the picker, a history and the ingestion table, for 30 days', async ({ page }) => {
    const s = read<Summary>('summary.json');
    const latest = s.snapshots.at(-1)!;
    for (const [days, n] of [[5, 1], [31, 0]] as const) {
      await page.clock.setFixedTime(dayAfter(latest.published!, days));
      await page.goto('./explore');
      await page.getByRole('textbox', { name: 'Snapshot' }).click();
      await expect(page.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
      const newOpts = page.getByRole('option').filter({ has: page.locator('.new-badge') });
      await expect(newOpts, `picker, day ${days}`).toHaveCount(n, { timeout: 30_000 });
      if (n) await expect(newOpts).toContainText(latest.label);
      await page.keyboard.press('Escape');

      await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
      const rows = page.locator('table.appt-history tbody tr');
      await expect(rows.first()).toBeVisible({ timeout: 60_000 });
      const marked = rows.filter({ has: page.locator('.appt-snapshot .new-badge') });
      await expect(marked, `history, day ${days}`).toHaveCount(n);
      if (n) await expect(marked.locator('.appt-snapshot')).toContainText(latest.label);

      await page.goto('./data#snapshots');
      await expect(page.locator('.data-snap-table tbody tr').first()).toBeVisible({ timeout: 60_000 });
      const snapRows = page.locator('.data-snap-table tbody tr').filter({ has: page.locator('.new-badge') });
      await expect(snapRows, `ingestion table, day ${days}`).toHaveCount(n, { timeout: 60_000 });
      if (n) await expect(snapRows).toContainText(latest.label);
      // Nor anywhere else on the Data page (What's new, the salary ranges) once the 30 days are out.
      if (!n) await expect(page.locator('.new-badge')).toHaveCount(0);
    }
  });

  test('a reorganization is said where its moves are counted: Changes, and both divisions’ pages', async ({ page }) => {
    const s = read<Summary>('summary.json');
    const [prev, latest] = s.snapshots.slice(-2);
    // A division new in the newest release that whole departments moved into — three quarters of a
    // department's continuing people, and at least three — found here in SQL, not taken from the build.
    const found = await oracle<{ school: string; from_school: string; department: string }>(
      `WITH a AS (SELECT DISTINCT person_key, school, department FROM $SAL WHERE snapshot_id = '${prev.id}' AND department IS NOT NULL),
            b AS (SELECT DISTINCT person_key, school FROM $SAL WHERE snapshot_id = '${latest.id}'),
            fresh AS (SELECT DISTINCT school FROM b WHERE school NOT IN (SELECT school FROM a WHERE school IS NOT NULL)),
            d AS (SELECT a.school from_school, a.department, f.school,
                    count(DISTINCT a.person_key) FILTER (WHERE a.person_key IN (SELECT person_key FROM b)) cont,
                    count(DISTINCT a.person_key) FILTER (WHERE a.person_key IN (SELECT person_key FROM b WHERE b.school = f.school)) moved
                  FROM a CROSS JOIN fresh f GROUP BY ALL)
       SELECT school, from_school, department FROM d WHERE moved >= 3 AND moved >= 0.75 * cont ORDER BY 1, 2, 3`,
    );
    expect(found.length, 'the newest release formed no division from whole departments; this needs another release').toBeGreaterThan(0);
    const r = s.reorganizations.find((x) => x.to_id === latest.id && x.school === found[0].school);
    expect(r, `the build does not name ${found[0].school} a reorganization`).toBeTruthy();
    expect(r!.from.flatMap((f) => f.departments.map((d) => `${f.school}|${d}`)).sort())
      .toEqual(found.filter((f) => f.school === r!.school).map((f) => `${f.from_school}|${f.department}`).sort());
    await page.goto('./explore?tab=changes');
    const alert = page.locator('.changes-reorg');
    await expect(alert).toHaveCount(1, { timeout: 60_000 });
    await expect(alert).toContainText(`A reorganization: ${r!.school}`);
    for (const f of r!.from) await expect(alert).toContainText(`${f.school} (${f.departments.join(', ')}: ${f.people.toLocaleString('en-US')} people)`);

    await page.goto(`./school/${encodeURIComponent(r!.school)}`);
    await expect(page.locator('.school-reorg-note')).toContainText(`Formed in ${latest.label}`, { timeout: 60_000 });
    const from = r!.from[0];
    await page.goto(`./school/${encodeURIComponent(from.school)}`);
    await expect(page.locator('.school-reorg-note')).toContainText(`${from.people.toLocaleString('en-US')} people — moved, whole, to the new ${r!.school}`, { timeout: 60_000 });
  });

  test('a band read in a snapshot older than the ranges says it is compared with today’s', async ({ page }) => {
    const s = read<Summary>('summary.json');
    const ref = read<Ref>('reference-status.json');
    const released = s.snapshots.find((x) => x.id === ref.released_with)!;
    const older = s.snapshots[s.snapshots.findIndex((x) => x.id === released.id) - 1];
    await page.goto(`./screening?run=1&flag=below-min&snap=${older.id}`);
    const note = page.locator('.below-market-note .payband-older');
    await expect(note).toHaveText(
      `Compared with the current ranges (${released.label}); the ranges in force in ${older.label} were likely lower — the last change measured was +${(ref.structure_change * 100).toFixed(1)}%.`,
      { timeout: 120_000 },
    );
    // Read in the release itself, there is nothing to say.
    await page.goto(`./screening?run=1&flag=below-min`);
    await expect(page.locator('.below-market-note .payband-note')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.below-market-note .payband-older')).toHaveCount(0);
  });

  test('a grade published with a minimum only shows the minimum, and no range to place the rate in', async ({ page }) => {
    const snap = await latestSnapshot();
    const floors = read<Grade[]>('grades.json').filter((g) => g.max == null);
    const [p] = await oracle<{ pk: string; grade: number; rate: number }>(
      `SELECT person_key pk, any_value(grade_number) grade, any_value(salary) rate FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       GROUP BY person_key HAVING count(*) = 1
          AND (${floors.map((g) => `(any_value(grade_number) = ${g.grade} AND any_value(grade_basis) = '${g.basis}')`).join(' OR ')})
       ORDER BY 1 LIMIT 1`,
    );
    const g = floors.find((x) => x.grade === p.grade)!;
    await page.goto(`./person/${encodeURIComponent(p.pk)}?tab=pay`);
    const card = page.locator('.person-payfloor');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`Grade ${p.grade} minimum`);
    await expect(card.locator('.payfloor-line')).toContainText(`The full-time rate, ${usd(p.rate)}, is`);
    await expect(card.locator('.payfloor-line')).toContainText(`grade ${p.grade}'s minimum of ${usd(g.min)}`);
    await expect(card.locator('.chart-plot')).toHaveCount(0);
    await expect(page.locator('.person-payband:not(.person-payfloor)')).toHaveCount(0);
  });

  test('before Sep 2025 a 9-month appointment was reported as its 9-month amount, and its band is read that way', async ({ page }) => {
    // Apr 2025 is the last release reporting 9-month pay as "Academic", the 9-month amount; read against
    // the 12-month figures unscaled, every one of those appointments would sit a fifth below its grade.
    const snap = '2025-04';
    const want = await belowMinimum(snap);
    const [academic] = await oracle<{ n: number }>(
      `SELECT count(*) n FROM (SELECT person_key, ${GRADED} gr FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY 1) WHERE lower(gr.comp) = 'academic'`,
    );
    expect(academic.n, 'no graded 9-month appointment reported the old way, so there is nothing to scale').toBeGreaterThan(100);
    await page.goto(`./screening?run=1&flag=below-min&snap=${snap}`);
    await expect(page.locator('.screen-count')).toHaveText(new RegExp(`^${want.n} (people|person) paid below`), { timeout: 120_000 });
  });

  test('search finds a title by its former wording, and names it as it reads now', async ({ page }) => {
    const index = read<{ titles: [string, string | null, number, number | null, string[]?][] }>('search-index.json');
    // The largest title whose old wording shares no word with its new one: only the alias can find it.
    const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
    const pick = index.titles
      .filter((t) => t[4]?.length && t[1])
      .map((t) => ({ code: t[0], title: t[1]!, n: t[2], was: t[4]!.find((f) => [...words(f)].every((w) => ![...words(t[1]!)].some((x) => x.startsWith(w)))) }))
      .filter((t) => t.was)
      .sort((a, b) => b.n - a.n)[0];
    expect(pick, 'no retitled job reads wholly differently, so the alias is untested').toBeTruthy();
    await page.goto('./');
    const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
    await box.fill(pick.was!);
    await expect(page.locator('[data-group="titles"] [role="option"]').filter({ hasText: pick.title }).first()).toBeVisible({ timeout: 30_000 });
  });
});

