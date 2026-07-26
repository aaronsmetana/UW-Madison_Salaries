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
