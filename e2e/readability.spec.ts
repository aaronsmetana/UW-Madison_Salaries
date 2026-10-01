import { test, expect, devices, type Page } from '@playwright/test';
import { parseColor, flatten, contrast } from './color';
import { deltaE } from './glass';

/**
 * The app-wide readability pass, as a reader meets it: the facts under a person's name as filled pills,
 * one size for every card title, links whose underline is quieter but never gone, and row buttons that
 * are not a wall of outlines. Each is one shared component or rule, so each is checked on more than one
 * page.
 */

const AARON = 'aaronsmetana|2014-10-15';

type RGB = [number, number, number];

/**
 * The colour actually behind an element: every background from it up to the first opaque one, laid
 * over each other from the bottom. A translucent pill or row tint is not the colour of its own box.
 */
async function groundOf(page: Page, selector: string, from: 'self' | 'parent' = 'parent'): Promise<RGB> {
  const layers = await page.locator(selector).first().evaluate((e, start) => {
    const out: string[] = [];
    for (let el: Element | null = start === 'self' ? e : e.parentElement; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      out.push(bg);
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg) && !/\/\s*0?\.\d+\)$|,\s*0?\.\d+\)$/.test(bg)) break;
    }
    out.push(getComputedStyle(document.body).backgroundColor);
    return out;
  }, from);
  let ground: RGB = [255, 255, 255];
  for (const layer of layers.reverse()) {
    const [r, g, b, a] = parseColor(layer);
    ground = flatten([r, g, b, a], ground) as RGB;
  }
  return ground;
}

const onGround = (css: string, ground: RGB): RGB => {
  const [r, g, b, a] = parseColor(css);
  return flatten([r, g, b, a], ground) as RGB;
};

