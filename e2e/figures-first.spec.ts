import { test, expect, type Page } from '@playwright/test';

/**
 * A card leads with one sentence and its figure; how the figure was counted is one click away (G22).
 * Changes opened with about 120 words and two callouts before its first number, the raise simulator put a
 * methodology paragraph between its presets and its inputs, and History closed on a 60-word footnote.
 */

const AARON = 'aaronsmetana|2014-10-15';

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** The method note: present, folded, and holding `text`. */
async function folded(page: Page, cls: string, text: RegExp) {
  const note = page.locator(`details.method-note.${cls}`);
  await expect(note).toHaveCount(1);
  expect(await note.evaluate((d) => (d as HTMLDetailsElement).open), 'the method note starts open').toBe(false);
  await expect(note.locator('summary')).toHaveText('How this is calculated');
  await expect(note).toContainText(text);
  // It opens from the keyboard, and the words are then on screen.
  await note.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(note.locator('.method-note-body')).toBeVisible();
}

test('Changes: one sentence, then the figures; the caveats are folded under them', async ({ page }) => {
  await page.goto('./divisions?tab=changes');
  const panel = page.getByRole('tabpanel', { name: 'Changes' });
  const tile = panel.locator('[data-stat-card], .stat-cell').first();
  await expect(tile).toContainText(/\d/, { timeout: 60_000 });
  await expect(panel.locator('.changes-lead')).toBeVisible();
  const before = await panel.evaluate((p) => {
    const top = p.querySelector('[data-stat-card], .stat-cell')!.getBoundingClientRect().top;
    const prose = [...p.querySelectorAll('p, .mantine-Alert-root')]
      .filter((e) => e.getBoundingClientRect().bottom <= top && (e as HTMLElement).offsetParent)
      .filter((e) => !e.closest('label, .mantine-InputWrapper-root, button'));
    return { text: prose.map((e) => (e as HTMLElement).innerText).join(' '), alerts: prose.filter((e) => e.classList.contains('mantine-Alert-root')).length };
  });
  expect(before.alerts, 'a callout comes before the figures').toBe(0);
  expect(words(before.text), `words before the first figure: "${before.text}"`).toBeLessThanOrEqual(25);
  await folded(page, 'changes-method', /matched by name only/);
});

test('the raise simulator goes from its presets straight to its inputs, its method folded at the end', async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=pay`);
  const card = page.locator('.mantine-Card-root', { hasText: 'Raise / what-if simulator' });
  const presets = card.locator('[data-raise-preset]').first();
  await expect(presets).toBeVisible({ timeout: 60_000 });
  const between = await card.evaluate((c) => {
    const p = c.querySelector('[data-raise-preset]')!.parentElement!.getBoundingClientRect().bottom;
    const input = [...c.querySelectorAll('label')].find((l) => l.textContent?.includes('Annual raise'))!.getBoundingClientRect().top;
    return [...c.querySelectorAll('p')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= p - 1 && r.bottom <= input + 1 && r.height > 0; })
      .map((e) => (e as HTMLElement).innerText);
  });
  expect(between, 'words between the presets and their inputs').toEqual([]);
  await folded(page, 'raise-method', /median raise among people who kept the same title/);
  // Last in its card.
  expect(await card.evaluate((c) => c.lastElementChild?.classList.contains('method-note'))).toBe(true);
});

test("History closes on its table, the reading of its columns folded", async ({ page }) => {
  await page.goto(`./person/${encodeURIComponent(AARON)}?tab=history`);
  const table = page.locator('table.appt-history');
  await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  const after = await page.locator('.mantine-Card-root', { has: table }).evaluate((c) => {
    const bottom = c.querySelector('table.appt-history')!.getBoundingClientRect().bottom;
    return [...c.querySelectorAll('p')].filter((e) => e.getBoundingClientRect().top >= bottom && (e as HTMLElement).offsetParent && !e.closest('details'))
      .map((e) => (e as HTMLElement).innerText).join(' ');
  });
  expect(words(after), `a footnote under the table: "${after}"`).toBeLessThanOrEqual(15);
  await folded(page, 'history-method', /“Change” is the change in actual pay/);
});
