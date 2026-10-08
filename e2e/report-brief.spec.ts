import { test, expect, type Browser, type Page } from '@playwright/test';
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

test('a raise case keeps its own people: the compare set starts a case about one of its people, and no case changes it', async ({ browser }) => {
  test.setTimeout(240_000);
  const snap = await latestSnapshot();
  const [p1, p2] = await oracle<{ k: string; nm: string }>(
    `SELECT person_key k, any_value(first_name || ' ' || last_name) nm FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
       AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}') AND person_key <> '${AARON}'
     GROUP BY 1 ORDER BY 1 LIMIT 2`,
  );
  const traySet = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('uwsal.tray.v1') ?? '[]').map((i: { id: string }) => i.id).sort());
  const listed = (p: Page) => p.locator('.setup-panel').getByRole('button', { name: /^Remove / })
    .evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Remove /, '').toLowerCase()).sort());
  const names = (...ps: { nm: string }[]) => ps.map((p) => p.nm.toLowerCase()).sort();

  // A compare set that holds the subject starts their case with its others.
  const set = [{ id: AARON, label: 'Aaron Smetana' }, { id: p1.k, label: p1.nm }];
  const { ctx, page } = await caseFor(browser, AARON, set);
  const setup = page.locator('.setup-panel');
  await expect.poll(() => listed(page), { timeout: 60_000 }).toEqual(names(p1));

  // Whom the case adds or takes out is the case's: the compare set is as it was.
  await setup.getByPlaceholder('Add a comparator by name…').fill(p2.nm);
  await page.getByRole('option').filter({ hasText: new RegExp(p2.nm, 'i') }).first().click();
  await expect.poll(() => listed(page)).toEqual(names(p1, p2));
  await setup.getByRole('button', { name: new RegExp(`^Remove ${p1.nm}$`, 'i') }).click();
  await expect.poll(() => listed(page)).toEqual(names(p2));
  expect(await traySet(page), 'the case changed the compare set').toEqual([AARON, p1.k].sort());

  // The case keeps its people from one visit to the next (opened afresh, not from its link), and can take in
  // the set's others.
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(AARON)}`);
  await expect.poll(() => listed(page), { timeout: 60_000 }).toEqual(names(p2));
  await setup.getByRole('button', { name: new RegExp(`^Add ${p1.nm} from the compare set$`, 'i') }).click();
  await expect.poll(() => listed(page)).toEqual(names(p1, p2));
  await expect(setup.getByRole('button', { name: /from the compare set$/ })).toHaveCount(0);
  const link = page.url();
  expect(link).toContain('sel=');
  await ctx.close();

  // Its link opens the same people for a reader with a set of their own, which stays theirs.
  const b = await caseFor(browser, HALZEN, [{ id: HALZEN, label: 'Francis Halzen' }]);
  await b.page.goto(link);
  await expect(b.page.locator('.report-brief')).toContainText('Prepared for Aaron Smetana', { timeout: 60_000 });
  await expect.poll(() => listed(b.page), { timeout: 60_000 }).toEqual(names(p1, p2));
  expect(await traySet(b.page), 'the link replaced the reader’s compare set').toEqual([HALZEN]);
  await b.ctx.close();

  // A set without the subject is about someone else: their case starts with no one, and can take the set in.
  const c = await caseFor(browser, HALZEN, set);
  await expect(c.page.locator('.setup-panel')).toContainText('No comparators yet', { timeout: 60_000 });
  await expect(c.page.locator('.setup-panel').getByRole('button', { name: 'Add 2 people from the compare set' })).toBeVisible();
  await c.ctx.close();
});

test('a person to match: the closest first, the two side by side, what tenure explains, the gap over time, what they have too', async ({ browser }) => {
  test.setTimeout(240_000);
  const snap = await latestSnapshot();
  // Someone with Aaron's job code paid more, and how many snapshots both were paid in.
  const [peer] = await oracle<{ k: string; nm: string; pay: number; shared: number }>(
    // A snapshot published in two versions (before and after the title change) is one date, one row.
    `WITH p AS (SELECT person_key k, snapshot_id s, any_value(snapshot_date) d, any_value(first_name || ' ' || last_name) nm, sum(${PAY}) pay
         FROM $SAL WHERE salary > 0 GROUP BY 1, 2),
       me AS (SELECT * FROM p WHERE k = '${AARON}')
     SELECT p.k, p.nm, p.pay, (SELECT count(DISTINCT q.d) FROM p q JOIN me USING (s) WHERE q.k = p.k) shared FROM p
     WHERE p.s = '${snap}' AND p.k <> '${AARON}' AND p.pay > (SELECT pay FROM me WHERE s = '${snap}')
       AND p.k IN (SELECT person_key FROM $SAL WHERE snapshot_id = '${snap}'
         AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}'))
     ORDER BY shared DESC, p.k LIMIT 1`,
  );
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const setup = page.locator('.setup-panel');
  const brief = page.locator('.report-brief');
  const dollars = (t: string) => Number(t.match(/\$([\d,]+)/)?.[1].replace(/,/g, ''));
  const readout = async () => dollars(await setup.locator('text="Recommended"').locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]').innerText());

  // One list of whom to add, closest first: the same school or division, then the nearest tenure.
  await expect(setup).toContainText('Closest matches with this title', { timeout: 60_000 });
  await expect(setup).not.toContainText(/top earners|Strong comparators/);
  const [me] = await oracle<{ school: string; tenure: number; mates: number }>(
    `SELECT any_value(school) school, any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure,
       (SELECT count(DISTINCT o.person_key) FROM $SAL o WHERE o.snapshot_id = '${snap}' AND o.salary > 0 AND o.person_key <> '${AARON}'
          AND o.job_code = any_value(a.job_code) AND o.school = any_value(a.school)) mates
     FROM $SAL a WHERE snapshot_id = '${snap}' AND person_key = '${AARON}'`,
  );
  const lines = await setup.getByRole('button', { name: /^Add (?!a justification)/ }).evaluateAll((bs) =>
    bs.filter((b) => !/from the compare set/.test(b.textContent ?? '')).map((b) => b.closest('.mantine-Group-root')?.querySelector('p:last-of-type')?.textContent ?? ''));
  expect(lines.length, 'no matches listed').toBeGreaterThan(2);
  const rank = lines.map((l) => ({ same: l.endsWith(me.school), far: Math.abs(Number(l.match(/^(\d+\.\d) yrs/)?.[1]) - me.tenure) }));
  expect(me.mates, 'no one else with this title in Aaron’s school, so this tests nothing').toBeGreaterThan(0);
  expect(rank.slice(0, me.mates).every((r) => r.same), 'the same school’s people do not lead the list').toBe(true);
  for (let i = 1; i < rank.length; i++) {
    const [a, b] = [rank[i - 1], rank[i]];
    expect(Number(b.same) <= Number(a.same), `"${lines[i]}" from another school ahead of the same school`).toBe(true);
    // Each shown to a tenth of a year.
    if (a.same === b.same) expect(b.far + 0.1, `"${lines[i]}" nearer in tenure than the one above it`).toBeGreaterThanOrEqual(a.far);
  }

  // Asked to match them, the brief sets the two side by side.
  await setup.getByPlaceholder('Add a comparator by name…').fill(peer.nm);
  await page.getByRole('option').filter({ hasText: new RegExp(peer.nm, 'i') }).first().click();
  await setup.getByRole('radio', { name: new RegExp(`^Match ${peer.nm}$`, 'i') }).click();
  const card = brief.locator('.match-card');
  await expect(card).toContainText(/side by side/i, { timeout: 30_000 });
  const salary = await card.locator('tr', { hasText: 'Salary' }).locator('td').allInnerTexts();
  expect(dollars(salary[2]), 'their pay').toBe(Math.round(peer.pay));
  expect(Number(salary[2].match(/\(\+\$([\d,]+)\)/)?.[1].replace(/,/g, '')), 'the gap beside their pay').toBe(Math.round(peer.pay) - dollars(salary[1]));
  // What tenure accounts for adds up: explained and the rest make the gap.
  const said = await card.locator('.match-tenure').innerText();
  expect(said).toMatch(/each year of UW tenure goes with about \$[\d,]+ more pay|does not go with higher pay/);
  const parts = said.match(/about \$([\d,]+) more pay\. .+ has (\d+\.\d) years more UW tenure than .+ accounts for about \$([\d,]+) of the \$([\d,]+) gap; the other \$([\d,]+)/);
  if (parts) {
    const [perYear, years, e, g, r] = parts.slice(1).map((x) => Number(x.replace(/,/g, '')));
    // The years are shown to a tenth, so the product is good to half a tenth of a year's pay.
    expect(Math.abs(perYear * years - e), 'what tenure explains is not its pay per year times the years').toBeLessThanOrEqual(perYear * 0.05 + 1);
    expect(Math.abs(e + r - g), 'what tenure explains and the rest do not make the gap').toBeLessThanOrEqual(1);
    expect(g).toBe(Math.round(peer.pay) - dollars(salary[1]));
  }
  // The gap at each snapshot both were paid in, the last one today's.
  const rows = card.locator('.match-history tbody tr');
  await expect(rows).toHaveCount(peer.shared);
  expect(dollars(await rows.last().locator('td').last().innerText())).toBe(Math.round(peer.pay) - dollars(salary[1]));

  // A factor: added to the ask, unless the person matched has it too.
  await setup.getByRole('button', { name: 'Add a justification factor' }).click();
  await page.getByRole('menuitem', { name: 'Certifications & education' }).click();
  await setup.getByRole('textbox', { name: '+$ (optional)' }).first().fill('2500');
  await expect.poll(readout).toBe(Math.round(peer.pay) + 2_500);
  await expect(card).toContainText(/brings: Certifications & education \(\+\$2,500\)/);
  const has = setup.getByRole('checkbox', { name: new RegExp(`^${peer.nm} has this too$`, 'i') });
  await has.check();
  await expect.poll(readout, 'a factor they have too was added to the ask').toBe(Math.round(peer.pay));
  await expect(card).toContainText(/has these too, so they are not added to the ask: Certifications & education\./);
  // What the requester attests the two share.
  await setup.getByRole('textbox', { name: new RegExp(`^Duties shared with ${peer.nm}`, 'i') }).fill('Both run the on-call rota');
  await expect(card).toContainText('Duties they share, as attested in this request: Both run the on-call rota');

  // Under masked names the card names them as the peer table does.
  await setup.getByText('Anonymize peer names in document', { exact: true }).click();
  await expect(card).toContainText(/Aaron and Peer [A-Z], side by side/);
  await expect(card).not.toContainText(new RegExp(peer.nm, 'i'));
  await setup.getByText('Anonymize peer names in document', { exact: true }).click();

  // Another ask: no one to set beside, and nothing of them left behind.
  await setup.getByRole('radio', { name: /^The (tenure-adjusted )?median of all / }).click();
  await expect(card).toHaveCount(0);
  await expect(has).toHaveCount(0);
  await setup.getByRole('radio', { name: new RegExp(`^Match ${peer.nm}$`, 'i') }).click();
  await expect(has).not.toBeChecked();
  await ctx.close();
});

test('each evidence card’s figure says what it counts', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const cards = page.locator('.report-brief .evidence-card');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  // Aaron's brief has the two that gave a bare number: years below the median, and the compa-ratio.
  await expect(page.locator('.report-brief')).toContainText(/\d+ years\s*in a row below the title median/);
  await expect(page.locator('.report-brief')).toContainText(/\d\.\d\d compa-ratio\s*below the university/);
  const values = await cards.evaluateAll((cs) => cs.map((c) => c.querySelector('p')?.textContent?.trim() ?? ''));
  expect(values.length).toBeGreaterThan(3);
  for (const v of values) expect(v, `"${v}" does not say what it counts`).toMatch(/[A-Za-z%$]/);
  await ctx.close();
});

test('the guideline section gives each provision one line, its words in the note it cites', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const section = page.locator('.report-brief .guideline-basis');
  await expect(section).toBeVisible({ timeout: 60_000 });
  await expect(section, 'a provision quoted in the section').not.toContainText(/[“”]/);
  await expect(page.locator('.report-brief')).not.toContainText('Terms follow the guideline');
  const lines = section.locator('p');
  expect(await lines.count()).toBeGreaterThan(0);
  for (const line of await lines.all()) {
    const name = (await line.locator('b').innerText()).trim();
    const n = await line.locator('.footnote-ref a').innerText();
    await expect(page.locator(`#report-note-${n}`), `${name}: its note is not its words`).toContainText(new RegExp(`^${name}: “.+”`));
  }
  await ctx.close();
});