for (const scheme of ['light', 'dark'] as const) {
  /**
   * The facts under a person's name (Job code, Grade, Category…) as pills on a tint of their own. They
   * were hairline boxes with 11px labels and 11px values — the smallest text on the page, on boxes that
   * all but vanished on a dark page. The fill must separate from the page it sits on, and the words on
   * it must read: the value in body ink at the caption size, the label as the app's small caps. A job
   * code in the search list wears the same pill.
   */
  test(`the facts under a person's name are filled pills a reader can read (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    const pills = page.locator('.fact-pills .fact-pill');
    await expect(pills.first()).toBeVisible({ timeout: 60_000 });
    expect(await pills.count(), 'the header shows too few facts to be checking anything').toBeGreaterThanOrEqual(5);
    await expect(pills.first()).toContainText('Job code');

    const s = await pills.first().evaluate((p) => {
      const cs = getComputedStyle(p);
      const value = p.querySelector('.fact-pill-value')!;
      const label = p.firstElementChild!;
      return {
        bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, cursor: cs.cursor,
        value: getComputedStyle(value).color, valueSize: getComputedStyle(value).fontSize,
        label: getComputedStyle(label).color,
      };
    });
    const ground = await groundOf(page, '.fact-pills .fact-pill');
    const pill = onGround(s.bg, ground);
    const d = deltaE(pill, ground);
    expect(d, `the pill's fill does not separate from the page: dE ${d.toFixed(2)}`).toBeGreaterThan(2.3);
    expect(parseFloat(s.border) || 0, 'the pill is outlined again').toBe(0);
    expect(contrast(onGround(s.value, pill), pill), 'the value on the pill').toBeGreaterThanOrEqual(7);
    expect(contrast(onGround(s.label, pill), pill), 'the label on the pill').toBeGreaterThanOrEqual(4.5);
    expect(s.valueSize, 'the value is back at the smallest size on the page').toBe('13px');
    // A fact, not a control: pointing at it changes nothing.
    await pills.first().locator('.fact-pill-value').hover();
    await page.waitForTimeout(200);
    expect(await pills.first().evaluate((p) => getComputedStyle(p).backgroundColor)).toBe(s.bg);
    expect(s.cursor).toBe('auto');

    // One pill in the app: a job code in the search list has the same fill and shape.
    await page.goto('./');
    const search = page.getByRole('combobox', { name: 'Search a person' });
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill('engineer');
    const code = page.locator('.search-dropdown .code-pill').first();
    await expect(code).toBeVisible({ timeout: 30_000 });
    const c = await code.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, radius: getComputedStyle(e).borderTopLeftRadius }));
    expect(c.bg, 'a job code wears a different fill from the facts').toBe(s.bg);
    expect(c.radius).toBe(s.radius);
  });

  /**
   * Every link keeps its underline — in a sentence, colour alone does not say "link" (WCAG 1.4.1) — but
   * a quieter one, in part of the link's own colour. Quieter must not mean gone: the underline is
   * measured against its ground at 3:1 or better, on the faintest link there is (the footer's dimmed
   * "About the data") as well as the accent ones in a person's header, and it takes the link's full
   * colour under the pointer.
   */
  test(`links keep an underline a reader can see, quieter until pointed at (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./person/${encodeURIComponent(AARON)}`);
    await expect(page.locator('.page-rail a').first()).toBeVisible({ timeout: 60_000 });
    for (const sel of ['.page-rail a[data-underline="always"]', '.mantine-AppShell-footer a[data-underline="always"]']) {
      const link = page.locator(sel).first();
      await expect(link, sel).toBeVisible();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const s = await link.evaluate((a) => ({ line: getComputedStyle(a).textDecorationLine, deco: getComputedStyle(a).textDecorationColor, color: getComputedStyle(a).color }));
      expect(s.line, `${sel}: the underline is gone`).toContain('underline');
      const [, , , alpha] = parseColor(s.deco);
      expect(alpha, `${sel}: the underline is at full strength at rest`).toBeLessThan(1);
      const ground = await groundOf(page, sel, 'self');
      const c = contrast(onGround(s.deco, ground), ground);
      expect(c, `${sel}: the underline reads ${c.toFixed(2)}:1 against its ground`).toBeGreaterThanOrEqual(3);
      await link.hover();
      await page.waitForTimeout(250);
      const hovered = await link.evaluate((a) => ({ deco: getComputedStyle(a).textDecorationColor, color: getComputedStyle(a).color }));
      expect(parseColor(hovered.deco).slice(0, 3).map(Math.round), `${sel}: the underline is not the link's colour under the pointer`)
        .toEqual(parseColor(hovered.color).slice(0, 3).map(Math.round));
      expect(parseColor(hovered.deco)[3]).toBe(1);
    }
  });

  /**
   * The row buttons ("+ Add to tray", "+ Compare") at rest: no outline — twenty-five hairline pills down a
   * table's right edge were a wall — in the muted ink that clears 3:1 (divisions.spec). The row a reader
   * points at gives its button the accent and a tint.
   */
  test(`a row's add button has no outline at rest and the accent on its row (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./explore?tab=schools');
    const btn = page.locator('.school-row .peer-add').first();
    await expect(btn).toBeVisible({ timeout: 60_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--text-accent)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    const rest = await btn.evaluate((b) => ({ border: getComputedStyle(b).borderTopColor, bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
    expect(parseColor(rest.border)[3], 'the add button is outlined at rest').toBe(0);
    expect(rest.color).not.toBe(accent);
    await page.locator('.school-row').first().hover();
    await page.waitForTimeout(250);
    const on = await btn.evaluate((b) => ({ bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
    expect(on.color, 'the row a reader points at leaves its button grey').toBe(accent);
    expect(parseColor(on.bg)[3], 'no tint under the pointed-at row').toBeGreaterThan(0);
  });
}

/** On a touch screen there is no pointer to point at a row, so every add button carries the accent. */
test('on a touch screen every add button carries the accent at rest', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  await page.goto('./explore?tab=schools');
  const btn = page.locator('.school-row .peer-add').first();
  await expect(btn).toBeVisible({ timeout: 60_000 });
  const s = await btn.evaluate((b) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-accent)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return { color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, accent };
  });
  expect(s.color).toBe(s.accent);
  expect(parseColor(s.bg)[3]).toBeGreaterThan(0);
  await ctx.close();
});

/**
 * One size for every card title, a clear step over the line under it, on every page: the titles were
 * 15px against a 13px line, so a card's heading and its explanation read as one grey block; then 17px,
 * one step off the type scale (typescale.spec). And one convention for what they say, read as rendered:
 * CardTitle.test.ts reads the titles as written, but a title passed in as a prop or built at runtime
 * ("Raises in Neurology, Mar 2026 → Sep 2026 (same job, same FTE)", through RaiseDistribution's `title`)
 * never reaches it. No em-dash tail, no middle-dot tail, no parenthetical: that is the sub line's job.
 */
test('every card title is one size, a step over its sub line, and a short phrase, on every page', async ({ page }) => {
  for (const [route, ready] of [
    [`./person/${encodeURIComponent(AARON)}`, '.peer-strip'],
    // The loaded histogram: the page loads with one real card title on a placeholder.
    ['./paycheck?code=IT040', '.hist-plot'],
    ['./explore?tab=changes', '.card-title'],
    [`./school/${encodeURIComponent('School of Medicine and Public Health')}?tab=dist`, '.card-title'],
    [`./raises?sch=${encodeURIComponent('School of Medicine and Public Health')}&dept=Neurology`, '.raise-review-dist'],
  ] as const) {
    await page.goto(route);
    // Visible ones: a page's other tabs keep their panels (and titles) mounted but hidden.
    await expect(page.locator(ready).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.card-title')].map((e) => ({
        size: getComputedStyle(e).fontSize,
        text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
      subs: [...document.querySelectorAll('.card-title-sub')].map((e) => parseFloat(getComputedStyle(e).fontSize)),
    }));
    expect(s.titles.length, `${route}: no card titles to measure`).toBeGreaterThan(0);
    expect(new Set(s.titles.map((t) => t.size)), `${route}: card titles in more than one size`).toEqual(new Set(['18px']));
    for (const sub of s.subs) expect(sub, `${route}: a sub line as large as its title`).toBeLessThan(18);
    const texts = s.titles.map((t) => t.text);
    expect(texts.filter((t) => /\s[—–]\s/.test(t)), `${route}: an em-dash tail`).toEqual([]);
    expect(texts.filter((t) => /\s·\s/.test(t)), `${route}: a middle-dot tail`).toEqual([]);
    expect(texts.filter((t) => /[()]/.test(t)), `${route}: a parenthetical`).toEqual([]);
  }
  // The one that slipped through, by name: the Raises chart's title, with what it counts under it.
  const dist = page.locator('.raise-review-dist');
  await expect(dist.locator('.card-title')).toHaveText(/^Raises in Neurology, \w{3} \d{4} → \w{3} \d{4}$/);
  await expect(dist.locator('.card-title-sub')).toContainText('same job at the same FTE');
});

/**
 * A link that is a table cell's whole content (a name alone in its column) is told apart by its column and
 * colour and underlined under the pointer; a column of underlined names was the one place a table read as
 * dated, and a person's peers table never had them. A link with other words beside it keeps its underline:
 * that is what WCAG 1.4.1 asks, and without it dark mode told Divisions' title links from their staff
 * category at 1.99:1 (axe's link-in-text-block). The test above holds the sentence links to it.
 */
test('a link alone in a table cell is underlined under the pointer, not at rest; a link beside words always', async ({ page }) => {
  for (const [route, table] of [
    ['./paycheck?code=IT040', '.mantine-Table-td a[data-underline="always"]:only-child'],
    ['./explore?tab=changes', '.mantine-Table-td a[data-underline="always"]:only-child'],
  ] as const) {
    await page.goto(route);
    const link = page.locator(table).locator('visible=true').first();
    await expect(link, `${route}: no link in a table cell`).toBeVisible({ timeout: 60_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await expect(link, `${route}: a cell's link is underlined at rest`).toHaveCSS('text-decoration-line', 'none');
    await link.hover();
    await expect(link, `${route}: a cell's link is not underlined under the pointer`).toHaveCSS('text-decoration-line', 'underline');
    // And from the keyboard.
    await page.mouse.move(0, 0);
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(link, `${route}: a cell's link is not underlined under keyboard focus`).toHaveCSS('text-decoration-line', 'underline');
  }
  // Beside words in its cell: a title on Divisions' Titles tab, with its staff category after it.
  await page.goto('./explore?tab=titles');
  const tagged = page.locator('.mantine-Table-td a[data-underline="always"]:has(+ .cat-tag)').locator('visible=true').first();
  await expect(tagged, 'no title link beside its category to check').toBeVisible({ timeout: 60_000 });
  await page.mouse.move(0, 0);
  await expect(tagged, 'a link beside other words lost its underline').toHaveCSS('text-decoration-line', 'underline');
  // A sentence: the person header's links sit in running text and keep theirs at rest.
  await page.goto(`./person/${encodeURIComponent(AARON)}`);
  const inText = page.locator('.page-rail a[data-underline="always"]').first();
  await expect(inText).toBeVisible({ timeout: 60_000 });
  await page.mouse.move(0, 0);
  await expect(inText).toHaveCSS('text-decoration-line', 'underline');
});

