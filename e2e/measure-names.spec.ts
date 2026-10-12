import { test, expect } from '@playwright/test';

/**
 * One figure, one name (G2): every pay figure is named after the measure in force — "Actual pay" or
 * "Full-time rate" — never a bare "Salary", "Pay" or "Current salary". The same number went by five names
 * beside a control that names the measure. Read off every heading, column, legend, tab, stat label and
 * chart word on the pages that show pay; the measure control's own "Pay" is its name, not a figure's.
 */

const AARON = 'aaronsmetana|2014-10-15';

const PAGES: [string, string, string][] = [
  ['a person', `./person/${encodeURIComponent(AARON)}`, '.peer-strip circle.chart-dot'],
  ['a person, pay trend', `./person/${encodeURIComponent(AARON)}?tab=trends`, '.recharts-line-curve'],
  ['a person, history', `./person/${encodeURIComponent(AARON)}?tab=history`, 'table.appt-history tbody tr'],
  ['a person, report', `./person/${encodeURIComponent(AARON)}?tab=report`, '.recharts-line-curve'],
  ['a title', './titles?code=FA020', '.recharts-bar-rectangle'],
  ['Divisions › Top earners', './divisions?tab=earners', '.earner-row'],
  ['Divisions › Trends', './divisions?tab=trends', '.recharts-line-curve'],
  ['a division', `./school/${encodeURIComponent('School of Education')}?tab=dist`, '.recharts-line-curve'],
  ['Raises', './raises', '.raise-above-table tbody tr'],
  ['Compare', './compare', '.recharts-line-curve'],
];

const BARE = /^(salary|pay|current salary|salary rate|rate)$/i;
const OLD = /median salary|salary (over time|distribution|by snapshot|trend|growth|trajectories)/i;

for (const [where, path, ready] of PAGES) {
  test(`every pay figure is named for its measure: ${where}`, async ({ page }) => {
    await page.addInitScript((set) => localStorage.setItem('uwsal.tray.v1', set), JSON.stringify([
      { type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 },
      { type: 'title', id: 'FA020', label: 'Professor', colorIdx: 1 },
    ]));
    await page.goto(path);
    await expect(page.locator(ready).first(), 'the page never drew').toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const found = await page.evaluate(([bare, old]) => {
      const [B, O] = [new RegExp(bare, 'i'), new RegExp(old, 'i')];
      const sel = 'th, h1, h2, h3, h4, [role="tab"], label, .recharts-legend-item-text, .marker-legend, svg text, .stat-cell-head, [data-stat-card] > :first-child, table caption, [aria-label]';
      const out: string[] = [];
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('.pay-measure')) continue;
        const texts = [(el as HTMLElement).innerText ?? el.textContent ?? '', el.getAttribute('aria-label') ?? ''];
        for (const raw of texts) {
          const t = raw.replace(/\s+/g, ' ').trim();
          if (t && (B.test(t) || O.test(t))) out.push(`${el.tagName.toLowerCase()}: "${t.slice(0, 60)}"`);
        }
      }
      return [...new Set(out)];
    }, [BARE.source, OLD.source]);
    expect(found).toEqual([]);
  });
}
