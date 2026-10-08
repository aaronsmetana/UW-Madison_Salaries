import { test, expect, type Browser } from '@playwright/test';
import { oracle, latestSnapshot, PAY } from './oracle';

/**
 * The reports' words (section 4): footnotes as a printed page has them, sentences built from the cohort's name
 * that read, a raise case's link that opens on its own subject, and no person named by their key.
 */

const AARON = 'aaronsmetana|2014-10-15';
const HALZEN = 'francishalzen|1975-07-01';

async function caseFor(browser: Browser, subject: string, set: { id: string; label: string }[]) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((s) => localStorage.setItem('uwsal.tray.v1', s), JSON.stringify(set.map((p, i) => ({ type: 'person', ...p, colorIdx: i }))));
  const page = await ctx.newPage();
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(subject)}`);
  await expect(page.locator('.report-brief')).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

test('the brief numbers its notes in reading order, each marker after a word and linked to its own note', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const brief = page.locator('.report-brief');
  await expect(brief.locator('#report-notes li').first()).toBeAttached({ timeout: 60_000 });
  const marks = await brief.locator('.footnote-ref a').evaluateAll((as) => as.map((a) => {
    // The text just before the marker, inside the block it sits in.
    const sup = a.closest('sup')!;
    const r = document.createRange();
    r.setStart(sup.parentElement!, 0);
    r.setEndBefore(sup);
    return { n: Number(a.textContent), href: a.getAttribute('href'), before: r.toString().slice(-12) };
  }));
  expect(marks.length, 'no footnote markers to read').toBeGreaterThan(5);
  // Each new number is the next one: 1, 2, 3 … down the page, a repeat citing an earlier note.
  let max = 0;
  for (const m of marks) {
    expect(m.n, `marker ${m.n} after ${max} came first`).toBeLessThanOrEqual(max + 1);
    max = Math.max(max, m.n);
    expect(m.href).toBe(`#report-note-${m.n}`);
    await expect(brief.locator(`#report-note-${m.n}`), `note ${m.n} is not in the list`).toHaveCount(1);
    expect(m.before, `marker ${m.n} reads as part of a figure: "…${m.before}${m.n}"`).not.toMatch(/\d$/);
  }
  expect(await brief.locator('#report-notes li').count()).toBeGreaterThanOrEqual(max);
  // A sentence built from the cohort's name reads as one.
  await expect(brief).not.toContainText(/the all /);
  await expect(brief.locator('.evidence-card').first()).toContainText(/median of all UW–Madison employees with this title/);
  await ctx.close();
});

test('a raise case link opens on its own subject, whoever is in the compare set', async ({ browser }) => {
  for (const set of [[], [{ id: AARON, label: 'Aaron Smetana' }]]) {
    const { ctx, page } = await caseFor(browser, HALZEN, set);
    await expect(page.locator('.report-brief'), `with ${set.length} in the set`).toContainText('Prepared for Francis Halzen', { timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`subject=${encodeURIComponent(HALZEN)}`));
    await ctx.close();
  }
});

test("the one-person report names its person from the data, never by their key, and promises no page count", async ({ page }) => {
  await page.goto(`./reports?person=${encodeURIComponent(AARON)}`);
  await expect(page.locator('.print-area')).toContainText('Aaron Smetana', { timeout: 60_000 });
  await expect(page).toHaveTitle(/Report — Aaron Smetana/);
  await expect(page.locator('main')).not.toContainText(AARON);
  await expect(page.locator('main')).not.toContainText(/one-page|single-page/i);
});

