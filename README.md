# UW–Madison Salaries

A static, client-side dashboard for exploring UW–Madison salary snapshots (public-record data).
React + Vite + Mantine front end; all querying runs in the browser via **DuckDB-WASM** over a
**Parquet** file built from the spreadsheets in `data/raw/`. Hosted free on GitHub Pages.

## Maintainer runbook (no local setup needed)

Everything is driven by the files in **`data/raw/`**, edited right on github.com:

- **Add a snapshot:** upload the XLSX/CSV to `data/raw/` (drag-and-drop in the GitHub web UI →
  *Add file → Upload files* → commit). A push to `main` triggers the **Deploy** workflow, which
  rebuilds the data and redeploys. The snapshot's month/year comes from the **sheet name** if it
  has one (e.g. "Updated October 2023"), otherwise from the **filename** (a 4-digit year + a 1–2
  digit month, e.g. `..._05-2026.xlsx`). A workbook with multiple data sheets (e.g. pre/post-TTC)
  becomes multiple snapshots.
- **Remove a snapshot:** delete its file in `data/raw/` and commit.
- **Unusual headers:** the importer auto-detects columns. For a dump it can't map, add an alias or a
  per-file override to `data/column-map.json` (web-editable). Coded categorical values are
  harmonized in `data/value-map.json`.
- **Check ingestion:** the **Data · About** page (and the Actions log) shows each snapshot's
  detected mapping, row counts, and any health flags.

## Pay-band reference (optional)

`data/reference/salary-grades.{xlsx,csv}` holds the official grade→salary-range table
(`grade, basis, min, max, effective_year`), copy/pasted from the
[Salary Structure page](https://hr.wisc.edu/pay/salary-structure/). It powers the pay-band view for
the latest snapshot. (Auto-harvest workflow is planned; copy/paste is the reliable baseline.)

## One-time GitHub setup

1. Create a public repo named **`UW-Madison_Salaries`** (the Vite `base` in `vite.config.ts` must
   match the repo name) and push this project.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` (or run the **Deploy** workflow manually). The site publishes at
   `https://<user>.github.io/UW-Madison_Salaries/`.

## Local development

Node 20+ required.

```bash
npm install
npm run data     # ETL: data/raw/* → public/data/{salaries.parquet,manifest.json,summary.json}
npm run dev      # http://localhost:5173/UW-Madison_Salaries/
npm run build    # typecheck + production build
```

## Layout

- `data/raw/` — source-of-truth salary dumps (committed).
- `data/column-map.json`, `data/value-map.json` — ingestion config.
- `scripts/build-data.mjs` — the ETL (XLSX via SheetJS → Parquet via DuckDB).
- `src/` — the app (`lib/duckdb.ts` data layer, `lib/queries.ts`, `routes/`, `app/` shell).
- `public/data/` — generated artifacts (git-ignored; built in CI).

Data is a Wisconsin public record. Person identity is best-effort (name + hire date); see the
Data · About page for methodology and known caveats.

## License

Code is [MIT-licensed](LICENSE). The underlying salary data is public record, released under
Wisconsin's open-records law — it is not covered by the license and is not owned by this project.