test('the points a reviewer may raise: off until asked for, then each one a figure the brief gives', async ({ browser }) => {
  const snap = await latestSnapshot();
  // Same-title peers with more UW tenure than Aaron who are paid less.
  const [{ n: seniorLess }] = await oracle<{ n: number }>(
    `WITH p AS (SELECT person_key k, sum(${PAY}) pay, any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) t
       FROM $SAL WHERE snapshot_id = '${snap}' AND salary > 0
         AND job_code = (SELECT any_value(job_code) FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}') GROUP BY 1),
       me AS (SELECT * FROM p WHERE k = '${AARON}')
     SELECT count(*) n FROM p, me WHERE p.k <> me.k AND p.t > me.t AND p.pay < me.pay`,
  );
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const brief = page.locator('.report-brief');
  const box = page.locator('.setup-panel').getByRole('checkbox', { name: 'Points a reviewer may raise' });
  await expect(box).not.toBeChecked({ timeout: 60_000 });
  await expect(brief).not.toContainText('Points a reviewer may raise');
  await page.locator('.setup-panel').getByText('Points a reviewer may raise', { exact: true }).click();
  const points = brief.locator('.counter-points li');
  await expect(points.first()).toBeVisible();
  const said = await points.allInnerTexts();
  // A pool it is paid at or above the median of, at the percentile the market-standing table gives it.
  for (const t of said.filter((x) => x.includes('paid at or above the median of'))) {
    const [, pool, nth] = t.match(/median of (.+?) \(the (\d+\w\w) percentile\)/)!;
    const row = brief.locator('tr', { hasText: pool }).first();
    await expect(row, `"${pool}" is not a pool the brief lists`).toContainText(nth);
  }
  if (seniorLess > 0) expect(said).toContain(`${seniorLess} same-title peer${seniorLess === 1 ? '' : 's'} with more UW tenure ${seniorLess === 1 ? 'is' : 'are'} paid less than Aaron.`);
  else expect(said.join(' ')).not.toContain('with more UW tenure');
  // In its place: after the pay history, numbered next.
  const order = await page.evaluate(() => {
    const a = document.querySelector('#report-sec-history'), b = document.querySelector('#report-sec-counter');
    return a && b ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  expect(order, 'the section is not after the pay history').toBe(true);
  const num = (id: string) => page.locator(`#report-sec-${id}`).innerText().then((t) => Number(t.match(/^(\d+)\./)?.[1]));
  expect(await num('counter')).toBe((await num('history')) + 1);
  await ctx.close();
});

test('the factor menu lists every factor by its kind, and a new one is added, described and counted like the rest', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  const setup = page.locator('.setup-panel');
  await expect(page.locator('.report-brief')).toContainText('Prepared for Aaron Smetana', { timeout: 60_000 });
  await setup.getByRole('button', { name: 'Add a justification factor' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.locator('.mantine-Menu-label')).toHaveText(['Responsibilities', 'Qualifications', 'Research & systems', 'Performance & market']);
  for (const f of ['Licensure or registration', 'Languages used in the job', 'On-call or after-hours duties', 'Trains or mentors others',
    'Budget or revenue responsibility', 'Awards and recognition', 'Hard-to-fill role']) await expect(menu.getByRole('menuitem', { name: f })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'On-call or after-hours duties' }).click();
  await expect(setup.getByPlaceholder('e.g. on call one week in four')).toBeVisible();
  await setup.getByPlaceholder('e.g. on call one week in four').fill('On call one week in four for the data center');
  await setup.getByRole('textbox', { name: '+$ (optional)' }).first().fill('1800');
  const brief = page.locator('.report-brief');
  await expect(brief).toContainText('On-call or after-hours duties');
  await expect(brief).toContainText('On call one week in four for the data center');
  await expect(brief).toContainText('+$1,800');
  // Once in use, it leaves the menu; its kind stays while the kind has others.
  await setup.getByRole('button', { name: 'Add a justification factor' }).click();
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'On-call or after-hours duties' })).toHaveCount(0);
  await expect(page.getByRole('menu').locator('.mantine-Menu-label', { hasText: 'Responsibilities' })).toBeVisible();
  await ctx.close();
});