test('the raise case setup names its people neutrally', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  await expect(page.getByText('Subject', { exact: true })).toBeVisible();
  await expect(page.getByText('Compared with', { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/this is me|compared against/i);
  await ctx.close();
});

test('one Export menu holds what each report can export, and the email copy keeps its lines', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((s) => localStorage.setItem('uwsal.tray.v1', s), JSON.stringify([{ type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 }]));
  const page = await ctx.newPage();
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(AARON)}`);
  await expect(page.locator('#report-sec-notes')).toBeVisible({ timeout: 60_000 });
  // Copy link beside it, and no export a button of its own.
  await expect(page.getByRole('button', { name: /Print|Download \.doc|Copy for email/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Print / Save as PDF', 'Download .doc', 'Copy for email']);
  await page.getByRole('menuitem', { name: 'Copy for email' }).click();
  await expect(page.getByRole('menuitem', { name: /^Copied/ })).toBeVisible();
  // What a mail client pastes when it takes no formatting: the brief's own lines, not one run-on line.
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const lines = text.split('\n');
  expect(lines[0]).toBe('Pay Parity Review');
  expect(lines.filter((l) => /^\d+\. Notes & sources$/.test(l))).toHaveLength(1);
  expect(lines.some((l) => /^1\. Source: /.test(l)), 'the notes are numbered').toBe(true);
  expect(text, 'a tag or an entity left in the text').not.toMatch(/<[a-z/]|&[a-z#0-9]+;/i);
  expect(lines.length).toBeGreaterThan(30);
  await ctx.close();

  // The one-person report prints; that is all it exports.
  const one = await browser.newPage();
  await one.goto(`./reports?person=${encodeURIComponent(AARON)}`);
  await expect(one.locator('.print-area')).toContainText('Aaron Smetana', { timeout: 60_000 });
  await one.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(one.getByRole('menuitem')).toHaveText(['Print / Save as PDF']);
  await one.close();
});

test('the recommended figure shows once: beside the setup on a desktop, in the pinned ledger on a phone', async ({ browser }) => {
  for (const [width, height, phone] of [[1440, 900, false], [375, 812, true]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript((s) => localStorage.setItem('uwsal.tray.v1', s), JSON.stringify([{ type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 }]));
    const page = await ctx.newPage();
    await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(AARON)}`);
    const where = phone ? 'phone' : 'desktop';
    if (phone) {
      // The ledger has the figure, so the setup's readout would have it too.
      await expect(page.getByText(/^→ \$[\d,]+/), where).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('text="Recommended"'), `${where}: the setup says it again`).toHaveCount(0);
    } else {
      await expect(page.locator('text="Recommended"'), where).toHaveCount(1, { timeout: 60_000 });
      await expect(page.getByText(/^→ \$[\d,]+/), `${where}: a ledger beside the setup's readout`).toHaveCount(0);
    }
    await ctx.close();
  }
});

test('the one-person report gives each figure once: standing in its comparison card, growth in its tile', async ({ page }) => {
  await page.goto(`./reports?person=${encodeURIComponent(AARON)}`);
  const report = page.locator('.print-area');
  await expect(report.locator('[data-standing="campus"]')).toContainText(/all of UW–Madison, more than \d+%; within .+, more than \d+%\./, { timeout: 60_000 });
  const tiles = report.locator('.stat-row').first();
  await expect(tiles.locator('> *')).toHaveCount(3);
  await expect(tiles, 'a standing figure in the tiles too').not.toContainText(/more than/);
  await expect(tiles).toContainText(/Growth since/);
  // The header names the person and their job; the figures are below it.
  await expect(report.locator('div:has(> h3)').first(), 'the header repeats a figure').not.toContainText(/%|years of salary data/);
});

