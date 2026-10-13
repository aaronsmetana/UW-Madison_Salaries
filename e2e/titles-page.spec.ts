import { test, expect, type Page } from '@playwright/test';
import { oracle, latestSnapshot, RATE } from './oracle';

/**
 * The Titles page (T1–T14): the chosen title is the heading, with what it is under it and its raises one of the
 * header's actions; the controls a compact row, the figures first; "All UW" a chosen value; one privacy line; a
 * currency pin applied on Enter; bins from the spread; the grade's band under the people on their scale; one median;
 * and a pinned salary placed in the figures' row and on the charts, with no card of its own.
 */

const OE = 'OE009';
test.use({ viewport: { width: 1440, height: 1000 } });

async function title(page: Page, code = OE) {
  await page.goto(`./titles?code=${code}`);
  await expect(page.locator('.stat-row').first()).toBeVisible({ timeout: 60_000 });
}
const dist = (page: Page) => page.locator('.mantine-Card-root', { has: page.getByRole('heading', { name: /distribution/ }) });
async function pin(page: Page, value: string) {
  const f = page.getByRole('textbox', { name: /Salary to pin/ });
  await f.fill(value);
  await f.press('Enter');
}

test('the title is the heading, with its code, grade, category and headcount under it', async ({ page }) => {
  const snap = await latestSnapshot();
  // OE009 is all Academic Staff; AD006 mixes Academic and University Staff, and its line names the larger.
  for (const code of [OE, 'AD006']) {
    const where = `snapshot_id = '${snap}' AND job_code = '${code}' AND salary > 0`;
    const [m] = await oracle<{ t: string; n: number; cat: string; g: number }>(
      `SELECT (SELECT arg_max(title, salary) FROM $SAL WHERE ${where}) t, (SELECT count(DISTINCT person_key) FROM $SAL WHERE ${where}) n,
              (SELECT employee_category FROM $SAL WHERE ${where} AND employee_category IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) cat,
              (SELECT grade_number FROM $SAL WHERE ${where} AND grade_number IS NOT NULL GROUP BY grade_number, grade_basis ORDER BY count(*) DESC, grade_number LIMIT 1) g`
    );
    await title(page, code);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.t);
    await expect(page.locator('.page-meta')).toHaveText(`${code} · grade ${m.g} · ${m.cat} · ${m.n.toLocaleString('en-US')} people`);
    await expect(page.getByRole('heading', { level: 1 }).locator('xpath=preceding-sibling::*[1]')).toHaveText(/^Titles$/i);
  }
  // Before a title is chosen, the page is "Titles".
  await page.goto('./titles');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Titles', { timeout: 60_000 });
});

test('the controls are one row under the heading, outside any card, and the figures come before the charts', async ({ page }) => {
  await title(page);
  const controls = page.locator('.title-controls');
  await expect(controls).toBeVisible();
  expect(await controls.evaluate((e) => !!e.closest('.mantine-Card-root')), 'the controls are a form card').toBe(false);
  const boxes = await controls.locator('.mantine-InputWrapper-root input, .pay-measure').evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
  expect(Math.max(...boxes) - Math.min(...boxes), 'the controls are not one row').toBeLessThan(30);
  const [figs, chart] = await Promise.all([page.locator('.stat-row').first().boundingBox(), dist(page).boundingBox()]);
  expect(figs!.y).toBeLessThan(chart!.y);
  // The raises link is one of the header's actions, beside "Copy link".
  const raises = page.locator('.title-actions').getByRole('link', { name: 'Raises in this title' });
  await expect(raises).toHaveAttribute('href', new RegExp(`/raises\\?title=${OE}`));
});

test('"All UW" is the school chosen, not a placeholder, and choosing it clears the filter', async ({ page }) => {
  await page.goto(`./titles?code=${OE}&sch=${encodeURIComponent('Division of Extension')}`);
  const school = page.getByRole('textbox', { name: 'School', exact: true });
  await expect(school).toHaveValue('Division of Extension', { timeout: 60_000 });
  await school.click();
  await page.getByRole('option', { name: /^All UW/ }).click();
  await expect(school).toHaveValue('All UW');
  await expect(page).not.toHaveURL(/sch=/);
});

test('one privacy line beside the pin, and a pin typed as currency, applied on Enter and cleared by its ✕', async ({ page }) => {
  await title(page);
  await expect(page.locator('.pin-privacy')).toHaveText('Private: never sent, saved or put in a link');
  await expect(page.locator('.pin-privacy svg')).toHaveCount(1);
  expect(await page.locator('main').evaluate((m) => (m.textContent ?? '').match(/never sent|never uploaded/g)?.length ?? 0)).toBe(1);
  const f = page.getByRole('textbox', { name: /Salary to pin/ });
  await f.fill('75000');
  await expect(f).toHaveValue('$75,000');
  // Long enough for a figure applied on typing to have been drawn: it waits on its share's query, about a second.
  await page.waitForTimeout(2000);
  await expect(page.locator('.pin-result'), 'applied before Enter').toHaveCount(0);
  await f.press('Enter');
  await expect(page.locator('.pin-result')).toContainText('$75,000');
  await page.getByRole('button', { name: 'Clear the pinned salary' }).click();
  await expect(f).toHaveValue('');
  await expect(page.locator('.pin-result')).toHaveCount(0);
});