test('private to the requester: what to ask if the ask is refused, and a reviewer’s questions answered from the brief’s own figures', async ({ browser }) => {
  const snap = await latestSnapshot();
  const [{ pay }] = await oracle<{ pay: number }>(`SELECT sum(${PAY}) pay FROM $SAL WHERE snapshot_id = '${snap}' AND person_key = '${AARON}' AND salary > 0`);
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((s) => localStorage.setItem('uwsal.tray.v1', s), JSON.stringify([{ type: 'person', id: AARON, label: 'Aaron Smetana', colorIdx: 0 }]));
  const page = await ctx.newPage();
  await page.goto(`./reports?type=comparison&subject=${encodeURIComponent(AARON)}`);
  const setup = page.locator('.setup-panel');
  const brief = page.locator('.report-brief');
  await expect(brief.locator('.evidence-card').first()).toBeVisible({ timeout: 60_000 });
  const dollars = (t: string) => Number(t.match(/\$([\d,]+)/)?.[1].replace(/,/g, ''));
  const ask = dollars(await setup.locator('text="Recommended"').locator('xpath=ancestor::div[contains(@class, "mantine-Group-root")][1]').innerText());

  // Each rung under the ask and over the pay, highest first, and none of them the ask.
  const rungs = (await setup.locator('.fallback-ladder li').allInnerTexts()).map(dollars);
  for (const r of rungs) {
    expect(r, 'a rung at or above the ask').toBeLessThan(ask);
    expect(r, 'a rung at or below the pay').toBeGreaterThan(Math.round(pay));
  }
  expect(rungs).toEqual([...rungs].sort((a, b) => b - a));
  if (!rungs.length) await expect(setup.locator('.fallback-ladder')).toContainText('No smaller ask has a basis in the record.');

  // The answers agree with the brief: the share paid less with its percentile card, the peers paid more with its inversions.
  const qa = setup.locator('.reviewer-questions');
  const why = await qa.getByText(/^Why compare Aaron with /).locator('xpath=following-sibling::p[1]').innerText();
  const card = await brief.locator('.evidence-card').filter({ hasText: /percentile/ }).first().innerText();
  expect(Number(why.match(/paid more than (\d+)% of them/)?.[1]), 'the answer’s share is not the brief’s percentile').toBe(Number(card.match(/(\d+)\w\w percentile/)?.[1]));
  const more = await qa.getByText('Is anyone with less experience paid more?').locator('xpath=following-sibling::p[1]').innerText();
  const inv = await brief.locator('.evidence-card').filter({ hasText: /tenure inversion/ }).first().innerText();
  expect(Number(more.match(/^(\d+) same-title/)?.[1])).toBe(Number(inv.match(/(\d+) peers?/)?.[1]));
  await expect(qa, 'a print word in the setup').not.toContainText(/percentile/i);
  await expect(brief, 'the private tools printed in the brief').not.toContainText(/If the ask is refused|Questions a reviewer may ask/);

  // Both go out with the talking points.
  await setup.getByRole('button', { name: 'Export talking points' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Questions a reviewer may ask:');
  if (rungs.length) expect(text).toContain('If the ask is refused:');
  await ctx.close();
});

test('the one-page form fits one Letter page, with the ask, three grounds and where the pay stands', async ({ browser }) => {
  const { ctx, page } = await caseFor(browser, AARON, [{ id: AARON, label: 'Aaron Smetana' }]);
  await expect(page.locator('.report-brief .evidence-card').first()).toBeVisible({ timeout: 60_000 });
  const grounds = await page.locator('.report-brief .evidence-card').count();
  await page.locator('.setup-panel').getByText('One page', { exact: true }).click();
  const one = page.locator('.report-brief.one-page');
  await expect(one).toBeVisible();
  await expect(one.locator('.one-page-grounds > *')).toHaveCount(Math.min(3, grounds));
  await expect(one).toContainText('Where the pay stands');
  await expect(one).not.toContainText(/Notes & sources|Peer comparison|Pay history/);
  await expect(page).toHaveURL(/case=/);
  // On paper the brief is 7.5in wide (print.css); a Letter page inside its 0.6in margins is 9.8in, 941px, tall.
  await page.emulateMedia({ media: 'print' });
  const box = await one.evaluate((e) => e.getBoundingClientRect());
  expect(box.width, 'not laid out at the printed width').toBeLessThanOrEqual(721);
  expect(box.height, 'the one page runs onto a second').toBeLessThanOrEqual(941);
  await ctx.close();
});
