import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Stack, Title, Text, Card, Table, Loader, Group, Pill, Button, ThemeIcon } from '@mantine/core';
import { IconArrowsDiff } from '@tabler/icons-react';
import {
  ResponsiveContainer, LineChart, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, TIP_STYLE, fmtUsd, fmtK, niceCurrencyTicks, CHART_SERIES } from '../lib/chartStyle';
import { withSnapX, snapAxisProps, snapX, reportingBreaks } from '../lib/snapTime';
import { PageHeader } from '../components/PageHeader';
import { CardTitle } from '../components/CardTitle';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { Eyebrow } from '../components/Eyebrow';
import { useTray, type TrayItem } from '../state/tray';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { makeSnapshotComparator } from '../lib/snapshotOrder';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay, peopleSql, continuingRaisesSql } from '../lib/queries';
import { usd, num, pct, spanLabel } from '../lib/format';
import { ordinal } from '../lib/stats';
import { ChartData } from '../components/ChartData';
import { ChartTooltip } from '../components/chart/ChartTooltip';
import { SvgPill } from '../components/chart/pills';
import { useDocTitle } from '../lib/useDocTitle';
import { usePref } from '../lib/prefs';
import { SearchBox } from '../components/SearchBox';
import { ControlBar } from '../app/ControlBar';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { encodeSel, decodeSel } from '../lib/share';
import { chartAnim, MOTION, prefersReducedMotion } from '../lib/motion';
import { focusControl } from '../components/EmptyState';
import { Sparkline } from '../components/chart/Sparkline';
import { cadenceOf, type CadencePoint } from '../lib/cadence';

interface PRow { person_key: string; label: string; date: string; pay: number; tenure: number | null }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface TStatRow { job_code: string; headcount: number; med: number | null; p25: number | null; p75: number | null; p90: number | null }
interface TTrendRow { job_code: string; label: string; date: string; med: number }
interface CadRow { person_key: string; id: string; date: string; pay: number | null; appts: number; job_code: string | null; grade: number | null; grade_basis: string | null; basis: string | null }

interface TooltipPayloadItem {
  /** 'none' for a series that stays out of the tooltip (the gap chart's shading). */
  type?: string;
  color?: string;
  stroke?: string;
  dataKey?: string | number;
  value?: string | number | Array<string | number>;
}

/** Builds ChartTooltip rows from a Recharts tooltip payload — one series-value line per item, using
 *  `labels` to resolve each dataKey (a person/title id) back to its display name. Every series here is
 *  a plain Line (never a range/area value), so `value` is always a scalar at runtime — the array case
 *  only exists to satisfy Recharts' generic payload type. */
function seriesRows(payload: TooltipPayloadItem[] | undefined, labels: Map<string, string>, fmt: (v: number) => ReactNode) {
  return (payload ?? []).map((p) => ({
    color: p.color ?? p.stroke,
    name: labels.get(String(p.dataKey)) ?? String(p.dataKey ?? ''),
    value: fmt(Number(Array.isArray(p.value) ? p.value[0] : p.value)),
  }));
}

/** The snapshot a tooltip is over, from its row. Recharts' own \`label\` is the x value, which on a date
 *  axis is a timestamp. */
function rowLabel(payload: readonly { payload?: unknown }[] | undefined): string | undefined {
  const row = payload?.[0]?.payload as { label?: unknown } | undefined;
  return row?.label != null ? String(row.label) : undefined;
}

/** Direct end-of-line label on a person's final point — only the last point renders (recharts calls
 *  this once per data point via the Line's `label` prop). With this, identity on the trajectory chart
 *  is never color-alone: the legend chips below already name each color, and now so does the chart. */
function TrajectoryEndLabel({ x, y, index, count, name, color }: {
  x?: number; y?: number; index?: number; count: number; name: string; color: string;
}) {
  if (x == null || y == null || index !== count - 1) return null;
  return <SvgPill x={x + 8 + name.length * 3 + 4} y={y} text={name} color={color} fontWeight={600} />;
}

