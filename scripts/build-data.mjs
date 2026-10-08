#!/usr/bin/env node
/**
 * build-data.mjs — UW-Madison Salary Dashboard ETL.
 *
 * Reads every spreadsheet in data/raw/ (XLSX via SheetJS, CSV too), classifies each
 * workbook's data sheets, resolves a snapshot date (sheet name first, then filename),
 * maps the varying headers to a canonical schema via data/column-map.json, normalizes
 * messy values (Excel serial dates, $/comma/float salaries, bare-vs-verbose grades),
 * and writes:
 *   public/data/salaries.parquet   — one row per appointment, all snapshots unioned
 *   public/data/manifest.json      — per-snapshot health, mapping, stats
 *   public/data/summary.json       — headline KPIs (engine-fallback)
 *
 * Deterministic + resilient: a bad file/sheet is skipped + flagged, never blocks the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import duckdb from 'duckdb';
import {
  norm, parseDate, parseMoney, parseNum, parseGrade, makePersonKey,
  snapshotFromSheetName, snapshotFromFilename, snapshotMeta, median, actualPay, latestGradeBands,
  prepareSheet, mapDepartment, departmentChanges, DEPT_RENAME_SHARE, DEPT_RENAME_MIN, structureChange, releasedWith,
  divisionReorganizations,
} from './lib/normalize.mjs';
import { computeHomeStats, serializeHomeStats } from './lib/home-stats.mjs';
import { computeRaiseSteps } from './lib/raise-steps.mjs';
import { computeSearchIndex, serializeSearchIndex } from './lib/search-index.mjs';
import { linkSplitPeople } from './lib/identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const COLUMN_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'column-map.json'), 'utf8'));
const VALUE_MAP = readJsonIfExists(path.join(ROOT, 'data', 'value-map.json')) || {};
const CORRECTIONS = readJsonIfExists(path.join(ROOT, 'data', 'corrections.json')) || {};
const MERGE = (CORRECTIONS.merge && typeof CORRECTIONS.merge === 'object') ? CORRECTIONS.merge : {};

// ---------- helpers ----------
function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
// canonical field -> Set of normalized aliases
const ALIASES = {};
for (const [field, names] of Object.entries(COLUMN_MAP.fields)) {
  ALIASES[field] = new Set(names.map(norm));
}
const REQUIRED = COLUMN_MAP.required || ['first_name', 'last_name', 'salary'];

function valueMapApply(field, raw) {
  if (raw == null) return raw;
  const map = VALUE_MAP[field];
  if (!map) return raw;
  const key = String(raw).trim();
  if (map[key] != null) return map[key];
  // case-insensitive
  const hit = Object.keys(map).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit ? map[hit] : raw;
}

// ---------- main ----------
function detectMapping(headers, file) {
  const mapping = {}; // canonical -> column index
  const detectedHeaders = {}; // canonical -> raw header
  const overrides = COLUMN_MAP.overrides || {};
  let forced = {};
  for (const [sub, map] of Object.entries(overrides)) {
    if (file.includes(sub)) forced = { ...forced, ...map };
  }
  headers.forEach((h, i) => {
    if (h == null || String(h).trim() === '') return;
    const nh = norm(h);
    for (const [field, set] of Object.entries(ALIASES)) {
      if (mapping[field] !== undefined) continue;
      if (set.has(nh)) { mapping[field] = i; detectedHeaders[field] = h; }
    }
  });
  // forced overrides (by exact raw header text)
  for (const [field, headerText] of Object.entries(forced)) {
    const idx = headers.findIndex((h) => h != null && norm(h) === norm(headerText));
    if (idx >= 0) { mapping[field] = idx; detectedHeaders[field] = headers[idx]; }
  }
  const unmapped = headers.filter(
    (h, i) => h != null && String(h).trim() !== '' && !Object.values(mapping).includes(i)
  );
  return { mapping, detectedHeaders, unmapped };
}

function processSheet(file, sheetName, aoa) {
  const result = { rows: [], status: 'ok', messages: [], detectedHeaders: {}, unmapped: [], isData: false, dataDictUrl: null };
  if (!aoa.length) { result.messages.push('empty sheet'); return result; }
  const headers = aoa[0];
  // capture a Data Dictionary URL if present
  const firstCell = headers && headers[0] != null ? String(headers[0]) : '';
  const { mapping, detectedHeaders, unmapped } = detectMapping(headers, file);
  result.detectedHeaders = detectedHeaders;
  result.unmapped = unmapped;

  const missingRequired = REQUIRED.filter((f) => mapping[f] === undefined);
  if (missingRequired.length) {
    if (/^https?:\/\//i.test(firstCell.trim())) result.dataDictUrl = firstCell.trim();
    result.messages.push(`not a data sheet (missing ${missingRequired.join(', ')})`);
    return result; // skipped, not data
  }
  result.isData = true;

  const get = (row, field) => (mapping[field] !== undefined ? row[mapping[field]] : null);
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.length === 0) continue;
    const first = get(row, 'first_name');
    const last = get(row, 'last_name');
    const salaryRaw = get(row, 'salary');
    if ((first == null || String(first).trim() === '') && (last == null || String(last).trim() === '') && salaryRaw == null) continue;

    const hireISO = parseDate(get(row, 'date_of_hire'));
    const salary = parseMoney(salaryRaw);
    const compBasis = get(row, 'comp_basis');
    const payRateType = get(row, 'pay_rate_type');
    const grade = parseGrade(get(row, 'salary_grade'), compBasis, payRateType);
    const empType = get(row, 'employee_type');
    const contractType = get(row, 'contract_type');
    let apptType = get(row, 'appointment_type');
    if ((apptType == null || apptType === '') && (empType || contractType)) {
      apptType = [empType, contractType].filter(Boolean).join(' / ') || null;
    }
    const flags = [];
    if (salary == null || salary === 0) flags.push('zero_or_null_salary');
    if (hireISO == null && get(row, 'date_of_hire') != null) flags.push('unparsed_hire_date');

    result.rows.push({
      first_name: clean(first),
      last_name: clean(last),
      // The source rewrote its division vocabulary between two records requests (see value-map.json's
      // `school` block and the rename detector below), so historical rows carry names that no longer
      // exist. Harmonize them the same way coded employee categories are harmonized.
      school: clean(valueMapApply('school', get(row, 'school'))),
      department: clean(get(row, 'department')),
      employee_category_raw: clean(get(row, 'employee_category')),
      employee_category: clean(valueMapApply('employee_category', get(row, 'employee_category'))),
      job_code: clean(get(row, 'job_code')),
      title: clean(get(row, 'title')),
      fte: parseNum(get(row, 'fte')),
      salary,
      salary_fte_adjusted: parseMoney(get(row, 'salary_fte_adjusted')),
      base_pay: parseMoney(get(row, 'base_pay')),
      comp_basis: clean(compBasis),
      pay_rate_type: clean(payRateType),
      flsa_status: clean(get(row, 'flsa_status')),
      salary_grade_raw: grade.raw,
      grade_number: grade.number,
      grade_basis: grade.basis,
      grade_is_numeric: grade.isNumeric,
      date_of_hire: hireISO,
      hire_year: hireISO ? parseInt(hireISO.slice(0, 4), 10) : null,
      appointment_type: clean(apptType),
      employee_type: clean(empType),
      contract_type: clean(contractType),
      _first: first,
      _last: last,
      _flags: flags,
    });
  }
  if (!result.rows.length) { result.status = 'error'; result.messages.push('no data rows'); }
  return result;
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Read the optional pay-band reference table (data/reference/salary-grades.{csv,xlsx}): every row, every
 * year. A row with a minimum and no maximum is a floor — HR publishes only a minimum for most of grades
 * 51–99 — and is kept: a floor says whether pay is below it, though it has no midpoint to place pay by.
 * `latestGradeBands` then keeps the newest row per grade and schedule.
 */
