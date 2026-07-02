import type { ReactNode } from 'react';
import { Paper, Text, Group } from '@mantine/core';

export interface ChartTooltipRow {
  color?: string;
  name: ReactNode;
  value: ReactNode;
}

/**
 * One themed tooltip surface for charts that just need a straightforward "series name + value" list
 * (as opposed to a derived-prose tooltip like TrendsPanel's median+YoY summary, which stays bespoke).
 * Matches the Paper-based look already used by the app's other custom tooltips, instead of Recharts'
 * unstyled default box.
 */
export function ChartTooltip({ label, rows }: { label?: ReactNode; rows: ChartTooltipRow[] }) {
  if (!rows.length) return null;
  return (
    <Paper withBorder shadow="sm" p="xs">
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
    </Paper>
  );
}
