import { useMemo, useState } from 'react';
import { Card, Text, Loader, Group } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine, ReferenceArea, Customized,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, fmtUsd, chartKeys, fmtCount, CHART_SERIES } from '../lib/chartStyle';
import { snapX, snapAxisProps, knownBreak } from '../lib/snapTime';
import { BreakLabel, BreakLabels } from './chart/BreakLabel';
import { TipSurface } from './chart/ChartTooltip';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSql, useSummary } from '../lib/hooks';
import { salaryExpr, paidHeadcount, peopleSql, whereAll, filterKey, PRIOR_FOOTING, growthBetween, mainOf } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { CATEGORY_SPELLINGS } from '../lib/timeline';
import { usd, num, pct, spanLabel } from '../lib/format';
import { chartAnim, useEntrance } from '../lib/motion';
import { ChartData } from './ChartData';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { SegmentedToggle } from './SegmentedToggle';
import { CardTitle } from './CardTitle';
import { YoyChips } from './chart/pills';
import { EndLabels } from './chart/EndLabels';
import { usePref } from '../lib/prefs';
import { useDollarMode } from '../lib/dollars';
import { RealBadge } from '../components/RealBadge';
import { usePeriod } from '../lib/period';
import { makeSnapshotComparator } from '../lib/snapshotOrder';

interface Row { id: string; label: string; date: string; med: number | null; med_prior: number | null; p10: number | null; p90: number | null; hc: number; renew: number | null }
interface Plot extends Row {
  x: number; yoy: number | null; band: [number, number] | null; [cat: `c${number}`]: number | null;
  /** The row in dollars, whatever the chart shows: the table under it gives these. */
  dollars: { med: number | null; p10: number | null; p90: number | null; cats: (number | null)[] };
}

/** The employee categories drawn one line each (D19), named as the latest release names them. University Staff
 *  and some trainees appear only as codes before Apr 2024 (CP, CL, ET…), which no public source defines and
 *  which are never merged on a guess (lib/timeline), so their lines start there. */
const CATS = ['Faculty', 'Academic Staff', 'University Staff', 'Employees in Training', 'Limited'] as const;

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

