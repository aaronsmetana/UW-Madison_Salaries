import { test, expect } from '@playwright/test';

test('search finds a person and navigates to their profile', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('combobox', { name: 'Search a person' });
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill('Kenneth Poss');
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  await expect(page).toHaveURL(/\/person\//);
  // The lead "Actual pay" stat card.
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
});

// The peer bar's p25/median/p75 labels are centered on their ticks, so a long-tailed cohort (a few very
// high earners stretching `max`) squeezes all three together. They used to render as one unreadable run —
// which neither axe nor a presence assertion catches, hence this geometric check. "Professor" is the
// known-bad cohort: p75 $258k against a $749k max.
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`peer-range quartile labels never overlap (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./');
    const search = page.getByRole('combobox', { name: 'Search a person' });
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill('Kenneth Poss');
    const hit = page.getByRole('option').first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    // Anchor both ends: the labels' container starts with "p25 $…" too, so a start-anchored regex
    // would match the wrapper and compare the wrong boxes.
    const p25 = page.getByText(/^p25 \$[\d.,]+k$/).first();
    await expect(p25).toBeVisible({ timeout: 60_000 });
    const median = page.getByText(/^median \$[\d.,]+k$/).first();
    const p75 = page.getByText(/^p75 \$[\d.,]+k$/).first();

    const boxes = [];
    for (const label of [p25, median, p75]) {
      const box = await label.boundingBox();
      expect(box, 'quartile label should have a layout box').not.toBeNull();
      boxes.push(box!);
    }

    // Two labels may share a row only if their horizontal spans are disjoint; otherwise they must have
    // been staggered onto different rows.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const sameRow = Math.abs(a.y - b.y) < 8;
        const overlapsX = a.x + a.width > b.x && b.x + b.width > a.x;
        expect(
          sameRow && overlapsX,
          `labels ${i}/${j} overlap at ${width}px — a=${JSON.stringify(a)} b=${JSON.stringify(b)}`
        ).toBe(false);
      }
    }
  });
}
