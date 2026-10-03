import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oracle, PAY, usd } from './oracle';

/**
 * Following a person on the landing graph (mockup 3a §9): a click on someone's square in the lens follows them
 * — their square marked, a dark label "{name} · $pay" on a leader, a chip in the toolbar with a way to open
 * them and to stop — and a click on them again stops. Through the timeline the label goes with them: a step
 * from a neighbouring snapshot counts their pay to the new one and adds the change; in a snapshot without
 * them, the chip says they are not on the payroll. Pays are restated from the data.
 */

const SUMMARY = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/summary.json', import.meta.url)), 'utf8')) as { snapshots: { id: string; label: string }[] };
const SNAPS = SUMMARY.snapshots;
const LAST = SNAPS.length - 1;
const field = (page: Page) => page.locator('.strata-field').first();
const plot = (page: Page) => page.locator('.strata-plot').first();
const chip = (page: Page) => page.locator('.strata-follow-chip');
const searchBox = (page: Page) => page.getByRole('combobox', { name: /Search a person/ });

async function home(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}
/** The lens on whoever is at a share of the plot, held until the names are in and it names one person. */
async function lensOn(page: Page, x: number, y: number) {
  await page.mouse.move(x - 12, y);
  await page.mouse.move(x, y, { steps: 4 });
  await expect(plot(page)).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
  const card = page.locator('.strata-card');
  await expect(card.locator('.strata-card-name')).toBeVisible({ timeout: 60_000 });
  let was = '';
  await expect.poll(async () => { const now = await card.getAttribute('data-who') ?? ''; const same = now === was; was = now; return same; }, { intervals: [300] }).toBe(true);
  return { key: (await card.getAttribute('data-who'))!, name: (await card.locator('.strata-card-name').innerText()).trim() };
}
const click = async (page: Page) => { await page.mouse.down(); await page.mouse.up(); };
const payIn = async (key: string, snap: string) =>
  (await oracle<{ pay: number | null }>(`SELECT sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0 AND person_key = '${key.replace(/'/g, "''")}'`))[0].pay;

test('a click on a square follows its person — mark, label with their pay, a chip — and a click on them again stops', async ({ page }) => {
  await home(page);
  const box = (await plot(page).boundingBox())!;
  const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.9 };
  const who = await lensOn(page, at.x, at.y);
  await expect(page.locator('.strata-card-foot')).toHaveText('Click to follow through time');
  await click(page);
  await expect(plot(page)).toHaveAttribute('data-follow', who.key);
  expect(page.url(), 'the click opened the person').not.toContain('/person/');
  const pay = await payIn(who.key, SNAPS[LAST].id);
  await expect(field(page)).toHaveAttribute('data-follow-label', `${who.name} · ${usd(pay!)}`);
  await expect(chip(page)).toContainText(`Following ${who.name}`);
  await expect(page.locator('.strata-card-foot')).toHaveText('Click to stop following');
  await click(page);
  await expect(plot(page)).not.toHaveAttribute('data-follow', /./);
  await expect(chip(page)).toHaveCount(0);
  await expect(field(page)).not.toHaveAttribute('data-follow-label', /./);
  // And the chip's × stops it too.
  await click(page);
  await expect(chip(page)).toBeVisible();
  await chip(page).getByRole('button', { name: `Stop following ${who.name}` }).click();
  await expect(chip(page)).toHaveCount(0);
});

