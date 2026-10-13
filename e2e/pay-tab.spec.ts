import { test, expect } from '@playwright/test';

/**
 * The Pay & standing tab, read at a glance (P16, P18–P21): Standing's pools named in a column wide enough for
 * them; the pay band filled to the rate, its standing over its marker, its scale named on the track and the
 * title's own spread laid over it; and a raise simulator that goes from presets on one row to a slider and four
 * spans of years, headed by the years to the band's top, with the path year by year against that top, the band
 * held at today's values.
 */

const AARON = 'aaronsmetana|2014-10-15';
test.use({ viewport: { width: 1440, height: 1000 } });

test('Standing names its pools in a column wide enough, the department as "Dept:"', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
  const rows = page.locator('.chart-plot', { hasText: 'more than' });
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const g = await rows.evaluateAll((els) => els.map((el) => ({ label: el.firstElementChild!.getBoundingClientRect().width, row: el.getBoundingClientRect().width, text: (el.firstElementChild as HTMLElement).innerText.split('\n')[0] })));
  for (const r of g) expect(r.label / r.row, `${r.text}: the label column is narrow`).toBeGreaterThan(0.3);
  expect(g.map((r) => r.text)).toContain('Dept: Administration');
});

test("the pay band is filled to the rate, says its standing over the marker, names its scale and lays the title's spread over it", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
  const bar = page.locator('.person-payband .payband-bar');
  await expect(bar.locator('.payband-marker')).toBeVisible({ timeout: 60_000 });
  // The title's spread arrives with its own query, after the band.
  await expect(bar.locator('.payband-peers')).toBeAttached({ timeout: 60_000 });
  const m = await bar.evaluate((el) => {
    const r = (s: string) => el.querySelector(s)!.getBoundingClientRect();
    const track = r('.payband-track'), fill = r('.payband-fill'), marker = r('.payband-marker'), status = r('.payband-status');
    return { track, fillRight: fill.right, markerX: marker.left + marker.width / 2, statusX: status.left + status.width / 2, statusBottom: status.bottom, markerTop: marker.top,
      scale: [...el.querySelectorAll('.payband-scale-label')].map((s) => s.textContent), peers: !!el.querySelector('.payband-peers'), median: !!el.querySelector('.payband-peers-median') };
  });
  expect(Math.abs(m.fillRight - m.markerX), 'the fill does not run to the marker').toBeLessThanOrEqual(1);
  expect(Math.abs(m.statusX - m.markerX), 'the standing is not over its marker').toBeLessThanOrEqual(2);
  expect(m.statusBottom, 'the standing is not above the bar').toBeLessThanOrEqual(m.markerTop);
  expect(m.scale[0]).toMatch(/^min \$\d+k$/);
  expect(m.scale[m.scale.length - 1]).toMatch(/^max \$\d+k$/);
  expect(m.scale.length, 'the quartiles are not named on the track').toBe(5);
  expect(m.peers && m.median, "the title's spread is not on the band").toBe(true);
  await expect(page.locator('.person-payband .payband-range')).toContainText('shaded: the middle 50% of everyone titled System Engineer IV');
  await expect(page.locator('.person-payband')).not.toContainText('Band quartiles');
});

test('the simulator: presets on one row, a slider and its number agreeing, four spans of years, and the years to the top', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
  const card = page.locator('.mantine-Card-root', { hasText: 'Raise / what-if simulator' });
  await expect(card.locator('[data-raise-preset="title"]')).toBeVisible({ timeout: 60_000 });
  const tops = await card.locator('[data-raise-preset]').evaluateAll((bs) => [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))]);
  expect(tops, 'the presets wrap to more than one row').toHaveLength(1);
  // The number and the slider are one value.
  const number = card.getByRole('textbox', { name: 'Annual raise %' });
  await number.fill('3');
  await number.blur();
  await expect(card.getByRole('slider', { name: 'Annual raise' })).toHaveAttribute('aria-valuenow', '3');
  // The years are four choices.
  await expect(card.getByRole('radio')).toHaveCount(4);
  for (const y of ['1', '3', '5', '10']) await expect(card.getByRole('radio', { name: y, exact: true })).toHaveCount(1);
  await card.getByText('10', { exact: true }).click();
  // The headline: the years to the band's top at that raise, as the rate and the band say.
  const range = await page.locator('.person-payband .payband-range').innerText();
  const [mn, mx] = [...range.matchAll(/\$([\d,]+)/g)].slice(0, 2).map((x) => Number(x[1].replace(/,/g, '')));
  const pct = Number((await page.locator('.person-payband .payband-status').innerText()).match(/(\d+)%/)![1]) / 100;
  const rate = mn + (mx - mn) * pct;
  const want = Math.ceil(Math.log(mx / rate) / Math.log(1.03));
  const head = (await card.locator('.raise-headline').innerText()).match(/≈(\d+) years to the band max at 3%\/yr/);
  expect(head, 'no years-to-the-top headline').not.toBeNull();
  // The band's own rate is shown to its whole percent, so the years can be one either way.
  expect(Math.abs(Number(head![1]) - want)).toBeLessThanOrEqual(1);
  // Year by year, today and ten more, against the band's top held at today's value.
  await expect(card.locator('.raise-path .recharts-line-dots circle')).toHaveCount(11);
  await expect(card.locator('.raise-band-max')).toContainText('held at Sep 2026');
});
