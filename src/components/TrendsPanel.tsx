import { useId, useMemo } from 'react';
import { Card, Text, Loader, Group } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceLine, Customized,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, fmtUsd } from '../lib/chartStyle';
import { snapX, snapAxisProps, knownBreak } from '../lib/snapTime';
import { BreakLabel, BreakLabels } from './chart/BreakLabel';
import { lineGlowDefs } from './chartDefs';
import { TipSurface } from './chart/ChartTooltip';
import { useControls } from '../state/controls';
import { useSql } from '../lib/hooks';
import { salaryExpr, paidHeadcount, peopleSql, whereAll, filterKey } from '../lib/queries';
import { usd, num, pct, spanLabel } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { ChartData } from './ChartData';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { SegmentedToggle } from './SegmentedToggle';
import { CardTitle } from './CardTitle';
import { YoyChips } from './chart/pills';
import { usePref } from '../lib/prefs';

interface Row { id: string; label: string; date: string; med: number | null; hc: number; renew: number | null }
interface Plot extends Row { x: number; yoy: number | null }

/** Hover marker for the median line: an accent dot with a soft halo. */
function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="var(--mantine-color-accent-6)" opacity={0.18} />
      <circle cx={cx} cy={cy} r={5} fill="var(--mantine-color-accent-6)" stroke="var(--mantine-color-body)" strokeWidth={2} />
    </g>
  );
}

function TrendTip({ active, payload }: {
  active?: boolean; payload?: { payload: Plot }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TipSurface>
      {/* The row's label, not Recharts' \`label\`: on a date axis that is the x value, a timestamp. */}
      <Text size="sm" fw={600}>{p.label}</Text>
      <Text size="sm">
        Median {usd(p.med)}{' '}
        {p.yoy != null && <Text span c={p.yoy >= 0 ? 'pos' : 'red'}>({p.yoy >= 0 ? '+' : ''}{pct(p.yoy)})</Text>}
      </Text>
      <Text size="xs" c="dimmed">
        {num(p.hc)} paid{p.renew != null ? ` · ${num(p.renew)} renewable` : ''}
      </Text>
    </TipSurface>
  );
}

