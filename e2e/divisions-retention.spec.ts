import { test, expect } from '@playwright/test';
import { oracle } from './oracle';

/**
 * Divisions › Retention (D31, D32): the third figure is a rate, the share of staff who left over the latest step,
 * not the span of the data; and the turnover axis reads its numbers with separators and a true minus.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

test('the third figure is the share who left over the latest step', async ({ page }) => {
  const snaps = await oracle<{ id: string }>(`SELECT snapshot_id id FROM $SAL WHERE snapshot_id NOT LIKE '%-pre' GROUP BY 1 ORDER BY any_value(snapshot_date)`);
  const [prev, last] = snaps.slice(-2).map((s) => s.id);
  const [r] = await oracle<{ n: number; left: number }>(
    `WITH p AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${prev}' AND salary > 0),
          l AS (SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${last}' AND salary > 0)
     SELECT count(*) n, count(*) FILTER (WHERE l.person_key IS NULL) "left" FROM p LEFT JOIN l USING (person_key)`
  );
  await page.goto('./divisions?tab=retention');
  const tile = page.locator('.left-latest');
  await expect(tile).toContainText('Left since the snapshot before', { timeout: 60_000 });
  await expect(tile).toContainText(`${((100 * r.left) / r.n).toFixed(1)}%`, { timeout: 60_000 });
  await expect(tile).toContainText(`${r.left.toLocaleString('en-US')} of the ${r.n.toLocaleString('en-US')} paid then`);
  await expect(page.getByText('data begins Nov 2021')).toHaveCount(0);
});

test('the turnover axis reads with separators and a true minus', async ({ page }) => {
  await page.goto('./divisions?tab=retention');
  const axis = page.locator('.turnover .recharts-yAxis .recharts-cartesian-axis-tick-value');
  await expect(axis.first()).toBeVisible({ timeout: 60_000 });
  const ticks = await axis.allTextContents();
  for (const t of ticks) expect(t, `tick "${t}"`).toMatch(/^−?\d{1,3}(,\d{3})*$/);
});
