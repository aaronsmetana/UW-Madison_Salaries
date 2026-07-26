import { test, expect } from '@playwright/test';

// Both hold the same (most populous) title in the latest snapshot (Professor, FA020) — chosen so
// the automatic same-title evidence (proofs/standing) always has a large cohort, and adding the
// second as a named comparator populates the (tray-driven, not automatic) "Peer comparison" table.
test.describe('equity review brief', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./reports?type=comparison');
    const startSearch = page.getByPlaceholder('Search yourself by name to begin…');
    await expect(startSearch).toBeVisible({ timeout: 60_000 });
    await startSearch.fill('Kenneth Poss');
    const startHit = page.getByRole('option').first();
    await expect(startHit).toBeVisible({ timeout: 15_000 });
    await startHit.click();

    const addSearch = page.getByPlaceholder('Add a comparator by name…');
    await expect(addSearch).toBeVisible({ timeout: 30_000 });
    await addSearch.fill('Debdeep Pati');
    const addHit = page.getByRole('option').first();
    await expect(addHit).toBeVisible({ timeout: 15_000 });
    await addHit.click();
  });

  test('renders the brief with evidence, peer, and notes sections', async ({ page }) => {
    await expect(page.locator('#report-sec-highlights')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#report-sec-peers')).toBeVisible();
    await expect(page.locator('#report-sec-notes')).toBeVisible();
  });

  test('anonymize masks comparator names in the brief', async ({ page }) => {
    // Scoped to the brief itself — the setup pane deliberately always shows real names (see its
    // "Anonymize" description), so an unscoped search would find "Debdeep Pati" there regardless.
    const brief = page.locator('.report-brief');
    await expect(brief.locator('#report-sec-peers')).toBeVisible({ timeout: 60_000 });
    await expect(brief.getByText('Debdeep Pati')).toBeVisible();
    await expect(brief.getByText('Peer A', { exact: true })).toHaveCount(0);
    // Mantine's Switch keeps its native input visually hidden (a styled track sits over it), so
    // Playwright's visibility check on the input itself never passes — click the label text instead,
    // exactly as a real user would.
    await page.getByText('Anonymize peer names in document').click();
    await expect(brief.getByText('Peer A', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(brief.getByText('Debdeep Pati')).toHaveCount(0);
  });

  test('downloads the brief as a .doc file', async ({ page }) => {
    await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 60_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download .doc' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.doc$/);
  });
});
