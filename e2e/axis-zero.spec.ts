import { test, expect, type Page } from '@playwright/test';

/**
 * Every chart of pay over time starts at $0 (G12), so a raise is drawn at its size and one chart's line never
 * climbs more steeply than another's for the same change. Read off each chart's own lowest tick on the y axis.
 */

const AARON = 'aaronsmetana|2014-10-15';

const CHARTS: [string, string, string[]][] = [
  ['the person page', `./person/${encodeURIComponent(AARON)}?tab=trends`, ['Salary over time', 'The group this person started with']],
  ['a person’s report', `./person/${encodeURIComponent(AARON)}?tab=report`, ['Salary over time']],
  ['Divisions', './explore?tab=trends', ['Median salary over time']],
  ['a division', `./school/${encodeURIComponent('School of Education')}?tab=dist`, ['Median salary over time']],
  ['Compare', './compare', ['Salary by snapshot', 'Median salary per title over time']],
  ['a raise case', `./reports?type=comparison&subject=${encodeURIComponent(AARON)}`, ['Pay vs. title median over time']],
];

/** The text of the lowest tick on a chart's y axis, the chart found by the name it gives a screen reader. */
async function floorOf(page: Page, name: string) {
  const surface = page.locator(`svg.recharts-surface[aria-label^="${name}."]`).first();
  await expect(surface, `no chart "${name}"`).toBeAttached({ timeout: 60_000 });
  const ticks = surface.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value');
  await expect(ticks.first()).toBeAttached({ timeout: 30_000 });
  return ticks.evaluateAll((ts) => ts.map((t) => ({ y: t.getBoundingClientRect().y, s: (t.textContent ?? '').trim() })).sort((a, b) => b.y - a.y)[0].s);
}

for (const [where, path, names] of CHARTS) {
  test(`pay over time starts at $0: ${where}`, async ({ page }) => {
    // A person and a title in the compare set, for Compare's charts.
    await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
      { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
      { type: 'title', id: 'FA020', label: 'Professor', colorIdx: 1 },
    ]));
    await page.goto(path);
    for (const name of names) expect(await floorOf(page, name), `${where}: ${name}`).toBe('$0');
  });
}
