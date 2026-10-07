import { test, expect } from '@playwright/test';
import { oracle } from './oracle';

/**
 * One grade format (G7): a grade is its number — "Grade 27", "grade 27" — never the source's "Grade 027 Madison 12
 * Month", and its schedule in brackets, "27 (12-month)", where the schedule is part of what is said. The person's
 * facts strip printed the source's text; everywhere else wrote the number.
 */

const AARON = 'aaronsmetana|2014-10-15';

test("the facts strip writes the grade as its number, its schedule only where it isn't the basis beside it", async ({ page }) => {
  // Someone whose grade's schedule is not their basis: an hourly grade on a 12-month appointment, say.
  const [odd] = await oracle<{ pk: string; g: number; s: string }>(
    `SELECT person_key pk, any_value(grade_number) g, any_value(grade_basis) s FROM $SAL
     WHERE snapshot_id = (SELECT max(snapshot_id) FROM $SAL WHERE snapshot_id NOT LIKE '%-pre') AND grade_number IS NOT NULL
       AND lower(comp_basis) = '12 month' AND grade_basis = 'hourly'
     GROUP BY 1 HAVING count(*) = 1 ORDER BY 1 LIMIT 1`,
  );
  for (const [pk, want] of [[AARON, /^27$/], ...(odd ? [[odd.pk, new RegExp(`^${odd.g} \\(hourly\\)$`)] as const] : [])] as const) {
    await page.goto(`./person/${encodeURIComponent(pk)}`);
    const grade = page.locator('dl.fact-strip[aria-label="About this appointment"] .fact-cell', { has: page.locator('dt', { hasText: /^Grade$/ }) }).locator('dd');
    await expect(grade, pk).toHaveText(want, { timeout: 60_000 });
  }
  await expect(page.getByText(/Madison (12|9) Month|Madison Hourly/)).toHaveCount(0);
});
