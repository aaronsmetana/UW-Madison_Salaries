// Pure normalization helpers for the ETL. No I/O — unit-tested in normalize.test.mjs.

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export const MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function excelSerialToISO(n) {
  // Excel epoch (1899-12-30); 25569 = 1970-01-01 in serial days.
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 60000) return excelSerialToISO(v); // plausible modern serial
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})([A-Za-z]{3,})(\d{4})$/); // 01Jun2022
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

export function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(typeof v === 'number' ? v : String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseGrade(rawGrade, compBasis, payRateType) {
  const raw = rawGrade == null ? null : String(rawGrade).trim() || null;
  let number = null;
  let isNumeric = false;
  if (raw) {
    const m = raw.match(/grade\s*0*(\d+)/i) || raw.match(/^0*(\d+)$/);
    if (m) { number = parseInt(m[1], 10); isNumeric = true; }
  }
  let basis = null;
  if (raw && /hourly/i.test(raw)) basis = 'hourly';
  else if (raw && /9\s*month/i.test(raw)) basis = 'annual_9mo';
  else if (raw && /12\s*month/i.test(raw)) basis = 'annual_12mo';
  if (!basis) {
    const cb = norm(compBasis);
    const pr = norm(payRateType);
    if (pr === 'hourly' || cb === 'hourly') basis = 'hourly';
    else if (cb.includes('9month') || cb === 'academic') basis = 'annual_9mo';
    else if (cb.includes('12month') || cb === 'annual') basis = 'annual_12mo';
  }
  return { raw, number, isNumeric, basis };
}

export const personNorm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function makePersonKey(first, last, hireISO) {
  return `${personNorm(first)}${personNorm(last)}|${hireISO || ''}`;
}

export function snapshotFromSheetName(name) {
  if (!name) return null;
  const yearM = name.match(/(19|20)\d{2}/);
  if (!yearM) return null;
  const year = parseInt(yearM[0], 10);
  let month = null;
  const monthName = name.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
  if (monthName) month = MONTHS[monthName[1].toLowerCase()] || MONTHS[monthName[0].toLowerCase()];
  if (!month) {
    const numeric = name.match(/\b(\d{1,2})[-/](19|20)\d{2}\b/);
    if (numeric) month = parseInt(numeric[1], 10);
  }
  let variant = null;
  if (/pre/i.test(name) && /ttc/i.test(name)) variant = 'pre';
  else if (/post/i.test(name) && /ttc/i.test(name)) variant = 'post';
  if (!month) return null;
  return { year, month, variant };
}

export function snapshotFromFilename(file) {
  // Use digit lookarounds (not \b — underscore is a word char, so \b fails on `_05`).
  let m = file.match(/(20\d{2})[-_ ]?(\d{1,2})(?!\d)/); // year then month: 2022-03, 2023-10-09
  if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2], variant: null };
  m = file.match(/(?<!\d)(\d{1,2})[-_ ](20\d{2})/); // month then year: _05-2026
  if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[2], month: +m[1], variant: null };
  m = file.match(/(20\d{2})/); // year only
  if (m) return { year: +m[1], month: null, variant: null };
  return null;
}

export function snapshotMeta(snap) {
  const mm = snap.month ? String(snap.month).padStart(2, '0') : '00';
  const id = `${snap.year}-${mm}${snap.variant ? `-${snap.variant}` : ''}`;
  const date = `${snap.year}-${snap.month ? mm : '01'}-01`;
  const label = `${snap.month ? MONTH_LABEL[snap.month] + ' ' : ''}${snap.year}` +
    (snap.variant ? ` (${snap.variant[0].toUpperCase()}${snap.variant.slice(1)}-TTC)` : '');
  return { id, date, label, year: snap.year, month: snap.month, variant: snap.variant || null };
}

