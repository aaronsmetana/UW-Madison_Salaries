import { expect, type Page } from '@playwright/test';

/**
 * A person picked in the landing search opens through the reveal (components/PersonReveal) whenever their
 * dot is marked by then: for up to five seconds it covers the page, and the pointer with it. A test that
 * goes on to point at, read or scan the person page waits until it is over; it may never have started.
 */
export async function afterReveal(page: Page) {
  await expect(page).toHaveURL(/\/person\//, { timeout: 60_000 });
  await expect(page.locator('.person-reveal')).toHaveCount(0, { timeout: 10_000 });
}
