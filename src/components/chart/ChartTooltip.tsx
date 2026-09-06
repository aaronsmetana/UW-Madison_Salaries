import type { ReactNode } from 'react';
import { Text, Group } from '@mantine/core';

/**
 * One glass surface for every bespoke chart tooltip in the app — a translucent, blurred card (see
 * `.chart-tip` in `src/styles/app.css`) instead of each tooltip hand-rolling its own Paper/div. Wrap a
 * tooltip's content in this instead of `<Paper withBorder shadow="sm" p="xs">` or a raw styled div.
 *
 * Its sibling is `TIP_STYLE` in `lib/chartStyle.ts`, for the tooltips where Recharts owns the markup
 * and writes inline styles a class cannot beat. The two are no longer copies: both resolve the same
 * `--tip-bg` / `--tip-blur` tokens, which is also what puts the reduced-transparency fallback within
 * reach of the CSS-in-JS one. `e2e/glass.spec.ts` fails if they drift.
 */
export function TipSurface({ children }: { children: ReactNode }) {
  return <div className="chart-tip">{children}</div>;
}

export interface ChartTooltipRow {
  color?: string;
  name: ReactNode;
  value: ReactNode;
}

/**
 * One themed tooltip surface for charts that just need a straightforward "series name + value" list
 * (as opposed to a derived-prose tooltip like TrendsPanel's median+YoY summary, which stays bespoke).
 */
export function ChartTooltip({ label, rows }: { label?: ReactNode; rows: ChartTooltipRow[] }) {
  if (!rows.length) return null;
  return (
    <TipSurface>
      {label != null && <Text size="sm" fw={600} mb={4}>{label}</Text>}
      {rows.map((r, i) => (
        <Group key={i} gap={10} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap">
            {r.color && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0, display: 'inline-block' }} />
            )}
            <Text size="xs" c="dimmed">{r.name}</Text>
          </Group>
          <Text size="xs" fw={600} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.value}</Text>
        </Group>
      ))}
    </TipSurface>
  );
}
