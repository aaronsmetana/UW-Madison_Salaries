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

// A screen is the most link-worthy artifact this app produces — it is what you hand to a steward —
// and its scope used to live in component state, so a reload or a shared link lost it entirely.
// Every other view in the app keeps its controls in the URL; this asserts Screening now does too.
test('a screen survives a reload and can be shared as a link', async ({ page }) => {
  await page.goto('./screening');
  await expect(page.getByRole('button', { name: /^Screen/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('textbox', { name: 'School / division' }).click();
  const chosen = (await page.getByRole('option').first().innerText()).trim();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: /^Screen/ }).click();

  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const before = await page.locator('table tbody tr').count();

  // The run is now addressable...
  await expect(page).toHaveURL(/[?&]run=1/);
  await expect(page).toHaveURL(/[?&]sch=/);
  const url = page.url();

  // ...survives a reload...
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('table tbody tr').count()).toBe(before);

  // ...and re-runs from a cold navigation to the same link, with the scope still populated.
  await page.goto('./');
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('table tbody tr').count()).toBe(before);
  await expect(page.getByRole('textbox', { name: 'School / division' })).toHaveValue(chosen);
});
