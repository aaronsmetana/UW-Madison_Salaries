import { useMemo } from 'react';
import { Card, Text } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Customized,
} from 'recharts';
import { useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay, poolPercentile } from '../lib/queries';
import { snapX, snapAxisProps, knownBreak } from '../lib/snapTime';
import { AXIS_TICK, GRID, fmtUsd } from '../lib/chartStyle';
import { usd, num } from '../lib/format';
import { ordinal } from '../lib/stats';
import { BAND_IQR, MARK_SELF } from './markers';
import { CardTitle } from './CardTitle';
import { ChartData } from './ChartData';
import { TipSurface } from './chart/ChartTooltip';
import { BreakLabel } from './chart/BreakLabel';

/** Fewer people than this in the title at the start, and there is no group to follow. */
const MIN_START = 10;
/** Below this many still here, a percentile band describes a handful of people, so it stops. */
const MIN_RIBBON = 5;

interface Row {
  snapshot_id: string;
  date: string;
  label: string;
  n: number;
  p10: number | null;
  p25: number | null;
  med: number | null;
  p75: number | null;
  p90: number | null;
  below: number | null;
  mine: number | null;
}

type PlotRow = Row & { x: number; band10: [number, number] | null; band25: [number, number] | null; median: number | null; pct: number | null };

function GroupTip({ active, payload }: { active?: boolean; payload?: { payload: PlotRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{d.label}</Text>
      <Text size="xs" c="dimmed">{num(d.n)} of the group still here</Text>
      {d.median != null && <Text size="xs" c="dimmed">Group median {usd(d.median)}</Text>}
      {d.mine != null && (
        <Text size="sm">
          This person {usd(d.mine)}{d.pct != null ? ` · ${ordinal(d.pct)} percentile` : ''}
        </Text>
      )}
    </TipSurface>
  );
}

/**
 * The people this person started with: everyone who held their first title in their first snapshot,
 * followed to today. It answers the question the title median cannot — the median is whoever holds
 * the title now, so a promotion swaps the comparison group out from under the reader; this group is
 * fixed at the start and only shrinks as people leave.
 *
 * Pay is per person (`personPay`), percentiles by the app's one rule (strictly below, of the others),
 * and the axis is the shared date axis, with the Sep 2025 reporting change marked where it falls.
 */
export function StartingGroup({ personKey, first }: {
  personKey: string;
  /** The person's first snapshot and the primary title they held in it. */
  first: { snapshotId: string; label: string; jobCode: string; title: string } | null;
}) {
  const { data } = useSql<Row>(
    ['starting-group', personKey, first?.snapshotId ?? '', first?.jobCode ?? ''],
    `WITH g AS (SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(first?.snapshotId ?? '')} AND job_code = ${sqlStr(first?.jobCode ?? '')}),
          pp AS (SELECT s.snapshot_id, any_value(s.snapshot_date) d, any_value(s.snapshot_label) lbl, s.person_key, ${personPay('fte')} pay
                 FROM salaries s JOIN g USING (person_key) GROUP BY s.snapshot_id, s.person_key),
          me AS (SELECT snapshot_id, pay mine FROM pp WHERE person_key = ${sqlStr(personKey)})
     SELECT pp.snapshot_id, any_value(d) date, any_value(lbl) "label",
            count(*) FILTER (WHERE pay > 0) n,
            quantile_cont(pay, 0.1) FILTER (WHERE pay > 0) p10, quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
            median(pay) FILTER (WHERE pay > 0) med,
            quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75, quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90,
            count(*) FILTER (WHERE pay > 0 AND pay < me.mine) below, any_value(me.mine) mine
     FROM pp LEFT JOIN me USING (snapshot_id)
     GROUP BY pp.snapshot_id ORDER BY date, pp.snapshot_id DESC`,
    !!first && !!personKey
  );

  const plot = useMemo<PlotRow[]>(() => (data ?? []).map((r) => {
    const ok = r.n >= MIN_RIBBON;
    return {
      ...r,
      x: snapX(r.date, r.snapshot_id),
      band10: ok && r.p10 != null && r.p90 != null ? [r.p10, r.p90] : null,
      band25: ok && r.p25 != null && r.p75 != null ? [r.p25, r.p75] : null,
      median: ok ? r.med : null,
      pct: r.mine != null && r.mine > 0 && r.below != null ? poolPercentile(r.below, r.n) : null,
    };
  }), [data]);

  if (!first || !plot.length || plot[0].n < MIN_START) return null;
  const start = plot[0];
  const now = plot[plot.length - 1];
  const axis = snapAxisProps(plot.map((r) => ({ date: r.date, label: r.label })));
  const brk = knownBreak('nineMonth2025');
  const brkX = snapX(brk.date, brk.snapshotId);
  const showBreak = brkX > axis.domain[0] && brkX < axis.domain[1];
  const when = first.label.replace(/\s*\((?:Pre|Post)-TTC\)/, '');

  return (
    <Card withBorder padding="lg" mt="lg" className="starting-group">
      <CardTitle sub="Everyone who held this person's first title in their first snapshot, followed to today.">
        The group this person started with
      </CardTitle>
      <Text
        size="sm"
        mb="sm"
        data-start-n={start.n}
        data-now-n={now.n}
        data-start-pct={start.pct ?? ''}
        data-now-pct={now.pct ?? ''}
      >
        {num(start.n)} people were {first.title} in {when}; {num(now.n)} {now.n === 1 ? 'is' : 'are'} still at UW. People
        who left drop out.
        {start.pct != null && now.pct != null ? ` Started at the ${ordinal(start.pct)} percentile; now ${ordinal(now.pct)}.` : ''}
      </Text>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={plot} margin={{ left: 12, right: 30, top: 16, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...axis} tick={AXIS_TICK} tickMargin={10} height={34} />
          <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} />
          <Tooltip content={<GroupTip />} />
          {showBreak && <ReferenceLine x={brkX} stroke="var(--mantine-color-gray-4)" strokeDasharray="2 4" />}
          {/* 10th–90th, then the middle 50% drawn as it is on every chart (BAND_IQR). */}
          <Area dataKey="band10" stroke="none" fill={BAND_IQR.fill} isAnimationActive={false} connectNulls={false} />
          <Area dataKey="band25" stroke={BAND_IQR.edge} strokeWidth={BAND_IQR.edgeWidth} fill={BAND_IQR.fill} isAnimationActive={false} connectNulls={false} />
          <Line className="group-median" dataKey="median" stroke="var(--guide-strong)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="mine" stroke={MARK_SELF} strokeWidth={2} dot isAnimationActive={false} connectNulls={false} />
          {showBreak && <Customized component={<BreakLabel at={brkX} texts={[brk.label, brk.short]} />} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        Shaded: the middle 50% of the group, and lighter, the 10th to 90th percentiles; the grey line is the group's
        median, the teal line this person. The bands stop where fewer than {MIN_RIBBON} of the group remain.
      </Text>
      <ChartData
        caption={`The group that started as ${first.title} in ${when}`}
        columns={['Snapshot', 'Still here', '10th', '25th', 'Median', '75th', '90th', 'This person', 'Percentile']}
        rows={plot.map((r) => [r.label, r.n, r.p10, r.p25, r.med, r.p75, r.p90, r.mine, r.pct])}
        unit="snapshots"
      />
    </Card>
  );
}
