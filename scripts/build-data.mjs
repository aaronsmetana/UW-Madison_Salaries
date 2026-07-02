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
  snapshotFromSheetName, snapshotFromFilename, snapshotMeta, median,
} from './lib/normalize.mjs';
import { computeHomeStats } from './lib/home-stats.mjs';

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
      school: clean(get(row, 'school')),
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

/** Read the optional pay-band reference table (data/reference/salary-grades.{csv,xlsx}). */
function readGrades() {
  const dir = path.join(ROOT, 'data', 'reference');
  let file = null;
  for (const f of ['salary-grades.csv', 'salary-grades.xlsx']) {
    if (fs.existsSync(path.join(dir, f))) { file = path.join(dir, f); break; }
  }
  if (!file) return [];
  const wb = XLSX.readFile(file, { raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const pick = (r, k) => {
    const key = Object.keys(r).find((x) => norm(x) === norm(k));
    return key ? r[key] : null;
  };
  return rows
    .map((r) => {
      const g = parseInt(String(pick(r, 'grade') ?? '').replace(/\D/g, ''), 10);
      return {
        grade: Number.isFinite(g) ? g : null,
        basis: clean(pick(r, 'basis')),
        min: parseMoney(pick(r, 'min')),
        max: parseMoney(pick(r, 'max')),
        effective_year: parseNum(pick(r, 'effective_year')),
      };
    })
    .filter((x) => x.grade != null && x.min != null && x.max != null);
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

      // person dedupe within snapshot (exact duplicate rows)
      const seen = new Set();
      const salaries = [];
      const people = new Set();
      const paidPeople = new Set(); // people with ≥1 positive-salary appointment = the employee headcount
      let zeroNull = 0;
      for (const row of res.rows) {
        const hireISO = row.date_of_hire;
        const pkey0 = makePersonKey(row._first, row._last, hireISO);
        const pkey = MERGE[pkey0] || pkey0; // corrections overlay: unify known-duplicate identities
        const dedupeKey = `${pkey}|${row.job_code || ''}|${row.title || ''}|${row.salary ?? ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        delete row._first; delete row._last;
        const flags = row._flags; delete row._flags;
        // Median/min/max are on ACTUAL pay (FTE-adjusted) — matches what the app shows; "paid" is still
        // gated on a positive full-time salary.
        if (row.salary == null || row.salary === 0) zeroNull++;
        else { salaries.push(row.salary_fte_adjusted ?? row.salary * (row.fte ?? 1)); paidPeople.add(pkey); }
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
        row_count: seen.size,
        distinct_people: people.size,
        distinct_people_paid: paidPeople.size,
        zero_or_null_salary: zeroNull,
        salary_min: min,
        salary_median: med,
        salary_max: max,
        detected_mapping: res.detectedHeaders,
        unmapped_headers: res.unmapped,
        status,
        messages,
      });
      console.log(`  ${file} :: ${name} -> ${id} (${meta.label}) rows=${seen.size} people=${people.size} median=${med}`);
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

  // manifest + summary
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    schema_version: 1,
    total_rows: allRows.length,
    snapshots: manifest,
  }, null, 2));

  const latest = dataSnaps[dataSnaps.length - 1];
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    total_rows: allRows.length,
    snapshot_count: dataSnaps.length,
    snapshots: dataSnaps.map((s) => ({ id: s.snapshot_id, label: s.snapshot_label, date: s.snapshot_date, rows: s.row_count, median: s.salary_median })),
    latest: latest ? { id: latest.snapshot_id, label: latest.snapshot_label, headcount: latest.distinct_people_paid, median: latest.salary_median } : null,
  }, null, 2));

  // pay-band reference (grade → range) + freshness status
  const grades = readGrades();
  fs.writeFileSync(path.join(OUT_DIR, 'grades.json'), JSON.stringify(grades, null, 2));

  // precomputed landing-page stats (latest snapshot only) — lets Home render without booting
  // DuckDB-WASM or downloading the multi-MB parquet at all; falls back to live SQL if missing.
  if (latest) {
    const homeStats = await computeHomeStats(path.join(OUT_DIR, 'salaries.parquet'), latest.snapshot_id);
    fs.writeFileSync(path.join(OUT_DIR, 'home-stats.json'), JSON.stringify(homeStats, null, 2));
  }

  const latestYear = dataSnaps.length ? dataSnaps[dataSnaps.length - 1].snapshot_year : null;
  const maxEff = grades.reduce((m, g) => (g.effective_year != null && g.effective_year > m ? g.effective_year : m), 0) || null;
  const refStatus = {
    generated_at: new Date().toISOString(),
    grades_count: grades.length,
    max_effective_year: maxEff,
    latest_snapshot_year: latestYear,
    status: grades.length === 0 ? 'missing' : latestYear && maxEff && latestYear - maxEff > 1 ? 'stale' : 'ok',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'reference-status.json'), JSON.stringify(refStatus, null, 2));

  console.log(`\nDone. ${allRows.length} rows across ${dataSnaps.length} snapshots, ${grades.length} grade ranges -> public/data/`);
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
