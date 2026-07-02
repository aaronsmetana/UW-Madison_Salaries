import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Title, Text, Card, Table, Loader, SegmentedControl, Group, Select, Pill, Button, SimpleGrid, ThemeIcon, Paper } from '@mantine/core';
import { IconUser, IconBriefcase, IconBuildingBank, IconArrowsDiff } from '@tabler/icons-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, fmtUsd, fmtK, niceCurrencyTicks, CHART_SERIES, fmtSnapTick } from '../lib/chartStyle';
import { PageHeader } from '../components/PageHeader';
import { useTray, type TrayItem } from '../state/tray';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { makeSnapshotComparator } from '../lib/snapshotOrder';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay, paidHeadcount } from '../lib/queries';
import { usd, num, pct } from '../lib/format';
import { ChartData } from '../components/ChartData';
import { ChartTooltip } from '../components/chart/ChartTooltip';
import { SvgPill } from '../components/chart/pills';
import { SearchBox } from '../components/SearchBox';
import { ControlBar } from '../app/ControlBar';
import { dropdownProps } from '../lib/selectProps';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { encodeSel, decodeSel } from '../lib/share';

interface PRow { person_key: string; label: string; date: string; pay: number; tenure: number | null }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface TStatRow { job_code: string; headcount: number; med: number | null; p25: number | null; p75: number | null; p90: number | null }
interface TTrendRow { job_code: string; label: string; date: string; med: number }

interface TooltipPayloadItem {
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
  const { items, add, remove, clear } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const [xMode, setXMode] = useState<'date' | 'tenure'>('date');
  const [dollarMode, setDollarMode] = useState<'nominal' | 'real'>('nominal');
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