test('a pinned salary takes its place in the figures and on the charts, and moves nothing', async ({ page }) => {
  const snap = await latestSnapshot();
  const [p] = await oracle<{ below: number; n: number }>(
    `WITH pp AS (SELECT person_key, ${RATE} r FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${OE}' GROUP BY person_key)
     SELECT count(*) FILTER (WHERE r < 75000) below, count(*) n FROM pp WHERE r > 0`
  );
  await title(page);
  // Every card in, the last to arrive the schools' table.
  await expect(page.locator('table.pay-by-school')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const cards = await page.locator('.mantine-Card-root').count();
  const before = (await dist(page).boundingBox())!.y;
  await pin(page, '75000');
  await expect(page.locator('.pin-result')).toContainText(`paid more than ${Math.round((100 * p.below) / p.n)}% of ${p.n}`);
  await page.waitForTimeout(500);
  expect(await page.locator('.mantine-Card-root').count(), 'pinning added a card').toBe(cards);
  expect(Math.abs((await dist(page).boundingBox())!.y - before), 'pinning moved the page').toBeLessThanOrEqual(2);
  await expect(dist(page).getByText('Your salary')).toBeVisible();
  await expect(dist(page).locator('.hist-band-marker')).toHaveCount(1);
});

test('the bins follow the spread: no one bar holds most of a title', async ({ page }) => {
  // FA020 (Professor) runs to about $750k, so ten bins across its range put most of it in one or two.
  for (const code of [OE, 'FA020']) {
    await title(page, code);
    await dist(page).getByRole('button', { name: "Table of this chart's data" }).click();
    const counts = (await dist(page).locator('table tbody tr td:last-child').allInnerTexts()).map((t) => Number(t.replace(/[^\d]/g, '')));
    const total = counts.reduce((a, b) => a + b, 0);
    expect(counts.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...counts) / total, `${code}: the largest bar holds ${Math.max(...counts)} of ${total}`).toBeLessThan(0.35);
  }
});

test('the grade’s band is under the people, on their scale, and the title’s median is said once', async ({ page }) => {
  await title(page);
  const band = dist(page).locator('.hist-band');
  await expect(band).toBeVisible();
  await expect(page.locator('.title-payband')).toHaveCount(0);
  await expect(page.getByText(/title median full-time rate/)).toHaveCount(0);
  // The band's quarters against the axis: the axis ticks are bin edges, a linear scale from first to last.
  const [lo, hi] = ((await band.locator('.hist-band-label').innerText()).match(/\$[\d,]+/g) ?? []).map((t) => Number(t.replace(/[^\d]/g, '')));
  // Each tick's own position, not its word's: the first word starts at its tick and the last ends at it. The tick
  // lines are not drawn, so their x comes from the attribute, in the chart's own coordinates.
  const ticks = await dist(page).locator('.recharts-xAxis .recharts-cartesian-axis-tick').evaluateAll((ts) => ts.map((t) => {
    const svg = t.closest('svg')!.getBoundingClientRect();
    return { x: svg.left + Number(t.querySelector('line')!.getAttribute('x1')), v: Number((t.textContent ?? '').replace(/[^\d.]/g, '')) * 1000 };
  }));
  const [a, b] = [ticks[0], ticks[ticks.length - 1]];
  const xOf = (v: number) => a.x + ((v - a.v) / (b.v - a.v)) * (b.x - a.x);
  const quarters = await band.locator('.hist-band-quarter').evaluateAll((qs) => qs.map((q) => { const r = q.getBoundingClientRect(); return r.left + r.width / 2; }));
  const want = [0.25, 0.5, 0.75].map((f) => lo + (hi - lo) * f).filter((v) => v > a.v && v < b.v).map(xOf);
  expect(quarters.length).toBe(want.length);
  quarters.forEach((x, i) => expect(Math.abs(x - want[i]), `quarter ${i + 1}`).toBeLessThanOrEqual(2));
});

test('a pinned salary that ties some people is paid more than only those below it', async ({ page }) => {
  const snap = await latestSnapshot();
  // The commonest whole-dollar rate in the title, so a share counting "at or below" would differ.
  const [p] = await oracle<{ v: number; below: number; n: number; tied: number }>(
    `WITH pp AS (SELECT person_key, ${RATE} r FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${OE}' GROUP BY person_key),
          m AS (SELECT r v FROM pp WHERE r > 0 AND r = round(r) GROUP BY r ORDER BY count(*) DESC, r LIMIT 1)
     SELECT (SELECT v FROM m) v, count(*) FILTER (WHERE r < (SELECT v FROM m)) below,
            count(*) FILTER (WHERE r = (SELECT v FROM m)) tied, count(*) n FROM pp WHERE r > 0`
  );
  expect(p.tied, 'no tie to test against').toBeGreaterThan(1);
  await title(page);
  await pin(page, String(p.v));
  await expect(page.locator('.pin-result')).toContainText(`paid more than ${Math.round((100 * p.below) / p.n)}% of ${p.n}`);
});

test('a histogram’s axis keeps its first and last labels on the plot, on both of its paths', async ({ page }) => {
  // IT040 is drawn a block a person (48 people), OE009 as bars.
  for (const code of ['IT040', OE]) {
    await title(page, code);
    const plot = dist(page).locator('.hist-plot');
    await expect(plot).toBeVisible();
    await page.waitForTimeout(800);
    const out = await plot.evaluate((root) => {
      const box = root.getBoundingClientRect();
      return [...root.querySelectorAll('*')]
        .filter((e) => !e.children.length && /^\$\d+k$/.test((e.textContent ?? '').trim()))
        .map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.left < box.left - 0.5 || r.right > box.right + 0.5)
        .map(({ t }) => t);
    });
    expect(out, `${code}: labels off the plot`).toEqual([]);
  }
});