test('a raise case asks for one thing, chosen second, each choice with its dollars and percent', async ({ browser }) => {
  test.setTimeout(180_000);
  const snap = await latestSnapshot();
  // Two others with Aaron's job code: one paid more, whom the case can ask to match, and one paid less, whom it cannot.
  const others = await oracle<{ k: string; nm: string; pay: number; more: boolean }>(
    `WITH p AS (SELECT person_key k, any_value(first_name || ' ' || last_name) nm, sum(${PAY}) pay FROM $SAL
       WHERE snapshot_id = '${snap}' AND salary > 0 GROUP BY 1)
     SELECT k, nm, pay, pay > (SELECT pay FROM p WHERE k = '${AARON}') more FROM p
     WHERE k <> '${AARON}' AND k IN (SELECT person_key FROM $SAL WHERE snapshot_id = '${snap}'
       AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}'))
     ORDER BY k`,
  );
  const peer = others.find((o) => o.more)!;
  const lower = others.find((o) => !o.more)!;
  expect(peer && lower, 'no one in Aaron’s job code paid more, or less, so this tests nothing').toBeTruthy();
  const { ctx, page } = await caseFor(browser, AARON, [AARON, peer, lower].map((p) => typeof p === 'string' ? { id: p, label: 'Aaron Smetana' } : { id: p.k, label: p.nm }));
  const setup = page.locator('.setup-panel');
  const dollars = (t: string) => Number(t.match(/\$([\d,]+)/)?.[1].replace(/,/g, ''));
  const row = (name: string | RegExp) => setup.getByRole('radio', { name }).locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]');
  const readout = async () => dollars(await setup.locator('text="Recommended"').locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]').innerText());

  const everyone = /^The (tenure-adjusted )?median of all UW–Madison employees with this title$/;
  const median = setup.getByRole('radio', { name: everyone });
  await expect(median).toBeChecked({ timeout: 60_000 });
  await expect(row(everyone)).toContainText(/\$[\d,]+/, { timeout: 60_000 });
  // The controls it replaces: a benchmark radio with its badges, a target Select, guideline boxes, an override.
  await expect(setup).not.toContainText(/Benchmark cohort|Target salary|Override the outcome|Set target to/i);
  // The cohorts' badges are gone from the ask (the case-strength panel keeps its own "market deficit" signal).
  expect((await setup.innerText()).split(/Compared with/i)[0], 'a badge on a choice').not.toMatch(/deficit|weak case/i);
  await expect(setup.getByRole('checkbox', { name: /target/i })).toHaveCount(0);
  await expect(setup.getByRole('button', { name: /parity target/i }), 'a second way to choose whom to match').toHaveCount(0);
  // In the order a case is argued: whose pay, what to ask, with whom, why it is more, then the private review.
  const text = (await setup.innerText()).toLowerCase();
  const order = ['subject', 'what to ask for', 'compared with', 'justification factors', 'strategy tools'].map((s) => [s, text.indexOf(s)] as const);
  for (const [s, i] of order) expect(i, `"${s}" is not in the setup`).toBeGreaterThanOrEqual(0);
  expect(order.map(([s]) => s)).toEqual([...order].sort((a, b) => a[1] - b[1]).map(([s]) => s));

  // Each choice with a figure gives its dollars and its percent against the subject's pay.
  const ask = setup.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: everyone }) });
  const choices = await ask.getByRole('radio').evaluateAll((rs) => rs.map((r) => r.closest('.mantine-Group-root')?.textContent ?? ''));
  expect(choices.length, 'the choices were not found, so none was read').toBeGreaterThan(3);
  for (const t of choices) {
    if (/A figure of my own/.test(t)) continue;
    expect(t, 'a choice without its dollars').toMatch(/\$[\d,]+/);
    expect(t, 'a choice without its percent').toMatch(/[+−]\d+\.\d%|0%/);
  }

  // No factors: the ask is the median as its row gives it.
  const medianPay = dollars(await row(everyone).innerText());
  await expect.poll(readout).toBe(medianPay);

  // A named person paid more: their pay is the ask. Matching someone paid less is not offered.
  await expect(setup.getByRole('radio', { name: new RegExp(`^Match ${lower.nm}$`, 'i') }), 'an ask below the subject’s pay').toHaveCount(0);
  const match = setup.getByRole('radio', { name: new RegExp(`^Match ${peer.nm}$`, 'i') });
  await match.click();
  const peerPay = dollars(await match.locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]').innerText());
  expect(peerPay, 'the match row gives their pay').toBe(Math.round(peer.pay));
  await expect.poll(readout).toBe(peerPay);
  await expect(page.locator('.report-brief')).toContainText(/'s salary/);

  // A figure of one's own starts from the ask as it stands, and is asked as written.
  await setup.getByRole('radio', { name: 'A figure of my own' }).click();
  const own = setup.getByRole('textbox', { name: 'Salary to ask for' });
  await expect(own).toHaveValue(`$${peerPay.toLocaleString('en-US')}`);
  await own.fill('150000');
  await expect.poll(readout).toBe(150_000);
  await expect(page.locator('.report-brief')).toContainText('$150,000');

  // Another group's median: that group is also the one standing is measured against.
  const school = setup.getByRole('radio', { name: /^The (tenure-adjusted )?median of same-title peers in / });
  if (await school.count()) {
    await school.click();
    await expect(own).toHaveCount(0);
    await expect.poll(readout).toBe(dollars(await row(/^The (tenure-adjusted )?median of same-title peers in /).innerText()));
    await expect(page.locator('.report-brief')).toContainText(/same-title peers in /);
  }

  // Back to everyone: one choice, so nothing of the others is left behind.
  await median.click();
  await expect(own).toHaveCount(0);
  await expect.poll(readout).toBe(medianPay);
  await ctx.close();
});

test('an ask at or below current pay reads as no raise, in the setup and on a phone as in the brief', async ({ browser }) => {
  // Someone paid above every group's median (their premise is checked below): every choice is a cut.
  const snap = await latestSnapshot();
  const [kp] = await oracle<{ k: string }>(
    `SELECT person_key k FROM $SAL WHERE snapshot_id = '${snap}' AND lower(first_name) = 'kenneth' AND lower(last_name) = 'poss' LIMIT 1`,
  );
  for (const [width, height, phone] of [[1440, 900, false], [375, 812, true]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(kp.k)}`);
    await expect(page.locator('.report-brief')).toContainText('maintain current pay', { timeout: 60_000 });
    if (phone) {
      await expect(page.getByText(/^→ /)).toHaveText('→ maintain current pay');
    } else {
      const setup = page.locator('.setup-panel');
      const ask = setup.getByRole('radiogroup').filter({ has: page.getByRole('radio', { name: /^The (tenure-adjusted )?median of all / }) });
      const pcts = await ask.locator('.mantine-Group-root').allInnerTexts();
      expect(pcts.filter((t) => /\$/.test(t)).every((t) => /−\d/.test(t)), 'a choice above their pay, so this tests nothing').toBe(true);
      const readout = setup.locator('text="Recommended"').locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]');
      await expect(readout, 'a cut shown as the recommendation').toHaveText(/^Recommended\s*Maintain current pay$/);
    }
    await ctx.close();
  }
});
