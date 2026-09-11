import { useMemo } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { ChartData } from './ChartData';
import type { RaiseContext } from '../lib/raiseContext';
import { breakdownLines } from '../lib/raises';


const money = (x: number) => (Math.round(Math.abs(x)) === 0 ? '$0' : `${x >= 0 ? '+' : '−'}${usd(Math.abs(x))}`);

/**
 * "Where the difference came from": the gap between actual pay and pay had every raise been typical,
 * split into each step's share (lib/raises `whereTheDifferenceCameFrom`). One component for the person
 * page and the printed report, so the two list the same steps in the same way.
 */
export function GapBreakdown({ breakdown }: { breakdown: NonNullable<RaiseContext['breakdown']> }) {
  // Past $500 a step gets its own row; under it, steps are folded — twenty rows of $40 hide the three
  // that explain the gap — and the steps at exactly the typical raise are said to be (lib/raises).
  const lines = useMemo(() => breakdownLines(breakdown.shares), [breakdown]);
  const gap = breakdown.actual - breakdown.typical;
  return (
    <div className="gap-breakdown">
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Text size="sm">
          Actual {usd(breakdown.actual)} · if raises had been typical {usd(breakdown.typical)}
        </Text>
        <Text size="sm" fw={700} data-gap-total>{money(gap)}</Text>
      </Group>
      <Stack gap={4}>
        {lines.map((l) => (
          <Group key={l.key} justify="space-between" wrap="nowrap" data-gap-row={l.kind}>
            <Text size="sm" c={l.kind === 'reporting' ? 'dimmed' : undefined}>{l.label}</Text>
            <Text size="sm" fw={l.kind === 'reporting' ? 400 : 600} c={l.kind === 'reporting' ? 'dimmed' : undefined} style={{ whiteSpace: 'nowrap' }}>
              {l.kind === 'reporting' ? '—' : money(l.amount)}
            </Text>
          </Group>
        ))}
      </Stack>
      <ChartData
        caption="Where the difference from typical raises came from"
        columns={['Step', 'Share of the difference']}
        rows={lines.map((l) => [l.label, l.kind === 'reporting' ? '' : Math.round(l.amount)])}
        unit="steps"
      />
    </div>
  );
}
