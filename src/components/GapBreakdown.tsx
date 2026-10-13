import { useMemo } from 'react';
import { Group, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { ChartData } from './ChartData';
import type { RaiseContext } from '../lib/raiseContext';
import { breakdownLines } from '../lib/raises';


const money = (x: number) => (Math.round(Math.abs(x)) === 0 ? '$0' : `${x >= 0 ? '+' : '−'}${usd(Math.abs(x))}`);

/**
 * "Where the difference came from": the gap between actual pay and pay had every raise been typical, split
 * into each step's share (lib/raises `whereTheDifferenceCameFrom`), drawn as a horizontal waterfall (P27): from
 * the typical figure, each step adds or takes away its share, to the actual figure. It was five rows of amounts
 * in text. Steps at exactly the typical raise, which add nothing, are a note under it rather than a "$0" row.
 * One component for the person page and the printed report, so the two show the same steps in the same way.
 */
export function GapBreakdown({ breakdown }: { breakdown: NonNullable<RaiseContext['breakdown']> }) {
  // Past $500 a step gets its own row; under it, steps are folded — twenty rows of $40 hide the three
  // that explain the gap — and the steps at exactly the typical raise are said to be (lib/raises).
  const lines = useMemo(() => breakdownLines(breakdown.shares), [breakdown]);
  const gap = breakdown.actual - breakdown.typical;
  const atTypical = lines.find((l) => l.kind === 'typical');
  const { segs, x, base } = useMemo(() => {
    let cum = breakdown.typical;
    const segs = lines.filter((l) => l.kind !== 'typical').map((l) => {
      const from = cum;
      if (l.kind !== 'reporting') cum += l.amount;
      return { ...l, from, to: cum };
    });
    const vals = [breakdown.typical, breakdown.actual, ...segs.flatMap((s) => [s.from, s.to])];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || Math.max(1, hi * 0.02);
    const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
    return { segs, x, base: lo - pad };
  }, [lines, breakdown]);

  const bar = (from: number, to: number, fill: string, cls: string) => (
    <div className="gap-track" aria-hidden>
      <div className={cls} style={{ left: `${x(Math.min(from, to))}%`, width: `${Math.max(0.6, Math.abs(x(to) - x(from)))}%`, background: fill }} />
    </div>
  );

  return (
    <div className="gap-breakdown">
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Text size="sm">
          Actual {usd(breakdown.actual)} · if raises had been typical {usd(breakdown.typical)}
        </Text>
        <Text size="sm" fw={700} data-gap-total>{money(gap)}</Text>
      </Group>
      <div className="gap-waterfall">
        <div className="gap-row gap-row-total" data-gap-start>
          <Text size="sm" className="gap-label">If raises had been typical</Text>
          {bar(base, breakdown.typical, 'var(--bar)', 'gap-bar gap-bar-total')}
          <Text size="sm" fw={600} className="gap-value">{usd(breakdown.typical)}</Text>
        </div>
        {segs.map((l) => (
          <div key={l.key} className="gap-row" data-gap-row={l.kind}>
            <Text size="sm" className="gap-label" c={l.kind === 'reporting' ? 'dimmed' : undefined}>{l.label}</Text>
            {l.kind === 'reporting'
              ? <div className="gap-track" aria-hidden />
              : bar(l.from, l.to, l.amount >= 0 ? 'var(--mark-up)' : 'var(--mark-down)', 'gap-bar gap-bar-step')}
            <Text size="sm" fw={l.kind === 'reporting' ? 400 : 600} className="gap-value" c={l.kind === 'reporting' ? 'dimmed' : undefined}>
              {l.kind === 'reporting' ? '—' : money(l.amount)}
            </Text>
          </div>
        ))}
        <div className="gap-row gap-row-total" data-gap-end>
          <Text size="sm" fw={600} className="gap-label">Actual</Text>
          {bar(base, breakdown.actual, 'var(--trend-self)', 'gap-bar gap-bar-total')}
          <Text size="sm" fw={700} className="gap-value">{usd(breakdown.actual)}</Text>
        </div>
      </div>
      {atTypical && (
        <Text size="xs" c="dimmed" mt={6} data-gap-note="typical">
          {atTypical.label}, adding nothing to the difference.
        </Text>
      )}
      <ChartData
        caption="Where the difference from typical raises came from"
        columns={['Step', 'Share of the difference']}
        rows={lines.map((l) => [l.label, l.kind === 'reporting' ? '' : Math.round(l.amount)])}
        unit="steps"
      />
    </div>
  );
}