export function TrendsPanel() {
  // Scopes this chart's <defs>. An SVG id is document-global, so a literal here would collide with
  // any second instance — see chartDefs.
  const gradId = useId();
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  const reduce = prefersReducedMotion();
  const [dollarMode, setDollarMode] = usePref<'nominal' | 'real'>('dollarMode', 'nominal');
  const [hcScale, setHcScale] = usePref<'linear' | 'log'>('scaleMode', 'linear');
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    // `renew` = paid employees on a renewable ("Regular") appointment — excludes Terminal and Temporary.
    // Appointment type is only recorded from the Sep 2025 dump on, so it's NULL (not 0) for older
    // snapshots, leaving those points off the line instead of plotting a misleading zero.
    // The median is over people (peopleSql); the counts stay over rows, where they already count people.
    `WITH pe AS (${peopleSql({ metric, where: whereAll(scope, filters), by: ['snapshot_id'] })}),
          m AS (SELECT snapshot_id, median(pay) FILTER (WHERE pay > 0) med FROM pe GROUP BY snapshot_id)
     SELECT snapshot_id id, any_value(snapshot_label) AS "label", any_value(snapshot_date) date,
        any_value(m.med) med, ${paidHeadcount(metric)} hc,
        CASE WHEN count(*) FILTER (WHERE employee_type IS NOT NULL) = 0 THEN NULL
             ELSE count(DISTINCT person_key) FILTER (WHERE ${expr} > 0 AND employee_type = 'Regular') END AS renew
     FROM salaries JOIN m USING (snapshot_id) WHERE ${whereAll(scope, filters)} GROUP BY snapshot_id ORDER BY date`
  );

  const plot = useMemo<Plot[]>(() => {
    const rows = data ?? [];
    return rows.map((r) => {
      if (dollarMode !== 'real' || r.med == null) return r;
      const year = Number(String(r.date).slice(0, 4)) || REAL_BASE_YEAR;
      return { ...r, med: toReal(r.med, year) };
    }).map((r, i, real) => {
      const prev = real[i - 1];
      const yoy = prev && prev.date !== r.date && prev.med != null && r.med != null && prev.med !== 0
        ? (r.med - prev.med) / prev.med
        : null;
      return { ...r, x: snapX(r.date, r.id), yoy };
    });
  }, [data, dollarMode]);
  const axis = useMemo(() => snapAxisProps(plot), [plot]);

  // The breaks that are not changes in pay or staff, from the one list every chart marks (snapTime's
  // KNOWN_BREAKS): the TTC relabel and the Sep 2025 change in 9-month reporting on the pay chart, the Oct
  // 2023 scope change on the headcount chart. The last used to be guessed as "the biggest headcount drop",
  // which in some divisions lands on a different step entirely.
  const inRange = (x: number) => plot.length > 1 && x >= plot[0].x && x <= plot[plot.length - 1].x;
  const ttc = knownBreak('ttc');
  const scope23 = knownBreak('scope2023');
  const nine = knownBreak('nineMonth2025');
  const ttcX = inRange(snapX(ttc.date, ttc.snapshotId)) ? snapX(ttc.date, ttc.snapshotId) : undefined;
  const coverageX = inRange(snapX(scope23.date, scope23.snapshotId)) ? snapX(scope23.date, scope23.snapshotId) : undefined;
  const nineX = inRange(snapX(nine.date, nine.snapshotId)) ? snapX(nine.date, nine.snapshotId) : undefined;

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <CardTitle
        right={
        <Group gap="sm" wrap="wrap">
          <SegmentedToggle
            value={dollarMode}
            onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
            options={[{ id: 'nominal', label: 'Nominal' }, { id: 'real', label: `${REAL_BASE_YEAR} $` }]}
          />
          <SegmentedToggle
            value={hcScale}
            onChange={(v) => setHcScale(v as 'linear' | 'log')}
            options={[{ id: 'linear', label: 'Linear' }, { id: 'log', label: 'Log' }]}
          />
        </Group>
        }
      >
        Median salary &amp; headcount over time
      </CardTitle>
      {/* Two stacked single-axis panels sharing an x-axis (syncId) instead of one dual-axis chart —
          a shared plot with two different y-scales makes the point where the lines cross meaningless.
          The median panel keeps the full rich tooltip (it reads hc/renew off the same `plot` rows even
          though those lines render below); the headcount panel suppresses its own tooltip and relies on
          the synced crosshair, matching the same convention as Person's trend+FTE stack. */}
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 28, bottom: 0 }}>
          <defs>{lineGlowDefs(gradId)}</defs>
          <CartesianGrid {...GRID} />
          <XAxis {...axis} tick={false} />
          <YAxis tickFormatter={fmtUsd} width={92} tick={AXIS_TICK} padding={Y_PAD}
            label={{ value: 'Median salary', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-accent-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip content={<TrendTip />} />

          {ttcX != null && <ReferenceLine x={ttcX} stroke="var(--mantine-color-accent-5)" strokeDasharray="3 3" />}
          {nineX != null && <ReferenceLine x={nineX} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" />}

          {/* Median: gradient area + soft-glow underlay + primary line. */}
          <Area type="monotone" dataKey="med" stroke="none" fill={`url(#${gradId}-area-grad)`} isAnimationActive={false} legendType="none" />
          <Line type="monotone" dataKey="med" stroke="var(--mantine-color-accent-6)" strokeWidth={6} strokeOpacity={0.4} dot={false} legendType="none" isAnimationActive={false} filter={`url(#${gradId}-line-glow)`} />
          <Line type="monotone" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot activeDot={<ActiveDot />} isAnimationActive={!reduce} animationDuration={800} animationEasing="ease-out" />

          {/* Change chips, drawn last so they sit above the area fill, placed together so none covers
              another where the date axis puts snapshots close. */}
          <Customized component={<YoyChips chipRows={plot} chipValueKey="med" chipYoyKey="yoy" chipAxis="0" chipBelow />} />
          {/* The TTC relabel's words and the reporting change's, placed together: on a phone they ran
              into one another. */}
          <Customized
            component={
              <BreakLabels
                marks={[
                  ...(ttcX != null ? [{ at: ttcX, texts: [ttc.label, ttc.short], fill: 'var(--mantine-color-accent-7)' }] : []),
                  ...(nineX != null ? [{ at: nineX, texts: [nine.label, nine.short] }] : []),
                ]}
              />
            }
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ height: 16 }} />

      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 16, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...axis} tick={AXIS_TICK} tickMargin={10} height={34} />
          <YAxis
            width={92}
            tick={AXIS_TICK}
            padding={Y_PAD}
            scale={hcScale === 'log' ? 'log' : 'auto'}
            domain={hcScale === 'log' ? [0.5, 'auto'] : undefined}
            allowDataOverflow={hcScale === 'log'}
            label={{ value: 'Headcount', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-pos-6)', fontSize: 12, textAnchor: 'middle' } }}
          />
          <Tooltip content={() => null} />
          <Legend />

          {coverageX != null && <ReferenceLine x={coverageX} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" />}
          {coverageX != null && <Customized component={<BreakLabel at={coverageX} texts={[scope23.label, scope23.short]} />} />}

          <Line type="monotone" dataKey="hc" name="Headcount" stroke="var(--mantine-color-pos-6)" strokeWidth={2} dot strokeDasharray="4 2" isAnimationActive={!reduce} />
          <Line type="monotone" dataKey="renew" name="Ongoing (renewable) appts" stroke="var(--mantine-color-orange-6)" strokeWidth={2} dot connectNulls={false} isAnimationActive={!reduce} />
        </ComposedChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        {dollarMode === 'real'
          ? `Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).`
          : 'Nominal dollars (not inflation-adjusted).'}{' '}
        Headcount = people with a paid appointment; unpaid $0 affiliate
        appointments are excluded. <b>Ongoing (renewable)</b> = staff on a continuing (&ldquo;Regular&rdquo;)
        appointment — excludes terminal and temporary ones; appointment type is only recorded from Sep 2025 on,
        so that line starts there. The dashed markers are changes in the data, not in pay or staff: at Oct 2023
        the source's coverage changed (some reports excluded students and trainees), so headcount across it
        partly reflects coverage, not hiring or leaving; from Sep 2025 9-month pay is reported ×11/9, which
        moves the median of a group with 9-month faculty.
      </Text>
      <ChartData
        caption={dollarMode === 'real' ? `Median salary, headcount & renewable staff over time (in ${REAL_BASE_YEAR} dollars)` : 'Median salary, headcount & renewable staff over time'}
        columns={['Snapshot', 'Median', 'YoY %', 'Headcount', 'Renewable']}
        rows={plot.map((d) => [d.label, d.med, d.yoy == null ? '' : pct(d.yoy), d.hc, d.renew])}
        unit="snapshots"
        period={spanLabel(plot.map((d) => d.label))}
      />
    </Card>
  );
}
