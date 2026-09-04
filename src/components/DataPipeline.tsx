import type { ReactNode } from 'react';
import { Text, Anchor, Box } from '@mantine/core';
import { num, plural } from '../lib/format';

/**
 * The seven steps between an open-records request and the number on the screen.
 *
 * It replaces explanation with structure. The route already said all of this in prose, spread across
 * three cards — the source card named the records request, the methodology card said the ingestion is
 * auditable, the disclaimer card said identity matching can merge two people — and a reader had to
 * assemble the order themselves. A pipeline has an order; showing it is cheaper than describing it.
 *
 * Built from text in an `<ol>`, not from an inline SVG. An SVG diagram would have to carry a
 * `role="img"` and a `VisuallyHidden` list as its text equivalent, which is two copies of the same
 * content to keep in step — and a seven-stage horizontal diagram scaled into a 375px viewport renders
 * its labels at about four pixels. An ordered list is already announced as an ordered list, stays
 * selectable and translatable, reflows at any width, and takes the theme's tokens directly.
 *
 * The right-hand figures are the Datasette register: real counts, read from the manifest rather than
 * typed in, in the mono face `app.css` reserves for machine strings. A step with nothing to count
 * carries the citation or the engine name instead.
 *
 * Each figure names its own scope, and no two of them count the same thing. Column detection and the
 * rows-to-people step are per-report, so both carry the snapshot they were measured on; the row total
 * spans every snapshot, so it says so. The first draft reported the app's 16 record fields one step
 * after the 16 detected columns — two unrelated sixteens stacked on consecutive lines, which reads as
 * one number printed twice. That count already has a home in the Methodology accordion below.
 */

type Stage = { label: string; body: ReactNode; fact?: ReactNode };

export function DataPipeline({
  snapshots,
  columnsMapped,
  peopleLatest,
  latestLabel,
  totalRows,
  fileSize,
}: {
  /** Source workbooks ingested — one per snapshot, all-time. */
  snapshots: number;
  /** Columns auto-mapped in the most recent report; null when the manifest carries no mapping. */
  columnsMapped: number | null;
  /** Distinct identities in the most recent report. */
  peopleLatest: number | null;
  /** The most recent report's label, e.g. "Mar 2026" — the scope of the two per-report figures. */
  latestLabel: string | null;
  /** Appointment rows across every snapshot. */
  totalRows: number | null | undefined;
  /** Human-readable size of the published parquet, once the HEAD request answers. */
  fileSize: string | null;
}) {
  const of = (label: string | null) => (label ? ` · ${label}` : '');
  const stages: Stage[] = [
    {
      label: 'An open-records request',
      body: (
        <>
          UFAS asks the university for its salary report under Wisconsin's public-records law. Nothing
          here is scraped, leaked, or estimated — <Anchor href="#source" underline="always" inherit>every
          record starts as a request someone filed</Anchor>.
        </>
      ),
      fact: 'Wis. Stat. § 19.35',
    },
    {
      label: 'A published spreadsheet comes back',
      body: 'UW returns a workbook — one sheet, one row per appointment. That workbook is the only input to everything below.',
      fact: plural(snapshots, 'workbook'),
    },
    {
      label: 'Columns are detected',
      body: "Each sheet names its columns differently, so headers are matched to this app's fields rather than assumed — per report, not once. A mis-match here is one way a value ends up under the wrong label.",
      fact: columnsMapped != null ? `${columnsMapped} columns${of(latestLabel)}` : undefined,
    },
    {
      label: 'Values are normalized, and rows become people',
      body: (
        <>
          Names are re-cased, salaries and FTE are typed as numbers, and rows are linked into one
          person by name and hire date. This is the step that can{' '}
          <Anchor href="#identity" underline="always" inherit>merge two people or split one</Anchor>.
        </>
      ),
      fact: peopleLatest != null ? `${num(peopleLatest)} people${of(latestLabel)}` : undefined,
    },
    {
      label: 'Each report is kept as its own snapshot',
      body: 'A new spreadsheet is added beside the old ones, never over them — which is what makes a salary readable as a history rather than a single current figure.',
      fact: totalRows != null ? `${num(totalRows)} rows · all reports` : undefined,
    },
    {
      label: 'Everything is written to one file',
      body: 'All snapshots are packed into a single columnar dataset and published with the site. It is the same file the download button hands you.',
      fact: fileSize ? `salaries.parquet · ${fileSize}` : 'salaries.parquet',
    },
    {
      label: 'Your browser queries it directly',
      body: 'The file is loaded and searched on your own machine. There is no backend, no account, and no server that sees which person you looked up.',
      fact: 'DuckDB-WASM',
    },
  ];

  return (
    <ol className="pipeline">
      {stages.map((s, i) => (
        <li key={s.label} className="pipeline-step">
          <span className="pipeline-dot" aria-hidden>{i + 1}</span>
          <Box>
            <div className="pipeline-head">
              <Text size="sm" fw={600}>{s.label}</Text>
              {s.fact && <Text size="xs" c="dimmed" className="mono pipeline-fact">{s.fact}</Text>}
            </div>
            <Text size="xs" c="dimmed" mt={2}>{s.body}</Text>
          </Box>
        </li>
      ))}
    </ol>
  );
}
