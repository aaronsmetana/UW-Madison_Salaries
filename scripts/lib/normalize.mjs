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