test('through the timeline the label goes with them: a step from a neighbour counts to their pay and adds the change, and a snapshot without them says so', async ({ page }) => {
  test.setTimeout(120_000);
  // Someone in the last two snapshots, paid differently in them, not yet on the payroll in the first — whose
  // name no one else's contains, so a search marks them alone.
  const [p] = await oracle<{ k: string; nm: string }>(
    `WITH n AS (SELECT DISTINCT person_key, lower(first_name || ' ' || last_name) nm FROM $SAL),
     pay AS (SELECT snapshot_id s, person_key, sum(${PAY}) pay FROM $SAL WHERE salary > 0 GROUP BY 1, 2 HAVING sum(${PAY}) > 0)
     SELECT n.person_key k, n.nm FROM n
     JOIN pay a ON a.person_key = n.person_key AND a.s = '${SNAPS[LAST].id}'
     JOIN pay b ON b.person_key = n.person_key AND b.s = '${SNAPS[LAST - 1].id}'
     WHERE a.pay BETWEEN 60000 AND 150000 AND abs(a.pay - b.pay) > 500 AND length(n.nm) > 12 AND n.nm NOT LIKE '%''%'
       AND NOT EXISTS (SELECT 1 FROM pay c WHERE c.person_key = n.person_key AND c.s = '${SNAPS[0].id}')
       AND (SELECT count(*) FROM n o WHERE o.nm LIKE '%' || n.nm || '%') = 1
     ORDER BY n.person_key LIMIT 1`,
  );
  await home(page);
  await searchBox(page).fill(p.nm);
  await expect(field(page)).toHaveAttribute('data-marks', /./, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const [i, mx, my] = (await field(page).getAttribute('data-marks'))!.split(' ')[0].split(':').map(Number);
  expect(i).toBeGreaterThanOrEqual(0);
  const box = (await plot(page).boundingBox())!;
  const who = await lensOn(page, box.x + mx, box.y + my);
  expect(who.key).toBe(p.k);
  await click(page);
  await expect(plot(page)).toHaveAttribute('data-follow', p.k);
  // A step back to the snapshot before: their pay then, and the change across the step.
  const [now, before] = [await payIn(p.k, SNAPS[LAST].id), await payIn(p.k, SNAPS[LAST - 1].id)];
  await page.mouse.move(0, 0);
  await page.locator('.strata-track-dot').nth(LAST - 1).click();
  await expect(page.locator('.strata-timeline')).toHaveAttribute('data-snap', SNAPS[LAST - 1].id, { timeout: 60_000 });
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 10_000 });
  const pct = ((before! - now!) / now!) * 100;
  const change = Math.abs(pct) < 0.05 ? 'no change' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
  await expect(field(page)).toHaveAttribute('data-follow-label', `${who.name} · ${usd(before!)} (${change})`);
  // Not on the payroll in the first snapshot: no square, and the chip says so.
  await page.locator('.strata-track-dot').nth(0).click();
  await expect(page.locator('.strata-timeline')).toHaveAttribute('data-snap', SNAPS[0].id, { timeout: 60_000 });
  await expect(chip(page)).toContainText('not on payroll this snapshot');
  await expect(field(page)).not.toHaveAttribute('data-follow', /./);
  // Back where they are, followed still.
  await page.locator('.strata-track-dot').nth(LAST).click();
  await expect(field(page)).toHaveAttribute('data-follow', /^(main|pile):\d+$/, { timeout: 60_000 });
  await expect(chip(page)).not.toContainText('not on payroll');
});

test('from the keyboard Enter follows whoever the lens names, and again stops', async ({ page }) => {
  await home(page);
  await page.locator('.hero-dist-full-toggle').focus();
  await page.keyboard.press('Tab');
  await expect(plot(page)).toBeFocused();
  await expect(plot(page)).toHaveAttribute('data-pick', /^main:\d+$/, { timeout: 10_000 });
  // Once the card says who it is.
  await expect(page.locator('.strata-card-name')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(plot(page)).toHaveAttribute('data-follow', /./, { timeout: 60_000 });
  await page.keyboard.press('Enter');
  await expect(plot(page)).not.toHaveAttribute('data-follow', /./);
});

test('unrolled, a click on one of the pile follows them at their own pay', async ({ page }) => {
  await home(page);
  await page.locator('.strata-pile-toggle').click();
  await expect(field(page)).toHaveAttribute('data-settled', 'true', { timeout: 5_000 });
  const tail = await field(page).evaluate((el) => (el as HTMLElement & { squarePlaces: (f: string) => number[] }).squarePlaces('pile'));
  const box = (await plot(page).boundingBox())!;
  let j = 0;
  for (let k = 0; k < tail.length / 2; k++) if (tail[2 * k] > 300 && tail[2 * k] < 360) { j = k; break; }
  const who = await lensOn(page, box.x + tail[2 * j], box.y + tail[2 * j + 1] - 4);
  await click(page);
  await expect(plot(page)).toHaveAttribute('data-follow', who.key);
  await expect(plot(page)).toHaveAttribute('data-tail', 'on');
  await expect(field(page)).toHaveAttribute('data-follow-label', new RegExp(`^${who.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · \\$`));
});
