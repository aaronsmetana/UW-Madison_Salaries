import { test, expect, type Page } from '@playwright/test';
import { oracle, PAY, MAIN, main, latestSnapshot } from './oracle';

/**
 * Someone with several appointments is named, placed and compared by their main one: of their paid
 * appointments, the one with the highest FTE — an hourly job records none, so it comes after every salaried
 * one — ties to the higher pay. The person page named the last row it fetched, which within a snapshot is any
 * of them; most lists named the best-paid. Brett Van Ess directs Threat Intervention Services full time and
 * works crowd control by the hour, at a rate that annualizes to more than half the directorship: his page called
 * him a Crowd Control Officer and compared him with crowd-control officers.
 */

const BRETT = 'brettvaness|2018-07-23';

interface Appt { job_code: string; title: string; fte: number | null; salary: number }

/** Someone's paid appointments in the latest snapshot, their main one first (the oracle's `MAIN`). */
async function appts(key: string): Promise<Appt[]> {
  const snap = await latestSnapshot();
  return oracle<Appt>(
    `SELECT job_code, title, fte, salary FROM $SAL WHERE person_key = '${key.replace(/'/g, "''")}' AND snapshot_id = '${snap}' AND salary > 0
     ORDER BY ${MAIN} DESC`,
  );
}

/** How the line under the title says an appointment: an hourly one by its rate, a salaried one by its FTE. */
const terms = (a: Appt) => (a.fte ? `${Math.round(a.fte * 100)}% FTE` : `hourly, $${(a.salary / 2080).toFixed(2)}/hr`);

