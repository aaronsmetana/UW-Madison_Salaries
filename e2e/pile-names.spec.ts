import { test, expect, type Browser, type Page } from '@playwright/test';
import { oracle, PAY } from './oracle';
import { HOME_STATS, spots, places } from './homeDots';

/**
 * Full page, the people at the top of the pay scale are named too: the pile past the cap, and the pile
 * unrolled. Neither has the magnifying glass over it — the pile clears it, and an unrolled graph is
 * squeezed, so nothing under the glass would read as it looks — so the dot being named is ringed in the
 * field itself and the caption stands beside it.
 *
 * They are the 574 dots a reader is most curious about and the only ones that used to be anonymous.
 */

const SNAP = HOME_STATS.snapshot_id;
const CAP = HOME_STATS.bin_cap;
const SCHOOL = 'School of Medicine and Public Health';
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

/** Someone in the pile — paid at or above the cap — whose name no one else's contains, so a search shows
 *  them alone, with the title and school of their highest-paid appointment. */
async function inPile() {
  const [r] = await oracle<{ person_key: string; nm: string; pay: number; title: string | null; school: string | null }>(
    `WITH names AS (SELECT person_key, lower(any_value(first_name) || ' ' || any_value(last_name)) nm FROM $SAL GROUP BY person_key),
          now AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key),
          top AS (SELECT person_key, title, school FROM (
                    SELECT person_key, title, school,
                           row_number() OVER (PARTITION BY person_key ORDER BY ${PAY} DESC, coalesce(employee_category, 'Other'), title, school) k
                    FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0) WHERE k = 1),
          alone AS (SELECT n.person_key, n.nm FROM names n WHERE length(n.nm) > 9 AND n.nm NOT LIKE '%''%'
                     AND (SELECT count(*) FROM names o WHERE o.nm LIKE '%' || n.nm || '%') = 1)
     SELECT a.person_key, a.nm, now.pay, top.title, top.school FROM alone a JOIN now USING (person_key) JOIN top USING (person_key)
     WHERE now.pay >= ${CAP} ORDER BY a.person_key LIMIT 1`,
  );
  return r;
}

/** Everyone in the pile, by name: what a dot named there must match. */
async function pileNames() {
  const rows = await oracle<{ person_key: string; nm: string }>(
    `WITH now AS (SELECT person_key, sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 GROUP BY person_key)
     SELECT n.person_key, lower(any_value(n.first_name) || ' ' || any_value(n.last_name)) nm
     FROM $SAL n JOIN now USING (person_key) WHERE now.pay >= ${CAP} GROUP BY n.person_key`,
  );
  return new Map(rows.map((r) => [r.person_key, r.nm]));
}

/** Everyone the School of Medicine filter lights. */
async function inSchool() {
  const rows = await oracle<{ person_key: string }>(
    `SELECT DISTINCT person_key FROM $SAL WHERE snapshot_id = '${SNAP}' AND salary > 0 AND school = '${SCHOOL.replace(/'/g, "''")}'`,
  );
  return new Set(rows.map((r) => r.person_key));
}

async function open(browser: Browser, o: { scheme?: 'light' | 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: o.scheme ?? 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  return { ctx, page };
}
async function goFull(page: Page) {
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'on');
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
}
const pileBox = (page: Page) => page.locator('.hero-dist-full .hero-dist-pile');
const pileWho = (page: Page) => page.locator('.hero-dist-full .hero-dist-pile .hero-lens-who');
const tailWho = (page: Page) => page.locator('.hero-dist-full .hero-dist-tail .hero-lens-who');

/** The names are looked up once, when the page goes full page; nothing is named before they are in. */
async function named(page: Page) {
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-who', 'ready', { timeout: 60_000 });
}

/** The pixels of a field's canvas in a band `r0`–`r1` CSS px out from a point. A ring is drawn over the
 *  dots already there, so it changes their colour rather than adding ink: what it does is only visible
 *  pixel against pixel, which is what `changed` counts. */
async function band(page: Page, sel: string, at: { x: number; y: number }, r0: number, r1: number) {
  return page.evaluate(
    ([sel, x, y, r0, r1]: [string, number, number, number, number]) => {
      const c = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!c) return [];
      const dpr = c.width / c.getBoundingClientRect().width;
      const ctx = c.getContext('2d')!;
      const R = Math.ceil(r1 * dpr) + 2;
      const img = ctx.getImageData(Math.round(x * dpr) - R, Math.round(y * dpr) - R, R * 2, R * 2).data;
      const out: number[] = [];
      for (let py = 0; py < R * 2; py++) {
        for (let px = 0; px < R * 2; px++) {
          const d = Math.hypot((px - R) / dpr, (py - R) / dpr);
          if (d < r0 || d > r1) continue;
          const i = (py * R * 2 + px) * 4;
          out.push(img[i], img[i + 1], img[i + 2], img[i + 3]);
        }
      }
      return out;
    },
    [sel, at.x, at.y, r0, r1] as [string, number, number, number, number],
  );
}

