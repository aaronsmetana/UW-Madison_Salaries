import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Stack, Title, Text, Card, Table, Loader, Group, Pill, Button, ThemeIcon } from '@mantine/core';
import { IconArrowsDiff } from '@tabler/icons-react';
import {
  ResponsiveContainer, LineChart, ComposedChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter, Customized,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, TIP_STYLE, fmtUsd, fmtK, niceCurrencyTicks, CHART_SERIES, chartKeys } from '../lib/chartStyle';
import { withSnapX, snapAxisProps, snapX, reportingBreaks } from '../lib/snapTime';
import { PageHeader } from '../components/PageHeader';
import { CardTitle } from '../components/CardTitle';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { Eyebrow } from '../components/Eyebrow';
import { useTray, type TrayItem, type TrayItemInput } from '../state/tray';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSql, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { makeSnapshotComparator } from '../lib/snapshotOrder';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personEarnings, personPay, peopleSql, continuingRaisesSql } from '../lib/queries';
import { usd, num, pct, spanLabel, fmtYears, fullName } from '../lib/format';
import { ChartData } from '../components/ChartData';
import { ChartTooltip } from '../components/chart/ChartTooltip';
import { EndLabels } from '../components/chart/EndLabels';
import { useDocTitle } from '../lib/useDocTitle';
import { usePref } from '../lib/prefs';
import { SearchBox } from '../components/SearchBox';
import { ControlBar } from '../app/ControlBar';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { readSel, writeSel } from '../lib/share';
import { chartAnim, useEntrance } from '../lib/motion';
import { Sparkline } from '../components/chart/Sparkline';
import { cadenceOf, type CadencePoint } from '../lib/cadence';
import { DOT_RIM } from '../components/markers';
import { ChartSkeleton } from '../components/Loading';
import { ICON } from '../lib/ui';

interface PRow { person_key: string; label: string; date: string; pay: number; tenure: number | null }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface TStatRow { job_code: string; headcount: number; med: number | null; p25: number | null; p75: number | null; p90: number | null }
interface RefRow { kind: 'title' | 'school'; rid: string; label: string; date: string; med: number; p25: number; p75: number }
/** A row of the pay-over-time chart: its snapshot, each person's pay, each title's and division's median by its
 *  key and that one's middle half (`<key>b`, a [25th, 75th] pair, which an Area draws as a band). */
type PayRow = Record<string, string | number | [number, number]>;
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

/** The trajectories chart (300px), its note and its footer, while their people load. */
const TRAJECTORY_LOADING_H = 369;

/** Comparisons to start from (C1): the faculty ranks, two of them, and the two largest divisions. */
const STARTERS: { label: string; items: TrayItemInput[] }[] = [
  { label: 'Professor vs Associate Professor', items: [{ type: 'title', id: 'FA020', label: 'Professor' }, { type: 'title', id: 'FA030', label: 'Associate Professor' }] },
  { label: 'The three faculty ranks', items: [{ type: 'title', id: 'FA040', label: 'Assistant Professor' }, { type: 'title', id: 'FA030', label: 'Associate Professor' }, { type: 'title', id: 'FA020', label: 'Professor' }] },
  { label: 'The two largest divisions', items: [{ type: 'school', id: 'School of Medicine and Public Health', label: 'School of Medicine and Public Health' }, { type: 'school', id: 'College of Letters & Science', label: 'College of Letters & Science' }] },
];