async function openPerson(page: Page, key: string) {
  await page.goto(`./person/${encodeURIComponent(key)}`);
  const head = page.locator('.person-head');
  await expect(head.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  return head;
}

/** The title the page names them by: the subtitle's first link, to that title's page. */
const titleLink = (head: ReturnType<Page['locator']>) => head.locator('a[href*="paycheck?code="]').first();
const jobCodeFact = (page: Page) => page.locator('.fact-strip .fact-cell').filter({ hasText: 'Job code' }).locator('dd');

test('Brett Van Ess is named by his directorship, with his hourly crowd-control job on the line under it', async ({ page }) => {
  const [dir, crowd, ...rest] = await appts(BRETT);
  // The premise: a full-time salaried job, and an hourly one that pays more than a salaried half-time job would.
  expect(rest, 'Brett holds two paid appointments').toHaveLength(0);
  expect(dir.fte).toBe(1);
  expect(crowd.fte ?? 0).toBe(0);
  const snap = await latestSnapshot();
  const [{ n }] = await oracle<{ n: number }>(
    `SELECT count(DISTINCT person_key) n FROM $SAL WHERE snapshot_id = '${snap}' AND job_code = '${dir.job_code}' AND salary > 0`,
  );

  const head = await openPerson(page, BRETT);
  await expect(titleLink(head)).toHaveText(dir.title);
  await expect(titleLink(head)).toHaveAttribute('href', new RegExp(`code=${dir.job_code}$`));
  await expect(jobCodeFact(page)).toHaveText(dir.job_code);
  const also = head.locator('.person-also');
  await expect(also).toHaveText(`Also: ${crowd.title} (${terms(crowd)})`);
  await expect(also.getByRole('link', { name: crowd.title })).toHaveAttribute('href', new RegExp(`code=${crowd.job_code}$`));
  // Compared with the people in his main title, and in it he is the only one.
  if (n === 1) {
    await expect(page.getByText(/is the only employee at UW with the title/)).toContainText(`(job code ${dir.job_code})`);
    await expect(page.locator('.peer-strip')).toHaveCount(0);
  } else {
    await expect(page.locator('.peer-strip').first()).toBeVisible({ timeout: 60_000 });
  }
});

test('everyone whose best-paid job is not their main one is named by the main one, the other on the line under it', async ({ page }) => {
  test.setTimeout(300_000);
  const snap = await latestSnapshot();
  const people = await oracle<{ person_key: string; code: string; title: string; paid_code: string; n: number }>(
    `SELECT person_key, ${main('job_code')} code, ${main('title')} title,
        arg_max(job_code, ${PAY}) paid_code, count(*) n
     FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key
     HAVING count(*) FILTER (WHERE salary > 0) > 0 AND ${main('job_code')} <> arg_max(job_code, ${PAY}) ORDER BY person_key`,
  );
  // Thirty-five in Sep 2026, nearly all because the best-paid job is an hourly one.
  expect(people.length, 'people whose highest-FTE and best-paid jobs differ').toBeGreaterThan(10);
  for (const p of people) {
    const head = await openPerson(page, p.person_key);
    await expect(titleLink(head), p.person_key).toHaveAttribute('href', new RegExp(`code=${p.code}$`));
    await expect(titleLink(head), p.person_key).toHaveText(p.title);
    await expect(jobCodeFact(page), p.person_key).toHaveText(p.code);
    // Every other appointment they hold then, paid or not, is on the line under the title.
    await expect(head.locator('.person-also'), p.person_key).toHaveAttribute('data-n', String(p.n - 1));
  }
});

test("search names a person by their main appointment's title", async ({ page }) => {
  const snap = await latestSnapshot();
  // Brett, whose search row was any job of the latest snapshot, and others whose best-paid job is not their main
  // one, each with a name no one else has carried.
  const people = await oracle<{ nm: string; title: string }>(
    `WITH uniq AS (SELECT lower(first_name || ' ' || last_name) nm FROM $SAL GROUP BY 1 HAVING count(DISTINCT person_key) = 1)
     SELECT lower(any_value(first_name) || ' ' || any_value(last_name)) nm, ${main('title')} title, person_key = '${BRETT}' brett
     FROM $SAL WHERE snapshot_id = '${snap}' GROUP BY person_key
     HAVING count(*) FILTER (WHERE salary > 0) > 0 AND (${main('job_code')} <> arg_max(job_code, ${PAY}) OR person_key = '${BRETT}')
        AND lower(any_value(first_name) || ' ' || any_value(last_name)) IN (SELECT nm FROM uniq)
     ORDER BY brett DESC, person_key LIMIT 6`,
  );
  expect(people[0].nm).toBe('brett van ess');
  await page.goto('./');
  const box = page.getByRole('combobox', { name: 'Search a person, title or division' });
  await expect(box).toBeVisible({ timeout: 60_000 });
  for (const p of people) {
    await box.fill(p.nm);
    const row = page.getByRole('option', { name: new RegExp(p.nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    await expect(row, p.nm).toBeVisible({ timeout: 60_000 });
    await expect(row, p.nm).toContainText(p.title);
  }
});

test("a swap between two jobs held on both sides is not drawn as a title change", async ({ page }) => {
  // People whose main job changed once in all their history, and only because two jobs they held on both sides
  // of the step traded places (their FTEs crossed). None from before the TTC relabel, which re-codes everyone.
  const [p] = await oracle<{ person_key: string }>(
    `WITH o AS (SELECT snapshot_id, row_number() OVER (ORDER BY snapshot_date, NOT ends_with(snapshot_id, '-pre')) k
                FROM (SELECT DISTINCT snapshot_id, snapshot_date FROM $SAL)),
          m AS (SELECT person_key, k, ${main('job_code')} code, list(job_code) codes FROM $SAL JOIN o USING (snapshot_id) GROUP BY 1, 2),
          st AS (SELECT a.person_key, a.code <> b.code ch,
                   a.code <> b.code AND list_contains(b.codes, a.code) AND list_contains(a.codes, b.code) sw
                 FROM m a JOIN m b ON b.person_key = a.person_key AND b.k = a.k + 1)
     SELECT person_key FROM st WHERE person_key NOT IN (SELECT person_key FROM $SAL WHERE ends_with(snapshot_id, '-pre'))
     GROUP BY 1 HAVING count(*) FILTER (WHERE ch) = 1 AND count(*) FILTER (WHERE sw) = 1 ORDER BY 1 LIMIT 1`,
  );
  expect(p, 'someone whose one change of main job is a swap').toBeTruthy();
  await page.goto(`./person/${encodeURIComponent(p.person_key)}?tab=trends`);
  // The pay line, not the first curve: a flat median line has no height, so it never reads as visible.
  await expect(page.locator('.recharts-line-curve[name="Actual pay"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.title-change-halo')).toHaveCount(0);
});