  // ── option lists for the in-page pickers ──────────────────────────────────
  const { data: schoolOpts } = useSql<{ school: string }>(
    ['cmp-school-opts', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );
  const { data: titleOpts } = useSql<{ job_code: string; title: string; n: number }>(
    ['cmp-title-opts', snap ?? '', metric],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );

  const { data: pdata, isFetching: pLoading } = useSql<PRow>(
    ['cmp-people', personIds, metric],
    `SELECT person_key, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    persons.length > 0
  );

  const { data: sdata, isFetching: sLoading } = useSql<SRow>(
    ['cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, ${paidHeadcount(metric)} headcount,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames}) GROUP BY school`,
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

  const labelMap = useMemo(() => new Map(persons.map((p) => [p.id, p.label])), [persons]);
  const titleLabelMap = useMemo(() => new Map(titles.map((t) => [t.id, t.label])), [titles]);

  const standingSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of standingData ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pctile;
      byLabel.set(r.label, row);
    }
    return [...byLabel.values()].sort(cmpSnap);
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
    const series = [...byLabel.values()].sort(cmpSnap);
    return { series, latest: latestByPerson };
  }, [pdata, cmpSnap]);

  // Real-dollar view of the trajectory chart only (gap/standing/cadence stay nominal — those are
  // separate cards without their own toggle). Each point converts using its own snapshot year.
  const trajectorySeries = useMemo(() => {
    if (dollarMode !== 'real') return series;
    return series.map((row) => {
      const year = Number(String(row.date).slice(0, 4)) || REAL_BASE_YEAR;
      const out: Record<string, string | number> = { label: row.label, date: row.date };
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
    return [...byLabel.values()].sort(cmpSnap);
  }, [ttrend, cmpSnap]);

  // gap to the top earner in the group, per snapshot
  const gapSeries = useMemo(
    () =>
      series.map((row) => {
        const o: Record<string, string | number> = { label: row.label as string };
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
        const arr = (perPerson.get(p.id) ?? []).filter((x) => x.pay > 0);
        let raises = 0;
        let sumPct = 0;
        let streak = 0;
        let longest = 0;
        for (let i = 1; i < arr.length; i++) {
          const delta = arr[i].pay - arr[i - 1].pay;
          if (delta > 0) {
            raises++;
            sumPct += delta / arr[i - 1].pay;
            streak = 0;
          } else {
            streak++;
            longest = Math.max(longest, streak);
          }
        }
        return { id: p.id, label: p.label, raises, avgPct: raises ? sumPct / raises : null, longest, periods: Math.max(0, arr.length - 1) };
      }),
    [perPerson, persons]
  );

  const titleSelectData = (titleOpts ?? []).map((t) => ({ value: t.job_code, label: `${t.title} (${t.job_code} · ${num(t.n)})` }));

  return (
    <Stack gap="lg">
      <PageHeader
        title="Compare People, Titles & Schools"
        description="Search and add anyone, any title, or any school, then compare salaries side by side. Selections are saved (your tray) so you can keep building across pages."
      />

      <ControlBar inline />

      {/* ── Build your comparison: three labeled add blocks ── */}
      <Card withBorder padding="lg">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconUser size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add person</Text></Group>
            <SearchBox placeholder="Search a person by name…" size="md" onPick={(h) => add({ type: 'person', id: h.person_key, label: h.name })} />
          </Paper>
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconBriefcase size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add title</Text></Group>
            <Select
              {...dropdownProps('md')}
              placeholder="Search a title…"
              data={titleSelectData}
              value={null}
              onChange={(v) => {
                if (!v) return;
                const t = titleOpts?.find((x) => x.job_code === v);
                add({ type: 'title', id: v, label: t?.title ?? v });
              }}
              searchable
              nothingFoundMessage="No matching title"
            />
          </Paper>
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconBuildingBank size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add school / division</Text></Group>
            <Select
              {...dropdownProps('md')}
              placeholder="Search a school…"
              data={(schoolOpts ?? []).map((s) => s.school)}
              value={null}
              onChange={(v) => v && add({ type: 'school', id: v, label: v })}
              searchable
              nothingFoundMessage="No matching school"
            />
          </Paper>
        </SimpleGrid>

        {items.length > 0 && (
          <>
            <SelectedRow label="People" items={persons} onRemove={remove} colored />
            <SelectedRow label="Titles" items={titles} onRemove={remove} colored />
            <SelectedRow label="Schools" items={schools} onRemove={remove} />
            {(persons.length > 0 || titles.length > 0) && (
              <Text size="xs" c="dimmed" mt={6}>The colored dots are the key for the charts below.</Text>
            )}
            <Group justify="flex-end" mt="sm">
              <Button size="xs" variant="subtle" color="gray" onClick={clear}>Clear all</Button>
            </Group>
          </>
        )}
      </Card>

      {items.length === 0 && (
        <Card withBorder padding="xl">
          <Stack align="center" gap="sm" py={48}>
            <ThemeIcon size={64} radius="xl" variant="light" color="accent">
              <IconArrowsDiff size={32} />
            </ThemeIcon>
            <Title order={3} ta="center">Build a side-by-side comparison</Title>
            <Text c="dimmed" ta="center" maw={480}>
              Add people, titles, or schools using the search boxes above — or the ＋ Compare buttons around the app — and they’ll line up here with charts and tables.
            </Text>
          </Stack>
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Group justify="space-between" mb="md" wrap="wrap">
            <Text size="sm" fw={600}>People — salary trajectory</Text>
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                value={dollarMode}
                onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
                data={[{ value: 'nominal', label: 'Nominal' }, { value: 'real', label: `${REAL_BASE_YEAR} $` }]}
              />
              <SegmentedControl
                size="xs"
                value={xMode}
                onChange={(v) => setXMode(v as 'date' | 'tenure')}
                data={[{ value: 'date', label: 'By date' }, { value: 'tenure', label: 'By tenure' }]}
              />
            </Group>
          </Group>
          {pLoading ? (
            <Loader />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                {xMode === 'date' ? (
                  <LineChart data={trajectorySeries} margin={{ left: 12, right: persons.length > 0 && persons.length <= 4 ? 90 : 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
                    <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip content={({ active, payload, label }) => active ? <ChartTooltip label={label} rows={seriesRows(payload, labelMap, usd)} /> : null} />
                    {persons.map((p) => {
                      const color = CHART_SERIES[p.colorIdx % CHART_SERIES.length];
                      return (
                        <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={color} strokeWidth={2} dot connectNulls
                          label={persons.length <= 4 ? <TrajectoryEndLabel count={trajectorySeries.length} name={p.label} color={color} /> : undefined}
                        />
                      );
                    })}
                  </LineChart>
                ) : (
                  <ScatterChart margin={{ left: 12, right: 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="tenure" name="Tenure" unit="y" tick={AXIS_TICK} />
                    <YAxis type="number" dataKey="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip formatter={(v: number, k) => (k === 'pay' ? usd(v) : `${Number(v).toFixed(1)} yrs`)} />
                    {persons.map((p) => (
                      <Scatter
                        key={p.id}
                        name={p.label}
                        data={(perPersonDisplay.get(p.id) ?? []).filter((x) => x.tenure != null && x.pay > 0).map((x) => ({ tenure: x.tenure, pay: x.pay }))}
                        line
                        fill={CHART_SERIES[p.colorIdx % CHART_SERIES.length]}
                      />
                    ))}
                  </ScatterChart>
                )}
              </ResponsiveContainer>
              <ChartData
                caption={dollarMode === 'real' ? `Salary by snapshot (in ${REAL_BASE_YEAR} dollars)` : 'Salary by snapshot'}
                columns={['Snapshot', ...persons.map((p) => p.label)]}
                rows={trajectorySeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
              />
              <Text size="xs" c="dimmed" mt={4}>
                {xMode === 'tenure' ? 'Aligned by years since hire — compares people at the same career stage.' : 'By calendar snapshot.'}
                {dollarMode === 'real' ? ` Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).` : ''}
              </Text>
            </>
          )}
        </Card>
      )}

      {persons.length > 1 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Pay gap to the top earner in this group</Text>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={gapSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
              <YAxis
                tickFormatter={fmtK}
                ticks={gapTicks}
                domain={gapTicks ? [gapTicks[0], gapTicks[gapTicks.length - 1]] : undefined}
                width={80}
                tick={AXIS_TICK}
              />
              <Tooltip content={({ active, payload, label }) => active ? <ChartTooltip label={label} rows={seriesRows(payload, labelMap, usd)} /> : null} />
              {persons.map((p) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Pay gap to the top earner by snapshot"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={gapSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">0 = highest-paid in the group at that snapshot; below 0 = behind by that amount.</Text>
        </Card>
      )}

      {persons.length > 0 && standingSeries.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Relative standing within school (percentile over time)</Text>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={standingSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
              <YAxis domain={[0, 100]} width={48} tick={AXIS_TICK} unit="%" padding={Y_PAD} />
              <Tooltip content={({ active, payload, label }) => active ? <ChartTooltip label={label} rows={seriesRows(payload, labelMap, (v) => `${v}th pctile`)} /> : null} />
              {persons.map((p) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Percentile within school over time"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={standingSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">Each person's percentile among peers in their own school at that snapshot.</Text>
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Raise cadence &amp; stagnation</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th ta="right">Latest</Table.Th>
                <Table.Th ta="right">Raises</Table.Th>
                <Table.Th ta="right">Avg raise</Table.Th>
                <Table.Th ta="right">Longest no-raise streak</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cadence.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.label}</Table.Td>
                  <Table.Td ta="right">{usd(latest.get(c.id) ?? null)}</Table.Td>
                  <Table.Td ta="right">{c.raises} / {c.periods}</Table.Td>
                  <Table.Td ta="right">{c.avgPct == null ? '—' : pct(c.avgPct)}</Table.Td>
                  <Table.Td ta="right">{c.longest} {c.longest === 1 ? 'period' : 'periods'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {titles.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Titles — side-by-side (current snapshot)</Text>
          {tLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right">25th</Table.Th>
                  <Table.Th ta="right">75th</Table.Th>
                  <Table.Th ta="right">90th</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(tdata ?? []).map((t) => (
                  <Table.Tr key={t.job_code}>
                    <Table.Td>{titleLabelMap.get(t.job_code) ?? t.job_code}</Table.Td>
                    <Table.Td ta="right">{num(t.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p25)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p75)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p90)}</Table.Td>
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
          <Text size="sm" fw={600} mb="md">Titles — median salary over time</Text>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={titleSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={fmtSnapTick} />
              <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
              <Tooltip content={({ active, payload, label }) => active ? <ChartTooltip label={label} rows={seriesRows(payload, titleLabelMap, usd)} /> : null} />
              {titles.map((t) => (
                <Line key={t.id} type="monotone" dataKey={t.id} name={t.label} stroke={CHART_SERIES[t.colorIdx % CHART_SERIES.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Median salary per title over time"
            columns={['Snapshot', ...titles.map((t) => t.label)]}
            rows={titleSeries.map((row) => [row.label as string, ...titles.map((t) => row[t.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">Median salary per title at each snapshot.</Text>
        </Card>
      )}

      {schools.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Schools — side-by-side (current snapshot)</Text>
          {sLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">Headcount</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right">90th pctile</Table.Th>
                  <Table.Th ta="right">Total payroll</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sdata ?? []).map((s) => (
                  <Table.Tr key={s.school}>
                    <Table.Td>{s.school}</Table.Td>
                    <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(s.med)}</Table.Td>
                    <Table.Td ta="right">{usd(s.p90)}</Table.Td>
                    <Table.Td ta="right">{usd(s.payroll)}</Table.Td>
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
function SelectedRow({ label, items, onRemove, colored = false }: { label: string; items: TrayItem[]; onRemove: (id: string) => void; colored?: boolean }) {
  if (items.length === 0) return null;
  return (
    <Group gap="xs" mt="sm" wrap="wrap">
      <Text size="xs" c="dimmed" w={56}>{label}</Text>
      {items.map((i) => (
        <Pill key={`${i.type}:${i.id}`} withRemoveButton onRemove={() => onRemove(i.id)}>
          {colored && (
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: CHART_SERIES[i.colorIdx % CHART_SERIES.length],
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            />
          )}
          {i.label}
        </Pill>
      ))}
    </Group>
  );
}