/** How many of a band's pixels are plainly a different colour between two of its states. */
function changed(a: number[], b: number[]) {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
    if (d > 24) n++;
  }
  return n;
}

test('full page, the pile names the dot under the pointer, and rings it', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await inPile();
  expect(p, 'no one in the pile to look for').toBeTruthy();
  const { ctx, page } = await open(browser);
  await goFull(page);
  // Where their dot rests: its place in the pile's layout, with no search on, so nothing is marked and the
  // pile itself is what says who is there. (Not from the search's mark: a typed name lights its people, and
  // full page a lit group settles to the floor, so the mark would be where the dot had settled.)
  const at = (await spots()).get(p.person_key);
  expect(at?.field, 'the pile person has no dot in the pile').toBe('pile');
  await named(page);
  const xy = await places(page, '.hero-dist-full .hero-dots-over');
  const [dx, dy] = [xy[2 * at!.index], xy[2 * at!.index + 1]];
  expect(Number.isFinite(dx) && Number.isFinite(dy), 'the pile has no place for their dot').toBe(true);
  const b = (await pileBox(page).boundingBox())!;
  const f = (await page.locator('.hero-dist-full .hero-dots-over').boundingBox())!;
  // The dot and its neighbours with the pointer on the pile but on no one: the pile draws itself brighter
  // under a pointer, so a picture taken before the pointer arrived would differ for that reason alone and
  // the ring would be proved by the hover.
  const sky = { x: b.x + b.width / 2, y: b.y + 4 };
  await page.mouse.move(sky.x, sky.y);
  await expect(pileWho(page)).toHaveCount(0);
  const bare = await band(page, '.hero-dist-pile .dot-field-ink', { x: dx, y: dy }, 1, 8);
  await page.mouse.move(f.x + dx, f.y + dy);
  await expect(pileWho(page)).toHaveAttribute('data-who', p.person_key);
  const name = await pileWho(page).locator('.hero-lens-who-name').textContent();
  expect(name!.toLowerCase()).toBe(p.nm);
  await expect(pileWho(page).locator('.hero-lens-who-pay')).toHaveText(fmtK(p.pay));
  expect(await pileWho(page).locator('.hero-lens-who-detail').allTextContents()).toEqual([p.title, p.school].filter(Boolean));
  // Ringed, so which dot of a packed column is being named is answered by the field itself.
  const ringed = await band(page, '.hero-dist-pile .dot-field-ink', { x: dx, y: dy }, 1, 8);
  expect(changed(bare, ringed), 'the named dot is not ringed').toBeGreaterThan(10);
  // Beside the pile, not on it, and inside the panel.
  const cap = (await pileWho(page).boundingBox())!;
  // The full page's panel is `.hero-dist` itself, with `.hero-dist-full` on it.
  const panel = (await page.locator('.hero-dist-full').boundingBox())!;
  expect(cap.x + cap.width <= b.x + 1, 'the caption lies on the pile').toBe(true);
  expect(cap.x >= panel.x - 1 && cap.y >= panel.y - 1 && cap.y + cap.height <= panel.y + panel.height + 1, 'the caption is off the panel').toBe(true);
  // The pile's own count gives way to it, and comes back when no one is named.
  await expect(page.locator('.hero-dist-full .hero-dist-pile .chart-value-pill')).toHaveCount(0);
  await page.mouse.move(sky.x, sky.y);
  await expect(pileWho(page)).toHaveCount(0);
  await expect(page.locator('.hero-dist-full .hero-dist-pile .chart-value-pill')).toHaveText(/at \$\d+k or more/);
  const after = await band(page, '.hero-dist-pile .dot-field-ink', { x: dx, y: dy }, 1, 8);
  expect(changed(bare, after), 'the ring stayed behind on the dot it had named').toBeLessThan(4);
  await ctx.close();
});

