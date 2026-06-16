import { VisuallyHidden } from '@mantine/core';

/** Screen-reader/print fallback: an off-screen data table mirroring a chart's data. */
export function ChartData({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
}) {
  if (!rows.length) return null;
  return (
    <VisuallyHidden>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{v ?? ''}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </VisuallyHidden>
  );
}
