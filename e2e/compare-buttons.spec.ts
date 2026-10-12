import { test, expect } from '@playwright/test';

/**
 * A row's compare control is an icon with a name and a tooltip (G19), not the word "Compare" down every row.
 * It shows which rows are already in the set, a check that is pressed, and a second press takes the row out.
 */

test.use({ viewport: { width: 1440, height: 900 } });

for (const [where, path, row] of [
  ["Divisions' Schools", './divisions?tab=schools', '.school-row'],
  ["Divisions' Titles", './divisions?tab=titles', 'tbody tr.peer-row'],
  ['Top earners', './divisions?tab=earners', '.earner-row'],
  ["a title's people", './titles?code=IT040', 'tbody tr.peer-row'],
] as const) {
  test(`an icon names its row, says when the row is in the set, and takes it out again: ${where}`, async ({ page }) => {
    await page.goto(path);
    const btns = page.locator(`${row} .peer-add`);
    await expect(btns.first()).toBeVisible({ timeout: 60_000 });
    // No words down the column: each control is an icon with an accessible name.
    const words = await btns.evaluateAll((bs) => bs.map((b) => b.textContent?.trim() ?? '').filter(Boolean));
    expect(words, 'a compare control still prints a word').toEqual([]);
    const first = btns.first();
    const name = (await first.getAttribute('aria-label'))!;
    expect(name).toMatch(/^Add .+ to compare$/);
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await first.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Add to compare');

    await first.click();
    const what = name.replace(/^Add (.+) to compare$/, '$1');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(first).toHaveAttribute('aria-label', `${what} is in the compare set`);
    await expect(page.getByRole('region', { name: 'Compare set' })).toContainText(what);

    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'false');
    await expect(first).toHaveAttribute('aria-label', name);
  });
}
