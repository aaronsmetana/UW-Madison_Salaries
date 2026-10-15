import { test, expect, type Page } from '@playwright/test';

/**
 * The ⌘K palette (I8), the landing graph full page (I9) and a group shown on it (I10).
 *
 * The palette opens on its box with no band above it, says its keys at its foot, lists the people looked at last
 * and then the pages; typed into, its results take the pages' place and stop short of the keys. Full page is in the
 * address with its title and school, so a link or Back reopens it; its bar gives the filter's chip a line of its
 * own. A group's people are lit where they stand and everyone else keeps their own colour at 40%, and no pin's
 * label is drawn over another's.
 */

test.use({ viewport: { width: 1440, height: 900 } });
const AARON = 'aaronsmetana|2014-10-15';

async function palette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search and go' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the palette: no band over its box, its keys said, the people looked at last, and results in the pages’ place', async ({ page }) => {
  // A person looked at, so there is someone to list.
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.goto('./divisions');
  await expect(page.locator('main')).toBeVisible();
  const dialog = await palette(page);
  const box = dialog.getByRole('combobox');
  await expect(box).toBeFocused();
  const [content, input] = [(await dialog.boundingBox())!, (await box.boundingBox())!];
  // The dialog's own padding over the box, the same as at its sides, and no more.
  expect(input.y - content.y, 'an empty band over the box').toBeLessThan(28);
  expect(input.y - content.y, 'the box against the dialog’s top edge').toBeGreaterThanOrEqual(8);
  const keys = dialog.locator('.palette-keys');
  await expect(keys).toBeVisible();
  await expect(keys).toHaveText(/↑\s*↓\s*to move.*Enter\s*to open.*Esc\s*to close/);
  await expect(dialog.locator('.palette-recent')).toContainText('Aaron Smetana');
  await expect(dialog.getByText('Go to')).toBeVisible();
  // Typed into: the pages go, the results come, and stop above the keys.
  await box.fill('smith');
  await expect(dialog.getByText('Go to')).toHaveCount(0);
  const list = page.locator('.search-dropdown');
  await expect(list).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 60_000 });
  const [l, k] = [(await list.boundingBox())!, (await keys.boundingBox())!];
  expect(l.y + l.height, 'the results run over the keys').toBeLessThanOrEqual(k.y + 1);
  // A recent person opens from the list.
  await box.fill('');
  await dialog.locator('.palette-recent').getByText('Aaron Smetana').click();
  await expect(page).toHaveURL(new RegExp(`/person/${encodeURIComponent(AARON)}`));
});

test('full page is in the address with its title and school: a link reopens it, Back comes back to it, and closing takes it off', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 60_000 });
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('full');
  // A link to it, with a title and a school: the graph opens full page, both on.
  await page.goto('./?view=full&gt=FA020&gs=College%20of%20Engineering');
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on', { timeout: 60_000 });
  const chip = page.locator('.hero-dist-full .strata-chip').first();
  await expect(chip).toContainText('Professor', { timeout: 60_000 });
  await expect(chip).toContainText('College of Engineering');
  await expect(page.locator('.hero-dist-full .search-token')).toHaveCount(2);
  // The chip on a line of its own, whole: nothing cut short.
  const cut = await page.locator('.hero-dist-full .strata-chip > span').evaluate((s) => s.scrollWidth > s.clientWidth + 1);
  expect(cut, 'the filter’s chip is cut short').toBe(false);
  // Measured at rest: the chip rises into its line as it comes.
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
  const [bar, chipBox] = [(await page.locator('.hero-dist-full .hero-dist-search').boundingBox())!, (await chip.boundingBox())!];
  expect(chipBox.y, 'the chip is on the box’s line').toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  // Off and back: out of full page, nothing of it in the address.
  await page.getByRole('button', { name: /Exit full page/ }).click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await expect.poll(() => [...new URL(page.url()).searchParams.keys()].filter((k) => ['view', 'gt', 'gs'].includes(k))).toEqual([]);
});

test('a group shown is lit where it stands, the rest in their own colours at 40%, and no pin label over another', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('strata-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./?view=full&gs=School%20of%20Medicine%20and%20Public%20Health');
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on', { timeout: 60_000 });
  const plot = page.locator('.hero-dist-full .hero-dist-main');
  await expect(plot).toHaveAttribute('data-filter', /School of Medicine/, { timeout: 60_000 });
  // Painted: the group's squares lit (the field's own print of them), and settled.
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForTimeout(300);
  // The canvas holds more than one faded ink, and none of them is the old one grey.
  const inks = await page.evaluate(() => {
    const c = document.querySelector('.hero-dist-full .strata-base') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] === 255) { const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    return [...seen].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k.split(',').map((v) => Number(v) * 8));
  });
  const grey = await page.evaluate(() => { const s = document.createElement('span'); document.body.appendChild(s); s.style.color = 'var(--strata-dim)'; const c = getComputedStyle(s).color; s.remove(); return c.match(/[\d.]+/g)!.slice(0, 3).map(Number); });
  expect(inks.filter((c) => Math.hypot(c[0] - grey[0], c[1] - grey[1], c[2] - grey[2]) < 10), 'everyone else went one pale grey').toEqual([]);
  // Each type's own, faded: several inks among the many squares outside the group, not one.
  expect(inks.length, `the field's inks: ${JSON.stringify(inks)}`).toBeGreaterThanOrEqual(4);
  // No two pin labels overlap.
  const labels = await page.locator('.hero-dist-full .strata-pin').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const [a, b] = [labels[i], labels[j]];
    expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, 'two pin labels overlap').toBe(true);
  }
  await expect(page.locator('.hero-dist-full .strata-pin-label-filter')).toBeVisible();
});
