import { useMemo, useState } from 'react';
import { Stack, Card, Text, Skeleton, Group } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Cell, Line, XAxis, YAxis, Tooltip, CartesianGrid, Customized,
  ReferenceLine,
} from 'recharts';
import { BreakLabels } from './chart/BreakLabel';
import { AXIS_TICK, GRID, BAR_RADIUS, TIP_STYLE, TIP_LABEL_STYLE, fmtSnapTick, chartKeys, fmtCount } from '../lib/chartStyle';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { whereAll, filterKey } from '../lib/queries';
import { num, pct, spanLabel, fmtYears } from '../lib/format';
import { ChartData } from './ChartData';
import { StatCard, StatRow } from './StatCard';
import { ChartSkeleton } from './Loading';
import { SegmentedToggle } from './SegmentedToggle';
import { CardTitle } from './CardTitle';
import { TipSurface } from './chart/ChartTooltip';
import { MarkerLegend } from './markers';
import { chartAnim, useEntrance } from '../lib/motion';
import { knownBreak } from '../lib/snapTime';
import { useWidth } from '../lib/useWidth';
import { monthsBetween } from '../lib/cadence';

/** Hover card: capitalized "Retention" plus the underlying counts so the % is grounded. */
function RetentionTip({ active, payload, label }: {
  active?: boolean;
  label?: string;
  payload?: { payload: { retention: number; stayed: number; left: number; total: number; of: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>Hired {label}</Text>
      <Text size="sm">Retention: {d.retention}%</Text>
      <Text size="xs" c="dimmed">{num(d.stayed)} stayed · {num(d.left)} left · of {num(d.total)} {d.of}</Text>
    </TipSurface>
  );
}

/** Retention % is a magnitude (share retained), not a polarity — a sequential single-hue ramp reads it
 *  correctly, where a red→green diverging scale would misuse the reserved status colors and be a
 *  classic CVD-confusable pair. Five steps, light→dark, off the accent ramp. */
const RETENTION_RAMP = [
  'var(--mantine-color-accent-2)', 'var(--mantine-color-accent-4)', 'var(--mantine-color-accent-6)',
  'var(--mantine-color-accent-7)', 'var(--mantine-color-accent-9)',
];
const retColor = (r: number) => {
  const pct = Math.max(0, Math.min(100, r));
  const idx = Math.min(RETENTION_RAMP.length - 1, Math.floor(pct / (100 / RETENTION_RAMP.length)));
  return RETENTION_RAMP[idx];
};


/** The panel's three figures, named once for the loaded row and its placeholder. */
const FIGURES = ['Median tenure · current staff', 'Hired in the last 5 years', 'Left since the snapshot before'] as const;

export function CohortPanel() {
  const entrance = useEntrance();
  const { scope, filters } = useControls();
  const { data: summary } = useSummary();
  const latest = summary?.snapshots[summary.snapshots.length - 1];
  const where = whereAll(scope, filters);
  const scopeVal = scope.kind === 'school' ? scope.value : '';
  const [sortMode, setSortMode] = useState<'year' | 'retention'>('year');
  // Which cohorts: those seen from the day they were hired, or those already here when the data begins. Only
  // people employed at the first snapshot are known, so an earlier hire year counts its survivors alone, and
  // drawn beside the later ones as "the share of each hire year still here" it read as retention.
  const [cohort, setCohort] = useState<'hired' | 'here'>('hired');
  const first = summary?.snapshots.find((s) => !s.id.endsWith('-pre'));
  const firstYear = first ? Number(first.date.slice(0, 4)) : 2021;
  const firstMonth = first ? new Date(`${first.date}T00:00:00`).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : 'Nov 2021';
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  // The turnover chart's width: its tooltip may be no wider than the plot, which Recharts keeps it inside.
  const [turnRef, turnW] = useWidth<HTMLDivElement>();

  const { data, isFetching } = useSql<{ hire_year: number; total: number; still_here: number; first_n: number; first_still: number }>(
    ['cohort', scope.kind, scopeVal, latest?.id ?? '', first?.id ?? '', filterKey(filters)],
    // Each person once, in the year their latest record says they were hired: someone a changed hire date
    // had split in two (scripts/lib/identity) carries both years on their rows.
    `WITH latest AS (SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(latest?.id ?? '')} AND ${where}),
     first AS (SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(first?.id ?? '')} AND ${where}),
     hired AS (SELECT person_key, arg_max(hire_year, snapshot_date) hire_year FROM salaries WHERE hire_year IS NOT NULL AND ${where} GROUP BY person_key)
     SELECT h.hire_year hire_year, count(*) total, count(*) FILTER (WHERE l.person_key IS NOT NULL) still_here,
            count(*) FILTER (WHERE f.person_key IS NOT NULL) first_n,
            count(*) FILTER (WHERE f.person_key IS NOT NULL AND l.person_key IS NOT NULL) first_still
     FROM hired h LEFT JOIN latest l ON h.person_key = l.person_key LEFT JOIN first f ON h.person_key = f.person_key
     WHERE h.hire_year BETWEEN 1990 AND 2026
     GROUP BY h.hire_year ORDER BY h.hire_year`,
    !!latest
  );

  // Median tenure + recent-hire share of current staff (an honest "how settled is this workforce" read).
  const { data: tenureRows } = useSql<{ med: number | null; n: number; recent5: number }>(
    ['cohort-tenure', scope.kind, scopeVal, latest?.id ?? '', filterKey(filters)],
    `WITH pp AS (
        SELECT person_key, date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(latest?.id ?? '')} AND ${where} AND salary > 0 GROUP BY person_key)
     SELECT median(tenure) med, count(*) n, count(*) FILTER (WHERE tenure <= 5) recent5 FROM pp WHERE tenure >= 0`,
    !!latest
  );
  const t = tenureRows?.[0];

  // Turnover: paid staff joining vs leaving between consecutive snapshots (Pre-TTC duplicate excluded).
  const { data: flow, isFetching: flowFetching } = useSql<{ sid: string; lbl: string; dt: string; prev_dt: string; start_n: number; joined: number; departed: number }>(
    ['turnover', scope.kind, scopeVal, filterKey(filters)],
    `WITH ord AS (
        SELECT snapshot_id, any_value(snapshot_label) "label", any_value(snapshot_date) dt,
               dense_rank() OVER (ORDER BY any_value(snapshot_date), snapshot_id) rn
        FROM salaries WHERE ${where} AND snapshot_id NOT LIKE '%-pre' GROUP BY snapshot_id
     ),
     paid AS (
        SELECT DISTINCT o.rn, s.person_key FROM salaries s JOIN ord o ON s.snapshot_id = o.snapshot_id
        WHERE ${where} AND s.salary > 0
     ),
     flow AS (
        SELECT coalesce(c.rn, p.rn) rn,
               count(*) FILTER (WHERE p.person_key IS NULL) joined,
               count(*) FILTER (WHERE c.person_key IS NULL) departed
        FROM (SELECT rn, person_key FROM paid) c
        FULL OUTER JOIN (SELECT rn + 1 AS rn, person_key FROM paid) p
          ON c.rn = p.rn AND c.person_key = p.person_key
        GROUP BY coalesce(c.rn, p.rn)
     )
     SELECT o.snapshot_id sid, o."label" lbl, o.dt, o0.dt prev_dt, s0.n start_n, f.joined, f.departed
     FROM flow f JOIN ord o ON o.rn = f.rn JOIN ord o0 ON o0.rn = f.rn - 1
     JOIN (SELECT rn, count(*) n FROM paid GROUP BY rn) s0 ON s0.rn = f.rn - 1
     WHERE f.rn > 1 ORDER BY o.dt`,
    !!latest
  );

  const chart = useMemo(() => {
    // Hired after the first snapshot's year: every one of them seen from the start. Hired by then: those
    // here at the first snapshot, of whom the share here at the latest.
    const rows = (data ?? []).flatMap((r) => {
      const seen = cohort === 'hired' ? r.hire_year > firstYear : r.hire_year <= firstYear;
      const total = cohort === 'hired' ? r.total : r.first_n;
      const stayed = cohort === 'hired' ? r.still_here : r.first_still;
      if (!seen || !total) return [];
      const retention = Math.max(0, Math.min(100, Math.round((100 * stayed) / total)));
      return [{ year: String(r.hire_year), retention, lost: 100 - retention, stayed, left: total - stayed, total, of: cohort === 'hired' ? 'hired' : `here in ${firstMonth}` }];
    });
    return sortMode === 'retention' ? [...rows].sort((a, b) => b.retention - a.retention) : rows;
  }, [data, sortMode, cohort, firstYear, firstMonth]);

  // Steps run 4 to 14 months, so the chart plots each a month at a time (G15): drawn whole, the 14-month
  // Aug 2022 → Oct 2023 step's 4,857 joiners stood as a hiring surge. "Left" is also given as a share of the
  // staff at the start of the step, per month. The table keeps the step's own counts beside the rates.
  const turnover = useMemo(() => (flow ?? []).map((r) => {
    const months = Math.max(1, monthsBetween(String(r.prev_dt), String(r.dt)));
    const leftShare = r.start_n > 0 ? r.departed / r.start_n : null;
    const net = r.joined - r.departed;
    return {
      id: r.sid, label: r.lbl, joined: r.joined, departed: r.departed, net,
      joinedPM: r.joined / months, departedPM: r.departed / months, netPM: net / months,
      startN: r.start_n, months, leftShare, leftPerMonth: leftShare != null ? leftShare / months : null,
    };
  }), [flow]);
  // The Oct 2023 scope change (snapTime's KNOWN_BREAKS), when the source's coverage changed. It used to
  // be guessed as the step with the most churn, which in some divisions is another step entirely.
  const scope23 = knownBreak('scope2023');
  const lastStep = turnover[turnover.length - 1] ?? null;
  const coverageLabel = turnover.find((r) => r.id === scope23.snapshotId)?.label;

  if (isFetching && !data) {
    return (
      <Stack gap="lg">
        <StatRow cols={{ base: 1, sm: 3 }}>
          {FIGURES.map((label) => <StatCard key={label} size="sm" label={label} value={<Skeleton height={28} width={120} radius="sm" />} />)}
        </StatRow>
        <Card withBorder padding="lg"><ChartSkeleton height={300} /></Card>
        <Card withBorder padding="lg"><ChartSkeleton height={280} /></Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <StatRow cols={{ base: 1, sm: 3 }}>
        <StatCard size="sm" label={FIGURES[0]} value={fmtYears(t?.med)} />
        <StatCard size="sm" label={FIGURES[1]} value={t && t.n ? pct(t.recent5 / t.n) : '—'} sub={t ? `${num(t.recent5)} of ${num(t.n)}` : undefined} />
        {/* A rate, not a date range (D31): the tile said "2021 – 2026 · data begins Nov 2021", a figure of nothing.
            The latest step's leavers as a share of the staff at its start, from the turnover below. */}
        <StatCard size="sm" label={FIGURES[2]} className="left-latest"
          value={lastStep?.leftShare != null ? pct(lastStep.leftShare) : '—'}
          sub={lastStep ? `${num(lastStep.departed)} of the ${num(lastStep.startN)} paid then, gone by ${lastStep.label} (${lastStep.months} months)` : undefined} />
      </StatRow>

      <Card withBorder padding="lg">
        <CardTitle
          right={
            <Group gap="xs">
              <SegmentedToggle
                size="xs" value={cohort} onChange={(v) => setCohort(v as 'hired' | 'here')}
                options={[{ id: 'hired', label: `Hired since ${firstYear + 1}` }, { id: 'here', label: `Here in ${firstMonth}` }]}
              />
              <SegmentedToggle
                size="xs" value={sortMode} onChange={(v) => setSortMode(v as 'year' | 'retention')}
                options={[{ id: 'year', label: 'By year' }, { id: 'retention', label: 'By retention' }]}
              />
            </Group>
          }
          sub={cohort === 'hired'
            ? `Of each year's hires since ${firstYear + 1}, the share still here in ${latest?.label ?? 'the latest snapshot'}.`
            : `Of those here in ${firstMonth}, by the year they were hired, the share still here in ${latest?.label ?? 'the latest snapshot'}. Who left before ${firstMonth} is not in the data.`}
        >
          Retention by hire year
        </CardTitle>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart {...chartKeys('Retention by hire year')} data={chart} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            {/* Labels thin themselves to the width: a fixed every-third-year still ran together on a
                phone, and sorted by retention every bar was labelled. */}
            <XAxis dataKey="year" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={8} />
            <YAxis width={48} tick={AXIS_TICK} unit="%" domain={[0, 100]} />
            <Tooltip content={<RetentionTip />} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            <Bar
              {...chartAnim(!entrance)}
              dataKey="retention"
              name="Retained"
              fill="var(--mantine-color-accent-6)"
              stackId="r"
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              onMouseEnter={(_, i) => setHoveredYear(i)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              {chart.map((c, i) => (
                <Cell
                  key={i}
                  fill={sortMode === 'retention' ? retColor(c.retention) : 'var(--mantine-color-accent-6)'}
                  fillOpacity={hoveredYear != null && hoveredYear !== i ? 0.45 : 1}
                />
              ))}
            </Bar>
            <Bar
              {...chartAnim(!entrance)}
              dataKey="lost"
              name="Left"
              stackId="r"
              fill="var(--mantine-color-gray-4)"
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              radius={BAR_RADIUS}
              onMouseEnter={(_, i) => setHoveredYear(i)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              {chart.map((_, i) => <Cell key={i} fillOpacity={hoveredYear != null && hoveredYear !== i ? 0.45 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <MarkerLegend items={[
          { color: 'var(--mantine-color-accent-6)', label: 'Retained', bar: true },
          { color: 'var(--mantine-color-gray-4)', label: 'Left', bar: true },
        ]} />
        <ChartData
          caption="Retention by hire year"
          columns={['Hire year', 'Retained %', 'Left %']}
          rows={chart.map((c) => [c.year, c.retention, c.lost])}
          unit="hire-year cohorts"
          period={latest?.label ? `as of ${latest.label}` : undefined}
          about={<>
            Each bar is one hire-year cohort: teal = share still present in the latest snapshot ({latest?.label}),
            grey = share since gone. The data begins in {firstMonth}, so only people hired after it are seen from the
            start; "Here in {firstMonth}" follows those already employed then, by hire year. The most recent cohorts
            have had little time to leave.
          </>}
        />
      </Card>

      <Card withBorder padding="lg">
        <CardTitle sub="Paid staff joining vs. leaving, a month at a time: each step's count over the months it covers, since snapshots run 4 to 14 months apart.">Workforce turnover</CardTitle>
        {flowFetching && !flow ? (
          <ChartSkeleton height={280} />
        ) : (
          <>
            <div className="turnover" data-coverage-at={coverageLabel ?? ''} ref={turnRef}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart {...chartKeys('Workforce turnover')} data={turnover} margin={{ left: 12, right: 12, top: 18 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
                <YAxis width={56} tick={AXIS_TICK} tickFormatter={fmtCount} />
                {/* Recharts' own tooltip (TIP_STYLE), with the step's share in its label: those who left, as
                    a share of the staff at the start, and per month, since steps run 4 to 14 months. */}
                {/* Recharts hands the formatter each series' `name` ("Joined", "Left", "Net change"), not its
                    key — compared with the key, every row read "Net". The label wraps inside a box no
                    wider than the plot (the chart less its axis and margins), where Recharts can keep it:
                    on one line it ran 590px wide on a 375px screen. */}
                <Tooltip
                  formatter={(v: number, name) => [`${num(Math.round(v))} a month`, name]}
                  labelFormatter={(label, payload) => {
                    const d = payload?.[0]?.payload as (typeof turnover)[number] | undefined;
                    return d && d.leftShare != null && d.leftPerMonth != null
                      ? `${label} · over ${d.months} months, ${num(d.joined)} joined and ${num(d.departed)} left: ${pct(d.leftShare)} of the ${num(d.startN)} at the start (${pct(d.leftPerMonth, 2)} a month)`
                      : label;
                  }}
                  cursor={{ fill: 'var(--mantine-color-default-hover)' }}
                  wrapperStyle={{ maxWidth: turnW ? Math.min(300, turnW - 96) : 300 }}
                  contentStyle={{ ...TIP_STYLE, whiteSpace: 'normal' }}
                  labelStyle={TIP_LABEL_STYLE}
                />
                {coverageLabel && (
                  <ReferenceLine x={coverageLabel} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" className="coverage-marker" />
                )}
                {/* Its words above the plot, as on Trends: inside it, they sat on the y-axis's top tick. */}
                {coverageLabel && <Customized component={<BreakLabels marks={[{ at: coverageLabel, texts: [scope23.label, scope23.short] }]} />} />}
                <ReferenceLine y={0} stroke="var(--mantine-color-default-border)" />
                <Bar
                  {...chartAnim(!entrance)}
                  dataKey="joinedPM"
                  name="Joined"
                  fill="var(--mark-up)"
                  radius={BAR_RADIUS}
                  onMouseEnter={(_, i) => setHoveredFlow(i)}
                  onMouseLeave={() => setHoveredFlow(null)}
                >
                  {turnover.map((_, i) => <Cell key={i} fillOpacity={hoveredFlow != null && hoveredFlow !== i ? 0.45 : 1} />)}
                </Bar>
                <Bar
                  {...chartAnim(!entrance)}
                  dataKey="departedPM"
                  name="Left"
                  fill="var(--mark-down)"
                  radius={BAR_RADIUS}
                  onMouseEnter={(_, i) => setHoveredFlow(i)}
                  onMouseLeave={() => setHoveredFlow(null)}
                >
                  {turnover.map((_, i) => <Cell key={i} fillOpacity={hoveredFlow != null && hoveredFlow !== i ? 0.45 : 1} />)}
                </Bar>
                <Line type="linear" dataKey="netPM" name="Net change" stroke="var(--mantine-color-text)" strokeWidth={2} dot {...chartAnim(!entrance)} />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
            <MarkerLegend items={[
              { color: 'var(--mark-up)', label: 'Joined', bar: true },
              { color: 'var(--mark-down)', label: 'Left', bar: true },
              { color: 'var(--mantine-color-text)', label: 'Net change' },
            ]} />
            <ChartData
              caption="Workforce turnover"
              columns={['As of', 'Months', 'Joined', 'Left', 'Net', 'Joined a month', 'Left a month', 'Net a month', 'Staff at start', 'Left, % of staff at start', 'Left, % a month']}
              rows={turnover.map((x) => [x.label, x.months, x.joined, x.departed, x.net, Math.round(x.joinedPM), Math.round(x.departedPM),
                Math.round(x.netPM), x.startN, x.leftShare != null ? pct(x.leftShare) : null, x.leftPerMonth != null ? pct(x.leftPerMonth, 2) : null])}
              unit="snapshot steps"
              period={spanLabel(turnover.map((x) => x.label))}
              about={<>
                Paid employees who joined vs left between each snapshot and the one before it, and the net change,
                each divided by the months the step covers: snapshots run 4 to 14 months apart, so a step's raw count
                says as much about its length as about hiring. The table gives both.
                Counts paid staff only (unpaid $0 affiliates excluded); the duplicate Pre-TTC snapshot is
                omitted. The dashed marker is Oct 2023, when the source's coverage changed (some reports excluded
                students and trainees): joiners and leavers across it partly reflect coverage, not hiring or
                attrition. The tooltip and the table also give those who left as a share of the staff at the start
                of each step, and that share per month.
              </>}
            />
          </>
        )}
      </Card>
    </Stack>
  );
}