export default function Compare() {
  const entrance = useEntrance();
  useDocTitle('Compare');
  const nav = useNavigate();
  const { items, add, remove, clear, relabel } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  /** Each figure here, named for the measure in force (G2). */
  const measure = METRIC_LABEL[metric];
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
    const decoded = readSel(searchParams);
    if (!decoded?.length) return;
    clear();
    decoded.forEach((i) => add(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        writeSel(next, items);
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // A link carries ids alone (C7): each person's and title's name looked up as it opens, the id standing in till then.
  const unnamed = items.filter((i) => i.type !== 'school' && i.label === i.id);
  const unnamedP = unnamed.filter((i) => i.type === 'person').map((i) => sqlStr(i.id)).join(',') || 'NULL';
  const unnamedT = unnamed.filter((i) => i.type === 'title').map((i) => sqlStr(i.id)).join(',') || 'NULL';
  const { data: names } = useSql<{ t: string; id: string; fn: string | null; ln: string | null; title: string | null }>(
    ['cmp-names', unnamedP, unnamedT],
    `SELECT 'person' t, person_key id, arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln, NULL title
       FROM salaries WHERE person_key IN (${unnamedP}) GROUP BY person_key
     UNION ALL
     SELECT 'title' t, job_code id, NULL fn, NULL ln, arg_max(title, snapshot_date) title
       FROM salaries WHERE job_code IN (${unnamedT}) AND title IS NOT NULL GROUP BY job_code`,
    unnamed.length > 0
  );
  useEffect(() => {
    for (const r of names ?? []) {
      const label = r.t === 'person' ? fullName(r.fn, r.ln) : r.title;
      if (label) relabel(r.t as TrayItem['type'], r.id, label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);
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
    `WITH pe AS (${peopleSql({ metric, where: `snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames})`, by: ['school'], extra: `${personEarnings(metric)} earn` })})
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

  // Titles and divisions over time (C3), drawn on the people's chart: each one's median and middle half, snapshot by
  // snapshot, over the same pools as their tables below — a person's pay in that title, or in that division.
  const refFrom = (col: string, list: string) =>
    peopleSql({ metric, where: `${col} IN (${list || 'NULL'})`, by: ['snapshot_id', col], extra: 'any_value(snapshot_label) lbl, any_value(snapshot_date) dt' });
  const { data: rtrend, isFetching: rLoading } = useSql<RefRow>(
    ['cmp-ref-trend', titleCodes, schoolNames, metric],
    `WITH refs AS (
        SELECT 'title' kind, job_code rid, snapshot_id, lbl, dt, pay FROM (${refFrom('job_code', titleCodes)})
        UNION ALL
        SELECT 'school' kind, school rid, snapshot_id, lbl, dt, pay FROM (${refFrom('school', schoolNames)}))
     SELECT kind, rid, any_value(lbl) AS "label", any_value(dt) date, median(pay) med,
        quantile_cont(pay, 0.25) p25, quantile_cont(pay, 0.75) p75
     FROM refs WHERE pay > 0 GROUP BY kind, rid, snapshot_id ORDER BY date`,
    titles.length + schools.length > 0
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

  // The titles and divisions drawn as references, each keyed by its colour (unique in the tray, so a key stays with its
  // item as others come and go).
  const refs = useMemo(() => items.filter((i) => i.type !== 'person').map((i) => ({ ...i, key: `r${i.colorIdx}` })), [items]);
  const labelMap = useMemo(() => new Map([
    ...persons.map((p) => [p.id, p.label] as const),
    ...refs.map((r) => [r.key, `${r.label} median`] as const),
  ]), [persons, refs]);
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
    const byLabel = new Map<string, PayRow>();
    const at = (label: string, date: string) => {
      const row = byLabel.get(label) ?? { label, date };
      byLabel.set(label, row);
      return row;
    };
    const latestByPerson = new Map<string, number>();
    for (const r of pdata ?? []) {
      at(r.label, r.date)[r.person_key] = r.pay;
      latestByPerson.set(r.person_key, r.pay);
    }
    const keyOf = new Map(refs.map((x) => [`${x.type}|${x.id}`, x.key]));
    for (const r of rtrend ?? []) {
      const k = keyOf.get(`${r.kind}|${r.rid}`);
      if (!k) continue;
      const row = at(r.label, r.date);
      row[k] = r.med;
      row[`${k}b`] = [r.p25, r.p75];
    }
    const series = withSnapX([...byLabel.values()].sort(cmpSnap));
    return { series, latest: latestByPerson };
  }, [pdata, rtrend, refs, cmpSnap]);

  // Real-dollar view of the trajectory chart only (gap/standing/cadence stay nominal — those are
  // separate cards without their own toggle). Each point converts using its own snapshot year.
  const trajectorySeries = useMemo(() => {
    if (dollarMode !== 'real') return series;
    return series.map((row) => {
      const year = Number(String(row.date).slice(0, 4)) || REAL_BASE_YEAR;
      const out: PayRow = { label: row.label, date: row.date, x: row.x };
      for (const k of [...persons.map((p) => p.id), ...refs.map((r) => r.key)]) {
        const v = row[k];
        if (typeof v === 'number') out[k] = toReal(v, year);
        const b = row[`${k}b`];
        if (Array.isArray(b)) out[`${k}b`] = [toReal(b[0], year), toReal(b[1], year)];
      }
      return out;
    });
  }, [series, dollarMode, persons, refs]);
  const perPersonDisplay = useMemo(() => {
    if (dollarMode !== 'real') return perPerson;
    const m = new Map<string, { label: string; date: string; pay: number; tenure: number | null }[]>();
    for (const [id, arr] of perPerson) {
      m.set(id, arr.map((x) => ({ ...x, pay: x.pay > 0 ? toReal(x.pay, Number(String(x.date).slice(0, 4)) || REAL_BASE_YEAR) : x.pay })));
    }
    return m;
  }, [perPerson, dollarMode]);

  // The gap to the group's top earner, at each snapshot where everyone compared was paid (C4): where one was not, the
  // "top earner" was only whoever was there, and the line said someone led who had merely stayed.
  const gapSeries = useMemo(
    () =>
      series.map((row) => {
        const o: Record<string, string | number> = { label: row.label as string, date: row.date as string, x: row.x };
        const vals = persons.map((p) => row[p.id]);
        if (vals.every((v): v is number => typeof v === 'number' && v > 0)) {
          const max = Math.max(...vals);
          persons.forEach((p, i) => { o[p.id] = vals[i] - max; });
        }
        return o;
      }),
    [series, persons]
  );
  const gapShared = gapSeries.filter((row) => persons.length > 0 && typeof row[persons[0].id] === 'number').length;
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
  // Who is not on the payroll in the latest snapshot, by the last one they were in.
  const latestLabel = summary?.snapshots?.[summary.snapshots.length - 1]?.label ?? null;
  const departed = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, arr] of perPerson) {
      const last = [...arr].reverse().find((x) => x.pay > 0);
      if (last && latestLabel && last.label !== latestLabel) m.set(id, last.label);
    }
    return m;
  }, [perPerson, latestLabel]);
  // Shade one person's gap only when they are the lone series on show; with several, the fills tangle.
  const soloPerson = persons.length > 1 && visiblePersons.length === 1 ? visiblePersons[0] : null;
  return (
    <Stack gap="lg">
      <PageHeader
        title="Compare"
        description="Add any people, titles, or divisions and see their salaries side by side. Your selection follows you around the site, so you can keep building it as you browse."
      />

      {/* The view's controls once there is something to view (C1): over an empty card they set nothing. */}
      {items.length > 0 && <ControlBar inline />}

      {/* ── Build your comparison: one add box ──
           The site's search, with all three groups: a person, a title or a division goes to the tray
           as what it is. The card carries the border; the box and the chips sit inside it bare. */}
      <Card withBorder padding="lg">
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
            <SelectedRow label="Divisions" items={schools} onRemove={remove} colored mutedIds={mutedIds} onToggleMute={toggleMute} onHover={setHoverId} />
            {items.length > 0 && (
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
              <IconArrowsDiff size={ICON.feature} />
            </ThemeIcon>
            {/* h2: the page's main content under PageHeader's h1 (see EmptyState's note). */}
            <Title order={2} fz="h3" ta="center">Build a side-by-side comparison</Title>
            <Text c="dimmed" ta="center" maw="var(--measure-narrow)">
              Add people, titles, or divisions above — or use the ＋ Compare buttons around the app — and they’ll line up here with charts and tables.
            </Text>
            {/* Somewhere to start (C1), each a press that fills the comparison. */}
            <Group gap="sm" justify="center" wrap="wrap" mt={4} className="compare-starters">
              {STARTERS.map((st) => (
                <Button key={st.label} variant="light" size="sm" onClick={() => st.items.forEach((i) => add(i))}>{st.label}</Button>
              ))}
            </Group>
          </Stack>
        </Card>
      )}

      {(persons.length > 0 || refs.length > 0) && (
        <Card withBorder padding="lg" className="cmp-pay-card">
          <CardTitle
            right={
              <Group gap="sm" wrap="wrap">
                <SegmentedToggle
                  value={dollarMode}
                  onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
                  options={[{ id: 'nominal', label: 'Nominal' }, { id: 'real', label: `${REAL_BASE_YEAR} $` }]}
                />
                {persons.length > 0 && (
                  <SegmentedToggle
                    value={xMode}
                    onChange={(v) => setXMode(v as 'date' | 'tenure')}
                    options={[{ id: 'date', label: 'By date' }, { id: 'tenure', label: 'By tenure' }]}
                  />
                )}
              </Group>
            }
          >
            {measure} over time
          </CardTitle>
          {/* Loading, a block the height of the chart, its note and its footer: a spinner, the card was a third
              of its height and the cards under it dropped 333px when the lines came (layout shift 0.06). */}
          {pLoading || rLoading ? (
            <ChartSkeleton height={TRAJECTORY_LOADING_H} />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                {xMode === 'date' || persons.length === 0 ? (
                  <ComposedChart {...chartKeys(`${measure} by snapshot`)} data={trajectorySeries} syncId="compare-people" margin={{ left: 12, right: 16, top: 18 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis {...snapAxisProps(trajectorySeries)} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows((payload ?? []).filter((x) => x.type !== 'none'), labelMap, usd)} /> : null} />
                    {/* Titles and divisions, under the people (C3): each one's middle half a band, its median a dashed
                        line, in the colour its chip has. */}
                    {refs.map((r) => (
                      <Area key={`${r.key}b`} className={`cmp-ref-band cmp-ref-${r.type}`} type="linear" dataKey={`${r.key}b`}
                        stroke="none" fill={CHART_SERIES[r.colorIdx % CHART_SERIES.length]} fillOpacity={mutedIds.has(r.id) ? 0 : 0.1}
                        tooltipType="none" legendType="none" isAnimationActive={false} connectNulls />
                    ))}
                    {refs.map((r) => (
                      <Line key={r.key} className={`cmp-ref cmp-ref-${r.type}`} type="linear" dataKey={r.key} name={`${r.label} median`}
                        stroke={CHART_SERIES[r.colorIdx % CHART_SERIES.length]} strokeDasharray="6 4" strokeWidth={lineWidth(r.id) - 0.5}
                        strokeOpacity={mutedIds.has(r.id) ? 0.15 : 1} dot={false} activeDot={false} connectNulls {...chartAnim(!entrance)} />
                    ))}
                    {persons.map((p) => {
                      const color = CHART_SERIES[p.colorIdx % CHART_SERIES.length];
                      const muted = mutedIds.has(p.id);
                      return (
                        <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="linear" dataKey={p.id} name={p.label} stroke={color} strokeWidth={lineWidth(p.id)} strokeOpacity={muted ? 0.15 : 1} dot={muted ? { opacity: 0.15 } : true} connectNulls
                          {...chartAnim(!entrance)}
                          onClick={() => nav(`/person/${encodeURIComponent(p.id)}`)}
                          style={{ cursor: 'pointer' }}
                        />
                      );
                    })}
                    {/* Every line named where it ends (C5) — at its own last point, so one who left is named where they
                        stopped, and says so ("left after Mar 2026"). Only the line reaching the last snapshot was. */}
                    <Customized component={<EndLabels endSeries={[
                      ...persons.filter((p) => !mutedIds.has(p.id)).map((p) => ({
                        key: p.id, text: departed.get(p.id) ? `${p.label} · left after ${departed.get(p.id)}` : p.label,
                        color: CHART_SERIES[p.colorIdx % CHART_SERIES.length],
                      })),
                      ...refs.filter((r) => !mutedIds.has(r.id)).map((r) => ({
                        key: r.key, text: `${r.label} median`, color: CHART_SERIES[r.colorIdx % CHART_SERIES.length],
                      })),
                    ]} />} />
                  </ComposedChart>
                ) : (
                  <ScatterChart margin={{ left: 12, right: 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="tenure" name="Tenure" unit="y" tick={AXIS_TICK} />
                    <YAxis type="number" dataKey="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip formatter={(v: number, k) => (k === 'pay' ? usd(v) : fmtYears(Number(v)))} contentStyle={TIP_STYLE} />
                    {persons.map((p) => (
                      <Scatter
                        {...chartAnim(!entrance)}
                        key={p.id}
                        name={p.label}
                        data={(perPersonDisplay.get(p.id) ?? []).filter((x) => x.tenure != null && x.pay > 0).map((x) => ({ tenure: x.tenure, pay: x.pay }))}
                        // The joining line at its own 1px: the rim's 2px stroke would otherwise reach it.
                        line={{ strokeWidth: 1 }}
                        fill={CHART_SERIES[p.colorIdx % CHART_SERIES.length]}
                        fillOpacity={mutedIds.has(p.id) ? 0.15 : 1}
                        {...DOT_RIM}
                        onClick={() => nav(`/person/${encodeURIComponent(p.id)}`)}
                        cursor="pointer"
                      />
                    ))}
                  </ScatterChart>
                )}
              </ResponsiveContainer>
              <Text size="xs" c="dimmed" mt={4}>
                {xMode === 'tenure' && persons.length > 0
                  ? `Aligned by years since hire — compares people at the same career stage.${refs.length ? ' Titles and divisions are drawn by date only.' : ''}`
                  : `By calendar snapshot.${refs.length ? ' A dashed line is a title’s or a division’s median, its band the middle half of its people.' : ''}`}
                {dollarMode === 'real' ? ` Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).` : ''}
              </Text>
              <ChartData
                caption={dollarMode === 'real' ? `${measure} by snapshot (in ${REAL_BASE_YEAR} dollars)` : `${measure} by snapshot`}
                columns={['Snapshot', ...persons.map((p) => p.label), ...refs.flatMap((r) => [`${r.label} median`, `${r.label} 25th`, `${r.label} 75th`])]}
                rows={trajectorySeries.map((row) => {
                  const band = (k: string) => (Array.isArray(row[`${k}b`]) ? row[`${k}b`] as [number, number] : null);
                  return [row.label as string, ...persons.map((p) => (row[p.id] as number | undefined) ?? null),
                    ...refs.flatMap((r) => [(row[r.key] as number | undefined) ?? null, band(r.key)?.[0] ?? null, band(r.key)?.[1] ?? null])];
                })}
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
          {gapShared === 0 ? (
            <Text size="sm" c="dimmed" className="gap-none">
              These people were never all paid in the same snapshot, so none of them was ever the top earner of the group.
            </Text>
          ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart {...chartKeys('Pay gap to the top earner')} data={gapSeries} syncId="compare-people" margin={{ left: 12, right: 16, top: 18 }} className="gap-chart">
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
                  type="linear"
                  dataKey={soloPerson.id}
                  baseValue={0}
                  stroke="none"
                  fill={CHART_SERIES[soloPerson.colorIdx % CHART_SERIES.length]}
                  fillOpacity={0.14}
                  legendType="none"
                  tooltipType="none"
                  isAnimationActive={false}
                />
              )}
              {/* No joining across a snapshot where someone was not paid: there is no gap there to draw. */}
              {persons.map((p) => (
                <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="linear" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={lineWidth(p.id)} strokeOpacity={mutedIds.has(p.id) ? 0.15 : 1} dot={mutedIds.has(p.id) ? { opacity: 0.15 } : true} {...chartAnim(!entrance)} />
              ))}
              <Customized component={<EndLabels endSeries={persons.filter((p) => !mutedIds.has(p.id)).map((p) => ({ key: p.id, text: p.label, color: CHART_SERIES[p.colorIdx % CHART_SERIES.length] }))} />} />
            </ComposedChart>
          </ResponsiveContainer>
          )}
          <ChartData
            caption="Pay gap to the top earner by snapshot"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={gapSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
            unit="snapshots"
            period={spanLabel(gapSeries.map((row) => row.label as string))}
            about={<>
              How far each person was behind the group's top earner at each snapshot where all of them were paid — at
              one where someone was not, the top earner would only be whoever was there, so there is no point drawn.
              Show only one person (shift-click their dot) to shade their gap.
            </>}
          />
        </Card>
      )}

      {persons.length > 0 && standingSeries.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle sub="The share of their school's staff each person is paid more than, snapshot by snapshot.">Standing within the school</CardTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart {...chartKeys('Standing within the school over time')} data={standingSeries} syncId="compare-people" margin={{ left: 12, right: 16, top: 18 }}>
              <CartesianGrid {...GRID} />
              <XAxis {...snapAxisProps(standingSeries)} tick={AXIS_TICK} />
              <YAxis domain={[0, 100]} width={48} tick={AXIS_TICK} unit="%" padding={Y_PAD} />
              <Tooltip content={({ active, payload }) => active ? <ChartTooltip label={rowLabel(payload)} rows={seriesRows(payload, labelMap, (v) => `more than ${Math.round(v)}%`)} /> : null} />
              {persons.map((p) => (
                <Line key={p.id} className={`cmp-line cmp-p${p.colorIdx}`} type="linear" dataKey={p.id} name={p.label} stroke={CHART_SERIES[p.colorIdx % CHART_SERIES.length]} strokeWidth={lineWidth(p.id)} strokeOpacity={mutedIds.has(p.id) ? 0.15 : 1} dot={mutedIds.has(p.id) ? { opacity: 0.15 } : true} connectNulls {...chartAnim(!entrance)} />
              ))}
              {/* Each line named on its own chart (C6): the chips that key them are a page above by here. */}
              <Customized component={<EndLabels endSeries={persons.filter((p) => !mutedIds.has(p.id)).map((p) => ({ key: p.id, text: p.label, color: CHART_SERIES[p.colorIdx % CHART_SERIES.length] }))} />} />
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Standing within the school over time"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={standingSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
            unit="snapshots"
            period={spanLabel(standingSeries.map((row) => row.label as string))}
            about="Each person's percentile among peers in their own school at that snapshot."
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
          <CardTitle sub="The latest snapshot.">Titles side by side</CardTitle>
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

      {schools.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle sub="The latest snapshot.">Divisions side by side</CardTitle>
          {sLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={520} className="fold-scroll">
            <Table className="fold-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Division</Table.Th>
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
                style={{ '--series-ink': CHART_SERIES[i.colorIdx % CHART_SERIES.length], opacity: muted ? 0.25 : 1 } as CSSProperties}
              />
            )}
            {i.label}
          </Pill>
        );
      })}
    </Group>
  );
}