/**
 * A field's help text sits under the field, not between its label and it (theme.ts, InputWrapper). Above,
 * it pushed that one field's label higher than the labels beside it, so a row of fields stood out of line:
 * Screening's "Min. cohort size", Raises' "Count raises above". In a row, the labels share a top and so do
 * the fields; Screening's button lines up with the fields, not the labels.
 */
test("a field's help text is under the field, and a row of fields shares its tops", async ({ page }) => {
  for (const [route, row] of [
    ['./screening', '.screen-scope'],
    ['./raises', 'main'],
  ] as const) {
    await page.goto(route);
    const help = page.locator(`${row} .mantine-InputWrapper-description`).locator('visible=true');
    await expect(help.first(), `${route}: no field with help text`).toBeVisible({ timeout: 60_000 });
    const placed = await help.evaluateAll((els) => els.map((d) => {
      const wrap = d.closest('.mantine-InputWrapper-root')!;
      const field = wrap.querySelector('.mantine-Input-wrapper')!;
      return { text: d.textContent, help: d.getBoundingClientRect().top, fieldBottom: field.getBoundingClientRect().bottom };
    }));
    for (const p of placed) expect(p.help, `${route}: "${p.text}" sits above its field`).toBeGreaterThanOrEqual(p.fieldBottom - 1);
  }

  // Screening's scope row, as one line: every label at one top, every field and the button at another.
  await page.goto('./screening');
  const scope = page.locator('.screen-scope');
  await expect(scope.getByRole('button', { name: /^Screen/ })).toBeVisible({ timeout: 60_000 });
  const r = await scope.evaluate((g) => {
    const top = (e: Element) => Math.round(e.getBoundingClientRect().top);
    const labels = [...g.querySelectorAll('.mantine-InputWrapper-label')].filter((l) => l.textContent?.trim() && getComputedStyle(l.firstElementChild ?? l).visibility !== 'hidden');
    return {
      labels: labels.map((l) => [l.textContent, top(l)] as const),
      fields: [...g.querySelectorAll('.mantine-Input-wrapper')].map(top),
      button: top(g.querySelector('button.mantine-Button-root')!),
    };
  });
  expect(r.labels.length, 'the scope row has too few labelled fields to be checking anything').toBeGreaterThanOrEqual(3);
  expect(new Set(r.labels.map(([, t]) => t)).size, `labels out of line: ${JSON.stringify(r.labels)}`).toBe(1);
  expect(new Set(r.fields).size, `fields out of line: ${r.fields}`).toBe(1);
  expect(Math.abs(r.button - r.fields[0]), 'the button does not line up with the fields').toBeLessThanOrEqual(1);
});
