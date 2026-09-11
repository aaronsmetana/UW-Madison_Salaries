import { useMemo } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { ChartData } from './ChartData';
import type { RaiseContext } from '../lib/raiseContext';

/** Past this, a step gets its own row; under it, steps are folded into one — twenty rows of $40 hide
 *  the three that explain the gap. */
const SMALL = 500;

const money = (x: number) => (Math.round(Math.abs(x)) === 0 ? '$0' : `${x >= 0 ? '+' : '−'}${usd(Math.abs(x))}`);

/**
 * "Where the difference came from": the gap between actual pay and pay had every raise been typical,
 * split into each step's share (lib/raises `whereTheDifferenceCameFrom`). One component for the person
 * page and the printed report, so the two list the same steps in the same way.
 */
export function GapBreakdown({ breakdown }: { breakdown: NonNullable<RaiseContext['breakdown']> }) {
  const lines = useMemo(() => {
    const big = breakdown.shares.filter((x) => x.kind === 'reporting' || Math.abs(x.amount) >= SMALL);
    const small = breakdown.shares.filter((x) => x.kind === 'step' && Math.abs(x.amount) < SMALL);
    const out = big
      .map((x) => ({ key: `${x.kind}-${x.toId}`, kind: x.kind, label: x.label, amount: x.amount }))
      // Largest first; a reporting change, which moves both lines alike, after the steps that differ.
      .sort((p, q) => (p.kind === 'reporting' ? 1 : 0) - (q.kind === 'reporting' ? 1 : 0) || Math.abs(q.amount) - Math.abs(p.amount));
    if (small.length) {
      out.push({ key: 'small', kind: 'step', label: `${small.length} smaller step${small.length === 1 ? '' : 's'} (under $500 each)`, amount: small.reduce((t, x) => t + x.amount, 0) });
    }
    return out;
  }, [breakdown]);
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