export function median(nums) {
  const a = nums.filter((n) => n != null && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * SQL and JS forms of the FTE multiplier — the Node twin of `FTE_MULT` in src/lib/queries.ts, which
 * carries the full explanation. Short version: `fte = 0` marks an hourly appointment with no recorded
 * appointment percentage, not a person who earns nothing, so it must be read as "unknown" (1) rather
 * than multiplied through as zero. Keep these two in step with the TS constant.
 */
export const FTE_MULT_SQL = 'COALESCE(NULLIF(fte, 0), 1)';

/** JS form: the multiplier for one raw row. */
export const fteMult = (fte) => (fte == null || fte === 0 ? 1 : fte);

/**
 * The same rule one column up, and the Node twin of `ACTUAL_PAY` / `actualPay` in
 * src/lib/queries.ts (which carries the full explanation). Short version: the Apr-2024 and Sep-2024
 * workbooks publish `salary_fte_adjusted` as a literal 0 on hourly rows, having already multiplied
 * the rate by a zero FTE themselves. A plain `??` treats that as a reported figure and hands back
 * $0 for 1,591 people who hold a real annualized rate.
 */
export const FTE_ADJUSTED_SQL = 'NULLIF(salary_fte_adjusted, 0)';
export const ACTUAL_PAY_SQL = `COALESCE(${FTE_ADJUSTED_SQL}, salary * ${FTE_MULT_SQL})`;

/** JS form: actual pay for one raw row. */
export const actualPay = (row) => (row.salary_fte_adjusted || null) ?? row.salary * fteMult(row.fte);

/**
 * The hours in the full-time year every hourly figure in this source is annualized over. Measured on
 * the workbooks that name their hourly rows: 5,143 of 5,144 in Sep 2025 land on a whole-cent rate at
 * 2,080 hours, against 12 at 2,088 and 1,287 at 2,000.
 */
export const HOURS_PER_YEAR = 2080;

/**
 * Above any hourly rate the source has published and below any annual salary. The early workbooks'
 * rates run $15 to $105, always whole dollars; the smallest non-zero annual figure in any workbook is
 * $1,683. Nothing in the data falls between.
 */
export const HOURLY_RATE_CEILING = 500;

/**
 * The early workbooks' way of writing "no appointment percentage on file". Later workbooks write 0,
 * which `FTE_MULT_SQL` / `fteMult` already read as unknown; this value they read as a 0.025%
 * appointment and turned into $9 a year.
 */
export const FTE_PLACEHOLDER = 0.00025;

const isPlaceholder = (fte) => fte != null && Math.abs(fte - FTE_PLACEHOLDER) < 1e-9;

/** One cent an hour, over a year: $20.80. */
const CENT_AN_HOUR = HOURS_PER_YEAR / 100;

/**
 * Whether a figure is an hourly rate annualized at `HOURS_PER_YEAR`: a whole-cent rate times 2,080,
 * to the cent as the later workbooks print it or rounded to the dollar as the early ones do ($41.62
 * an hour is $86,569.60, printed $86,570). True of 99.8% of the rows the later workbooks label Hourly
 * and of 99.1% of the early placeholder rows; true of 4.5% of the rows labelled Salary, which is the
 * one in 20.8 a whole-dollar figure lands on by chance.
 *
 * Exact-to-the-cent alone is not enough for the early workbooks. It was tried, and it let a raise that
 * rounded to the dollar flip one unchanged appointment from hourly to nominal between two snapshots.
 */
export const isAnnualizedRate = (salary) =>
  Math.abs(salary - Math.round(salary / CENT_AN_HOUR) * CENT_AN_HOUR) <= 0.5 + 1e-9;

/**
 * Put one sheet's hourly appointments on the footing every later workbook uses: a full-time annual
 * rate, and an FTE of 0 where no percentage is recorded. The Nov 2021 through Aug 2022 workbooks
 * differ from the later ones in two ways, and each one broke every pay figure computed from them:
 *
 * 1. **2,240 rows carry the hourly RATE in the annual-salary column** ($19, not $39,520). Annualized
 *    here at `HOURS_PER_YEAR`. Tracked across the Aug 2022 to Oct 2023 boundary, the same appointments
 *    come back at a median of 2,133 times their old figure: 2,080 hours plus a year's raise.
 * 2. **About 4,650 paid rows carry `FTE_PLACEHOLDER`** instead of 0, so actual pay came out at
 *    0.025% of the rate: $9 a year on a $36,400 job. Rewritten to 0. Of the Aug 2022 placeholders
 *    still present in Oct 2023 under the same job code, 641 of 655 are recorded there with FTE 0 and
 *    the same rate.
 *
 * A placeholder whose figure is NOT an annualized hourly rate keeps it. About ten per snapshot: an
 * associate dean's line beside the same person's professorship, a professor emeritus, lines the later
 * workbooks publish as Non-Paid at $0. Read as unknown-FTE, each would add a full salary to someone's
 * pay; the near-zero figure they keep is the later workbooks' answer.
 *
 * Decided by the row's own figure and nothing else. A version that also asked whether the person held
 * another job was tried: it kept a line in one snapshot and cleared it in the next as that other job
 * came and went, and the history table printed a +400,000% change for an appointment whose pay had
 * not moved. It also credited the emeritus with $154,595.
 *
 * Returns new rows (the input is not mutated), flagging each one it rewrote in `_flags`.
 */
export function harmonizeHourly(rows) {
  let annualized = 0, cleared = 0, kept = 0;
  const out = rows.map((r) => {
    let row = r;
    const edit = (patch, flag) => { row = { ...row, ...patch, _flags: [...(row._flags ?? []), flag] }; };
    if (row.salary > 0 && row.salary < HOURLY_RATE_CEILING) {
      edit({ salary: Math.round(row.salary * HOURS_PER_YEAR * 100) / 100 }, 'hourly_rate_annualized');
      annualized++;
    }
    if (isPlaceholder(row.fte)) {
      if (row.salary > 0 && !isAnnualizedRate(row.salary)) kept++;
      else { edit({ fte: 0 }, 'fte_placeholder'); cleared++; }
    }
    return row;
  });
  return { rows: out, annualized, cleared, kept };
}

/**
 * One sheet's rows, ready for the ETL to read a salary or an FTE from: exact duplicates dropped, then
 * hourly pay harmonized. In that order. The duplicate test compares the source's own values, and an
 * annualized rate can land on the figure of a second, separate appointment: one Aug 2022 research
 * intern holds the same title at $15 an hour and, on another line, at $31,200. Harmonizing first
 * merged the two.
 */
export function prepareSheet(rows, personOf) {
  const seen = new Set();
  const unique = rows.filter((row) => {
    const key = `${personOf(row)}|${row.job_code || ''}|${row.title || ''}|${row.salary ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return harmonizeHourly(unique);
}

/**
 * Collapse a pay-band reference table to ONE row per (grade, basis), keeping the newest
 * `effective_year`. A real published grade table carries several years for the same grade, and every
 * extra row is a silent correctness bug downstream: School's pay-band panel LEFT JOINs `grades` on
 * (grade, basis), so a duplicate multiplies that person's row and skews the banded/graded coverage,
 * `avg_pos`, `over_max` and `below_min` it reports; PersonDashboard, TitleStats and screening all use
 * `grades.find(...)`, which silently takes whichever year happens to sit first in the file. Deduping
 * here fixes all four at once. A row with no `effective_year` loses to any row that has one, and ties
 * keep the first occurrence.
 */
export function latestGradeBands(rows) {
  const latest = new Map();
  for (const g of rows) {
    const key = `${g.grade}|${norm(g.basis ?? '')}`;
    const prev = latest.get(key);
    const year = g.effective_year ?? -Infinity;
    if (!prev || year > (prev.effective_year ?? -Infinity)) latest.set(key, g);
  }
  return [...latest.values()];
}