function readGrades() {
  const dir = path.join(ROOT, 'data', 'reference');
  let file = null;
  for (const f of ['salary-grades.csv', 'salary-grades.xlsx']) {
    if (fs.existsSync(path.join(dir, f))) { file = path.join(dir, f); break; }
  }
  if (!file) return [];
  // Every cell as text: `raw` would read a retrieval date as a day count.
  const wb = XLSX.readFile(file, { raw: true, cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const pick = (r, k) => {
    const key = Object.keys(r).find((x) => norm(x) === norm(k));
    return key ? r[key] : null;
  };
  const parsed = rows
    .map((r) => {
      const g = parseInt(String(pick(r, 'grade') ?? '').replace(/\D/g, ''), 10);
      return {
        grade: Number.isFinite(g) ? g : null,
        basis: clean(pick(r, 'basis')),
        min: parseMoney(pick(r, 'min')),
        max: parseMoney(pick(r, 'max')),
        effective_year: parseNum(pick(r, 'effective_year')),
        retrieved: clean(pick(r, 'retrieved')),
        source: clean(pick(r, 'source')),
      };
    })
    .filter((x) => x.grade != null && x.min != null && (x.max == null || x.max > x.min));
  return parsed;
}

function readWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { raw: true, cellDates: false });
  return wb.SheetNames.map((name) => ({
    name,
    aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }),
  }));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) { console.error(`No raw dir: ${RAW_DIR}`); process.exit(1); }
  const files = fs.readdirSync(RAW_DIR).filter((f) => /\.(xlsx|xls|csv)$/i.test(f) && !f.startsWith('~$')).sort();

  const manifest = [];
  const allRows = [];
  const seenSnapshotIds = new Map();

  for (const file of files) {
    const full = path.join(RAW_DIR, file);
    let sheets;
    try { sheets = readWorkbook(full); }
    catch (e) { manifest.push({ snapshot_id: null, source_file: file, status: 'error', messages: [`read failed: ${e.message}`] }); continue; }

    for (const { name, aoa } of sheets) {
      const res = processSheet(file, name, aoa);
      if (!res.isData) {
        if (res.dataDictUrl) {
          manifest.push({ snapshot_id: null, source_file: file, source_sheet: name, status: 'info', messages: ['data dictionary'], data_dictionary_url: res.dataDictUrl });
        }
        continue;
      }
      // resolve snapshot date: sheet name first, then filename
      let snap = snapshotFromSheetName(name) || snapshotFromFilename(file);
      const messages = [...res.messages];
      let status = res.status;
      if (!snap || !snap.month) {
        status = 'error';
        messages.push('could not resolve snapshot month/year');
        snap = snap || { year: 0, month: 0, variant: null };
      }
      // if filename gave month but sheet says pre/post, attach variant from sheet name
      const sheetVar = snapshotFromSheetName(name);
      if (sheetVar && sheetVar.variant && !snap.variant) snap.variant = sheetVar.variant;

      const meta = snapshotMeta(snap);
      let id = meta.id;
      if (seenSnapshotIds.has(id)) {
        status = status === 'ok' ? 'warning' : status;
        messages.push(`duplicate snapshot id ${id} (also from ${seenSnapshotIds.get(id)})`);
        id = `${id}-dup${seenSnapshotIds.size}`;
      }
      seenSnapshotIds.set(id, `${file} :: ${name}`);

      // corrections overlay: unify known-duplicate identities
      const personOf = (row) => {
        const k = makePersonKey(row._first, row._last, row.date_of_hire);
        return MERGE[k] || k;
      };
      // Exact duplicates dropped, then the early workbooks' hourly pay put on the later footing.
      const hourly = prepareSheet(res.rows, personOf);

      const salaries = [];
      // Actual pay summed per person — the population the app's medians describe (see peopleSql in
      // src/lib/queries.ts). `salaries` stays per appointment row: it feeds the data-health page,
      // which reports on the source's rows.
      const payByPerson = new Map();
      const people = new Set();
      const paidPeople = new Set(); // people with ≥1 positive-salary appointment = the employee headcount
      let zeroNull = 0;
      for (const row of hourly.rows) {
        const pkey = personOf(row);
        delete row._first; delete row._last;
        const flags = row._flags; delete row._flags;
        // Median/min/max are on ACTUAL pay (FTE-adjusted) — matches what the app shows; "paid" is still
        // gated on a positive full-time salary.
        if (row.salary == null || row.salary === 0) zeroNull++;
        else {
          salaries.push(actualPay(row));
          paidPeople.add(pkey);
          payByPerson.set(pkey, (payByPerson.get(pkey) ?? 0) + actualPay(row));
        }
        people.add(pkey);
        allRows.push({
          snapshot_id: id,
          snapshot_label: meta.label,
          snapshot_date: meta.date,
          snapshot_year: meta.year,
          snapshot_month: meta.month,
          ttc_variant: meta.variant,
          source_file: file,
          source_sheet: name,
          person_key: pkey,
          ...row,
          row_flags: flags.length ? flags.join(',') : null,
        });
      }

      const med = median(salaries);
      const medPeople = median([...payByPerson.values()].filter((v) => v > 0));
      const min = salaries.length ? Math.min(...salaries) : null;
      const max = salaries.length ? Math.max(...salaries) : null;
      if (max != null && max > 5_000_000) messages.push(`max salary ${max} looks implausible`);
      manifest.push({
        snapshot_id: id,
        snapshot_label: meta.label,
        snapshot_date: meta.date,
        snapshot_year: meta.year,
        snapshot_month: meta.month,
        ttc_variant: meta.variant,
        source_file: file,
        source_sheet: name,
        row_count: hourly.rows.length,
        distinct_people: people.size,
        distinct_people_paid: paidPeople.size,
        zero_or_null_salary: zeroNull,
        salary_min: min,
        salary_median: med,
        salary_median_people: medPeople,
        salary_max: max,
        detected_mapping: res.detectedHeaders,
        unmapped_headers: res.unmapped,
        status,
        messages,
      });
      console.log(`  ${file} :: ${name} -> ${id} (${meta.label}) rows=${hourly.rows.length} people=${people.size} median=${med}`);
      if (hourly.annualized || hourly.cleared || hourly.kept) {
        console.log(`      hourly: ${hourly.annualized} rates annualized, ${hourly.cleared} placeholder FTEs cleared, ${hourly.kept} kept as nominal`);
      }
    }
  }

  // cross-snapshot anomaly: headcount cliffs vs neighbors. Use PAID headcount (people with a salary),
  // not raw row_count — unpaid $0 affiliate appointments came and went over time (≈6k in 2022 → 0 by
  // Oct 2023) and would otherwise flag a false ~−21% "scope change" that isn't a real staffing shift.
  const dataSnaps = manifest.filter((m) => m.row_count).sort((a, b) => (a.snapshot_date > b.snapshot_date ? 1 : -1));
  for (let i = 1; i < dataSnaps.length; i++) {
    const prev = dataSnaps[i - 1], cur = dataSnaps[i];
    if (prev.distinct_people_paid && cur.distinct_people_paid) {
      const change = (cur.distinct_people_paid - prev.distinct_people_paid) / prev.distinct_people_paid;
      if (Math.abs(change) > 0.15) {
        cur.messages.push(`headcount ${change > 0 ? 'up' : 'down'} ${(change * 100).toFixed(0)}% vs ${prev.snapshot_id} (possible scope change)`);
        if (cur.status === 'ok') cur.status = 'warning';
      }
    }
  }

  // Division renames. The source rewrote its whole division vocabulary between two records requests —
  // 20 names retired, 34 introduced — and because nothing canonicalized them, 61% of the older
  // snapshot's rows were filed under names that no longer existed. That severed every division time
  // series at the boundary and was invisible until a reader noticed one division under two names in
  // one person's history table. value-map.json's `school` block fixes the known ones; this reports
  // whatever it does not cover, so the next rename arrives as build output instead of as a defect.
  //
  // "Where did its people go" is the evidence, not the name: matching person keys across the pair
  // separates a rename (nearly everyone reappears under one new name) from a real reorganization
  // (they scatter). The threshold is the one value-map.json's `school` block documents.
  const RENAME_SHARE = 0.85;
  const schoolsIn = (snapId) => {
    const m = new Map();
    for (const r of allRows) {
      if (r.snapshot_id !== snapId || !r.school) continue;
      if (!m.has(r.school)) m.set(r.school, new Set());
      m.get(r.school).add(r.person_key);
    }
    return m;
  };
  const drift = [];
  for (let i = 1; i < dataSnaps.length; i++) {
    const prev = dataSnaps[i - 1], cur = dataSnaps[i];
    const before = schoolsIn(prev.snapshot_id), after = schoolsIn(cur.snapshot_id);
    const whereNow = new Map();
    for (const [school, keys] of after) for (const k of keys) whereNow.set(k, school);
    for (const [school, keys] of before) {
      if (after.has(school)) continue;
      const dest = new Map();
      let carried = 0;
      for (const k of keys) {
        const to = whereNow.get(k);
        if (!to) continue;
        carried++;
        dest.set(to, (dest.get(to) || 0) + 1);
      }
      const [topName, topN] = [...dest.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      const share = carried ? topN / carried : 0;
      const line = topName
        ? `"${school}" is gone; ${Math.round(share * 100)}% of its ${carried} carried-over people are now in "${topName}"`
        : `"${school}" is gone and none of its ${keys.size} people appear in ${cur.snapshot_id}`;
      drift.push({ snapshot: cur.snapshot_id, line, rename: share >= RENAME_SHARE });
      cur.messages.push(
        share >= RENAME_SHARE
          ? `${line} — looks like a rename; add it to the "school" block in data/value-map.json`
          : line
      );
      // A reorganization is a fact worth publishing, not a problem to fix, so it gets the message
      // without the badge. Only an unhandled rename asks someone to do something.
      if (share >= RENAME_SHARE && cur.status === 'ok') cur.status = 'warning';
    }
  }
  if (drift.length) {
    console.log('\nDivision names that changed between snapshots:');
    for (const d of drift) console.log(`  [${d.rename ? 'rename?' : 'reorg'}] ${d.snapshot}: ${d.line}`);
  }

  // Department renames: the same evidence one level down, read both ways (normalize `departmentChanges`),
  // on the names as the source wrote them. value-map.json's `department` block carries the ones found;
  // each step's renames, mergers and other departments that ended go to departments.json for the Data
  // page, and a rename the block does not yet carry is reported here — as a message, not a warning:
  // departments churn every release, and most of it is reorganization rather than renaming.
  const DEPT_MAP = VALUE_MAP.department || {};
  const unitsBySnap = new Map();
  for (const r of allRows) {
    if (!unitsBySnap.has(r.snapshot_id)) unitsBySnap.set(r.snapshot_id, []);
    unitsBySnap.get(r.snapshot_id).push({ person_key: r.person_key, school: r.school, department: r.department });
  }
  const deptLines = [];
  const deptSteps = [];
  const reorganizations = [];
  const r3 = (x) => (x == null ? x : Math.round(x * 1000) / 1000);
  const shares = (o) => ({ ...o, share: r3(o.share), ...(o.reverse != null ? { reverse: r3(o.reverse) } : {}) });
  for (let i = 1; i < dataSnaps.length; i++) {
    const prev = dataSnaps[i - 1], cur = dataSnaps[i];
    const { renames, mergers, gone } = departmentChanges(unitsBySnap.get(prev.snapshot_id) ?? [], unitsBySnap.get(cur.snapshot_id) ?? []);
    const carried = renames.filter((r) => mapDepartment(DEPT_MAP, r.school, r.from) === mapDepartment(DEPT_MAP, r.school, r.to));
    const uncarried = renames.filter((r) => !carried.includes(r));
    // A new division formed from whole departments of others (CCAI, Sep 2026): published in summary.json.
    for (const r of divisionReorganizations(unitsBySnap.get(prev.snapshot_id) ?? [], unitsBySnap.get(cur.snapshot_id) ?? [])) {
      reorganizations.push({ from_id: prev.snapshot_id, to_id: cur.snapshot_id, ...r });
      deptLines.push(`  [reorganized] ${cur.snapshot_id}: "${r.school}" formed from ${r.from.map((f) => `${f.people} of "${f.school}" (${f.departments.join(', ')})`).join('; ')}`);
    }
    deptSteps.push({
      from: prev.snapshot_id, to: cur.snapshot_id,
      carried: carried.map(shares), uncarried: uncarried.map(shares),
      mergers: mergers.map((m) => ({ ...m, reverse: r3(m.reverse), from: m.from.map(shares) })),
      gone: gone.map(shares),
    });
    for (const r of uncarried) {
      const line = `"${r.from}" (${r.school}) looks renamed to "${r.to}": ${Math.round(r.share * 100)}% of its ${r.carried} carried-over people went there, and ${Math.round(r.reverse * 100)}% of the new department's came from it`;
      cur.messages.push(`${line} — add "${r.school}|${r.from}" to the "department" block in data/value-map.json`);
      deptLines.push(`  [rename?] ${cur.snapshot_id}: ${line}`);
    }
    for (const r of carried) deptLines.push(`  [carried] ${cur.snapshot_id}: "${r.from}" → "${r.to}" (${r.school})`);
    for (const m of mergers) deptLines.push(`  [merged] ${cur.snapshot_id}: ${m.from.map((f) => `"${f.department}"`).join(' + ')} → "${m.to}" (${m.school}), not carried`);
  }
  if (deptLines.length) {
    console.log('\nDepartment names that changed between snapshots:');
    for (const l of deptLines) console.log(l);
  }
  // Now carry them, so every snapshot files a renamed department under its name today.
  for (const r of allRows) r.department = mapDepartment(DEPT_MAP, r.school, r.department);

  // One person split in two by a hire date the source changed, or by a rehire (lib/identity): joined back
  // under their latest key, on department names as carried. The old keys are kept as aliases, so a link to
  // one still finds the person. Never two keys in one snapshot, so no snapshot's headcount moves.
  const identity = linkSplitPeople(allRows);
  for (const r of allRows) r.person_key = identity.canon.get(r.person_key) ?? r.person_key;
  console.log(`\nIdentity: ${identity.links.length} records split by a changed hire date joined back into ${new Set(identity.canon.values()).size} people`);

  // Hard gate — the NEWEST snapshot only. A >40% paid-headcount swing vs its immediate predecessor is
  // far outside anything seen in this dataset's history and more likely a mapping/ingestion break than
  // a real staffing change. This fails the CI job (site keeps serving the last good deploy) instead of
  // silently publishing bad data. Only the latest pair is checked, so documented historical anomalies
  // (the Nov 2021 TTC relabel, the Oct 2023 scope change) can never retroactively break the build.
  let hardFail = false;
  if (dataSnaps.length >= 2) {
    const cur = dataSnaps[dataSnaps.length - 1];
    const prev = dataSnaps[dataSnaps.length - 2];
    if (prev.distinct_people_paid && cur.distinct_people_paid) {
      const change = Math.abs((cur.distinct_people_paid - prev.distinct_people_paid) / prev.distinct_people_paid);
      if (change > 0.4) {
        cur.status = 'error';
        cur.messages.push(`BLOCKING: paid headcount changed ${(change * 100).toFixed(0)}% vs ${prev.snapshot_id} — over the 40% safety threshold. If this swing is expected, investigate and adjust before re-running.`);
        hardFail = true;
      }
    }
  }

  // Files where every sheet failed the required-columns check are otherwise invisible (silently
  // dropped) — surface them as a manifest error so a bad upload doesn't go unnoticed.
  const filesInManifest = new Set(manifest.map((m) => m.source_file));
  for (const f of files) {
    if (!filesInManifest.has(f)) {
      manifest.push({
        snapshot_id: null, source_file: f, status: 'error',
        messages: ['no sheet in this file could be mapped to the required columns — check data/column-map.json'],
      });
    }
  }

  if (hardFail) {
    console.error('\nBLOCKING data-health error — aborting before writing output.');
    for (const m of manifest.filter((x) => x.status === 'error')) console.error(`  [error] ${m.snapshot_id || m.source_file}: ${(m.messages || []).join('; ')}`);
    process.exit(1);
  }

  // write NDJSON -> Parquet via DuckDB
  const ndjson = path.join(OUT_DIR, '_rows.ndjson');
  fs.writeFileSync(ndjson, allRows.map((r) => JSON.stringify(r)).join('\n'));
  await writeParquet(ndjson, path.join(OUT_DIR, 'salaries.parquet'));
  fs.unlinkSync(ndjson);

  // optional maintainer snapshot notes (no-op if absent) — attach before writing manifest
  const notes = readJsonIfExists(path.join(ROOT, 'data', 'snapshot-notes.json')) || {};
  for (const m of manifest) {
    if (m.snapshot_id && notes[m.snapshot_id]) m.note = notes[m.snapshot_id];
  }

  // Department renames carried, mergers left separate, and the other departments each step ended (above).
  fs.writeFileSync(path.join(OUT_DIR, 'departments.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    rule: { share: DEPT_RENAME_SHARE, min: DEPT_RENAME_MIN },
    mapped: Object.keys(DEPT_MAP).filter((k) => !k.startsWith('_')).length,
    steps: deptSteps,
  }));

  // manifest + summary
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    schema_version: 1,
    total_rows: allRows.length,
    snapshots: manifest,
  }, null, 2));

  // The day each release went up on the site (data/releases.json): every "New" counts 30 days from it.
  // Hand-kept on purpose — neither the snapshot date (the 1st of its month) nor this build's date (every
  // deploy) says when readers first had the data.
  const releases = readJsonIfExists(path.join(ROOT, 'data', 'releases.json')) || {};
  const publishedOf = (id) => (/^\d{4}-\d{2}-\d{2}$/.test(releases[id] ?? '') ? releases[id] : null);
  const latest = dataSnaps[dataSnaps.length - 1];
  if (latest && !publishedOf(latest.snapshot_id)) {
    console.warn(`\nRelease: no date for ${latest.snapshot_id} in data/releases.json — NEW will count from its snapshot date (${latest.snapshot_date}).`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    total_rows: allRows.length,
    snapshot_count: dataSnaps.length,
    // `median` is over PEOPLE (their summed actual pay), matching the headcount beside it and every
    // median in the app; `median_rows` keeps the per-appointment figure the source's rows give.
    snapshots: dataSnaps.map((s) => ({ id: s.snapshot_id, label: s.snapshot_label, date: s.snapshot_date, published: publishedOf(s.snapshot_id), rows: s.row_count, headcount: s.distinct_people_paid, median: s.salary_median_people, median_rows: s.salary_median })),
    latest: latest ? { id: latest.snapshot_id, label: latest.snapshot_label, headcount: latest.distinct_people_paid, median: latest.salary_median_people, median_rows: latest.salary_median } : null,
    // Divisions formed from whole departments of others (normalize `divisionReorganizations`), so a move
    // of every member of a department is read as the reorganization it is.
    reorganizations,
    // People whose records a changed hire date had split, joined back (lib/identity).
    joined_people: new Set(identity.canon.values()).size,
  }, null, 2));
  // Their old keys, for a link made before they were joined.
  fs.writeFileSync(path.join(OUT_DIR, 'person-aliases.json'), JSON.stringify(Object.fromEntries(identity.canon)));

  // pay-band reference (grade → range, or → minimum) + freshness status
  const gradeRows = readGrades();
  const grades = latestGradeBands(gradeRows).map((g) => ({ grade: g.grade, basis: g.basis, min: g.min, max: g.max ?? null, effective_year: g.effective_year }));
  fs.writeFileSync(path.join(OUT_DIR, 'grades.json'), JSON.stringify(grades, null, 2));

  // precomputed landing-page stats (latest snapshot only) — lets Home render without booting
  // DuckDB-WASM or downloading the multi-MB parquet at all; falls back to live SQL if missing.
  if (latest) {
    const homeStats = await computeHomeStats(path.join(OUT_DIR, 'salaries.parquet'), latest.snapshot_id);
    // Over its gzipped budget, the data build fails rather than slow every landing.
    const { json, gz } = serializeHomeStats(homeStats);
    fs.writeFileSync(path.join(OUT_DIR, 'home-stats.json'), json);
    console.log(`home-stats.json: ${gz} bytes gzipped`);
  }

  // Every step's continuing raises, campus-wide (scripts/lib/raise-steps.mjs) — what a person's page
  // compares each raise against, without scanning every raise on campus in the browser.
  const raiseSteps = await computeRaiseSteps(path.join(OUT_DIR, 'salaries.parquet'));
  fs.writeFileSync(path.join(OUT_DIR, 'raise-steps.json'), JSON.stringify(raiseSteps));

  // Titles and divisions for search (scripts/lib/search-index.mjs), so they answer before the
  // database loads. Over its gzipped budget, the data build fails rather than slow every landing.
  if (latest) {
    const { json, gz } = serializeSearchIndex(await computeSearchIndex(path.join(OUT_DIR, 'salaries.parquet'), latest));
    fs.writeFileSync(path.join(OUT_DIR, 'search-index.json'), json);
    console.log(`search-index.json: ${gz} bytes gzipped`);
  }

  const latestYear = dataSnaps.length ? dataSnaps[dataSnaps.length - 1].snapshot_year : null;
  const maxEff = grades.reduce((m, g) => (g.effective_year != null && g.effective_year > m ? g.effective_year : m), 0) || null;

  // Coverage, not just presence: a handful of seeded grades still reports "ok" under an existence +
  // freshness check, so the pay-band panels render a confident-looking average over a tiny slice of
  // people. Measure against the rows that *have* a grade in the source (many appointments legitimately
  // aren't on the graded structure at all) — that's the population the reference is supposed to band.
  //
  // Ranges and floors are counted apart. A floor answers one question (is pay below the grade's minimum?)
  // and a range the rest — position in range, compa-ratio, the market floor — so coverage, and whether the
  // pay-band figures are "sparse", is the ranges'.
  const rangeKeys = new Set(grades.filter((g) => g.max != null).map((g) => `${g.grade}|${norm(g.basis ?? '')}`));
  const floorKeys = new Set(grades.filter((g) => g.max == null).map((g) => `${g.grade}|${norm(g.basis ?? '')}`));
  const latestRows = latest ? allRows.filter((r) => r.snapshot_id === latest.snapshot_id) : [];
  const gradedRows = latestRows.filter((r) => r.grade_number != null);
  const keyOf = (r) => `${r.grade_number}|${norm(r.grade_basis ?? '')}`;
  const matchedRows = gradedRows.filter((r) => rangeKeys.has(keyOf(r)));
  const floorRows = gradedRows.filter((r) => floorKeys.has(keyOf(r)));
  const coverage = gradedRows.length ? matchedRows.length / gradedRows.length : null;
  const SPARSE_BELOW = 0.5;
  // Where the newest figures came from, and when: HR states no effective date, so the day they were read.
  const newest = gradeRows.filter((g) => g.effective_year === maxEff);
  const retrievedAt = newest.map((g) => g.retrieved).filter(Boolean).sort().pop() ?? null;

  const refStatus = {
    generated_at: new Date().toISOString(),
    grades_count: new Set(grades.filter((g) => g.max != null).map((g) => g.grade)).size,
    floors_count: new Set(grades.filter((g) => g.max == null).map((g) => g.grade)).size,
    max_effective_year: maxEff,
    latest_snapshot_year: latestYear,
    graded_rows: gradedRows.length,
    matched_rows: matchedRows.length,
    coverage,
    floor_rows: floorRows.length,
    floor_coverage: gradedRows.length ? floorRows.length / gradedRows.length : null,
    retrieved_at: retrievedAt,
    source_url: newest.map((g) => g.source).find(Boolean) ?? null,
    structure_change: structureChange(gradeRows),
    released_with: releasedWith(dataSnaps, retrievedAt),
    status:
      grades.length === 0
        ? 'missing'
        : latestYear && maxEff && latestYear - maxEff > 1
          ? 'stale'
          : coverage != null && coverage < SPARSE_BELOW
            ? 'sparse'
            : 'ok',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'reference-status.json'), JSON.stringify(refStatus, null, 2));

  console.log(`\nDone. ${allRows.length} rows across ${dataSnaps.length} snapshots, ${grades.length} grade ranges and minimums -> public/data/`);
  console.log(`Pay bands: ranges cover ${matchedRows.length} of ${gradedRows.length} graded appointments (${Math.round((coverage ?? 0) * 100)}%), minimums ${floorRows.length} more; structure ${refStatus.structure_change == null ? 'change unknown' : `${refStatus.structure_change > 0 ? '+' : ''}${(refStatus.structure_change * 100).toFixed(1)}%`}, released with ${refStatus.released_with ?? '—'}, status ${refStatus.status}`);
  const warnings = manifest.filter((m) => m.status === 'warning' || m.status === 'error');
  if (warnings.length) {
    console.log('\nHealth flags:');
    for (const w of warnings) console.log(`  [${w.status}] ${w.snapshot_id || w.source_file}: ${w.messages.join('; ')}`);
  }
}

function writeParquet(ndjsonPath, parquetPath) {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:');
    const con = db.connect();
    const esc = (p) => p.replace(/'/g, "''");
    con.run(
      `CREATE TABLE salaries AS SELECT * FROM read_json_auto('${esc(ndjsonPath)}', format='newline_delimited', sample_size=-1);`,
      (err) => {
        if (err) return reject(err);
        con.run(`COPY salaries TO '${esc(parquetPath)}' (FORMAT PARQUET, COMPRESSION ZSTD);`, (err2) => {
          if (err2) return reject(err2);
          db.close(() => resolve());
        });
      }
    );
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