export default function Compare() {
  /** The add box's card, so the empty state below can put the cursor in it. */
  const addBlocksRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = prefersReducedMotion();
  useDocTitle('Compare');
  const nav = useNavigate();
  const { items, add, remove, clear } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const [xMode, setXMode] = useState<'date' | 'tenure'>('date');
  const [dollarMode, setDollarMode] = usePref<'nominal' | 'real'>('dollarMode', 'nominal');
  // Legend mute/solo: a click dims one series (state only — the tray itself is untouched); shift-click
  // solos it (mutes everyone else), or un-solos back to "all visible" if it's already the lone survivor.
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  // Hover emphasis: a legend chip or a cadence row under the pointer thickens that series on every
  // chart. Nothing else changes — dimming stays on click and shift-click (mute and solo), where it is
  // asked for; a hover that faded everyone else was more than a pointer passing over should do.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lineWidth = (id: string) => (hoverId === id ? 3 : 2);
  const toggleMute = (id: string, allIds: string[], solo: boolean) => {
    setMutedIds((prev) => {
      if (solo) {
        const others = allIds.filter((x) => x !== id);
        const alreadySolo = others.length > 0 && others.every((x) => prev.has(x)) && !prev.has(id);
        return alreadySolo ? new Set() : new Set(others);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Canonical snapshot order (from summary.json) so every pivoted series here sorts identically —
  // otherwise the two same-dated Nov 2021 (Pre/Post-TTC) snapshots can land in a different order per
  // chart, since each chart's own SQL query breaks that date tie in its own row order.
  const { data: summary } = useSummary();
  const cmpSnap = useMemo(() => makeSnapshotComparator(summary?.snapshots), [summary]);

  // Shareable comparisons: a `?sel=` link hydrates the tray on first load (replacing whatever's
  // there — the recipient should see exactly what was shared), then every tray change keeps `?sel=`
  // in sync so the page's existing "Copy link" button (ControlBar) always captures the current set.
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedFromUrl = useRef(false);
  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const decoded = decodeSel(searchParams.get('sel'));
    if (!decoded?.length) return;
    clear();
    decoded.forEach((i) => add(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (items.length) next.set('sel', encodeSel(items));
        else next.delete('sel');
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const persons = items.filter((i) => i.type === 'person');
  const schools = items.filter((i) => i.type === 'school');
  const titles = items.filter((i) => i.type === 'title');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');
  const titleCodes = titles.map((t) => sqlStr(t.id)).join(',');

  const { data: pdata, isFetching: pLoading } = useSql<PRow>(
    ['cmp-people', personIds, metric],
    `SELECT person_key, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    persons.length > 0
  );

  const { data: sdata, isFetching: sLoading } = useSql<SRow>(
    ['cmp-schools', schoolNames, snap ?? '', metric],
    `WITH pe AS (${peopleSql({ metric, where: `snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames})`, by: ['school'], extra: `sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) earn` })})
     SELECT school, count(*) FILTER (WHERE pay > 0) headcount,
        sum(earn) payroll,
        median(pay) FILTER (WHERE pay > 0) med,
        quantile_cont(pay, 0.90) FILTER (WHERE pay > 0) p90
     FROM pe GROUP BY school`,
    schools.length > 0 && !!snap
  );

  // Titles — side-by-side (current snapshot), per-person salary sums within each title.
  const { data: tdata, isFetching: tLoading } = useSql<TStatRow>(
    ['cmp-titles', titleCodes, snap ?? '', metric],
    `WITH pp AS (SELECT person_key, job_code, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IN (${titleCodes}) GROUP BY person_key, job_code)
     SELECT job_code, count(*) headcount, median(pay) med,
        quantile_cont(pay, 0.25) p25, quantile_cont(pay, 0.75) p75, quantile_cont(pay, 0.90) p90
     FROM pp WHERE pay > 0 GROUP BY job_code`,
    titles.length > 0 && !!snap
  );

  // Titles — median salary over time.
  const { data: ttrend } = useSql<TTrendRow>(
    ['cmp-title-trend', titleCodes, metric],
    `WITH pp AS (SELECT snapshot_id, job_code, person_key,
          any_value(snapshot_label) AS lbl, any_value(snapshot_date) AS dt, ${personPay(metric)} pay
        FROM salaries WHERE job_code IN (${titleCodes}) AND ${expr} > 0
        GROUP BY snapshot_id, job_code, person_key)
     SELECT job_code, any_value(lbl) AS "label", any_value(dt) date, median(pay) med
     FROM pp GROUP BY snapshot_id, job_code ORDER BY date`,
    titles.length > 0
  );

  const { data: standingData } = useSql<{ person_key: string; label: string; date: string; pctile: number }>(
    ['cmp-standing', personIds, metric],
    `WITH pop AS (SELECT snapshot_id, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, school, person_key, ${personPay(metric)} pay
                  FROM salaries WHERE ${expr} > 0 GROUP BY snapshot_id, school, person_key),
          ranked AS (SELECT *, percent_rank() OVER (PARTITION BY snapshot_id, school ORDER BY pay) pr FROM pop)
     SELECT person_key, label, date, round(pr * 100) pctile FROM ranked WHERE person_key IN (${personIds}) ORDER BY date`,
    persons.length > 0
  );

  // Raise cadence, by the site's rules: continuing raises (R2), promotions and title changes by grade
  // within one pay schedule (R3), the Sep 2025 reporting change never a raise, and months by date.
  const { data: cadRows } = useSql<CadRow>(
    ['cmp-cadence', personIds, metric],
    `SELECT person_key, snapshot_id id, any_value(snapshot_date) date, ${personPay(metric)} pay,
        count(*) FILTER (WHERE salary > 0) appts,
        first(job_code ORDER BY coalesce(fte, 0) DESC, salary DESC) job_code,
        first(grade_number ORDER BY coalesce(fte, 0) DESC, salary DESC) grade,
        first(grade_basis ORDER BY coalesce(fte, 0) DESC, salary DESC) grade_basis,
        first(comp_basis ORDER BY coalesce(fte, 0) DESC, salary DESC) basis
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id`,
    persons.length > 0
  );
  const { data: contRows } = useSql<{ person_key: string; to_id: string; r: number }>(
    ['cmp-continuing', personIds, metric],
    `SELECT person_key, to_id, r FROM (${continuingRaisesSql({ metric, where: `person_key IN (${personIds})` })})`,
    persons.length > 0
  );

  const labelMap = useMemo(() => new Map(persons.map((p) => [p.id, p.label])), [persons]);
  const titleLabelMap = useMemo(() => new Map(titles.map((t) => [t.id, t.label])), [titles]);

  const standingSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of standingData ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pctile;
      byLabel.set(r.label, row);
    }
    return withSnapX([...byLabel.values()].sort(cmpSnap));
  }, [standingData, cmpSnap]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { label: string; date: string; pay: number; tenure: number | null }[]>();
    for (const r of pdata ?? []) {
      const arr = m.get(r.person_key) ?? [];
      arr.push({ label: r.label, date: r.date, pay: r.pay, tenure: r.tenure });
      m.set(r.person_key, arr);
    }
    for (const arr of m.values()) arr.sort(cmpSnap);
    return m;
  }, [pdata, cmpSnap]);

  const { series, latest } = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    const latestByPerson = new Map<string, number>();
    for (const r of pdata ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pay;
      byLabel.set(r.label, row);
      latestByPerson.set(r.person_key, r.pay);
    }
    const series = withSnapX([...byLabel.values()].sort(cmpSnap));
    return { series, latest: latestByPerson };
  }, [pdata, cmpSnap]);

  // Real-dollar view of the trajectory chart only (gap/standing/cadence stay nominal — those are
  // separate cards without their own toggle). Each point converts using its own snapshot year.
  const trajectorySeries = useMemo(() => {
    if (dollarMode !== 'real') return series;
    return series.map((row) => {
      const year = Number(String(row.date).slice(0, 4)) || REAL_BASE_YEAR;
      const out: Record<string, string | number> = { label: row.label, date: row.date, x: row.x };
      for (const p of persons) {
        const v = row[p.id];
        if (typeof v === 'number') out[p.id] = toReal(v, year);
      }
      return out;
    });
  }, [series, dollarMode, persons]);
  const perPersonDisplay = useMemo(() => {
    if (dollarMode !== 'real') return perPerson;
    const m = new Map<string, { label: string; date: string; pay: number; tenure: number | null }[]>();
    for (const [id, arr] of perPerson) {
      m.set(id, arr.map((x) => ({ ...x, pay: x.pay > 0 ? toReal(x.pay, Number(String(x.date).slice(0, 4)) || REAL_BASE_YEAR) : x.pay })));
    }
    return m;
  }, [perPerson, dollarMode]);

  // Title median-over-time pivot: { label, date, [job_code]: med }.
  const titleSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of ttrend ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.job_code] = r.med;
      byLabel.set(r.label, row);
    }
    return withSnapX([...byLabel.values()].sort(cmpSnap));
  }, [ttrend, cmpSnap]);

  // gap to the top earner in the group, per snapshot
  const gapSeries = useMemo(
    () =>
      series.map((row) => {
        const o: Record<string, string | number> = { label: row.label as string, date: row.date, x: row.x };
        const vals = persons.map((p) => row[p.id]).filter((v): v is number => typeof v === 'number');
        const max = vals.length ? Math.max(...vals) : null;
        if (max != null) persons.forEach((p) => { const v = row[p.id]; if (typeof v === 'number') o[p.id] = v - max; });
        return o;
      }),
    [series, persons]
  );
  // Gap values are all ≤0 (distance behind the top earner); Recharts' auto ticks over an all-negative
  // range pick ugly steps (-$9,500/-$19,000/-$28,500) — snap to round numbers instead.
  const gapTicks = useMemo(() => {
    const vals = gapSeries.flatMap((row) => persons.map((p) => row[p.id]).filter((v): v is number => typeof v === 'number'));
    if (!vals.length) return undefined;
    return niceCurrencyTicks(Math.min(...vals, 0), Math.max(...vals, 0));
  }, [gapSeries, persons]);

  const cadence = useMemo(
    () =>
      persons.map((p) => {
        const points: CadencePoint[] = (cadRows ?? [])
          .filter((r) => r.person_key === p.id)
          .map((r) => ({ id: r.id, date: r.date, pay: r.pay ?? 0, appts: r.appts, jobCode: r.job_code, grade: r.grade, gradeBasis: r.grade_basis, basis: r.basis }))
          .sort((a, b) => snapX(a.date, a.id) - snapX(b.date, b.id));
        const continuing = new Map((contRows ?? []).filter((r) => r.person_key === p.id).map((r) => [r.to_id, r.r]));
        const paid = points.filter((x) => x.pay > 0);
        return {
          id: p.id,
          label: p.label,
          colorIdx: p.colorIdx,
          ...cadenceOf(points, continuing),
          spark: paid.map((x) => ({ x: snapX(x.date, x.id), y: x.pay })),
          breaks: reportingBreaks(paid),
        };
      }),
    [cadRows, contRows, persons]
  );
  const visiblePersons = persons.filter((p) => !mutedIds.has(p.id));
  // Shade one person's gap only when they are the lone series on show; with several, the fills tangle.
  const soloPerson = persons.length > 1 && visiblePersons.length === 1 ? visiblePersons[0] : null;
  return (
    <Stack gap="lg">
      <PageHeader
        title="Compare"
        description="Add any people, titles, or schools and see their salaries side by side. Your selection follows you around the site, so you can keep building it as you browse."
      />

      <ControlBar inline />

      {/* ── Build your comparison: one add box ──
           The site's search, with all three groups: a person, a title or a division goes to the tray
           as what it is. The card carries the border; the box and the chips sit inside it bare. */}
      <Card withBorder padding="lg" ref={addBlocksRef}>
        <Eyebrow>Add a person, title or division</Eyebrow>
        <div style={{ marginTop: 8 }}>
          <SearchBox
            placeholder="Add a person, title or division…"
            size="md"
            onPick={(h) => add({ type: 'person', id: h.person_key, label: h.name })}
            onPickTitle={(t) => add({ type: 'title', id: t.code, label: t.title })}
            onPickDivision={(d) => add({ type: 'school', id: d.school, label: d.school })}
          />
        </div>

        {items.length > 0 && (
          <>
            <SelectedRow label="People" items={persons} onRemove={remove} colored mutedIds={mutedIds} onToggleMute={toggleMute} onHover={setHoverId} />
            <SelectedRow label="Titles" items={titles} onRemove={remove} colored mutedIds={mutedIds} onToggleMute={toggleMute} onHover={setHoverId} />
            <SelectedRow label="Schools" items={schools} onRemove={remove} />
            {(persons.length > 0 || titles.length > 0) && (
              <Text size="xs" c="dimmed" mt={6}>The colored dots are the key for the charts below — point at one to pick out its line, click to hide it, shift-click to show only it.</Text>
            )}
            <Group justify="flex-end" mt="sm">
              <Button size="xs" variant="subtle" color="gray" onClick={clear}>Clear all</Button>
            </Group>
          </>
        )}
      </Card>

      {items.length === 0 && (
        <Card withBorder padding="lg">
          <Stack align="center" gap="sm" py={16}>
            <ThemeIcon size={48} radius="xl" variant="light" color="accent">
              <IconArrowsDiff size={26} />
            </ThemeIcon>
            {/* h2: the page's main content under PageHeader's h1 (see EmptyState's note). */}
            <Title order={2} fz="h3" ta="center">Build a side-by-side comparison</Title>
            <Text c="dimmed" ta="center" maw="var(--measure-narrow)">
              Add people, titles, or schools — or use the ＋ Compare buttons around the app — and they’ll line up here with charts and tables.
            </Text>
            <Button variant="light" onClick={() => focusControl(addBlocksRef)}>Add someone to compare</Button>
          </Stack>
        </Card>
      )}

      {persons.length > 0 && (
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
                  value={xMode}
                  onChange={(v) => setXMode(v as 'date' | 'tenure')}
                  options={[{ id: 'date', label: 'By date' }, { id: 'tenure', label: 'By tenure' }]}
                />
              </Group>
            }
          >
            People — salary trajectory
          </CardTitle>
          {pLoading ? (
            <Loader />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                {xMode === 'date' ? (
                  <LineChart data={trajectorySeries} syncId="compare-people" margin={{ left: 12, right: persons.length > 0 && persons.length <= 4 ? 90 : 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...snapAxisProps(trajectorySeries)} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows(payload, labelMap, usd)} /> : null} />
                    {persons.map((p) => {
                      const color = CHART_SERIES[p.colorIdx % CHART_SERIES.length];
                      const muted = mutedIds.has(p.id);
                      return (
                        <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="monotone" dataKey={p.id} name={p.label} stroke={color} strokeWidth={lineWidth(p.id)} strokeOpacity={muted ? 0.15 : 1} dot={muted ? { opacity: 0.15 } : true} connectNulls
                          {...chartAnim(reduceMotion, MOTION.figure)}
                          label={persons.length <= 4 && !muted ? <TrajectoryEndLabel count={trajectorySeries.length} name={p.label} color={color} /> : undefined}
                          onClick={() => nav(`/person/${encodeURIComponent(p.id)}`)}
                          style={{ cursor: 'pointer' }}
                        />
                      );
                    })}
                  </LineChart>
                ) : (
                  <ScatterChart margin={{ left: 12, right: 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="tenure" name="Tenure" unit="y" tick={AXIS_TICK} />
                    <YAxis type="number" dataKey="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip formatter={(v: number, k) => (k === 'pay' ? usd(v) : `${Number(v).toFixed(1)} yrs`)} contentStyle={TIP_STYLE} />
                    {persons.map((p) => (
                      <Scatter
                        {...chartAnim(reduceMotion, MOTION.figure)}
                        key={p.id}
                        name={p.label}
                        data={(perPersonDisplay.get(p.id) ?? []).filter((x) => x.tenure != null && x.pay > 0).map((x) => ({ tenure: x.tenure, pay: x.pay }))}
                        line
                        fill={CHART_SERIES[p.colorIdx % CHART_SERIES.length]}
                        fillOpacity={mutedIds.has(p.id) ? 0.15 : 1}
                        onClick={() => nav(`/person/${encodeURIComponent(p.id)}`)}
                        cursor="pointer"
                      />
                    ))}
                  </ScatterChart>
                )}
              </ResponsiveContainer>
              <Text size="xs" c="dimmed" mt={4}>
                {xMode === 'tenure' ? 'Aligned by years since hire — compares people at the same career stage.' : 'By calendar snapshot.'}
                {dollarMode === 'real' ? ` Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).` : ''}
              </Text>
              <ChartData
                caption={dollarMode === 'real' ? `Salary by snapshot (in ${REAL_BASE_YEAR} dollars)` : 'Salary by snapshot'}
                columns={['Snapshot', ...persons.map((p) => p.label)]}
                rows={trajectorySeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
                unit="snapshots"
                period={spanLabel(trajectorySeries.map((row) => row.label as string))}
              />
            </>
          )}
        </Card>
      )}

      {persons.length > 1 && (
        <Card withBorder padding="lg">
          <CardTitle>Pay gap to the top earner in this group</CardTitle>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={gapSeries} syncId="compare-people" margin={{ left: 12, right: 12 }} className="gap-chart">
              <CartesianGrid {...GRID} />
              <XAxis {...snapAxisProps(gapSeries)} tick={AXIS_TICK} />
              {/* Distance behind, said as distance: "$10k behind", and the top line named for who is on it. */}
              <YAxis
                tickFormatter={(v: number) => (v === 0 ? 'top earner' : `${fmtK(-v)} behind`)}
                ticks={gapTicks}
                domain={gapTicks ? [gapTicks[0], gapTicks[gapTicks.length - 1]] : undefined}
                width={96}
                tick={AXIS_TICK}
              />
              <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows((payload ?? []).filter((x) => x.type !== 'none'), labelMap, (v) => (v === 0 ? 'top earner' : `${usd(-v)} behind`))} /> : null} />
              {soloPerson && (
                <Area
                  className="gap-shade"
                  type="monotone"
                  dataKey={soloPerson.id}
                  baseValue={0}
                  stroke="none"
                  fill={CHART_SERIES[soloPerson.colorIdx % CHART_SERIES.length]}
                  fillOpacity={0.14}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                  connectNulls
                />
              )}
              {persons.map((p) => (
                <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="monotone" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={lineWidth(p.id)} strokeOpacity={mutedIds.has(p.id) ? 0.15 : 1} dot={mutedIds.has(p.id) ? { opacity: 0.15 } : true} connectNulls {...chartAnim(reduceMotion, MOTION.figure)} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <Text size="xs" c="dimmed">
            How far each person was behind the group's top earner at each snapshot. Show only one person
            (shift-click their dot) to shade their gap.
          </Text>
          <ChartData
            caption="Pay gap to the top earner by snapshot"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={gapSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
            unit="snapshots"
            period={spanLabel(gapSeries.map((row) => row.label as string))}
          />
        </Card>
      )}

      {persons.length > 0 && standingSeries.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle>Relative standing within school (percentile over time)</CardTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={standingSeries} syncId="compare-people" margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis {...snapAxisProps(standingSeries)} tick={AXIS_TICK} />
              <YAxis domain={[0, 100]} width={48} tick={AXIS_TICK} unit="%" padding={Y_PAD} />
              <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows(payload, labelMap, (v) => `${ordinal(v)} pctile`)} /> : null} />
              {persons.map((p) => (
                <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="monotone" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={lineWidth(p.id)} strokeOpacity={mutedIds.has(p.id) ? 0.15 : 1} dot={mutedIds.has(p.id) ? { opacity: 0.15 } : true} connectNulls {...chartAnim(reduceMotion, MOTION.figure)} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Text size="xs" c="dimmed">Each person's percentile among peers in their own school at that snapshot.</Text>
          <ChartData
            caption="Percentile within school over time"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={standingSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
            unit="snapshots"
            period={spanLabel(standingSeries.map((row) => row.label as string))}
          />
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle sub="A raise is pay up in the same job, at the same FTE, from one snapshot to the next. A promotion (a grade up on the same pay schedule) is counted as a promotion, the Nov 2021 relabel is not a step, and the Sep 2025 change in how 9-month pay is reported is never a raise.">
            Raise cadence &amp; stagnation
          </CardTitle>
          <Table.ScrollContainer minWidth={640} className="fold-scroll">
          <Table className="fold-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th data-fold>Pay path</Table.Th>
                <Table.Th ta="right">Latest</Table.Th>
                <Table.Th ta="right" data-fold>Raises</Table.Th>
                <Table.Th ta="right" data-fold>Promotions</Table.Th>
                <Table.Th ta="right" data-fold>Avg raise</Table.Th>
                <Table.Th ta="right" data-fold>Longest without a raise</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cadence.map((c) => {
                const color = CHART_SERIES[c.colorIdx % CHART_SERIES.length];
                const raises = `${c.raises} of ${c.judged}`;
                const longest = `${c.longestMonths} ${c.longestMonths === 1 ? 'month' : 'months'}`;
                return (
                  <Table.Tr
                    key={c.id}
                    className="cadence-row"
                    data-person={c.id}
                    data-raises={c.raises}
                    data-promotions={c.promotions}
                    data-judged={c.judged}
                    data-longest={c.longestMonths}
                    data-steps={c.steps.map((x) => `${x.toId}:${x.kind}`).join(',')}
                    onMouseEnter={() => setHoverId(c.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <Table.Td>
                      <Group gap={8} wrap="nowrap">
                        <span className="series-dot" aria-hidden style={{ background: color }} />
                        <span>{c.label}</span>
                      </Group>
                      <Text className="fold-under" size="xs" c="dimmed">
                        raised at {c.raises} of {c.judged} steps · {c.promotions} {c.promotions === 1 ? 'promotion' : 'promotions'} · avg raise {c.avgRaise == null ? '—' : pct(c.avgRaise)} · longest without a raise: {longest}
                      </Text>
                    </Table.Td>
                    <Table.Td data-fold><Sparkline points={c.spark} breaks={c.breaks} stroke={color} width={64} height={18} /></Table.Td>
                    <Table.Td ta="right">{usd(latest.get(c.id) ?? null)}</Table.Td>
                    <Table.Td ta="right" data-fold>{raises}</Table.Td>
                    <Table.Td ta="right" data-fold>{c.promotions}</Table.Td>
                    <Table.Td ta="right" data-fold>{c.avgRaise == null ? '—' : pct(c.avgRaise)}</Table.Td>
                    <Table.Td ta="right" data-fold>{longest}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          </Table.ScrollContainer>
          <Text size="xs" c="dimmed" mt={4}>
            "Raises" counts the steps that say either way; a step where pay cannot be compared — several
            appointments, a changed FTE, a snapshot missing between — is left out, and so is the run of
            months across it.
          </Text>
        </Card>
      )}

      {titles.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle>Titles — side-by-side (current snapshot)</CardTitle>
          {tLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={560} className="fold-scroll">
            <Table className="fold-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th ta="right" data-fold>People</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right" data-fold>25th</Table.Th>
                  <Table.Th ta="right" data-fold>75th</Table.Th>
                  <Table.Th ta="right" data-fold>90th</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(tdata ?? []).map((t) => (
                  <Table.Tr key={t.job_code}>
                    <Table.Td>
                      {titleLabelMap.get(t.job_code) ?? t.job_code}
                      <Text className="fold-under" size="xs" c="dimmed">
                        {num(t.headcount)} people · {usd(t.p25)} – {usd(t.p75)} · 90th {usd(t.p90)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" data-fold>{num(t.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right" data-fold>{usd(t.p25)}</Table.Td>
                    <Table.Td ta="right" data-fold>{usd(t.p75)}</Table.Td>
                    <Table.Td ta="right" data-fold>{usd(t.p90)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      {titles.length > 0 && titleSeries.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle>Titles — median salary over time</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={titleSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis {...snapAxisProps(titleSeries)} tick={AXIS_TICK} />
              <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
              <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows(payload, titleLabelMap, usd)} /> : null} />
              {titles.map((t) => (
                <Line key={t.id} className={`cmp-line cmp-t${t.colorIdx}`} type="monotone" dataKey={t.id} name={t.label} stroke={CHART_SERIES[t.colorIdx % CHART_SERIES.length]} strokeWidth={lineWidth(t.id)} strokeOpacity={mutedIds.has(t.id) ? 0.15 : 1} dot={mutedIds.has(t.id) ? { opacity: 0.15 } : true} connectNulls {...chartAnim(reduceMotion, MOTION.figure)} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Text size="xs" c="dimmed">Median salary per title at each snapshot.</Text>
          <ChartData
            caption="Median salary per title over time"
            columns={['Snapshot', ...titles.map((t) => t.label)]}
            rows={titleSeries.map((row) => [row.label as string, ...titles.map((t) => row[t.id] ?? null)])}
            unit="snapshots"
            period={spanLabel(titleSeries.map((row) => row.label as string))}
          />
        </Card>
      )}

      {schools.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle>Schools — side-by-side (current snapshot)</CardTitle>
          {sLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={520} className="fold-scroll">
            <Table className="fold-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right" data-fold>Headcount</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right" data-fold>90th pctile</Table.Th>
                  <Table.Th ta="right" data-fold>Total payroll</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sdata ?? []).map((s) => (
                  <Table.Tr key={s.school}>
                    <Table.Td>
                      {s.school}
                      <Text className="fold-under" size="xs" c="dimmed">
                        {num(s.headcount)} people · 90th {usd(s.p90)} · payroll {usd(s.payroll)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" data-fold>{num(s.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(s.med)}</Table.Td>
                    <Table.Td ta="right" data-fold>{usd(s.p90)}</Table.Td>
                    <Table.Td ta="right" data-fold>{usd(s.payroll)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
    </Stack>
  );
}

/**
 * A removable-pill row for one selection type; renders nothing when empty.
 * When `colored`, each pill shows its persistent chart color (its stored colorIdx,
 * not its position — a color follows its item even if others are removed) so the
 * tags double as the charts' legend.
 */
function SelectedRow({
  label, items, onRemove, colored = false, mutedIds, onToggleMute, onHover,
}: {
  label: string;
  items: TrayItem[];
  onRemove: (id: string) => void;
  colored?: boolean;
  mutedIds?: Set<string>;
  onToggleMute?: (id: string, allIds: string[], solo: boolean) => void;
  /** The chip under the pointer (or focused), whose series the charts thicken; null on leaving. */
  onHover?: (id: string | null) => void;
}) {
  if (items.length === 0) return null;
  const allIds = items.map((i) => i.id);
  return (
    <Group gap="xs" mt="sm" wrap="wrap" data-row={label}>
      <Text size="xs" c="dimmed" w={56}>{label}</Text>
      {items.map((i) => {
        const muted = mutedIds?.has(i.id) ?? false;
        return (
          <Pill
            key={`${i.type}:${i.id}`}
            withRemoveButton
            onRemove={() => onRemove(i.id)}
            onMouseEnter={() => onHover?.(i.id)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(i.id)}
            onBlur={() => onHover?.(null)}
            data-series={colored ? i.id : undefined}
            data-color-idx={colored ? i.colorIdx : undefined}
          >
            {colored && (
              <button
                type="button"
                className="series-toggle"
                aria-label={`${muted ? 'Show' : 'Hide'} ${i.label} on the charts (shift-click to show only this one)`}
                aria-pressed={!muted}
                onClick={(e) => onToggleMute?.(i.id, allIds, e.shiftKey)}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  padding: 0,
                  border: 'none',
                  borderRadius: '50%',
                  background: CHART_SERIES[i.colorIdx % CHART_SERIES.length],
                  opacity: muted ? 0.25 : 1,
                  marginRight: 6,
                  verticalAlign: 'middle',
                  cursor: 'pointer',
                }}
              />
            )}
            {i.label}
          </Pill>
        );
      })}
    </Group>
  );
}