test('with a filter on, the pile names only the people it lights', async ({ browser }) => {
  test.setTimeout(120_000);
  const covered = await inSchool();
  const { ctx, page } = await open(browser);
  await goFull(page);
  await named(page);
  const b = (await pileBox(page).boundingBox())!;
  // Down the pile, a step at a time: who it names at each height.
  const sweep = async () => {
    const out: (string | null)[] = [];
    for (let k = 0; k < 40; k++) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4 - k * 2);
      await page.waitForTimeout(30);
      out.push((await pileWho(page).count()) ? await pileWho(page).getAttribute('data-who') : null);
    }
    return out;
  };
  const before = await sweep();
  expect(before.filter(Boolean).length, 'the pile named no one').toBeGreaterThan(3);
  const box = page.locator('.hero-dist-full .search-bar-field input');
  await box.fill('medicine');
  await page.locator(`.hero-dist-full [role="option"][data-key="d:${SCHOOL}"]`).click({ timeout: 60_000 });
  await expect(page.locator('.hero-dist-full .hero-dots')).toHaveAttribute('data-lit', /./, { timeout: 60_000 });
  await box.blur();
  const after = await sweep();
  const names = after.filter((k): k is string => !!k);
  expect(names.length, 'the pile named no one in the school').toBeGreaterThan(0);
  for (const k of names) expect(covered.has(k), `the pile named ${k}, who the filter does not light`).toBe(true);
  // And it did pass over people it dims: the same sweep named them before.
  expect(before.filter((k, i) => k && !covered.has(k) && after[i] !== k).length, 'the sweep never crossed anyone the filter dims').toBeGreaterThan(0);
  await ctx.close();
});

test('the pile unrolled names the dot under the pointer, and stays out while it is read', async ({ browser }) => {
  test.setTimeout(150_000);
  const names = await pileNames();
  const { ctx, page } = await open(browser);
  await goFull(page);
  await named(page);
  const pb = (await pileBox(page).boundingBox())!;
  await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height - 10);
  const tail = page.locator('.hero-dist-full .hero-dist-tail');
  await expect(tail).toBeVisible();
  await expect(page.locator('.hero-dots-tail')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  const tb = (await tail.boundingBox())!;
  // Along the hill the unrolled dots make, until one is named.
  let at: { x: number; y: number } | null = null;
  for (let k = 0; k < 120 && !at; k++) {
    const x = tb.x + 6 + k * 2;
    const y = tb.y + tb.height - 12;
    await page.mouse.move(x, y);
    await page.waitForTimeout(25);
    if (await tailWho(page).count()) at = { x, y };
  }
  expect(at, 'the unrolled field named no one').toBeTruthy();
  const key = (await tailWho(page).getAttribute('data-who'))!;
  expect(names.has(key), `the unrolled field named ${key}, who is not in the pile`).toBe(true);
  expect((await tailWho(page).locator('.hero-lens-who-name').textContent())!.toLowerCase()).toBe(names.get(key));
  // The caption stands clear of the dot it names, so it never covers what it points at.
  const cap = (await tailWho(page).boundingBox())!;
  expect(cap.y + cap.height <= at!.y - 2 || cap.y >= at!.y + 2, 'the caption lies on the dot it names').toBe(true);
  // Read, it stays out: the wait that folds it back does not run while a pointer is on it.
  await page.waitForTimeout(11_000);
  await expect(tail).toBeVisible();
  await expect(tailWho(page)).toHaveAttribute('data-who', key);
  // Left alone, it folds back as it always did.
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 60);
  await expect(tail).toHaveCount(0, { timeout: 20_000 });
  await ctx.close();
});

test('the names are looked up when the graph opens full page, not on the first hover', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await goFull(page);
  // Nothing has been pointed at: the glass is down, and the names are in all the same.
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-lens', 'off');
  await named(page);
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-lens', 'off');
  await ctx.close();
});

test('on a phone, the graph says once that a dot can be held', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('dotfield-entrance', '1'); } catch { /* private mode */ } });
  await page.goto('./');
  await expect(page.locator('.hero-dots')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await goFull(page);
  const hint = page.locator('.hero-hold-hint');
  await expect(hint).toHaveText(/hold/i);
  // Over the graph it is about, and out of the way of the search above it.
  const hb = (await hint.boundingBox())!;
  const plot = (await page.locator('.hero-dist-full .hero-dist-main').boundingBox())!;
  expect(hb.x >= plot.x - 1 && hb.x + hb.width <= plot.x + plot.width + 1, 'the nudge hangs off the plot').toBe(true);
  // Held, it has been found, and saying it again would be in the way of what it asked for.
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x = plot.x + plot.width * 0.3, y = plot.y + plot.height * 0.8;
  await touch('touchStart', x, y);
  await page.waitForTimeout(700);
  await expect(page.locator('.hero-dist-full .hero-dist-main')).toHaveAttribute('data-lens', 'on');
  await expect(hint).toHaveCount(0);
  await touch('touchEnd', x, y);
  // Not again this visit, even opening the graph anew.
  await page.locator('.hero-dist-full-toggle').click();
  await expect(page.locator('.hero-dist')).toHaveAttribute('data-full', 'off');
  await goFull(page);
  await expect(hint).toHaveCount(0);
  await ctx.close();
});
