import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * The comparison brief's setup and layout: the strip that explains the page, the factor menu, the
 * section order the brief and its .doc share, and the evidence cards.
 */

async function pickSubject(page: Page, name: string) {
  const start = page.getByPlaceholder('Search yourself by name to begin…');
  await expect(start).toBeVisible({ timeout: 60_000 });
  await start.fill(name);
  const hit = page.getByRole('option').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await expect(page.locator('.report-brief')).toBeVisible({ timeout: 60_000 });
}

test('"How this works" is the full strip until there is a subject, then one line', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  const wrap = page.locator('.report-flow-wrap');
  await expect(wrap).toHaveAttribute('data-expanded', 'yes', { timeout: 60_000 });
  await expect(page.locator('.report-flow > .mantine-Paper-root')).toHaveCount(3);

  await pickSubject(page, 'Aaron Smetana');
  await expect(wrap).toHaveAttribute('data-expanded', 'no');
  await expect(page.locator('.report-flow')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'How this report works' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // One line: the toggle is all that is left of the strip.
  expect((await wrap.boundingBox())!.height).toBeLessThan(40);
  await toggle.click();
  await expect(page.locator('.report-flow > .mantine-Paper-root')).toHaveCount(3);
});

test('a factor added from the menu is listed, and lights its line in the brief on hover', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  await pickSubject(page, 'Aaron Smetana');
  const factor = page.locator('[data-factor="credentials"]');
  await expect(factor, 'an unused factor waits in the menu').toHaveCount(0);

  await page.getByRole('button', { name: 'Add a justification factor' }).click();
  await page.getByRole('menuitem', { name: 'Certifications & education' }).click();
  await expect(factor).toBeVisible();
  await factor.getByRole('button', { name: /^\+1%/ }).click();

  const line = page.locator('[data-receipt="credentials"]');
  await expect(line).toBeVisible({ timeout: 30_000 });
  // The pointer is still over the factor after clicking its pill; move it off before checking rest.
  await page.getByRole('heading', { level: 1 }).hover();
  await expect(line).not.toHaveAttribute('data-lit', 'yes');
  await factor.hover();
  await expect(line).toHaveAttribute('data-lit', 'yes');
});

test('the brief and its .doc give their sections one order, grounds before basis', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  await pickSubject(page, 'Aaron Smetana');
  await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 60_000 });
  // "2. Grounds for …" → "2 Grounds for": the number and the first two words name a section in both.
  const key = (t: string) => {
    const m = t.replace(/\s+/g, ' ').trim().match(/^(\d+)\.\s+(\S+\s+\S+)/);
    return m ? `${m[1]} ${m[2]}` : null;
  };
  const onScreen = (await page.locator('.report-brief h3').allTextContents()).map(key).filter((k): k is string => !!k);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download .doc' }).click(),
  ]);
  const html = readFileSync((await download.path())!, 'utf8');
  const inDoc = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((m) => key(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')))
    .filter((k): k is string => !!k);

  expect(onScreen.length, 'sections were found').toBeGreaterThan(3);
  expect(inDoc).toEqual(onScreen);
  // Numbered in the order they are read — a list that says 3 before 2 has two orders, not one.
  const nums = onScreen.map((k) => Number(k.split(' ')[0]));
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  const grounds = onScreen.findIndex((k) => /Grounds for/.test(k));
  const basis = onScreen.findIndex((k) => /Basis under/.test(k));
  // This subject's brief carries both, so the order between them is a real check.
  expect(grounds, 'the grounds are in the brief').toBeGreaterThanOrEqual(0);
  expect(basis, 'the guideline basis is in the brief').toBeGreaterThanOrEqual(0);
  expect(grounds).toBeLessThan(basis);
});

test('evidence cards carry the hairline and no shadow', async ({ page }) => {
  await page.goto('./reports?type=comparison');
  await pickSubject(page, 'Aaron Smetana');
  const card = page.locator('.evidence-card').first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  const { shadow, border } = await card.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { shadow: cs.boxShadow, border: cs.borderTopWidth };
  });
  expect(shadow).toBe('none');
  expect(border).toBe('1px');
});
