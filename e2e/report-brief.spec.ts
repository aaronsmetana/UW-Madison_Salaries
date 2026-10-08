import { test, expect, type Browser } from '@playwright/test';

/**
 * The reports' words (section 4): footnotes as a printed page has them, sentences built from the cohort's name
 * that read, a raise case's link that opens on its own subject, and no person named by their key.
 */

const AARON = 'aaronsmetana|2014-10-15';
const HALZEN = 'francishalzen|1975-07-01';

async function caseFor(browser: Browser, subject: string, set: { id: string; label: string }[]) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((s) => localStorage.setItem('uwsal.tray.v1', s), JSON.stringify(set.map((p, i) => ({ type: 'person', ...p, colorIdx: i }))));
  const page = await ctx.newPage();
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(subject)}`);
  await expect(page.locator('.report-brief')).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

test('the brief numbers its notes in reading order, each marker after a word and linked to its own note', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const brief = page.locator('.report-brief');
  await expect(brief.locator('#report-notes li').first()).toBeAttached({ timeout: 60_000 });
  const marks = await brief.locator('.footnote-ref a').evaluateAll((as) => as.map((a) => {
    // The text just before the marker, inside the block it sits in.
    const sup = a.closest('sup')!;
    const r = document.createRange();
    r.setStart(sup.parentElement!, 0);
    r.setEndBefore(sup);
    return { n: Number(a.textContent), href: a.getAttribute('href'), before: r.toString().slice(-12) };
  }));
  expect(marks.length, 'no footnote markers to read').toBeGreaterThan(5);
  // Each new number is the next one: 1, 2, 3 … down the page, a repeat citing an earlier note.
  let max = 0;
  for (const m of marks) {
    expect(m.n, `marker ${m.n} after ${max} came first`).toBeLessThanOrEqual(max + 1);
    max = Math.max(max, m.n);
    expect(m.href).toBe(`#report-note-${m.n}`);
    await expect(brief.locator(`#report-note-${m.n}`), `note ${m.n} is not in the list`).toHaveCount(1);
    expect(m.before, `marker ${m.n} reads as part of a figure: "…${m.before}${m.n}"`).not.toMatch(/\d$/);
  }
  expect(await brief.locator('#report-notes li').count()).toBeGreaterThanOrEqual(max);
  // A sentence built from the cohort's name reads as one.
  await expect(brief).not.toContainText(/the all /);
  await expect(brief.locator('.evidence-card').first()).toContainText(/median of all UW–Madison employees with this title/);
  await ctx.close();
});

test('a raise case link opens on its own subject, whoever is in the compare set', async ({ browser }) => {
  for (const set of [[], [{ id: AARON, label: 'Aaron Smetana' }]]) {
    const { ctx, page } = await caseFor(browser, HALZEN, set);
    await expect(page.locator('.report-brief'), `with ${set.length} in the set`).toContainText('Prepared for Francis Halzen', { timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`subject=${encodeURIComponent(HALZEN)}`));
    await ctx.close();
  }
});

test("the one-person report names its person from the data, never by their key, and promises no page count", async ({ page }) => {
  await page.goto(`./reports?person=${encodeURIComponent(AARON)}`);
  await expect(page.locator('.print-area')).toContainText('Aaron Smetana', { timeout: 60_000 });
  await expect(page).toHaveTitle(/Report — Aaron Smetana/);
  await expect(page.locator('main')).not.toContainText(AARON);
  await expect(page.locator('main')).not.toContainText(/one-page|single-page/i);
});

test('the raise case setup names its people neutrally', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  await expect(page.getByText('Subject', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with', { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/this is me|compared against/i);
  await ctx.close();
});