function TrendTip({ active, payload, byCat = false, index = false }: {
  active?: boolean; payload?: { payload: Plot }[]; byCat?: boolean; index?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const fmt = (v: number | null) => (v == null ? '—' : index ? String(Math.round(v)) : usd(v));
  return (
    <TipSurface>
      {/* The row's label, not Recharts' \`label\`: on a date axis that is the x value, a timestamp. */}
      <Text size="sm" fw={600}>{p.label}</Text>
      {byCat ? CATS.map((c, i) => p[`c${i}`] != null && (
        <Text key={c} size="xs"><Text span c={CHART_SERIES[i]} fw={700}>■</Text> {c} {fmt(p[`c${i}`])}</Text>
      )) : (
        <Text size="sm">
          Median {fmt(p.med)}{' '}
          {p.yoy != null && <Text span c={p.yoy >= 0 ? 'up' : 'down'}>({p.yoy >= 0 ? '+' : ''}{pct(p.yoy)})</Text>}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {num(p.hc)} paid{p.renew != null ? ` · ${num(p.renew)} renewable` : ''}
      </Text>
    </TipSurface>
  );
}

export function TrendsPanel() {
  // Scopes this chart's <defs>. An SVG id is document-global, so a literal here would collide with
  // any second instance — see chartDefs.
  const { scope, metric, filters } = useControls();
  const expr = salaryExpr(metric);
  /** The plotted figure, named for the measure in force (G2). */
  const med = `Median ${METRIC_LABEL[metric].toLowerCase()}`;
  const entrance = useEntrance();
  // The dollars are the page's (the control bar's Nominal / 2026 $, D2): this tab had a toggle of its own too.
  const [dollarMode] = useDollarMode();
  const { from: periodFrom, to: periodTo } = usePeriod();
  // Dollars, or each line as an index of its own first snapshot (D17, D18): from a $0 baseline a +25% median read
  // flat, and the Log scale offered for one line added nothing. The axis stays at $0 in dollars, as every pay
  // line in the app does; the index is where the shape reads.
  const [view, setView] = usePref<'dollars' | 'index'>('trendView', 'dollars');
  // All UW's median with its 10th–90th band, or a line for each employee category (D19).
  const [lines, setLines] = useState<'all' | 'cats'>('all');
  const byCat = lines === 'cats';
  const index = view === 'index';
  const { data, isFetching } = useSql<Row>(
    ['trend', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    // `renew` = paid employees on a renewable ("Regular") appointment — excludes Terminal and Temporary.
    // Appointment type is only recorded from the Sep 2025 dump on, so it's NULL (not 0) for older
    // snapshots, leaving those points off the line instead of plotting a misleading zero.
    // The median is over people (peopleSql); the counts stay over rows, where they already count people.
    // `med_prior`: the median with every reporting change undone (`PRIOR_FOOTING`), so the step across one is
    // like for like.
    `WITH pe AS (${peopleSql({ metric, where: whereAll(scope, filters), by: ['snapshot_id'] })}),
          po AS (${peopleSql({ metric, where: whereAll(scope, filters), by: ['snapshot_id'], from: PRIOR_FOOTING })}),
          m AS (SELECT snapshot_id, median(pay) FILTER (WHERE pay > 0) med, quantile_cont(pay, 0.1) FILTER (WHERE pay > 0) p10,
                       quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90 FROM pe GROUP BY snapshot_id),
          mp AS (SELECT snapshot_id, median(pay) FILTER (WHERE pay > 0) med_prior FROM po GROUP BY snapshot_id)
     SELECT snapshot_id id, any_value(snapshot_label) AS "label", CAST(any_value(snapshot_date) AS VARCHAR) date,
        any_value(m.med) med, any_value(mp.med_prior) med_prior, any_value(m.p10) p10, any_value(m.p90) p90, ${paidHeadcount(metric)} hc,
        CASE WHEN count(*) FILTER (WHERE employee_type IS NOT NULL) = 0 THEN NULL
             ELSE count(DISTINCT person_key) FILTER (WHERE ${expr} > 0 AND employee_type = 'Regular') END AS renew
     FROM salaries JOIN m USING (snapshot_id) LEFT JOIN mp USING (snapshot_id) WHERE ${whereAll(scope, filters)} GROUP BY snapshot_id ORDER BY date`
  );

  // Each category's median per snapshot, by each person's main appointment, its spellings folded into the latest's.
  const fold = `CASE c ${Object.entries(CATEGORY_SPELLINGS).map(([a, b]) => `WHEN ${sqlStr(a)} THEN ${sqlStr(b)}`).join(' ')} ELSE c END`;
  const { data: catRows } = useSql<{ id: string; cat: string; med: number | null }>(
    ['trend-cats', scope.kind, scope.kind === 'school' ? scope.value : '', metric, filterKey(filters)],
    `WITH pe AS (${peopleSql({ metric, where: whereAll(scope, filters), by: ['snapshot_id'], extra: `${mainOf('employee_category')} c` })})
     SELECT snapshot_id id, ${fold} cat, median(pay) FILTER (WHERE pay > 0) med FROM pe WHERE c IS NOT NULL GROUP BY 1, 2`,
    byCat
  );

  const { data: summary } = useSummary();
  const plot = useMemo<Plot[]>(() => {
    // In the snapshots' own order: by date alone, Nov 2021's two twins (one date) came in whatever order the
    // query returned them, and the table listed Post-TTC before Pre-TTC.
    const rows = [...(data ?? [])].sort(makeSnapshotComparator(summary?.snapshots));
    const cats = new Map<string, Record<string, number | null>>();
    for (const r of catRows ?? []) {
      const i = (CATS as readonly string[]).indexOf(r.cat);
      if (i >= 0) cats.set(r.id, { ...(cats.get(r.id) ?? {}), [`c${i}`]: r.med });
    }
    const real = rows.map((r) => {
      const year = Number(String(r.date).slice(0, 4)) || REAL_BASE_YEAR;
      const k = (v: number | null | undefined) => (v == null ? null : dollarMode === 'real' ? toReal(v, year) : v);
      const c = cats.get(r.id) ?? {};
      return {
        ...r, med: k(r.med), med_prior: k(r.med_prior), p10: k(r.p10), p90: k(r.p90),
        ...Object.fromEntries(CATS.map((_, i) => [`c${i}`, k(c[`c${i}`])])),
      } as Row & Record<`c${number}`, number | null>;
    });
    // Each line over its own first snapshot, × 100; the band over the median's.
    const base = (key: string) => real.find((r) => (r as unknown as Record<string, number | null>)[key] != null) as unknown as Record<string, number> | undefined;
    const by = (key: string, v: number | null, of = key) => {
      if (!index || v == null) return v;
      const b = base(of)?.[of];
      return b ? (v / b) * 100 : null;
    };
    return real.map((r, i) => {
      const prev = real[i - 1];
      // Across a reporting change, like for like (queries `growthBetween`): the Sep 2025 step was +17.6% for
      // Faculty as reported, nearly all of it how 9-month pay is reported.
      const yoy = prev && prev.date !== r.date && prev.med != null && r.med != null && prev.med !== 0
        ? growthBetween({ date: prev.date, value: prev.med }, { date: r.date, value: r.med, prior: r.med_prior }).growth
        : null;
      const p10 = by('p10', r.p10, 'med'), p90 = by('p90', r.p90, 'med');
      return {
        ...r, med: by('med', r.med), p10, p90, band: p10 != null && p90 != null ? [p10, p90] as [number, number] : null,
        ...Object.fromEntries(CATS.map((_, k) => [`c${k}`, by(`c${k}`, r[`c${k}`])])),
        x: snapX(r.date, r.id), yoy,
        dollars: { med: r.med, p10: r.p10, p90: r.p90, cats: CATS.map((_, k) => r[`c${k}`]) },
      } as Plot;
    });
  }, [data, catRows, dollarMode, summary, index]);
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

  const periodX = periodFrom && periodTo && plot.length > 1
    ? [snapX(periodFrom.date, periodFrom.id), snapX(periodTo.date, periodTo.id)] as const
    : null;

  if (isFetching && !data) return <Loader />;

  return (
    <Card withBorder padding="lg">
      <CardTitle
        right={
        <Group gap="sm" wrap="wrap">
          <SegmentedToggle
            ariaLabel="Lines"
            value={lines}
            onChange={(v) => setLines(v as 'all' | 'cats')}
            options={[{ id: 'all', label: 'Median and spread' }, { id: 'cats', label: 'By category' }]}
          />
          <SegmentedToggle
            ariaLabel="Scale"
            value={view}
            onChange={(v) => setView(v as 'dollars' | 'index')}
            options={[{ id: 'dollars', label: 'Dollars' }, { id: 'index', label: 'Index' }]}
          />
        </Group>
        }
      >
        {med} and headcount over time{dollarMode === 'real' && <> <RealBadge /></>}
      </CardTitle>
      {/* Two stacked single-axis panels sharing an x-axis (syncId) instead of one dual-axis chart —
          a shared plot with two different y-scales makes the point where the lines cross meaningless.
          The median panel keeps the full rich tooltip (it reads hc/renew off the same `plot` rows even
          though those lines render below); the headcount panel suppresses its own tooltip and relies on
          the synced crosshair, matching the same convention as Person's trend+FTE stack. */}
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart {...chartKeys(`${med} over time`)} data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 32, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...axis} tick={false} />
          <YAxis tickFormatter={index ? (v: number) => String(Math.round(v)) : fmtUsd} width={92} tick={AXIS_TICK} padding={Y_PAD}
            domain={index ? ['auto', 'auto'] : undefined}
            label={{ value: index ? `Index, ${plot[0]?.label ?? 'first'} = 100` : med, angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-accent-6)', fontSize: 12, textAnchor: 'middle' } }} />
          <Tooltip content={<TrendTip byCat={byCat} index={index} />} />

          {/* The page's period, shaded (D1): every snapshot is drawn, the period the figures and Changes read marked. */}
          {periodX && (
            // The accent's tint, not the band's grey: the 10th–90th band is grey, and the two ran into each other.
            <ReferenceArea x1={periodX[0]} x2={periodX[1]} fill="var(--tint-accent)" fillOpacity={0.8} stroke="none" ifOverflow="hidden" className="trend-period" />
          )}
          {ttcX != null && <ReferenceLine x={ttcX} stroke="var(--mantine-color-accent-5)" strokeDasharray="3 3" />}
          {nineX != null && <ReferenceLine x={nineX} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" />}

          {/* The median with its 10th–90th band, the spread a single line hid; or a line for each category. */}
          {!byCat && <Area type="linear" dataKey="band" stroke="none" fill="var(--band-fill)" fillOpacity={1} isAnimationActive={false} legendType="none" className="trend-p10-band" connectNulls={false} />}
          {!byCat && <Line type="linear" dataKey="med" name="Median" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot activeDot={<ActiveDot />} {...chartAnim(!entrance)} />}
          {byCat && CATS.map((c, i) => (
            <Line key={c} type="linear" dataKey={`c${i}`} name={c} stroke={CHART_SERIES[i]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false}
              className={`trend-cat trend-cat-${i}`} {...chartAnim(!entrance)} />
          ))}
          {byCat && (
            <Customized component={<EndLabels endSeries={CATS.map((c, i) => ({ key: `c${i}`, text: c, color: CHART_SERIES[i] }))} />} />
          )}

          {/* Change chips, drawn last so they sit above the band, placed together so none covers
              another where the date axis puts snapshots close. On the median alone. */}
          {!byCat && <Customized component={<YoyChips chipRows={plot} chipValueKey="med" chipYoyKey="yoy" chipAxis="0" chipBelow />} />}
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

      {/* Taller (D17): at 70px its ticks were "0 12000 24000". */}
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={plot} syncId="explore-trend" margin={{ left: 12, right: 16, top: 16, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis {...axis} tick={AXIS_TICK} tickMargin={10} height={34} />
          <YAxis tickFormatter={fmtCount}
            width={92}
            tick={AXIS_TICK}
            padding={Y_PAD}
            label={{ value: 'Headcount', angle: -90, position: 'insideLeft', style: { fill: 'var(--mantine-color-dimmed)', fontSize: 12, textAnchor: 'middle' } }}
          />
          <Tooltip content={() => null} />

          {coverageX != null && <ReferenceLine x={coverageX} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" />}
          {coverageX != null && <Customized component={<BreakLabel at={coverageX} texts={[scope23.label, scope23.short]} />} />}

          {/* Two counts, not a direction or this page's subject: the ink and the guide grey, told apart by their
              lightness and named at their ends. Neither is dashed — a dash on these charts is a reference line. */}
          <Line type="linear" dataKey="hc" name="Headcount" stroke="var(--mantine-color-text)" strokeWidth={2} dot {...chartAnim(!entrance)} />
          <Line type="linear" dataKey="renew" name="Ongoing (renewable) appts" stroke="var(--guide-strong)" strokeWidth={2} dot connectNulls={false} {...chartAnim(!entrance)} />
          <Customized
            component={
              <EndLabels
                endSeries={[
                  { key: 'hc', text: 'Headcount', color: 'var(--mantine-color-text)' },
                  { key: 'renew', text: 'Ongoing (renewable) appts', color: 'var(--mantine-color-dimmed)' },
                ]}
                endBreaks={coverageX != null ? [{ at: coverageX, texts: [scope23.label, scope23.short] }] : []}
              />
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Text size="xs" c="dimmed" mt={4}>
        {dollarMode === 'real'
          ? `Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).`
          : 'Nominal dollars (not inflation-adjusted).'}
        {periodFrom && periodTo ? ` Shaded: ${periodFrom.label} → ${periodTo.label}, the page's period.` : ''}
        {!byCat ? ' The band: the middle 80% of pay, the 10th to the 90th percentile.' : ''}
        {index ? ' Index: each line over its own first snapshot, × 100.' : ''}
      </Text>
      {/* Where the second line starts, said (D20): it first appeared at Sep '25 with no word why. */}
      <Text size="xs" c="dimmed" className="renew-note">
        Ongoing (renewable) appointments are reported from Sep 2025, so that line starts there.
        {byCat ? ' University Staff and some trainees appear only as codes before Apr 2024, so their lines start there.' : ''}
      </Text>
      <ChartData
        caption={dollarMode === 'real' ? `${med}, headcount & renewable staff over time (in ${REAL_BASE_YEAR} dollars)` : `${med}, headcount & renewable staff over time`}
        columns={['Snapshot', med, 'Change vs previous snapshot', 'Headcount', 'Renewable', '10th percentile', '90th percentile', ...(byCat ? CATS : [])]}
        rows={plot.map((d) => [d.label, d.dollars.med, d.yoy == null ? '' : pct(d.yoy), d.hc, d.renew, d.dollars.p10, d.dollars.p90, ...(byCat ? d.dollars.cats : [])])}
        unit="snapshots"
        period={spanLabel(plot.map((d) => d.label))}
        about={<>
          Headcount = people with a paid appointment; unpaid $0 affiliate appointments are excluded.{' '}
          <b>Ongoing (renewable)</b> = staff on a continuing (&ldquo;Regular&rdquo;) appointment — excludes terminal
          and temporary ones; appointment type is only recorded from Sep 2025 on, so that line starts there. The
          dashed markers are changes in the data, not in pay or staff: at Oct 2023 the source's coverage changed
          (some reports excluded students and trainees), so headcount across it partly reflects coverage, not
          hiring or leaving; from Sep 2025 9-month pay is reported ×11/9, which moves the median of a group with
          9-month faculty. The change across that step is given like for like, the ×11/9 taken out.
        </>}
      />
    </Card>
  );
}
