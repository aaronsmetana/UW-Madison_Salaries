import { test, expect } from '@playwright/test';

test('screening a school renders ranked rows and drafts a report', async ({ page }) => {
  await page.goto('./screening');
  await expect(page.getByRole('button', { name: 'Screen' })).toBeVisible({ timeout: 60_000 });

  const schoolSelect = page.getByRole('textbox', { name: 'School / division' });
  await schoolSelect.click();
  await page.getByRole('option').first().click();

  await page.getByRole('button', { name: 'Screen' }).click();

  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  expect(await rows.count()).toBeGreaterThan(0);

  // Capture the drafted person's name so we can assert the report opens ON them (not whatever the
  // tray's existing primary happened to be).
  const draftedName = (await rows.first().locator('td').first().innerText()).trim();
  expect(draftedName.length).toBeGreaterThan(0);

  await rows.first().getByRole('button', { name: 'Draft report' }).click();
  await expect(page).toHaveURL(/\/reports\?type=comparison/);
  await expect(page.locator('#report-sec-notes').or(page.getByText('at or above'))).toBeVisible({ timeout: 60_000 });
  // The brief's "Prepared for" header must name the person we drafted.
  await expect(page.getByText(`Prepared for ${draftedName}`)).toBeVisible({ timeout: 10_000 });
});
