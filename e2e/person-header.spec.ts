import { test, expect } from '@playwright/test';
import { oracle } from './oracle';

/**
 * A person's page answers first (P1–P8, P13, P14): the header says what they are paid and where that sits among
 * their title; the page's actions are one group (a raise case, and one compare control with a menu); the old
 * title before TTC reads as words; the growth figure sets raises against raises; the standing cell says what it
 * ranks; the table keeps its comparison on a phone and names a same-school peer in words.
 */

const AARON = 'aaronsmetana|2014-10-15';

test('the header answers: the pay, its snapshot, and the share of the title paid less', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const answer = page.locator('.person-answer');
  await expect(answer).toContainText(/paid more than \d+% of others titled /, { timeout: 60_000 });
  const pay = (await page.locator('.person-figures .stat-cell').first().innerText()).match(/\$[\d,]+/)![0];
  const share = (await page.locator('.standing-share').innerText()).match(/(\d+)%/)![1];
  await expect(answer).toHaveText(new RegExp(`^\\${pay} actual pay, \\w+ \\d{4} · paid more than ${share}% of others titled .+$`));
  // Above the fact strip and the tabs: the first dollar figure on the page.
  const [a, strip] = await Promise.all([answer.boundingBox(), page.locator('.fact-strip').boundingBox()]);
  expect(a!.y).toBeLessThan(strip!.y);
  // "At UW since" is the Tenure figure's alone (P4).
  await expect(page.locator('.person-head')).not.toContainText('At UW since');
});

test("the page's actions are one group: a raise case, and one compare control whose menu names someone", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const actions = page.getByRole('navigation', { name: 'Take this further' });
  await expect(actions.getByRole('link', { name: 'Build raise case' })).toBeVisible({ timeout: 60_000 });
  // Not a link under the title line.
  expect(await page.locator('.person-head .tool-links').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Compare with…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to compare', pressed: false })).toBeVisible();
  await page.getByRole('button', { name: 'Compare with a specific person…' }).click();
  await expect(page.getByPlaceholder('Search a person to compare…')).toBeFocused();
});

test('a title before TTC reads as words, and TTC links to what it was', async ({ page }) => {
  const [p] = await oracle<{ pk: string; t: string }>(
    `WITH pre AS (SELECT person_key, any_value(title) t FROM $SAL WHERE snapshot_id LIKE '%-pre' AND title = upper(title) AND title LIKE '%CONSLT%' GROUP BY 1),
          now AS (SELECT person_key FROM $SAL WHERE snapshot_id = (SELECT max(snapshot_id) FROM $SAL) GROUP BY 1)
     SELECT pre.person_key pk, pre.t FROM pre JOIN now USING (person_key) ORDER BY 1 LIMIT 1`);
  await page.goto(`./person/${encodeURIComponent(p.pk)}`);
  const line = page.locator('.pre-ttc-title');
  await expect(line).toContainText('Consultant', { timeout: 60_000 });
  expect(await line.innerText(), `"${p.t}" is still in capitals`).not.toMatch(/\b[A-Z]{4,}\b/);
  await expect(line.getByRole('link', { name: 'TTC' })).toHaveAttribute('href', /\/data#ttc$/);
});

test('growth sets raises against typical raises, and says what the title change added and what typical is', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const figures = page.locator('.person-figures');
  await expect(figures.locator('.growth-titles')).toContainText(/^and [+−][\d.]+% from the title change in \w+ \d{4}$/, { timeout: 60_000 });
  const total = Number((await figures.locator('[data-trend]').innerText()).replace(/[^\d.]/g, '')) / 100;
  const rows = await figures.locator('.growth-bar-row').allInnerTexts();
  expect(rows[0]).toMatch(/^Aaron, raises/);
  const raises = Number(rows[0].match(/([\d.]+)%/)![1]) / 100;
  const titles = Number((await figures.locator('.growth-titles').innerText()).match(/([\d.]+)%/)![1]) / 100;
  // Compounded, the two are the whole, to the rounding of three figures.
  expect(Math.abs((1 + raises) * (1 + titles) - (1 + total))).toBeLessThan(0.002);
  // What "typical" means, in one line under the bars.
  await expect(figures.locator('.growth-typical')).toHaveText('Typical: campus median, same title and FTE');
  // The standing cell says what it ranks (P7), and the lead card names its measure (P8).
  await expect(figures.locator('.stat-cell').nth(1)).toContainText(/^Standing in title\s*Paid more than \d+% of [\d,]+ peers/);
  await expect(figures.locator('.stat-cell').nth(1)).toContainText('by full-time rate');
  await expect(figures.locator('.pay-is-rate')).toHaveText('= the full-time rate, at 100% FTE');
});

test("on a phone: the table's difference under each pay, a same-school peer in words, and the details folded", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const card = page.locator('.peer-table-card');
  const under = card.locator('.peer-vs-under').first();
  await expect(under).toBeVisible({ timeout: 60_000 });
  await expect(under).toHaveText(/^[+−]\$[\d,]+ vs\. Aaron$/);
  await expect(card.locator('td.peer-vs').first()).toBeHidden();
  const details = page.locator('details.fact-details');
  await expect(details).toHaveCount(1);
  expect(await details.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  await details.locator('summary').click();
  await expect(details.locator('.fact-strip')).toBeVisible();
  // A same-school peer, at desktop width, where the school column shows.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(card.locator('.same-school-tag').first()).toHaveText('Same school');
});
