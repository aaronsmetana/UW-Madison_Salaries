import { test, expect } from '@playwright/test';

// DuckDB-WASM needs a moment to boot on a cold page load; give assertions room via expect's
// built-in polling rather than fixed sleeps.

test('home renders KPI figures', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
});

test('theme toggle switches color scheme without blanking the page', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible({ timeout: 60_000 });
  const toggle = page.getByRole('button', { name: /Switch theme/ });
  await expect(toggle).toBeVisible();
  const before = await page.locator('html').getAttribute('data-mantine-color-scheme');
  await toggle.click();
  await expect(async () => {
    const after = await page.locator('html').getAttribute('data-mantine-color-scheme');
    expect(after).not.toBe(before);
  }).toPass({ timeout: 5_000 });
  // Content is still there after the scheme change — the toggle didn't break rendering.
  await expect(page.getByText(/\$[\d,]+/).first()).toBeVisible();
});

test('explore renders a trend chart and the real-dollar toggle', async ({ page }) => {
  await page.goto('./explore');
  await expect(page.locator('svg').first()).toBeVisible({ timeout: 60_000 });
  const realToggle = page.getByText(/^\d{4} \$$/).first();
  await expect(realToggle).toBeVisible();
  await realToggle.click();
  // Toggling shouldn't blow away the chart.
  await expect(page.locator('svg').first()).toBeVisible();
});

test('data health page renders the source/manifest table', async ({ page }) => {
  await page.goto('./data');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 60_000 });
});

// The landing distribution's quartile markers are the same collision risk as PeerRangeBar's (see
// person.spec.ts): p25 and the median sit close together on a right-skewed curve, so their labels
// run into each other and render as one unreadable string. Same guard, same shape — and it must
// hold at phone width, where the chart is narrowest and all three crowd.
for (const { name, width, height } of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`home distribution quartile labels never overlap (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('./', { waitUntil: 'networkidle' });

    // Anchor both ends — the labels' container also starts with "p25 $…", and a start-anchored
    // regex would match the wrapper and compare the wrong boxes.
    const labels = [
      page.getByText(/^p25 \$[\d.,]+k$/).first(),
      page.getByText(/^median \$[\d.,]+k$/).first(),
      page.getByText(/^p75 \$[\d.,]+k$/).first(),
    ];
    await expect(labels[0]).toBeVisible({ timeout: 60_000 });
    // The stagger re-measures on document.fonts.ready; let that settle before reading geometry.
    await page.waitForTimeout(800);

    const boxes = [];
    for (const label of labels) {
      const box = await label.boundingBox();
      expect(box, 'quartile label should have a layout box').not.toBeNull();
      boxes.push(box!);
    }

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

// PayCheck tells the reader the salary they type "is never uploaded, saved, or put in the address
// bar". It used to live in a `?sal=` query parameter, which broke that in three places at once:
// browser history, any copied link, and — because GitHub Pages has no rewrite and deep links bounce
// through public/404.html — a request URL sent to GitHub's servers. This asserts the promise holds.
test('a pinned salary never reaches the URL', async ({ page }) => {
  await page.goto('./paycheck');

  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeVisible({ timeout: 60_000 });
  await title.click();
  await page.getByRole('option').first().click();

  const secret = '123456';
  await page.getByRole('textbox', { name: /Salary to pin/ }).fill(secret);
  // Let any state/URL write settle before reading the address bar.
  await page.waitForTimeout(1_000);

  expect(page.url()).not.toContain(secret);
  expect(page.url()).not.toContain('sal=');
  // The value is still doing its job on the page, just not in the URL.
  await expect(page.getByRole('textbox', { name: /Salary to pin/ })).toHaveValue(/123,?456/);
});
