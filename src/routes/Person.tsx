import { PersonSkeleton } from '../components/PersonSkeleton';
import { PersonNotFound } from '../components/PersonNotFound';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { Stack, Title, Text, Group, Button, Card, Table, Alert, Anchor, NumberInput, TextInput, Tabs, Popover, Skeleton, VisuallyHidden, Slider, Input, Chip } from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceDot, ReferenceLine, ReferenceArea, Customized,
} from 'recharts';
import { AXIS_TICK, GRID, fmtK, fmtUsd, fmtSnapTick, chartKeys, CHART_FONT, TIP_STYLE, TIP_LABEL_STYLE, niceCurrencyTicks } from '../lib/chartStyle';
import { YoyChips, MARK_HALO } from '../components/chart/pills';
import { snapX, snapAxisProps, reportingBreaks, KNOWN_BREAKS } from '../lib/snapTime';
import { titleEras, sameTitleText, mainSwapped } from '../lib/payHistory';
import { moneyTicks } from '../lib/rangeScale';
import { BreakLabels } from '../components/chart/BreakLabel';
import { packLabelRows, measureText } from '../lib/labelLayout';
import { useWidth } from '../lib/useWidth';
import { useRaiseContext } from '../lib/raiseContext';
import { GapBreakdown } from '../components/GapBreakdown';
import { StartingGroup } from '../components/StartingGroup';
import { PayBandNote } from '../components/PayBandNote';
import { raiseStepsSql, annualized, MIN_TITLE_STEP, type RaiseStep } from '../lib/raises';
import { ttcRank } from '../lib/snapshotOrder';
import { areaGradDef } from '../components/chartDefs';
import { TipSurface } from '../components/chart/ChartTooltip';
import { IconAlertTriangle, IconArrowRight, IconChevronDown, IconFilter, IconPrinter } from '@tabler/icons-react';
import { PersonDashboard } from '../components/PersonDashboard';
import { PayMeasure } from '../components/PayMeasure';
import { useControls } from '../state/controls';
import { useSql, useGrades, useSummary, usePersonAlias } from '../lib/hooks';
import { latestHire, latestMain, latestRows, otherAppts, apptTerms } from '../lib/personQuery';
import { sqlStr } from '../lib/duckdb';
import { personRowsSql } from '../lib/personQuery';
import { personPay, TITLE_RATE, countedAppts, personActualPay, personRate, gradedAppt, mainRow, mainOf, standingSql, poolPercentile, continuingRaisesSql, reportingAcross, reportingChange } from '../lib/queries';
import { toReal, REAL_BASE_YEAR } from '../lib/cpi';
import { useTray } from '../state/tray';
import { ToolLinks } from '../components/ToolLinks';
import { usd, num, fullName, fmtBasis, spanLabel, fmtGrade, fmtGradeBasis, fmtChange, fmtYears, hourly, legacyTitle } from '../lib/format';
import { usePref } from '../lib/prefs';
import { percentile, MIN_GROUP } from '../lib/stats';
import { payWindow, sideOf } from '../lib/payWindow';
import { useMounted, prefersReducedMotion, chartAnim, useEntrance, markTabSwitch } from '../lib/motion';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { TenurePayScatter, type ScatterPoint } from '../components/TenurePayScatter';
import { PayBandBar } from '../components/PayBandBar';
import { MethodNote } from '../components/MethodNote';
import { bandFor, belowMinimum, isRange } from '../lib/bands';
import { PeerStrip } from '../components/PeerStrip';
import { ChartData } from '../components/ChartData';
import { SearchBox } from '../components/SearchBox';
import { CardTitle } from '../components/CardTitle';
import { FactStrip } from '../components/FactStrip';
import { StatRow, StatCell } from '../components/StatCard';
import { PayCell, GrowthCell, GrowthNotes, TenureCell } from '../components/PersonFigures';
import { headlineGrowth } from '../lib/growth';
import { SpreadMark, GrowthBars } from '../components/FigureBars';
import { CompareSetButton } from '../components/CompareSetButton';
import { HistoryTable } from '../components/HistoryTable';
import { TrayButton } from '../components/TrayButton';
import { SortableTh, type SortState } from '../components/SortableTh';
import { GlossaryTerm } from '../components/GlossaryTerm';
import { GLOSSARY } from '../lib/glossary';
import { useDocTitle } from '../lib/useDocTitle';
import { useCrumbs } from '../app/PageTop';
import { noteRecent } from '../lib/recent';
import { ICON } from '../lib/ui';

import { OverflowTabsList } from '../components/OverflowTabsList';
/** Salary-trend hover card: the title at that snapshot, actual pay, and the full-time rate breakdown. */
function TrendTooltip({ active, payload, onHeight }: { active?: boolean; onHeight?: (h: number) => void; payload?: { payload: { full: string; title: string | null; salary: number | null; rate?: number | null; fte?: number | null; appts?: number; med?: number | null; gap?: boolean; compare?: string | null; typical?: number | null } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // A gap row only breaks the line at a reporting change; there is no snapshot there to describe.
  if (d.gap || d.salary == null) return null;
  const partTime = d.rate != null && Math.round(d.rate) !== Math.round(d.salary);
  // Its height, so a card above the pointer ends above it however many lines it has (P25).
  return (
    <div ref={(el) => { if (el) onHeight?.(el.offsetHeight); }}>
    <TipSurface>
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Actual paid: {usd(d.salary)}</Text>
      {partTime && <Text size="xs" c="dimmed">Full-time rate: {usd(d.rate)}</Text>}
      {d.fte != null && <Text size="xs" c="dimmed">Appointment: {Math.round(d.fte * 100)}% FTE</Text>}
      {d.med != null && <Text size="xs" c="dimmed">Title median: {usd(d.med)}</Text>}
      {d.compare && <Text size="xs" c="dimmed">This raise: {d.compare}</Text>}
      {d.typical != null && <Text size="xs" c="dimmed">If raises had been typical: {usd(d.typical)}</Text>}
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </TipSurface>
    </div>
  );
}

/** Title-change marker on the actual-pay line: a diamond with a faint halo (Recharts injects cx/cy). */
function TitleChangeDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  const s = 6;
  return (
    <g>
      <circle className="title-change-halo" cx={cx} cy={cy} r={MARK_HALO} fill="var(--mantine-color-accent-6)" opacity={0.15} />
      <path
        d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
        fill="var(--mantine-color-accent-7)"
        stroke="var(--mantine-color-body)"
        strokeWidth={1.5}
      />
    </g>
  );
}

/** Hover marker for the primary line: an accent dot with a soft halo. */
function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="var(--mantine-color-accent-6)" opacity={0.18} />
      <circle cx={cx} cy={cy} r={5} fill="var(--mantine-color-accent-6)" stroke="var(--mantine-color-body)" strokeWidth={2} />
    </g>
  );
}

/** Custom legend below the trend chart, explaining the title-era demarcations. */
/**
 * Dash patterns shared between the trend chart and the legend that describes it.
 *
 * They had drifted: the legend drew the title median as "5 3" against the chart's "6 4", and the
 * title-era divider as "2 3" against "2 4". A legend that doesn't match the line it labels is worse
 * than no legend — it teaches the reader a key that is wrong. Only the grade band happened to agree.
 */
const TREND_DASH = { median: '6 4', gradeBand: '4 4', era: '2 4', typical: '2 3' } as const;

function TrendLegend({ hasTitleChange, hasFte, gradeBand, mode, hasTypical = false }: { hasTitleChange: boolean; hasFte: boolean; gradeBand: { grade: number | null; min: number; max: number | null } | null; mode: 'actual' | 'rate'; hasTypical?: boolean }) {
  const item = (swatch: ReactNode, label: string) => (
    <Group gap={6} wrap="nowrap" align="center">
      {swatch}
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
  return (
    <Group gap="lg" mt="xs" wrap="wrap">
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--trend-self)" strokeWidth={2} /></svg>,
        mode === 'actual' ? 'Actual pay' : 'Full-time rate',
      )}
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--trend-ref)" strokeWidth={2} strokeDasharray={TREND_DASH.median} /></svg>,
        'Title median — resets at each title change',
      )}
      {hasTypical && item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--guide-strong)" strokeWidth={2} strokeDasharray={TREND_DASH.typical} /></svg>,
        'If raises had been typical',
      )}
      {gradeBand && item(
        <svg width={22} height={12} aria-hidden><rect x={1} y={2} width={20} height={8} fill="var(--band-fill)" /><line x1={1} y1={10} x2={21} y2={10} stroke="var(--guide-strong)" strokeWidth={1} strokeDasharray={TREND_DASH.gradeBand} /></svg>,
        // The values used to sit on the lines themselves, right-aligned — exactly where the latest
        // snapshot's chip lands, so "grade min $70,720" printed through "+3.0%".
        // A grade published with a minimum only draws that one line, and says so.
        gradeBand.max == null
          ? `${gradeBand.grade != null ? `Grade ${gradeBand.grade}` : 'Grade'} minimum ${usd(gradeBand.min)}`
          : `${gradeBand.grade != null ? `Grade ${gradeBand.grade}` : 'Grade'} band ${usd(gradeBand.min)} – ${usd(gradeBand.max)}`,
      )}
      {hasFte && item(
        <svg width={22} height={12} aria-hidden>
          <rect x={1} y={4} width={20} height={7} fill="var(--guide-strong)" fillOpacity={0.18} />
          <line x1={1} y1={4} x2={21} y2={4} stroke="var(--guide-strong)" strokeWidth={2} />
        </svg>,
        'Appointment (FTE) — lower chart',
      )}
      {hasTitleChange && item(
        <svg width={14} height={14} aria-hidden><path d="M7,1 L13,7 L7,13 L1,7 Z" fill="var(--mantine-color-accent-7)" /></svg>,
        'Title change',
      )}
      {hasTitleChange && item(
        <svg width={10} height={14} aria-hidden><line x1={5} y1={1} x2={5} y2={13} stroke="var(--mantine-color-gray-4)" strokeWidth={1} strokeDasharray={TREND_DASH.era} /></svg>,
        'New title era',
      )}
    </Group>
  );
}

/** A grade band's top above the chart (P22): named at the plot's top left, where a rising line is lowest. */
function OffChartMax({ text, offset }: { text: string; offset?: { left: number; top: number; width: number } }) {
  if (!offset) return null;
  return (
    <text className="trend-band-offchart" x={offset.left + 6} y={offset.top + 14} fontSize={CHART_FONT} fill="var(--mantine-color-dimmed)">
      {text}
    </text>
  );
}

/** The trend's hover card: below a pointer above this height (or above the card's own, if taller), above one under
 *  it (P25). Until the card has been measured, it is taken to be about TIP_H tall. */
const TIP_H = 132;
const TIP_FLIP_Y = 150;

/** The title labels' second row, a line of chart text above the first: at 14px, two 12px titles touched. */
const ERA_ROW = Math.round(CHART_FONT * 4 / 3);

/** A title era's label above the plot: one line, starting at the era's divider so it reads as "from
 *  here", on row 0 or (14px higher) row 1. `shift` pulls a label that would run off the right edge back
 *  inside it. Recharts injects `viewBox` ({ x, y }) for the vertical reference line it hangs from. */
function TitleChangeLabel({
  viewBox, title, row = 0, shift = 0,
}: { viewBox?: { x?: number; y?: number }; title?: string | null; row?: 0 | 1; shift?: number }) {
  if (!viewBox || viewBox.x == null || viewBox.y == null || !title) return null;
  return (
    <text className="trend-era-label" x={viewBox.x + shift} y={viewBox.y - 5 - (row === 1 ? ERA_ROW : 0)} textAnchor="start" fontSize={CHART_FONT} fill="var(--mantine-color-dimmed)">
      {title}
    </text>
  );
}

/** One horizontal percentile bar for the "Standing" small-multiples: label + rank on the left, a track
 *  with a neutral fill to p%, the pool median's tick, and a marker coloured by its side of the median (up
 *  green above, down red below), and the percentile on the right. The fill was green above the median
 *  and grey below, so a below-median pool looked switched off (P15). The fill + marker sweep in
 *  left→right on mount (staggered by `delay`). */
function PercentileBar({ label, n, below, pct, delay = 0 }: { label: string; n?: number; below?: number; pct?: number; delay?: number }) {
  // Drawn at their final state at once where no entrance plays (a tab switch, Reduce Motion: G8).
  const entrance = useEntrance();
  const mounted = useMounted() || !entrance;
  // Its counts still coming: the row at its final size, the label real and the rest placeholders.
  if (n == null || below == null || pct == null) {
    return (
      <Group wrap="nowrap" gap="md" align="center">
        <div style={{ flex: '0 0 35%', minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={2} title={label}>{label}</Text>
          <Skeleton height={13} width={84} radius="sm" my={2.5} />
        </div>
        <Skeleton height={10} radius="sm" style={{ flex: 1 }} />
        <Skeleton height={16} width={72} radius="sm" ml={32} />
      </Group>
    );
  }
  const side = pct > 50 ? 'above' : pct < 50 ? 'below' : 'at';
  const tick = side === 'above' ? 'var(--mark-up)' : side === 'below' ? 'var(--mark-down)' : 'var(--guide-strong)';
  const sweep = `var(--dur-base) var(--ease) ${delay}ms`;
  return (
    // `chart-plot` for the same reason PayBandBar and PeerRangeBar carry it: a plotted figure built
    // from divs rather than SVG.
    <Group className="chart-plot" wrap="nowrap" gap="md" align="center">
      {/* A wider label column (P16): at 210px a pool's name wrapped to three lines while the bar took 65%. */}
      <div style={{ flex: '0 0 35%', minWidth: 0 }}>
        <Text size="sm" fw={500} lineClamp={2} title={label}>{label}</Text>
        <Text size="xs" c="dimmed">#{num(n - below)} of {num(n)}</Text>
      </div>
      <div style={{ flex: 1, position: 'relative', height: 10, background: 'var(--mantine-color-default-hover)', borderRadius: 6 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${mounted ? pct : 0}%`, background: 'var(--mantine-color-gray-5)', opacity: 0.5, borderRadius: 6, transition: `width ${sweep}` }} />
        {/* The pool median, a tick that clears the track and is named once, over the first bar. */}
        <div className="standing-median" style={{ position: 'absolute', left: '50%', top: -4, bottom: -4, width: 2, background: 'var(--guide-strong)', transform: 'translateX(-50%)' }} />
        <div className="standing-marker" data-side={side} style={{ position: 'absolute', left: `${mounted ? pct : 0}%`, top: -3, bottom: -3, width: 4, borderRadius: 2, background: tick, transform: 'translateX(-50%)', transition: `left ${sweep}` }} />
      </div>
      <Text size="sm" fw={700} style={{ width: 104, flexShrink: 0, textAlign: 'right' }}>
        <Text span size="xs" fw={500} c="dimmed">more than</Text> {pct}%
      </Text>
    </Group>
  );
}


interface Row {
  first_name: string | null;
  last_name: string | null;
  snapshot_id: string;
  snapshot_label: string;
  snapshot_date: string;
  school: string | null;
  department: string | null;
  title: string | null;
  job_code: string | null;
  salary: number | null;
  salary_fte_adjusted: number | null;
  fte: number | null;
  date_of_hire: string | null;
  employee_category: string | null;
  grade_number: number | null;
  grade_basis: string | null;
  salary_grade_raw: string | null;
  flsa_status: string | null;
  comp_basis: string | null;
  pay_rate_type: string | null;
  employee_type: string | null;
  contract_type: string | null;
}

interface PeerStats {
  n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; hi: number | null;
  med_rate: number | null; p75_rate: number | null;
}
interface PeerRow { person_key: string; fn: string | null; ln: string | null; school: string | null; department: string | null; tenure: number | null; pay: number }
type PeerSortKey = 'name' | 'school' | 'tenure' | 'salary';

export default function Person() {
  // Scopes this page's chart <defs>. An SVG id is document-global, so a literal here would collide
  // with any second instance — see chartDefs.
  const gradId = useId();
  const { id } = useParams();
  const key = decodeURIComponent(id ?? '');
  const nav = useNavigate();
  const { add, has, remove } = useTray();
  const { metric } = useControls();

  // Active tab lives in the URL (?tab=…), same convention as Explore, so a shared/bookmarked link
  // opens on the same tab; "overview" is the implicit default and stays out of the query string.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const setTab = (v: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!v || v === 'overview') n.delete('tab');
        else n.set('tab', v);
        return n;
      },
      { replace: true }
    );

  const { data, isLoading, error } = useSql<Row>(['person', key], personRowsSql(key), !!key);
  const { data: grades } = useGrades();

  const { data: summary } = useSummary();

  const rows = useMemo(() => data ?? [], [data]);
  // An address from before a person split in two was joined back leads to them as they are now.
  const alias = usePersonAlias(key, !!data && !data.length);
  // The job the page names them by and compares them in: their main appointment in their latest snapshot
  // (queries `MAIN_KEY`, the highest FTE). It was the last row fetched, which within a snapshot is any of them.
  const latest = useMemo(() => latestMain(rows), [rows]);
  // Their other appointments then, named under the title.
  const also = useMemo(() => otherAppts(latestRows(rows)), [rows]);
  // Which of them actual pay counts (queries `personPay`): the line says of the rest that it leaves them out.
  const counts = useMemo(() => new Set(countedAppts(latestRows(rows))), [rows]);
  const name = (latest ? fullName(latest.first_name, latest.last_name) : '') || key;
  useDocTitle(latest ? name : 'People');
  // "People / System Engineer IV / Aaron Smetana": the landing (where a person is found), their title's page,
  // and them. The trail is one line either way, so it can wait for the record without moving anything.
  useCrumbs(latest ? [
    { label: 'People', to: '/people' },
    ...(latest.title ? [{ label: latest.title, to: latest.job_code ? `/titles?code=${encodeURIComponent(latest.job_code)}` : undefined }] : []),
    { label: name },
  ] : [{ label: 'People', to: '/people' }]);
  // The People page's "Recently viewed": this person, at the front, once their record is in.
  useEffect(() => {
    if (latest) noteRecent({ key, name, title: latest.title ?? null });
  }, [key, latest, name]);

  // Flag people who aren't in the most recent snapshot (likely no longer employed).
  const campusLatest = summary?.snapshots[summary.snapshots.length - 1] ?? null;
  const departed = !!(latest && campusLatest && String(latest.snapshot_date) < String(campusLatest.date));

  // Nominal (as-reported) vs real (inflation-adjusted to REAL_BASE_YEAR dollars) for the trend chart.
  const [dollarMode, setDollarMode] = usePref<'nominal' | 'real'>('dollarMode', 'nominal');

  // Salary trend: one point per snapshot. `salary` (the plotted line) is ACTUAL pay — the reported
  // FTE-adjusted figure (salary_fte_adjusted, falling back to rate × FTE), summed across the appointments
  // it counts (queries `personPay`: a salaried person's hourly jobs are left out, and someone holding only
  // hourly jobs is at one rate). We also carry their full-time `rate` and total `fte` for the breakdown.
  const trend = useMemo(() => {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const ttcSuffix = (id: string) => (id.endsWith('-pre') ? ' (Pre-TTC)' : id.endsWith('-post') ? ' (Post-TTC)' : '');
    const fullLabel = (date: string, id: string) => {
      const m = Number(String(date).slice(5, 7));
      return `${MONTHS[m - 1] ?? ''} ${String(date).slice(0, 4)}${ttcSuffix(id)}`.trim();
    };
    const by = new Map<string, { id: string; label: string; full: string; date: string; rows: Row[] }>();
    for (const r of rows) {
      let cur = by.get(r.snapshot_id);
      if (!cur) {
        cur = { id: r.snapshot_id, label: r.snapshot_label, full: fullLabel(r.snapshot_date, r.snapshot_id), date: r.snapshot_date, rows: [] };
        by.set(r.snapshot_id, cur);
      }
      cur.rows.push(r);
    }
    return [...by.values()]
      .map((g) => {
        const counted = countedAppts(g.rows);
        const appts = counted.length;
        const paid = personActualPay(g.rows);
        const rate = personRate(g.rows);
        // null, not 0, when no appointment records a percentage — every row here is hourly. Summed
        // as a number it reported "Appointment: 0% FTE" in the trend tooltip, which says the person
        // does not work; the honest answer is that the source does not say.
        const fte = counted.some((r) => r.fte) ? counted.reduce((s, r) => s + (r.fte ?? 0), 0) : null;
        // The main appointment (queries `MAIN_KEY`) names the snapshot; `codes` are every job held, so a
        // swap between two of them is not drawn as a title change (payHistory `mainSwapped`).
        const primary = mainRow(g.rows)!;
        const codes = g.rows.map((r) => r.job_code);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary: paid, rate, fte, title: primary.title, job_code: primary.job_code, codes, appts, basis: primary.comp_basis, grade: primary.grade_number, gradeBasis: primary.grade_basis };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

  // Each continuing raise against that step's raises campus-wide, the path pay would have taken had
  // every raise been typical, and where the difference came from (lib/raiseContext) — on actual pay.
  const raiseCtx = useRaiseContext(key, trend, 'fte');

  // Median pay for the title the person held at each snapshot (market context for the trend).
  const { data: titleMedRows } = useSql<{ snapshot_id: string; med: number | null; med_rate: number | null }>(
    ['person-title-med', key],
    `WITH me AS (SELECT snapshot_id, ${mainOf('job_code')} job FROM salaries
        WHERE person_key = ${sqlStr(key)} GROUP BY snapshot_id),
      pp AS (SELECT s.snapshot_id, s.person_key, ${personPay('fte')} pay, ${TITLE_RATE} rate
        FROM salaries s JOIN me ON s.snapshot_id = me.snapshot_id AND s.job_code = me.job
        GROUP BY s.snapshot_id, s.person_key)
     SELECT snapshot_id, median(pay) med, median(rate) med_rate FROM pp WHERE pay > 0 GROUP BY snapshot_id`,
    !!key
  );
  const trendData = useMemo(() => {
    const med = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med]));
    const medRate = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med_rate]));
    // `era` increments at each title change so the median can be drawn as disconnected per-title segments
    // (lib/payHistory `titleEras`: the TTC relabel that only re-spells a title is not one).
    const eraOf = titleEras(trend);
    return trend.map((t, i) => {
      const era = eraOf[i];
      const medRaw = med.get(t.id) ?? null;
      const medRateRaw = medRate.get(t.id) ?? null;
      const typRaw = raiseCtx.typical.get(t.id) ?? null;
      const cmp = raiseCtx.comparisons.get(t.id);
      const compare = cmp ? `${cmp.text}${cmp.title ? ` · for this title ${fmtChange(cmp.title.med)} (${num(cmp.title.n)} people)` : ''}` : null;
      if (dollarMode !== 'real') return { ...t, med: medRaw, medRate: medRateRaw, era, typical: typRaw, compare };
      // Real mode: convert every dollar figure to REAL_BASE_YEAR purchasing power using this snapshot's year.
      const year = Number(String(t.date).slice(0, 4)) || REAL_BASE_YEAR;
      return {
        ...t,
        salary: toReal(t.salary, year),
        rate: toReal(t.rate, year),
        med: medRaw != null ? toReal(medRaw, year) : null,
        medRate: medRateRaw != null ? toReal(medRateRaw, year) : null,
        era,
        typical: typRaw != null ? toReal(typRaw, year) : null,
        compare,
      };
    });
  }, [trend, titleMedRows, dollarMode, raiseCtx]);

  // Distinct title eras (for disconnected median segments) and the points where the title changes.
  const eras = useMemo(() => [...new Set(trendData.map((t) => t.era))], [trendData]);
  const titleChanges = useMemo(
    () => trendData.map((t, idx) => ({ ...t, idx })).filter((t, i) => i > 0 && t.era !== trendData[i - 1].era && !mainSwapped(trendData[i - 1], t)),
    [trendData],
  );
  // Plot rows, on the date axis (snapTime): x is the snapshot's own date, so the same-day TTC relabel
  // is a sliver and the fourteen months from Aug 2022 to Oct 2023 are fourteen months wide. Each row
  // carries its change from the previous snapshot for the chips — except where there is no change to
  // show: the TTC twins are one date relabelled, and across a reporting break the two figures are on
  // different footings. There a gap row sits between the sides, so the line, its fill and its glow all
  // stop instead of drawing the ×11/9 of the Sep 2025 9-month change as a rise.
  type TrendPoint = (typeof trendData)[number];
  type PlotRow = Omit<TrendPoint, 'salary' | 'rate' | 'fte' | 'med' | 'medRate' | 'typical'> & {
    x: number; salary: number | null; rate: number | null; fte: number | null; med: number | null; medRate: number | null; typical: number | null;
    yoyActual: number | null; yoyRate: number | null; gap?: boolean;
  };
  const trendBreaks = useMemo(() => reportingBreaks(trendData), [trendData]);
  // The change the first break is, named from the break itself (not from the growth card's tally).
  const breakChange = trendBreaks.length ? reportingChange(trendData[trendBreaks[0] - 1].basis, trendData[trendBreaks[0]].basis) : null;
  const trendPlot = useMemo(() => {
    const breaks = new Set(trendBreaks);
    const out: PlotRow[] = [];
    trendData.forEach((t, i) => {
      const prev = i > 0 ? trendData[i - 1] : null;
      const x = snapX(t.date, t.id);
      const measurable = !!prev && String(prev.date) !== String(t.date) && !breaks.has(i);
      if (prev && breaks.has(i)) {
        out.push({
          ...prev, x: (snapX(prev.date, prev.id) + x) / 2, gap: true,
          salary: null, rate: null, fte: null, med: null, medRate: null, typical: null, yoyActual: null, yoyRate: null,
        });
      }
      out.push({
        ...t,
        x,
        yoyActual: measurable && prev!.salary ? (t.salary - prev!.salary) / prev!.salary : null,
        yoyRate: measurable && prev!.rate ? (t.rate - prev!.rate) / prev!.rate : null,
      });
    });
    return out;
  }, [trendData, trendBreaks]);
  // Where the line breaks at a reporting change: a marker at the gap and the change named beside it,
  // as Trends and the starting-group chart mark it (snapTime's KNOWN_BREAKS). Its words go along the
  // baseline: the top margin is the title eras'.
  const breakMarks = useMemo(() => trendPlot.flatMap((r, i) => {
    if (!r.gap) return [];
    const next = trendPlot[i + 1];
    const kb = KNOWN_BREAKS.find((k) => k.kind === 'reporting' && k.snapshotId === next?.id);
    return [{ key: next?.id ?? String(i), x: r.x, texts: kb ? [kb.label, kb.short] : ['pay reported differently'] }];
  }), [trendPlot]);
  // Plot rows that carry a title-change marker: the chips keep clear of them.
  const markIdx = useMemo(
    () => trendPlot.flatMap((r, i) => (i > 0 && !r.gap && r.era !== trendPlot[i - 1].era ? [i] : [])),
    [trendPlot],
  );
  const trendAxis = useMemo(() => snapAxisProps(trendData), [trendData]);
  // Hide the FTE sub-chart entirely when the appointment never changes — a flat 100% line is pure noise.
  const fteVaries = useMemo(
    () => new Set(trendData.map((t) => Math.round((t.fte ?? 1) * 100))).size > 1,
    [trendData],
  );
  // Each title era's faint background band, from its first snapshot to the next era's (or the end),
  // so the bands meet at the divider rather than leaving the gap between two eras unshaded.
  const eraSpans = useMemo(() => {
    const firsts: { era: number; x: number }[] = [];
    for (const t of trendData) {
      if (!firsts.length || firsts[firsts.length - 1].era !== t.era) firsts.push({ era: t.era, x: snapX(t.date, t.id) });
    }
    const end = trendData.length ? snapX(trendData[trendData.length - 1].date, trendData[trendData.length - 1].id) : 0;
    return firsts.map((f, i) => ({ era: f.era, x1: f.x, x2: i + 1 < firsts.length ? firsts[i + 1].x : end }));
  }, [trendData]);

  // The title-era labels above the chart, laid out at the chart's real width: each starts at its own
  // divider (the first at the left edge, which has none), on one of two rows. Centred on the divider,
  // a label straddled both eras it separates. When they cannot all fit — a phone, several short eras,
  // long titles — they are listed under the chart instead: drawn anyway, they printed on each other.
  const [trendBoxRef, trendWidth] = useWidth<HTMLDivElement>();
  const eraLayout = useMemo(() => {
    const labels = [
      ...(eras.length > 1 && trendData[0]?.title ? [{ key: 'first', x: snapX(trendData[0].date, trendData[0].id), title: trendData.filter((t) => t.era === trendData[0].era).slice(-1)[0]?.title ?? trendData[0].title, from: trendData[0].label }] : []),
      ...titleChanges.map((t) => ({ key: t.id, x: snapX(t.date, t.id), title: t.title, from: t.label })),
    ].filter((l): l is typeof l & { title: string } => !!l.title);
    const none = { labels: [] as (typeof labels[number] & { row: 0 | 1; shift: number })[], fold: false, rows: 0 };
    if (!labels.length) return none;
    // Unmeasured (the first render, or a hidden tab): nothing to place yet, and the chart is not
    // drawn at width 0 either. Listing the titles only to pull them back into the chart would flash.
    if (!trendWidth) return none;
    const [lo, hi] = trendAxis.domain;
    const left = 12 + 80 + 16; // margin + y-axis + axis padding
    const right = trendWidth - 30 - 16;
    const px = (x: number) => left + (hi > lo ? ((x - lo) / (hi - lo)) * (right - left) : 0);
    const placed = labels.map((l) => {
      const at = px(l.x);
      const w = measureText(l.title, CHART_FONT);
      const shift = Math.min(0, trendWidth - 2 - (at + w));
      return { ...l, shift, span: { left: at + shift, right: at + shift + w } };
    });
    // Packed from the right edge, so where two labels collide it is the earlier one that rises: read
    // top to bottom, a stack runs in date order.
    const fromRight = packLabelRows([...placed].reverse().map((p) => ({ left: -p.span.right, right: -p.span.left })), { left: -trendWidth, right: 0 }, 2, 10);
    const rows = fromRight && [...fromRight].reverse();
    if (!rows) return { labels: placed.map((p) => ({ ...p, row: 0 as 0 | 1 })), fold: true, rows: 0 };
    return { labels: placed.map((p, i) => ({ ...p, row: rows[i] as 0 | 1 })), fold: false, rows: Math.max(...rows) + 1 };
  }, [eras.length, trendData, titleChanges, trendWidth, trendAxis]);

  // As-of the latest snapshot (not today) — matches the peer SQL's tenure basis (Person.tsx peer
  // queries use snapshot_date), so this card, the tenure-curve callout, and the peer table all agree.
  const tenureYears = useMemo(() => {
    const hire = latestHire(rows);
    const asOf = rows[rows.length - 1]?.snapshot_date;
    if (!hire || !asOf) return null;
    return Math.max(0, (new Date(asOf).getTime() - new Date(hire).getTime()) / (365.25 * 864e5));
  }, [rows]);

  const firstSalary = trend[0]?.salary ?? null; // actual paid
  const lastSalary = trend[trend.length - 1]?.salary ?? null; // actual paid
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;
  // Span of available salary data (oldest → latest snapshot) — the window the change is measured over.
  const firstDate = trend[0]?.date ?? null;
  const lastDate = trend[trend.length - 1]?.date ?? null;
  const spanYears = firstDate && lastDate ? (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 864e5) : null;
  const oldestLabel = trend[0]?.label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? null;
  const hireYear = latestHire(rows)?.slice(0, 4) ?? trend[0]?.date?.slice(0, 4) ?? null;
  // Full-time rate (and its growth) — shown alongside actual pay where they diverge (FTE changes).
  const firstRate = trend[0]?.rate ?? null;
  const lastRate = trend[trend.length - 1]?.rate ?? null;
  const lastFte = trend[trend.length - 1]?.fte ?? null;
  const rateChange = firstRate && lastRate ? (lastRate - firstRate) / firstRate : null;
  const partTime = lastRate != null && lastSalary != null && Math.round(lastRate) !== Math.round(lastSalary);
  // Paid by the hour alone in the latest snapshot: no appointment it counts records a percentage.
  const hourlyOnly = trend.length > 0 && lastFte == null && (lastSalary ?? 0) > 0;
  const chgDiffer = totalChange != null && rateChange != null && Math.abs(totalChange - rateChange) > 0.005;
  const sgnPct = (x: number | null) => (x == null ? '—' : fmtChange(x));
  // Below the precision the card prints, a change is flat — the same threshold as fmtChange's "0%".
  // The reporting changes this history crosses. Their factor is inside `totalChange` and none of it
  // is pay: a 9-month member's growth jumped by ×11/9 in Sep 2025 without a dollar more.
  const reporting = useMemo(() => reportingAcross(trend.map((t) => t.basis)), [trend]);
  // The headline growth, like for like and on the full-time rate where the FTE moved (lib/growth): the Report
  // works it out the same way. The figure as reported is in the note under the bars.
  const { payLfl, firstFte, fteMoved, growth: growthLfl } = headlineGrowth(trend, reporting.factor);

  // One-line career summary under the header. Only surface a prior title when it's a genuine *pre-TTC* title
  // (the person's earliest record is the pre-TTC snapshot and the title differs from now) — we can't assume the
  // hire-era title otherwise. The current title is the line above's first words, so it is not said again here.
  // The title they held before the TTC relabel, when it differs from today's: the header's one line of history.
  // "At UW since" was said here and again in the Tenure figure (P4); the old title was printed in the source's
  // capitals (P5).
  const preTtcTitle = useMemo(() => {
    const firstTitle = trend[0]?.title;
    const latestTitle = latest?.title;
    if (!latestTitle || !firstTitle || !trend[0]?.id?.endsWith('-pre') || sameTitleText(firstTitle, latestTitle)) return null;
    return legacyTitle(firstTitle);
  }, [trend, latest]);

  // The band is read against the main appointment's grade, at its full-time rate (queries `gradedAppt`):
  // `lastRate` sums every appointment's rate, which for someone holding two is neither job's.
  const graded = useMemo(() => gradedAppt(rows.filter((r) => r.snapshot_id === latest?.snapshot_id)), [rows, latest]);
  const bandRate = graded?.rate ?? null;
  // The grade's range, or its minimum when HR publishes only that (lib/bands) — in the units the person's
  // own latest snapshot reports pay in.
  const band = useMemo(() => (graded ? bandFor(grades, graded.grade, graded.basis, graded.comp) : null), [graded, grades]);
  const range = isRange(band) ? band : null;

  const lastSnap = latest?.snapshot_id ?? '';
  // Where this pay stands in each pool the person belongs to (standingSql — the one query the printed
  // report uses too): per person, the department inside its school, a grade on its own schedule.
  const mine = lastSalary ?? 0;
  // Within the title, their full-time rate in it, as the Overview compares them (queries `TITLE_RATE`).
  const titleRate = useMemo(
    () => (latest?.job_code ? personRate(latestRows(rows).filter((r) => r.job_code === latest.job_code)) || null : null),
    [rows, latest],
  );
  const { data: standingRows } = useSql<{
    n_all: number; b_all: number; n_div: number; b_div: number; n_dept: number; b_dept: number;
    n_grade: number; b_grade: number; n_title: number; b_title: number;
  }>(
    ['standing', key, lastSnap, mine, titleRate ?? 0],
    standingSql({
      snapshotId: lastSnap, pay: mine, metric: 'fte', school: latest?.school, department: latest?.department,
      grade: latest?.grade_number, gradeBasis: latest?.grade_basis, jobCode: latest?.job_code, titleRate,
    }),
    !!latest && lastSalary != null && lastSalary > 0
  );
  // The pools this person is in, known from their own row before the counts are: the card is drawn at its
  // final size from the start (their labels, and placeholders for the bars), rather than arriving above the
  // pay band and the simulator and pushing them down (layout shift 0.21).
  const poolLabels = useMemo(() => {
    return [
      { key: 'all', label: 'All UW–Madison', ok: true },
      { key: 'div', label: latest?.school ?? 'Division', ok: !!latest?.school },
      // "Dept: Administration" (P16), its school on the line above it in this list; it was "Administration ·
      // School of Medicine and Public Health", three lines in a squeezed column.
      { key: 'dept', label: latest?.department ? `Dept: ${latest.department}` : 'Department', ok: !!latest?.department },
      { key: 'grade', label: `Grade ${fmtGrade(latest?.grade_number, latest?.grade_basis)}`, ok: latest?.grade_number != null },
      { key: 'title', label: latest?.title ?? 'Title', ok: !!latest?.job_code },
    ].filter((x) => x.ok);
  }, [latest]);
  const standingPools = useMemo(() => {
    const r = standingRows?.[0];
    if (!r) return [];
    const count = { all: [r.n_all, r.b_all], div: [r.n_div, r.b_div], dept: [r.n_dept, r.b_dept], grade: [r.n_grade, r.b_grade], title: [r.n_title, r.b_title] } as const;
    return poolLabels
      .map((x) => ({ label: x.label, n: count[x.key as keyof typeof count][0], below: count[x.key as keyof typeof count][1] }))
      .filter((x) => x.n >= MIN_GROUP)
      .map((x) => ({ ...x, pct: poolPercentile(x.below, x.n)! }));
  }, [standingRows, poolLabels]);

  // Same-title peers = everyone sharing this person's job_code at the latest snapshot, each at their full-time
  // rate in it (queries `TITLE_RATE`), so a part-time appointment is not read as underpaid.
  const jobCode = latest?.job_code ?? null;
  const { data: peerStatsRows } = useSql<PeerStats>(
    ['peer-stats', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, ${TITLE_RATE} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi,
            median(pay) med_rate, quantile_cont(pay, 0.75) p75_rate FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peers } = useSql<PeerRow>(
    ['peer-list', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(school) school, any_value(department) department,
        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 AS tenure,
        ${TITLE_RATE} pay
        FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, tenure, pay FROM pp WHERE pay > 0 ORDER BY pay DESC`,
    !!lastSnap && !!jobCode
  );
  // Where the title's charts zoom to — the middle 90% of everyone with it, when a few far out would
  // squeeze the rest (lib/payWindow) — and which of the piles of people outside it the table lists.
  const payWin = useMemo(() => payWindow((peers ?? []).map((p) => p.pay)), [peers]);
  const [pileShown, setPileShown] = useState<-1 | 0 | 1>(0);
  const peerCardRef = useRef<HTMLDivElement>(null);
  // ── Cohort (All vs Same-school): every overview stat derives from the SAME filtered peer set. ──
  const [cohort, setCohort] = useState<'all' | 'school'>('all');
  // The person pointed at on the overview — in the strip, the scatter or the table — shown in all three.
  const [pointed, setPointed] = useState<string | null>(null);
  useEffect(() => setPileShown(0), [cohort, key]);
  const sameSchoolPeers = useMemo(
    () => (peers ?? []).filter((p) => p.school != null && p.school === latest?.school),
    [peers, latest],
  );
  const allCount = peers?.length ?? 0;
  const schoolCount = sameSchoolPeers.length;
  const cohortList = useMemo(
    () => (cohort === 'school' ? sameSchoolPeers : peers ?? []),
    [cohort, sameSchoolPeers, peers],
  );
  const cohortPays = useMemo(() => cohortList.map((p) => p.pay), [cohortList]);
  // Fixed x-domain for the histogram (full-title range) so the "same school" subset visibly thins.
  const allPaysDomain = useMemo<[number, number] | undefined>(() => {
    const a = (peers ?? []).map((p) => p.pay);
    return a.length ? [Math.min(...a), Math.max(...a)] : undefined;
  }, [peers]);
  const cohortStats = useMemo(() => {
    const s = [...cohortPays].sort((a, b) => a - b);
    if (!s.length) return null;
    const q = (p: number) => {
      const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return s[lo] + (s[hi] - s[lo]) * (i - lo);
    };
    return { n: s.length, lo: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), hi: s[s.length - 1] };
  }, [cohortPays]);
  const cohortRank = useMemo(() => {
    const i = cohortList.findIndex((p) => p.person_key === key);
    return i >= 0 ? i + 1 : null;
  }, [cohortList, key]);
  // The subject AS A MEMBER OF THIS COHORT: their full-time rate in the title, as everyone else in it is
  // measured, which is not their actual pay. A part-time appointment's actual pay is a fraction of its rate,
  // and `lastSalary` sums every appointment: measured that way a Crowd Control Officer who is also a Police
  // Officer read as "paid more than 101% of people with this title".
  const cohortSelfPay = useMemo(
    () => cohortList.find((p) => p.person_key === key)?.pay ?? lastSalary,
    [cohortList, key, lastSalary],
  );
  const ratePlotted = cohortSelfPay != null && lastSalary != null && Math.round(cohortSelfPay) !== Math.round(lastSalary);
  const cohortPct = cohortSelfPay != null && cohortSelfPay > 0 && cohortPays.length > 1 ? percentile(cohortSelfPay, cohortPays) : null;
  // Too few to summarize (stats `MIN_GROUP`): no share, spread or rank, but the others' rates themselves.
  const spread = !!cohortStats && cohortStats.n >= MIN_GROUP && cohortStats.hi > cohortStats.lo;
  const fewOthers = useMemo(
    () => (cohortStats && cohortStats.n >= 2 && cohortStats.n < MIN_GROUP
      ? cohortList.filter((p) => p.person_key !== key).sort((a, b) => b.pay - a.pay)
      : null),
    [cohortStats, cohortList, key],
  );
  /** What both overview charts write beside this person's mark: "Aaron · $116,491". */
  const selfLabel = latest?.first_name?.trim() || 'This person';

  // Everyone with the title, marked once: both charts on this tab are handed the same array, so they cannot
  // disagree about who is the subject and who shares their school (the scatter drops those whose tenure the
  // source never recorded). Those outside the chosen cohort stay where they are, dimmed, so "Same school"
  // thins the picture instead of redrawing it.
  const allPoints = useMemo(
    () => (peers ?? []).map((p) => {
      const sameSchool = p.person_key !== key && !!p.school && p.school === latest?.school;
      const isSelf = p.person_key === key;
      return {
        pay: p.pay,
        tenure: p.tenure,
        sameSchool,
        isSelf,
        name: fullName(p.fn, p.ln) || '—',
        personKey: p.person_key,
        dimmed: cohort === 'school' && !sameSchool && !isSelf,
      };
    }),
    [peers, key, latest, cohort],
  );
  // The scatter is handed everyone too, those outside the chosen cohort dimmed; it fits its line to the cohort.
  const scatterPoints = useMemo<ScatterPoint[]>(
    () => allPoints
      .filter((p) => p.tenure != null && Number.isFinite(p.tenure))
      .map(({ tenure, ...rest }) => ({ ...rest, tenure: Math.max(0, tenure as number) })),
    [allPoints],
  );
  const selfScatter = useMemo(() => {
    const s = cohortList.find((p) => p.person_key === key);
    return s && s.tenure != null && Number.isFinite(s.tenure) ? { tenure: Math.max(0, s.tenure), pay: s.pay } : null;
  }, [cohortList, key]);

  const typicalGrowth = useMemo(() => {
    const canon = trend.filter((t) => !t.id.endsWith('-pre') && t.salary > 0);
    const first = canon[0] && raiseCtx.typical.get(canon[0].id);
    const last = canon.length > 1 ? raiseCtx.typical.get(canon[canon.length - 1].id) : undefined;
    return first && last ? last / first - 1 : null;
  }, [trend, raiseCtx.typical]);

  const [trendMode, setTrendMode] = useState<'actual' | 'rate'>('actual');
  // The band's lines only where the line drawn is in the band's unit: a full-time rate, and the rate of the
  // graded appointment. A half-time actual-pay line under a full-time range reads as half the band below it.
  const shown = trendMode === 'rate' ? lastRate : lastSalary;
  /** The trend's figure, named for what it plots (G2): the toggle read "Rate" and the line "Salary rate". */
  const trendMeasure = trendMode === 'rate' ? 'Full-time rate' : 'Actual pay';
  const trendBand = band && bandRate != null && shown != null && Math.round(shown) === Math.round(bandRate) ? band : null;
  const trendEntrance = useEntrance('person-trend');
  // The chart opens on the pay and the title median (P23); the typical-raise path and the grade band are a
  // choice away. All of it at once — six legend entries, a chip on every point, eras, diamonds and a band —
  // was too much to read.
  const [showTypical, setShowTypical] = useState(false);
  const [trendTipY, setTrendTipY] = useState<number | null>(null);
  const [trendTipH, setTrendTipH] = useState(TIP_H);
  const [showBand, setShowBand] = useState(false);
  // Round steps from $0 to the highest line drawn (lib/rangeScale): Recharts' own read $0 / $45,000 / $90,000.
  // Fitted to the person and the title median (P22), never stretched to the band's top: a $183k maximum held a
  // $72k → $116k line flat in the lower half. The band is clipped to the plot and its top named off the chart.
  const trendTicks = useMemo(() => {
    const vals = trendPlot.flatMap((r) => (trendMode === 'actual' ? [r.salary, r.med, ...(showTypical ? [r.typical] : [])] : [r.rate, r.medRate]));
    const top = Math.max(1, ...vals.filter((v): v is number => v != null && Number.isFinite(v)));
    return moneyTicks(0, top);
  }, [trendPlot, trendMode, showTypical]);
  const trendTop = trendTicks[trendTicks.length - 1] ?? 0;
  const bandShown = showBand && trendBand ? trendBand : null;

  // The table opens on the people round the subject (AROUND either side of them), with the rest one "Show all"
  // away, and a filter over name, school and department; no scroll box inside the page (G11). It used to open
  // on the top 25, or on everyone in a 460px scroll box centred on the subject.
  const [showAllPeers, setShowAllPeers] = useState(false);
  const [peerFilter, setPeerFilter] = useState('');
  const [peerSort, setPeerSort] = useState<SortState<PeerSortKey>>({ key: 'salary', dir: 'desc' });
  // The table's own display order (independent of cohortRank, which stays a fixed pay-rank stat for
  // the "#N of M" caption above regardless of how the table below is currently sorted).
  const sortedCohort = useMemo(() => {
    const arr = cohortList.filter((p) => !pileShown || sideOf(payWin, p.pay) === pileShown);
    arr.sort((a, b) => {
      let cmp: number;
      switch (peerSort.key) {
        case 'name': cmp = fullName(a.fn, a.ln).localeCompare(fullName(b.fn, b.ln)); break;
        case 'school': cmp = (a.school ?? '').localeCompare(b.school ?? ''); break;
        case 'tenure': cmp = (a.tenure ?? 0) - (b.tenure ?? 0); break;
        default: cmp = a.pay - b.pay;
      }
      return peerSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [cohortList, peerSort, pileShown, payWin]);
  const subjectIndexInSort = useMemo(() => sortedCohort.findIndex((p) => p.person_key === key), [sortedCohort, key]);
  const peerQuery = peerFilter.trim().toLowerCase();
  const filteredPeers = useMemo(
    () => (peerQuery
      ? sortedCohort.filter((p) => `${fullName(p.fn, p.ln)} ${p.school ?? ''} ${p.department ?? ''}`.toLowerCase().includes(peerQuery))
      : sortedCohort),
    [sortedCohort, peerQuery],
  );
  const AROUND = 4;
  const windowed = !peerQuery && !pileShown && !showAllPeers && sortedCohort.length > 2 * AROUND + 1;
  const visiblePeers = useMemo(() => {
    if (!windowed) return filteredPeers;
    const start = subjectIndexInSort < 0 ? 0 : Math.max(0, Math.min(sortedCohort.length - (2 * AROUND + 1), subjectIndexInSort - AROUND));
    return sortedCohort.slice(start, start + 2 * AROUND + 1);
  }, [windowed, filteredPeers, sortedCohort, subjectIndexInSort]);
  const selfPeerPay = useMemo(() => cohortList.find((p) => p.person_key === key)?.pay ?? null, [cohortList, key]);
  // A pile pressed on the strip lists its people here, and brings the table into view; pressed again,
  // everyone is back.
  const showPile = (side: -1 | 1) => {
    const next = pileShown === side ? 0 : side;
    setPileShown(next);
    if (next) requestAnimationFrame(() => peerCardRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }));
  };

  const [pctRaise, setPctRaise] = useState<number>(2);
  const [years, setYears] = useState<number>(5);

  // Raise presets, each a rate of CONTINUING raises (continuingRaisesSql — same title, same FTE, same
  // pay basis) on the full-time rate, compounded over this person's time in the data and annualized.
  // The old "My recent avg" was first-to-last growth, so it projected a promotion forward as if it
  // came every year; "Title median growth" chained the medians of three different titles.
  // Only once the Pay tab is opened: every raise on campus is ~6× the standing query, and DuckDB runs
  // one query at a time, so fetched with the page it held back the Overview's peer cards by a second
  // for presets the reader may never open.
  const payOpen = tab === 'pay';
  const { data: raiseSteps } = useSql<RaiseStep>(
    ['raise-steps', latest?.job_code ?? ''],
    raiseStepsSql({ metric: 'full', jobCode: latest?.job_code }),
    !!latest && payOpen
  );
  const { data: ownRaises } = useSql<{ from_date: string; to_date: string; r: number }>(
    ['own-raises', key],
    `SELECT from_date, to_date, r FROM (${continuingRaisesSql({ metric: 'full', where: `person_key = ${sqlStr(key)}` })}) ORDER BY from_date`,
    !!key && payOpen
  );
  const presets = useMemo(() => {
    // This person's span in the data, from their first snapshot after the TTC relabel.
    const canon = trend.filter((t) => !t.id.endsWith('-pre'));
    const from = canon[0]?.date;
    const to = canon[canon.length - 1]?.date;
    const inSpan = (raiseSteps ?? []).filter((st) => from && to && st.from_date >= String(from).slice(0, 10) && st.to_date <= String(to).slice(0, 10));
    const uw = annualized(inSpan.filter((st) => st.med != null).map((st) => ({ from: st.from_date, to: st.to_date, rate: st.med! })));
    const title = annualized(
      inSpan.filter((st) => st.n_title >= MIN_TITLE_STEP && st.med_title != null).map((st) => ({ from: st.from_date, to: st.to_date, rate: st.med_title! }))
    );
    const own = annualized((ownRaises ?? []).map((x) => ({ from: x.from_date, to: x.to_date, rate: x.r })));
    return { uw, title, own };
  }, [trend, raiseSteps, ownRaises]);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const growth = Math.pow(1 + pctRaise / 100, years);
  const projectedRate = lastRate != null ? lastRate * growth : null;
  // On the band, the graded appointment's rate moves by the same raise.
  // The simulator's year-by-year line (P19), and the top of its axis: the band's maximum when it is in view.
  const raisePath = useMemo(() => (lastRate == null ? [] : Array.from({ length: years + 1 }, (_, y) => ({ year: y, rate: lastRate * (1 + pctRaise / 100) ** y }))), [lastRate, years, pctRaise]);
  const raisePathTop = useMemo(() => {
    const hi = Math.max(...raisePath.map((r) => r.rate), range?.max ?? 0);
    return niceCurrencyTicks(0, hi * 1.05).at(-1) ?? hi;
  }, [raisePath, range]);
  // Quick-target presets: the annualized %/yr needed to take `from` to a target rate over the current `years`.
  const targetRaisePct = (t: number | null | undefined, from: number | null = lastRate) =>
    from != null && from > 0 && years > 0 && t != null && t > from
      ? r1((Math.pow(t / from, 1 / years) - 1) * 100)
      : null;
  const medTargetPct = targetRaisePct(peer?.med_rate);
  const maxTargetPct = range ? targetRaisePct(range.max, bandRate) : null;

  if (isLoading) return <PersonSkeleton />;
  if (error) return <Alert color="red">Failed to load person: {(error as Error).message}</Alert>;
  if (!rows.length) {
    if (alias.data) return <Navigate to={{ pathname: `/person/${encodeURIComponent(alias.data)}`, search: params.toString() }} replace />;
    if (alias.isPending) return <PersonSkeleton />;
    return <PersonNotFound personKey={key} />;
  }

  return (
    <Stack gap="lg">
      {/* Wraps like PageHeader's own action slot: `nowrap` kept the buttons beside the name on a phone,
          squeezing the title into ~215px so "Kenneth Poss" broke across two lines and the breadcrumb
          across six — and pushing the page 53px wider than the viewport. The flex-basis keeps the
          desktop row unchanged and only drops the actions below once they can no longer both fit. */}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <div className="person-head" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <Title order={1} data-reveal-target tabIndex={-1}>{name}</Title>
          <Text c="dimmed">
            {latest?.job_code ? (
              <Anchor component={Link} to={`/titles?code=${encodeURIComponent(latest.job_code)}`} fw={600}>{latest?.title}</Anchor>
            ) : (
              latest?.title
            )}
            {' '}·{' '}
            {latest?.school ? (
              <Anchor component={Link} to={`/school/${encodeURIComponent(latest.school)}`}>
                {latest.school}
              </Anchor>
            ) : (
              '—'
            )}
            {latest?.department ? ` · ${latest.department}` : ''}
          </Text>
          {/* The answer, in the header (P1): what they are paid and where that sits among their title. On a phone
              the first dollar figure was ~650px down, under the actions and a seven-field strip. */}
          {lastSalary != null && lastSalary > 0 && (
            <Text className="person-answer" mt={6}>
              <Text span fw={700}>{usd(lastSalary)}</Text>
              {` ${hourlyOnly ? 'annualized hourly rate' : 'actual pay'}${latest?.snapshot_label ? `, ${latest.snapshot_label}` : ''}`}
              {cohortPct != null && cohortStats && latest?.title && (
                <>
                  {` · ${partTime ? 'full-time rate above' : 'paid more than'} `}
                  <Text span fw={700}>{Math.round(cohortPct)}%</Text>
                  {` of others titled ${latest.title}${cohort === 'school' ? ' in the school' : ''}`}
                </>
              )}
            </Text>
          )}
          {/* The other jobs they hold now: the title above is their main one (the highest FTE). Two named, the
              rest counted; the History tab lists every one. */}
          {also.length > 0 && (
            <Text size="xs" c="dimmed" mt={4} className="person-also" data-n={also.length}>
              Also:{' '}
              {also.slice(0, 2).map((a, i) => (
                <Fragment key={i}>
                  {i > 0 && '; '}
                  {a.job_code ? (
                    <Anchor component={Link} to={`/titles?code=${encodeURIComponent(a.job_code)}`} inherit>{a.title ?? a.job_code}</Anchor>
                  ) : (a.title ?? 'another appointment')}
                  {` (${apptTerms(a, counts.has(a))})`}
                </Fragment>
              ))}
              {also.length > 2 && `; and ${also.length - 2} more, in History`}
            </Text>
          )}
          {preTtcTitle && (
            <Text size="xs" c="var(--text-faint)" mt={4} className="pre-ttc-title">
              Title before <Anchor component={Link} to="/data#ttc" inherit>TTC</Anchor>: {preTtcTitle}
            </Text>
          )}
        </div>
        {/* The page's actions in one group (P2, P3): the raise case, and one compare control — add this person,
            or open its menu to compare them with someone named. They were "Compare with…" and "+ Add to compare"
            side by side with nothing to tell them apart, and the raise case a link under the title. */}
        <Group gap="sm" wrap="wrap" style={{ flexShrink: 0, maxWidth: '100%' }}>
          <ToolLinks asButtons links={[{ label: 'Build raise case', to: `/raise-case?type=comparison&subject=${encodeURIComponent(key)}` }]} />
          <Button.Group>
          <CompareSetButton item={{ type: 'person', id: key, label: name }} />
          <Popover width={320} position="bottom-end" shadow="md" withArrow trapFocus>
            <Popover.Target>
              <Button variant={has(key) ? 'light' : 'filled'} px={10} aria-label="Compare with a specific person…" className="compare-with">
                <IconChevronDown size={ICON.control} />
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <SearchBox
                kinds={['people']}
                placeholder="Search a person to compare…"
                size="sm"
                autoFocus
                onPick={(h) => {
                  add({ type: 'person', id: key, label: name });
                  add({ type: 'person', id: h.person_key, label: h.name });
                  nav('/compare');
                }}
              />
            </Popover.Dropdown>
          </Popover>
          </Button.Group>
        </Group>
      </Group>
      {/* Source columns the page otherwise hides, in one divided strip (null ones left out): what identifies the
          job first — its code, grade and category — then its terms. Under the name and the actions, across the
          page, so a cell is wide enough for its value on one line. */}
      <FactStrip
        label="About this appointment"
        facts={[
          { label: 'Job code', value: latest?.job_code },
          // The number, as everywhere (format `fmtGrade`); its schedule only where it is not the basis beside it.
          { label: <GlossaryTerm term="grade">Grade</GlossaryTerm>, value: latest?.grade_number != null
            ? fmtGrade(latest.grade_number, fmtBasis(latest.comp_basis).toLowerCase().startsWith(fmtGradeBasis(latest.grade_basis) ?? '') ? null : latest.grade_basis)
            : latest?.salary_grade_raw?.replace(/^grade\s*/i, '') ?? null },
          { label: 'Category', value: latest?.employee_category },
          { label: 'Type', value: [latest?.employee_type, latest?.contract_type].filter(Boolean).join(' · ') || null },
          { label: <GlossaryTerm term="basis">Basis</GlossaryTerm>, value: latest?.comp_basis ? fmtBasis(latest.comp_basis) : null },
          { label: 'Pay type', value: latest?.pay_rate_type },
          { label: <GlossaryTerm term="flsa">FLSA</GlossaryTerm>, value: latest?.flsa_status },
        ]}
      />

      {departed && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={ICON.control} />}>
          Not in the latest snapshot ({campusLatest?.label}) — may no longer be employed. Last seen {latest?.snapshot_label}.
        </Alert>
      )}

      <Tabs value={tab} onChange={(v) => { markTabSwitch(); setTab(v); }}>
        <OverflowTabsList>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="pay">Pay &amp; standing</Tabs.Tab>
          <Tabs.Tab value="trends">Pay trend</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
          <Tabs.Tab value="report">Report</Tabs.Tab>
        </OverflowTabsList>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="lg" className="tab-rise">
            {/* The headline figures, one card of four cells: what this person is paid, where that sits among
                everyone with the title, how it grew against what typical raises alone would have given, and how
                long they have been here. Pay, growth and tenure open the tab that shows them in full. */}
            <StatRow cols={{ base: 1, sm: 2, md: '1.2fr 1fr 1fr .8fr' }} label="Headline figures" className="person-figures">
              {/* The cells the Report draws too (PersonFigures, P37); what follows the figure is this page's. */}
              <PayCell
                // Hourly only: the figure is the rate over a full-time year, not what was paid — the hours worked are
                // not in the records, and "Actual pay $58,240" said they were.
                label={hourlyOnly ? 'Annualized hourly rate' : 'Actual pay'}
                value={lastSalary}
                asOf={latest?.snapshot_label}
                fte={lastFte}
                onOpen={() => setTab('trends')}
              >
                {latest?.title && (
                  <Text size="sm" c="dimmed" mt={4}>
                    {latest.title}{latest.comp_basis ? ` · ${fmtBasis(latest.comp_basis)} basis` : ''}
                  </Text>
                )}
                {partTime && <Text size="xs" c="dimmed" mt={2}>full-time rate {usd(lastRate)}</Text>}
                {/* At 100% the two measures are one figure, and the next cell ranks the full-time rate: said here (P8). */}
                {!partTime && !hourlyOnly && lastFte != null && Math.abs(lastFte - 1) <= 0.005 && (
                  <Text size="xs" c="dimmed" mt={2} className="pay-is-rate">= the full-time rate, at 100% FTE</Text>
                )}
                {hourlyOnly && lastSalary != null && (
                  <Text size="xs" c="dimmed" mt={2} className="hourly-rate">{hourly(lastSalary)} × 2,080 hours · hours worked are not in the records</Text>
                )}
              </PayCell>

              {/* Where the full-time rate sits among everyone with the title (or, with "Same school", among those in
                  the person's school): the share on a lower rate, the spread it sits in, and the rank. The sentence sat in
                  the chart's card; the chart now shows it, and this says it. */}
              {/* "Standing in title" (P7): it read "Full-time rate above · 33% of the 46 others with this title". */}
              <StatCell label="Standing in title">
                {spread && cohortStats && cohortPct != null ? (
                  <>
                    <Text size="sm" mt={6} className="standing-share" style={{ lineHeight: 1.15 }}>
                      Paid more than <Text span fw={700} style={{ fontSize: 24 }}>{Math.round(cohortPct)}%</Text>
                      {' '}of {num(cohortStats.n - 1)} {cohort === 'school' ? 'peers in the school' : 'peers'}
                    </Text>
                    <SpreadMark
                      lo={cohortStats.lo} p25={cohortStats.p25} med={cohortStats.med} p75={cohortStats.p75} hi={cohortStats.hi}
                      value={cohortSelfPay ?? lastSalary ?? cohortStats.med}
                      label={`A full-time rate of ${usd(cohortSelfPay ?? lastSalary)} in a spread from ${usd(cohortStats.lo)} to ${usd(cohortStats.hi)}, median ${usd(cohortStats.med)}`}
                    />
                    {cohortRank != null && (
                      <Text size="xs" c="dimmed" mt={6}>Rank {cohortRank} of {num(cohortList.length)} · by full-time rate · median {fmtK(cohortStats.med)}</Text>
                    )}
                  </>
                ) : fewOthers ? (
                  // Too few for a share: the others' rates, said outright.
                  <Text size="sm" mt={6} className="few-others">
                    {fewOthers.length === 1 ? 'The one other with this title: ' : `The ${fewOthers.length} others with this title: `}
                    {fewOthers.map((o) => usd(o.pay)).join(', ')}.
                  </Text>
                ) : (
                  // A title of one, or one where everyone is paid the same: there is no share to state.
                  <Text size="sm" c="dimmed" mt={6}>
                    {peer && peer.n === 1
                      ? `The only ${latest?.title ?? 'person with this title'} at UW.`
                      : cohortStats && cohortStats.n >= 2 && cohortStats.hi === cohortStats.lo
                        ? `Everyone with this title has a full-time rate of ${usd(cohortStats.lo)}.`
                        : '—'}
                  </Text>
                )}
              </StatCell>

              <GrowthCell label="Actual pay growth" value={growthLfl} years={spanYears} onOpen={() => setTab('trends')}>
                {/* Against what typical raises alone would have given over the same steps. Across a reporting
                    change (a 9-month member's pay grew ×11/9 in Sep 2025 without a dollar more) both bars leave
                    its factor out, so they stand on the same footing; the note under them says so. */}
                {growthLfl != null && typicalGrowth != null && (() => {
                  const typical = (1 + typicalGrowth) / reporting.factor - 1;
                  // Like against like (P6): where a title changed in the span, the raises alone are set against
                  // typical raises, and what the title change added is said beside them. The whole set against
                  // raises only had a +17% move to a new title reading as a raise twice the usual.
                  const split = raiseCtx.growthSplit;
                  const retitled = split && !fteMoved && split.titleSteps.length > 0 && Math.abs(split.titles) >= 0.0005 ? split : null;
                  const mine = retitled ? retitled.raises : growthLfl;
                  return (
                    <>
                      <GrowthBars rows={[
                        { name: retitled ? `${selfLabel}, raises` : selfLabel, value: mine, self: true, text: sgnPct(mine) },
                        { name: 'Typical raises', value: typical, text: sgnPct(typical) },
                      ]} />
                      {/* What "typical" means (P6), in a line short enough for a phone's cell: the cell is a button,
                          so a glossary term inside it would be a control within a control. */}
                      <Text size="xs" c="dimmed" mt={4} className="growth-typical">Typical: campus median, same title and FTE</Text>
                      {retitled && (
                        <Text size="xs" c="dimmed" mt={2} className="growth-titles">
                          and {sgnPct(retitled.titles)} from {retitled.titleSteps.length === 1 ? `the title change in ${retitled.titleSteps[0]}` : `${retitled.titleSteps.length} title changes`}
                        </Text>
                      )}
                    </>
                  );
                })()}
                <GrowthNotes
                  snapshots={trend.length}
                  since={oldestLabel}
                  rateAside={chgDiffer ? rateChange : null}
                  fte={fteMoved ? [firstFte!, lastFte!] : null}
                  actualPay={payLfl}
                  reported={totalChange == null ? null : fteMoved ? rateChange : totalChange}
                  change={reporting.changes[0] ?? null}
                />
              </GrowthCell>

              <TenureCell years={tenureYears} hireYear={hireYear} asOf={latest?.snapshot_label} onOpen={() => setTab('history')} />
            </StatRow>

            {peer && peer.n === 1 && jobCode && (
              <Card withBorder padding="lg">
                <Text size="sm">
                  {name} is the only employee at UW with the title {latest?.title} (job code {jobCode}) in the latest snapshot — no one else to compare against.
                </Text>
                <Group justify="flex-end" mt="md">
                  <Button component={Link} to={`/titles?code=${encodeURIComponent(jobCode)}`} variant="default" size="xs" rightSection={<IconArrowRight size={ICON.compact} />}>
                    Go to title page
                  </Button>
                </Group>
              </Card>
            )}

            {peer && peer.n > 1 && lastSalary != null && jobCode && (
              <Card withBorder padding="lg">
                {/* The sentence under the title is the card's `sub`, not a line of its own: every other card
                    sets its explanation there. The title links to its page in it, where the reader is
                    already reading about it; a "Go to title page" button under the footnotes was one more
                    row on the card. */}
                <CardTitle
                  mb={spread ? 'xs' : 'md'}
                  sub={(() => {
                    const titleLink = <Anchor component={Link} to={`/titles?code=${encodeURIComponent(jobCode)}`} inherit className="peer-title-link">{latest?.title}</Anchor>;
                    const where = cohort === 'school' ? <> in {latest?.school}</> : null;
                    // The finding, in one sentence, before the chart that shows it: the share of the others paid
                    // less (the subject is not counted among them) and how far from the median. With no spread
                    // there is no share to state, and it says who the chart is of instead.
                    if (spread && cohortStats && cohortPct != null && cohortSelfPay != null) {
                      const d = cohortSelfPay - cohortStats.med;
                      return (
                        <span className="peer-finding">
                          {selfLabel}&rsquo;s full-time rate is higher than <b>{Math.round(cohortPct)}%</b> of the {num(cohortStats.n - 1)} others titled {titleLink} ({jobCode}){where},
                          {Math.abs(d) < 0.5 ? <> and <b>at</b> the median.</> : <> and <b>{usd(Math.abs(d))} {d < 0 ? 'below' : 'above'}</b> the median.</>}
                        </span>
                      );
                    }
                    return cohort === 'school'
                      ? <>Among {num(cohortStats?.n ?? 0)} {(cohortStats?.n ?? 0) === 1 ? 'person' : 'people'} with the title {titleLink}, in the same school ({latest?.school}).</>
                      : <>Among {num(allCount)} people with the title {titleLink} (job code {jobCode}) in the latest snapshot.</>;
                  })()}
                  right={allCount > schoolCount && (
                    <SegmentedToggle
                      value={cohort}
                      onChange={(v) => setCohort(v as 'all' | 'school')}
                      options={[
                        { id: 'all', label: `All ${num(allCount)}` },
                        { id: 'school', label: `Same school ${num(schoolCount)}` },
                      ]}
                    />
                  )}
                >
                  Among people with this title
                </CardTitle>
                {fewOthers ? (
                  // Fewer than MIN_GROUP: no strip with a middle 50%, but each of them at their rate.
                  <Stack gap={4} className="few-list">
                    {[...fewOthers, ...(cohortSelfPay != null ? [{ person_key: key, fn: latest?.first_name ?? null, ln: latest?.last_name ?? null, pay: cohortSelfPay }] : [])]
                      .sort((a, b) => b.pay - a.pay)
                      .map((p) => (
                        <Group key={p.person_key} justify="space-between" wrap="nowrap" maw={420}>
                          {p.person_key === key
                            ? <Text size="sm" fw={700}>{fullName(p.fn, p.ln) || name}</Text>
                            : <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`} size="sm">{fullName(p.fn, p.ln) || '—'}</Anchor>}
                          <Text size="sm" fw={p.person_key === key ? 700 : 500}>{usd(p.pay)}</Text>
                        </Group>
                      ))}
                  </Stack>
                ) : cohortStats && cohortStats.n >= 2 ? (
                  <>
                    <PeerStrip
                      min={cohortStats.lo}
                      p25={cohortStats.p25}
                      median={cohortStats.med}
                      p75={cohortStats.p75}
                      max={cohortStats.hi}
                      value={cohortSelfPay ?? lastSalary}
                      points={allPoints}
                      fullName={name}
                      domain={allPaysDomain}
                      zoom={payWin}
                      onPile={showPile}
                      pileShown={pileShown}
                      label={selfLabel}
                      pointed={pointed}
                      onPoint={setPointed}
                      onOpen={(k) => nav(`/person/${encodeURIComponent(k)}`)}
                    />
                    {ratePlotted && (
                      <Text size="xs" c="dimmed" mt={4} className="peer-rate-note">
                        Marked at {usd(cohortSelfPay!)}, {selfLabel}&rsquo;s full-time rate in this title. Their actual pay is {usd(lastSalary!)}.
                      </Text>
                    )}
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    {name} is the only person with this title in {latest?.school} — switch to “All {num(allCount)}” to compare against everyone with the title.
                  </Text>
                )}
              </Card>
            )}

            {scatterPoints.length >= 4 && (
              <Card withBorder padding="lg">
                {/* No second cohort toggle here. The card above owns it, both were bound to the same
                    state, and two controls for one value sitting a few hundred pixels apart read as
                    two independent settings that happen to move together. This card says which cohort
                    it is drawing instead. */}
                <CardTitle
                  sub={<>
                    Where {selfLabel}&rsquo;s full-time rate sits against what tenure alone predicts for {latest?.title}
                    {cohort === 'school' ? ` within ${latest?.school}` : ' across UW'}.
                  </>}
                >
                  Pay vs. tenure
                </CardTitle>
                <TenurePayScatter points={scatterPoints} self={selfScatter} titleLabel={latest?.title ?? 'this title'} zoom={payWin} label={selfLabel} measure="Full-time rate" pointed={pointed} onPoint={setPointed} />
              </Card>
            )}

            {peers && peers.length > 1 && (
              <Card withBorder padding="lg" ref={peerCardRef} className="peer-table-card">
                <CardTitle
                  sub={<>
                    Ranked by full-time rate{cohort === 'school' ? `, in ${latest?.school}` : ''}.
                    {cohortRank != null && cohortList.length >= MIN_GROUP && <> {selfLabel} ranks <b>#{cohortRank} of {num(cohortList.length)}</b>.</>}
                  </>}
                  right={
                    <TextInput
                      className="peer-filter"
                      w={{ base: '100%', sm: 300 }}
                      aria-label="Filter the people with this title by name, school or department"
                      placeholder="Filter by name, school, department"
                      leftSection={<IconFilter size={ICON.control} />}
                      value={peerFilter}
                      onChange={(e) => setPeerFilter(e.currentTarget.value)}
                    />
                  }
                >
                  Others with this title
                </CardTitle>
                {pileShown !== 0 && payWin && (
                  <Group gap="xs" mb="xs" className="peer-pile-filter">
                    <Text size="sm">
                      Showing the {num(sortedCohort.length)} {sortedCohort.length === 1 ? 'person' : 'people'} with a full-time rate {pileShown < 0 ? `under ${fmtK(payWin.lo)}` : `over ${fmtK(payWin.hi)}`}
                    </Text>
                    <Button variant="subtle" size="compact-xs" onClick={() => setPileShown(0)}>Show everyone</Button>
                  </Group>
                )}
                <Table miw={760} className="fold-table peer-table">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={48} ta="right" data-fold>#</Table.Th>
                      <SortableTh sortKey="name" label="Name" sort={peerSort} onSort={setPeerSort} />
                      <SortableTh sortKey="school" label="School · department" srLabel="school" fold sort={peerSort} onSort={setPeerSort} />
                      <SortableTh sortKey="tenure" label="Tenure" fold tip={GLOSSARY.tenure} sort={peerSort} onSort={setPeerSort} align="right" />
                      <SortableTh sortKey="salary" label="Full-time rate" sort={peerSort} onSort={setPeerSort} align="right" />
                      <Table.Th ta="right" data-fold className="peer-vs">vs. {selfLabel}</Table.Th>
                      <Table.Th w={44} className="tray-col"><VisuallyHidden>Compare</VisuallyHidden></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visiblePeers.map((p) => {
                      const isYou = p.person_key === key;
                      const inTray = has(p.person_key);
                      const sameSchool = !isYou && !!p.school && p.school === latest?.school;
                      const rank = sortedCohort.indexOf(p) + 1;
                      const vs = !isYou && selfPeerPay != null ? p.pay - selfPeerPay : null;
                      return (
                        <Table.Tr
                          key={p.person_key}
                          className={`peer-row${isYou ? ' row-this' : ''}`}
                          // Pointing at a row points at the person in both charts above; the charts point back.
                          data-pointed={pointed === p.person_key || undefined}
                          onMouseEnter={() => setPointed(p.person_key)}
                          onMouseLeave={() => setPointed((k) => (k === p.person_key ? null : k))}
                          // Mouse convenience only — the name below is a real link, so keyboard/screen-reader
                          // users have a proper, unambiguous way in (a `role="button"` row would otherwise
                          // nest one interactive element inside another around the add button in the last cell).
                          onClick={() => !isYou && nav(`/person/${encodeURIComponent(p.person_key)}`)}
                          style={{ cursor: isYou ? 'default' : 'pointer' }}
                        >
                          <Table.Td ta="right" c="dimmed" data-fold>{rank}</Table.Td>
                          <Table.Td>
                            {/* Its own block, so the name is a line by itself and not a link inside the
                                folded text below it (which axe then required to differ by more than colour). */}
                            <div>
                              {isYou ? (
                                <Text span size="sm" fw={700}>{fullName(p.fn, p.ln) || '—'}</Text>
                              ) : (
                                <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`} size="sm" c="accent" underline="hover" onClick={(e) => e.stopPropagation()}>
                                  {fullName(p.fn, p.ln) || '—'}
                                </Anchor>
                              )}
                              {isYou && <span className="viewing-pill">Viewing</span>}
                            </div>
                            {/* On a phone: rank, school and department under the name, then the salary. */}
                            <Text className="fold-under" size="xs" c="dimmed" lineClamp={2}>
                              #{rank} · {[p.school, p.department].filter(Boolean).join(' · ') || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td data-fold title={sameSchool ? `Same school as ${name}` : undefined}>
                            <div className="peer-school">
                              <Text span size="sm" lineClamp={1}>{p.school ?? '—'}</Text>
                              {/* Said in words (P14): it was an 8px dot keyed in a footnote under the table. */}
                              {sameSchool && <span className="cat-tag same-school-tag">Same school</span>}
                            </div>
                            {p.department && <Text size="xs" c="var(--text-faint)" lineClamp={1} className="peer-dept">{p.department}</Text>}
                          </Table.Td>
                          <Table.Td data-fold ta="right" fw={isYou ? 700 : undefined}>{p.tenure != null ? fmtYears(Math.max(0, p.tenure)) : '—'}</Table.Td>
                          <Table.Td ta="right" fw={isYou ? 700 : 600}>
                            {usd(p.pay)}
                            {/* On a phone, where the "vs." column folds away, the difference under the pay (P13). */}
                            {vs != null && (
                              <Text className="fold-under peer-vs-under" size="xs" c="dimmed" fw={400}>
                                {`${vs > 0 ? '+' : vs < 0 ? '−' : ''}${usd(Math.abs(vs))} vs. ${selfLabel}`}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td ta="right" data-fold c="dimmed" className="peer-vs">
                            {vs == null ? '—' : `${vs > 0 ? '+' : vs < 0 ? '−' : ''}${usd(Math.abs(vs))}`}
                          </Table.Td>
                          <Table.Td ta="right">
                            {isYou ? (
                              <Text span size="xs" c="dimmed" className="peer-in-set">{inTray ? '✓ In set' : ''}</Text>
                            ) : (
                              <TrayButton
                                inTray={inTray}
                                name={fullName(p.fn, p.ln)}
                                stopPropagation
                                onAdd={() => add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) })}
                                onRemove={() => remove(p.person_key)}
                              />
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
                {peerQuery && filteredPeers.length === 0 && (
                  <Text size="sm" c="dimmed" mt="sm">No one with this title matches “{peerFilter.trim()}”.</Text>
                )}
                {/* The table's foot: how much of the list is showing. */}
                <Group justify="flex-end" mt="sm" gap="xs" className="peer-foot">
                  {!pileShown && sortedCohort.length > 2 * AROUND + 1 && (
                    <Group gap={6} wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        {peerQuery
                          ? `Showing ${num(filteredPeers.length)} of ${num(sortedCohort.length)} matching`
                          : windowed
                            ? `Showing ${num(visiblePeers.length)} of ${num(sortedCohort.length)} around ${selfLabel}`
                            : `Showing all ${num(sortedCohort.length)}`}
                      </Text>
                      {!peerQuery && (
                        <Button variant="subtle" size="compact-xs" className="peer-show-all" onClick={() => setShowAllPeers((v) => !v)}>
                          {windowed ? 'Show all' : `Show the ${2 * AROUND + 1} around ${selfLabel}`}
                        </Button>
                      )}
                    </Group>
                  )}
                </Group>
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="pay" pt="md">
          <Stack gap="lg" className="tab-rise">
      {/* 4a — Standing: a percentile bar per pool, so all five comparisons read at a glance. */}
      {(standingPools.length > 0 || (!standingRows && poolLabels.length > 0)) && (
        <Card withBorder padding="lg">
          <CardTitle sub="Where this person's actual pay ranks in each pool they belong to, in the latest snapshot; within their title, their full-time rate, as the Overview compares it.">
            Standing
          </CardTitle>
          <Stack gap="sm">
            {/* The median's name, once, over its tick: the bars' own columns, so it lands on the line. */}
            <Group wrap="nowrap" gap="md" aria-hidden mb={-6}>
              <div style={{ flex: '0 0 35%' }} />
              <div style={{ flex: 1, position: 'relative', height: 16 }}>
                <Text className="standing-median-label" size="xs" c="dimmed" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', lineHeight: '16px' }}>Pool median</Text>
              </div>
              <div style={{ width: 104, flexShrink: 0 }} />
            </Group>
            {standingRows
              ? standingPools.map((p, i) => (
                <PercentileBar key={p.label} label={p.label} n={p.n} below={p.below} pct={p.pct} delay={i * 90} />
              ))
              : poolLabels.map((p) => <PercentileBar key={p.label} label={p.label} />)}
          </Stack>
          <Text size="xs" c="dimmed" mt="md">Each bar is the share of the pool this person is paid more than. The marker is green above the pool's median and red below it. Pools of fewer than {MIN_GROUP} people are left out.</Text>
        </Card>
      )}

      {/* 4b — Pay band: full-time rate within the OFFICIAL grade range + headroom. (Title median/p75 live on
              the Overview title bar, so this card is purely the HR grade-structure lens.) */}
      {range && bandRate != null && (
        <Card withBorder padding="lg" className="person-payband">
          <CardTitle
            sub={<>Where the full-time rate sits in grade {graded?.grade}'s official min–max, and the room to the top.</>}
          >
            Grade {graded?.grade} pay band
          </CardTitle>
          <PayBandBar
            min={range.min}
            max={range.max}
            value={bandRate}
            quartiles
            // The title's own spread on its band (P18), where there are enough people to have one.
            peers={peer && peer.n >= MIN_GROUP && peer.p25 != null && peer.med != null && peer.p75 != null && latest?.title
              ? { p25: peer.p25, med: peer.med, p75: peer.p75, label: `everyone titled ${latest.title}` } : null}
          />
          {bandRate !== lastRate && (
            <Text size="xs" c="dimmed" mt={4} className="payband-rate">
              Placed on the full-time rate of the appointment in grade {graded?.grade}, {usd(bandRate)}.
            </Text>
          )}
          <PayBandNote mt="sm" snapshotId={latest?.snapshot_id} />
          {bandRate >= range.max ? (
            <Text size="sm" mt="md">
              At or above the top of grade {graded?.grade}'s band (max {usd(range.max)}) — effectively maxed out.
            </Text>
          ) : (
            <Text size="sm" mt="md">
              <Text span fw={700}>{usd(range.max - bandRate)}</Text> of headroom to the top of grade {graded?.grade}'s band
              <Text span c="dimmed"> (grade max {usd(range.max)}).</Text>
            </Text>
          )}
        </Card>
      )}
      {/* A grade HR publishes with a minimum only: whether the rate clears it, and no band to place it in. */}
      {band && !range && bandRate != null && (
        <Card withBorder padding="lg" className="person-payband person-payfloor">
          <CardTitle sub={<>HR publishes a minimum for grade {graded?.grade} and no maximum, so there is no range to place the rate in.</>}>
            Grade {graded?.grade} minimum
          </CardTitle>
          <Text size="sm" className="payfloor-line">
            {belowMinimum(bandRate, band, graded?.basis) ? (
              <>The full-time rate, {usd(bandRate)}, is <Text span fw={700} c="red">{usd(band.min - bandRate)} below</Text> grade {graded?.grade}&apos;s minimum of {usd(band.min)}.</>
            ) : (
              <>The full-time rate, {usd(bandRate)}, is at or above grade {graded?.grade}&apos;s minimum of {usd(band.min)}.</>
            )}
          </Text>
          <PayBandNote mt="sm" snapshotId={latest?.snapshot_id} />
        </Card>
      )}

      {/* 4c — Raise / what-if: presets, steppers, the projected rate, and where it lands on the band. */}
      {lastRate != null && (
        <Card withBorder padding="lg">
          <CardTitle mb="sm" sub="Projects the full-time salary rate; actual pay scales with FTE.">
            Raise / what-if simulator
          </CardTitle>
          {/* The presets on one row (P19), short enough to fit and scrolled sideways where they don't; each sets the
              raise below. They wrapped to two rows of long phrases. */}
          <Group gap="xs" mb="md" wrap="nowrap" className="raise-presets">
            {[
              { id: 'flat', label: 'Flat 2%', val: 2 },
              ...(presets.uw != null && presets.uw >= 0 ? [{ id: 'uw', label: `UW typical ≈${r1(presets.uw * 100)}%`, val: r1(presets.uw * 100) }] : []),
              ...(presets.title != null && presets.title >= 0 ? [{ id: 'title', label: `Title typical ≈${r1(presets.title * 100)}%`, val: r1(presets.title * 100) }] : []),
              ...(presets.own != null && presets.own >= 0 ? [{ id: 'own', label: `Own raises ≈${r1(presets.own * 100)}%`, val: r1(presets.own * 100) }] : []),
              ...(medTargetPct != null ? [{ id: 'median', label: `To title median ${medTargetPct}%`, val: medTargetPct }] : []),
              ...(maxTargetPct != null ? [{ id: 'bandmax', label: `To band max ${maxTargetPct}%`, val: maxTargetPct }] : []),
            ].map((c) => {
              const sel = Math.abs(pctRaise - c.val) < 0.05;
              return (
                <Button key={c.id} data-raise-preset={c.id} size="compact-sm" radius="xl" variant={sel ? 'light' : 'default'} color="accent" onClick={() => setPctRaise(c.val)} style={{ flexShrink: 0 }}>
                  {c.label}
                </Button>
              );
            })}
          </Group>
          {/* A slider with its number beside it, in half-percent steps, and the years as four choices (P21): two
              spin boxes asked for both. */}
          <Group align="flex-end" wrap="wrap" gap="lg">
            <Input.Wrapper label="Annual raise" style={{ flex: '1 1 260px', minWidth: 0 }}>
              <Group gap="sm" wrap="nowrap" mt={4}>
                <Slider
                  className="raise-slider"
                  value={pctRaise}
                  onChange={setPctRaise}
                  min={0}
                  max={10}
                  step={0.5}
                  label={(v) => `${v}%`}
                  thumbLabel="Annual raise"
                  // A finger-sized thumb (24px), as every target on a phone is.
                  thumbSize={24}
                  style={{ flex: 1 }}
                />
                <NumberInput aria-label="Annual raise %" value={pctRaise} onChange={(v) => setPctRaise(typeof v === 'number' ? v : 0)} w={92} step={0.5} min={0} max={25} suffix="%" />
              </Group>
            </Input.Wrapper>
            <Input.Wrapper label="Years">
              <SegmentedToggle
                ariaLabel="Years"
                value={String(years)}
                onChange={(v) => setYears(Number(v))}
                options={[1, 3, 5, 10].map((y) => ({ id: String(y), label: String(y) }))}
              />
            </Input.Wrapper>
          </Group>

          {/* The headline (P19): how long to the top of the band at this raise, where there is a band; otherwise the
              projected rate. */}
          <div className="raise-headline" style={{ marginTop: 'var(--mantine-spacing-md)' }}>
            {range && bandRate != null && bandRate >= range.max ? (
              <Text fw={700} size="lg">Already at the top of grade {graded?.grade}&apos;s band ({usd(range.max)})</Text>
            ) : range && bandRate != null && pctRaise > 0 ? (
              <Text fw={700} size="lg">
                ≈{Math.ceil(Math.log(range.max / bandRate) / Math.log(1 + pctRaise / 100))} years to the band max at {pctRaise}%/yr
              </Text>
            ) : range ? (
              <Text fw={700} size="lg">Set a raise above 0% to see the years to the band max</Text>
            ) : null}
            {projectedRate != null && lastRate != null && (
              <Text size="sm" c={range ? 'dimmed' : undefined} mt={2}>
                Full-time rate in {years} {years === 1 ? 'year' : 'years'}: <Text span fw={700} c="var(--mantine-color-text)">{usd(projectedRate)}</Text>
                {' '}(<Text span c="up" fw={600}>+{usd(projectedRate - lastRate)}</Text> vs today
                {lastFte != null && Math.abs(lastFte - 1) > 0.005 ? `; actual ${usd(projectedRate * lastFte)}` : ''})
              </Text>
            )}
          </div>

          {/* Year by year against the band's top (P19), the band held where it is today (P20): the published maximum
              does not grow with the projection. */}
          {lastRate != null && (
            <div className="raise-path" style={{ marginTop: 'var(--mantine-spacing-md)' }}>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart {...chartKeys('Projected full-time rate by year')} data={raisePath} margin={{ left: 12, right: 24, top: 18, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="year" tick={AXIS_TICK} tickFormatter={(y: number) => (y === 0 ? 'Today' : `+${y} yr`)} interval={0} />
                  <YAxis tick={AXIS_TICK} tickFormatter={fmtK} width={56} domain={[0, raisePathTop]} />
                  <Tooltip formatter={(v: number) => [usd(v), 'Full-time rate']} labelFormatter={(y: number) => (y === 0 ? 'Today' : `In ${y} ${y === 1 ? 'year' : 'years'}`)} contentStyle={TIP_STYLE} labelStyle={TIP_LABEL_STYLE} />
                  {range && (
                    <ReferenceLine
                      y={range.max}
                      stroke="var(--guide-strong)"
                      strokeDasharray="4 3"
                      className="raise-band-max"
                      label={{ value: `Band max ${usd(range.max)}, held at ${latest?.snapshot_label ?? 'today'}'s value`, position: 'insideTopRight', fontSize: CHART_FONT, fill: 'var(--mantine-color-dimmed)' }}
                    />
                  )}
                  <Line type="linear" dataKey="rate" name="Full-time rate" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <ChartData
                caption="Projected full-time rate by year"
                columns={['Year', 'Full-time rate']}
                rows={raisePath.map((r) => [r.year === 0 ? 'Today' : `+${r.year}`, Math.round(r.rate)])}
                unit="years"
                about={`Today's full-time rate grown at ${pctRaise}% a year.${range ? ` The band's maximum is held at its published value; it does not grow with the projection.` : ''}`}
              />
            </div>
          )}

          {/* The presets' method, after the projection it feeds rather than between the presets and their inputs (G22). */}
          {(presets.uw != null || presets.title != null || presets.own != null) && (
            <MethodNote className="raise-method">
              <Text inherit>
                Typical is the median raise among people who kept the same title and FTE from one snapshot to the next,
                compounded over this person's time in the data; titles need at least {MIN_TITLE_STEP} such people at a step.
                Promotions and title changes are not raises, so they are left out of all three.
              </Text>
            </MethodNote>
          )}
        </Card>
      )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md">
      <Card withBorder padding="lg">
        <CardTitle
          sub={<>
            Rate is the full-time salary; Actual pay scales it by FTE.
            {dollarMode === 'real' ? ` Shown in ${REAL_BASE_YEAR} dollars (inflation-adjusted, approx.).` : ''}
          </>}
          right={
          <Group gap="sm" wrap="wrap">
            <SegmentedToggle
              value={dollarMode}
              onChange={(v) => setDollarMode(v as 'nominal' | 'real')}
              options={[{ id: 'nominal', label: 'Nominal' }, { id: 'real', label: `${REAL_BASE_YEAR} $` }]}
            />
            <SegmentedToggle
              value={trendMode}
              onChange={(v) => setTrendMode(v as 'actual' | 'rate')}
              options={[{ id: 'actual', label: 'Actual pay' }, { id: 'rate', label: 'Full-time rate' }]}
            />
          </Group>
          }
        >
          {trendMeasure} over time
        </CardTitle>
        {/* Hero salary chart: a ComposedChart with a gradient area + soft-glow line, faint title-era bands,
            grade-band reference lines, and per-step change chips, on a date axis. The FTE sub-chart below
            appears only when the appointment actually varies; when it's hidden, the date labels move onto
            this chart's x-axis. */}
        <div ref={trendBoxRef} className="person-trend">
        <ResponsiveContainer width="100%" height={fteVaries ? 244 : 300}>
          <ComposedChart {...chartKeys(`${trendMeasure} over time`)} data={trendPlot} syncId="person-trend" margin={{ left: 12, right: 30, top: eraLayout.rows === 2 ? 36 : 22, bottom: 0 }}
            onMouseMove={(st: { chartY?: number }) => { if (st?.chartY != null) setTrendTipY(st.chartY); }}>
            <defs>{areaGradDef(gradId)}</defs>
            {/* First, so the plot surface it paints lies under the era bands rather than over them. */}
            <CartesianGrid {...GRID} />
            {/* Faint alternating background band per title era. */}
            {eras.length > 1 && eraSpans.map((sp) => (
              <ReferenceArea
                key={`era-${sp.era}`}
                yAxisId="pay"
                x1={sp.x1}
                x2={sp.x2}
                fill={sp.era % 2 === 1 ? 'var(--mantine-color-accent-6)' : 'transparent'}
                fillOpacity={0.05}
                stroke="none"
                ifOverflow="extendDomain"
              />
            ))}
            <XAxis
              {...trendAxis}
              tick={fteVaries ? false : AXIS_TICK}
              tickLine={false}
              tickMargin={fteVaries ? undefined : 10}
              height={fteVaries ? 8 : 34}
            />
            <YAxis yAxisId="pay" tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={{ top: 6, bottom: 0 }} ticks={trendTicks} domain={[0, trendTicks[trendTicks.length - 1] ?? 'auto']} />
            {/* The hover card follows the pointer down the chart and flips above it in the lower half (P25): pinned to
                the plot's top, it covered the title labels and the axis whatever was pointed at. */}
            <Tooltip
              content={<TrendTooltip onHeight={setTrendTipH} />}
              cursor={{ stroke: 'var(--mantine-color-accent-5)', strokeWidth: 1, strokeDasharray: '4 3' }}
              position={trendTipY == null ? undefined : { y: trendTipY > Math.max(TIP_FLIP_Y, trendTipH + 12) ? trendTipY - trendTipH - 12 : trendTipY + 16 }}
              allowEscapeViewBox={{ x: false, y: true }}
              // Placed at once, not eased there: the card's measured height moves it after its first frame, and a
              // 400ms glide left it over the pointer meanwhile (a CI runner caught it there).
              isAnimationActive={false}
            />
            {/* The grade's official band, on demand (P23): shading from its floor, clipped at the plot's top, which is
                fitted to the pay rather than to the band (P22). A top above the chart is named there (below). */}
            {bandShown && (
              <ReferenceArea yAxisId="pay" y1={bandShown.min} y2={Math.min(bandShown.max ?? trendTop, trendTop)} fill="var(--band-fill)" stroke="none" ifOverflow="hidden" className="trend-band" />
            )}
            {bandShown && bandShown.min <= trendTop && (
              <ReferenceLine yAxisId="pay" y={bandShown.min} stroke="var(--guide-strong)" strokeWidth={1} strokeDasharray={TREND_DASH.gradeBand} ifOverflow="hidden" />
            )}
            {bandShown?.max != null && bandShown.max <= trendTop && (
              <ReferenceLine yAxisId="pay" y={bandShown.max} stroke="var(--guide-strong)" strokeWidth={1} strokeDasharray={TREND_DASH.gradeBand} ifOverflow="hidden" />
            )}
            {bandShown?.max != null && bandShown.max > trendTop && (
              <Customized component={<OffChartMax text={`↑ grade max ${usd(bandShown.max)}`} />} />
            )}
            {/* Title-change dividers segment the chart into title eras; each era's title sits above it
                (the first at the left edge, which has no divider), unless they could not all fit. */}
            {titleChanges.map((t) => (
              <ReferenceLine
                key={`div-${t.id}`}
                yAxisId="pay"
                x={snapX(t.date, t.id)}
                stroke="var(--mantine-color-gray-4)"
                strokeWidth={1}
                strokeDasharray={TREND_DASH.era}
              />
            ))}
            {!eraLayout.fold && eraLayout.labels.map((l) => (
              <ReferenceLine
                key={`era-label-${l.key}`}
                yAxisId="pay"
                x={l.x}
                stroke="none"
                label={<TitleChangeLabel title={l.title} row={l.row} shift={l.shift} />}
              />
            ))}
            {breakMarks.map((b) => (
              <ReferenceLine key={`brk-${b.key}`} yAxisId="pay" x={b.x} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" className="reporting-marker" />
            ))}
            {breakMarks.length > 0 && <Customized component={<BreakLabels edge="bottom" marks={breakMarks.map((b) => ({ at: b.x, texts: b.texts }))} />} />}
            {/* Gradient area fill under the active metric. */}
            <Area yAxisId="pay" type="linear" dataKey={trendMode === 'actual' ? 'salary' : 'rate'} stroke="none" fill={`url(#${gradId}-area-grad)`} isAnimationActive={false} legendType="none" />
            {/* Title median, one disconnected dashed segment per era. */}
            {eras.map((e) => (
              <Line
                key={`med-${e}`}
                yAxisId="pay"
                type="linear"
                dataKey={(d: PlotRow) => (d.era === e ? (trendMode === 'actual' ? d.med : d.medRate) : null)}
                name="Title median"
                stroke="var(--trend-ref)"
                strokeWidth={2}
                strokeDasharray={TREND_DASH.median}
                dot={false}
                connectNulls={false}
                legendType="none"
                isAnimationActive={false}
              />
            ))}
            {/* If every raise had been the campus median (lib/raiseContext) — a hypothetical, so dotted,
                in the strong-guide grey (>=3:1), and only on actual pay, which is what it compounds. */}
            {showTypical && trendMode === 'actual' && raiseCtx.typical.size > 1 && (
              <Line yAxisId="pay" className="typical-line" type="linear" dataKey="typical" name="If raises had been typical" stroke="var(--guide-strong)" strokeWidth={2} strokeDasharray={TREND_DASH.typical} dot={false} connectNulls={false} isAnimationActive={false} legendType="none" />
            )}
            {/* Primary line + haloed active dot. */}
            <Line yAxisId="pay" type="linear" dataKey={trendMode === 'actual' ? 'salary' : 'rate'} name={trendMeasure} stroke="var(--trend-self)" strokeWidth={2} dot activeDot={<ActiveDot />} {...chartAnim(!trendEntrance)} />
            {titleChanges.map((t) => {
              const y = trendMode === 'actual' ? t.salary : t.rate;
              return y != null ? (
                <ReferenceDot key={`tc-${t.id}`} yAxisId="pay" x={snapX(t.date, t.id)} y={y} shape={<TitleChangeDot />} />
              ) : null;
            })}
            {/* Every step's change, placed together so no chip covers another or a title-change marker. */}
            <Customized
              component={
                <YoyChips
                  chipRows={trendPlot}
                  chipValueKey={trendMode === 'actual' ? 'salary' : 'rate'}
                  chipYoyKey={trendMode === 'actual' ? 'yoyActual' : 'yoyRate'}
                  chipAxis="pay"
                  chipMarks={markIdx}
                  chipMin={0.03}
                />
              }
            />
          </ComposedChart>
        </ResponsiveContainer>

        {fteVaries && (
          <>
            {/* Distinct gap between the salary baseline and the FTE chart below. */}
            <div style={{ height: 36 }} />
            <ResponsiveContainer width="100%" height={108}>
              <AreaChart data={trendPlot} syncId="person-trend" margin={{ left: 12, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis {...trendAxis} tick={AXIS_TICK} tickMargin={10} height={34} />
                <YAxis
                  yAxisId="fte"
                  domain={[0, 1]}
                  ticks={[0, 0.5, 1]}
                  width={80}
                  tick={AXIS_TICK}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  padding={{ top: 8, bottom: 4 }}
                />
                <Tooltip content={() => null} />
                <Area
                  yAxisId="fte"
                  type="linear"
                  dataKey="fte"
                  name="Appointment (FTE)"
                  stroke="var(--guide-strong)"
                  strokeWidth={2}
                  fill="var(--guide-strong)"
                  fillOpacity={0.18}
                  dot
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
        </div>
        {eraLayout.fold && (
          <Group gap={6} mt="xs" wrap="wrap" className="trend-era-list">
            <Text size="xs" c="dimmed">Titles:</Text>
            {eraLayout.labels.map((l, i) => (
              <Text key={l.key} size="xs">
                {i > 0 && <Text span size="xs" c="dimmed" aria-hidden>→ </Text>}
                {l.title} <Text span size="xs" c="dimmed">from {fmtSnapTick(l.from)}</Text>
              </Text>
            ))}
          </Group>
        )}
        {breakChange && (
          <Text size="xs" c="dimmed" mt="xs" data-reporting-break>
            The line breaks at {breakChange.sinceLabel}, the change in {breakChange.what} (×{breakChange.ratio}):
            the step across it is not a raise.
          </Text>
        )}
        <TrendLegend hasTitleChange={titleChanges.length > 0} hasFte={fteVaries} gradeBand={bandShown ? { grade: graded?.grade ?? null, min: bandShown.min, max: bandShown.max } : null} mode={trendMode} hasTypical={showTypical && trendMode === 'actual' && raiseCtx.typical.size > 1} />
        {/* The layers a reader adds (P23). Changes under 3% are in the tooltip and the table, not on the line (P24). */}
        {((trendMode === 'actual' && raiseCtx.typical.size > 1) || trendBand) && (
          <Group gap="xs" mt="xs" className="trend-layers">
            {trendMode === 'actual' && raiseCtx.typical.size > 1 && (
              <Chip size="sm" checked={showTypical} onChange={setShowTypical} className="trend-show-typical">Typical-raise path</Chip>
            )}
            {trendBand && (
              <Chip size="sm" checked={showBand} onChange={setShowBand} className="trend-show-band">Grade {graded?.grade} band</Chip>
            )}
          </Group>
        )}
        <ChartData
          caption={dollarMode === 'real' ? `Pay over time (in ${REAL_BASE_YEAR} dollars)` : 'Pay over time'}
          columns={['Snapshot', 'Actual pay', 'Full-time rate', 'Title median']}
          rows={trendData.map((t) => [t.label, t.salary, t.rate, t.med])}
          unit="snapshots"
          period={spanLabel(trendData.map((t) => t.label))}
        />
      </Card>
      {raiseCtx.breakdown && raiseCtx.breakdown.shares.length > 0 && (
        <Card withBorder padding="lg" mt="lg">
          <CardTitle sub="Each step's share of the difference between actual pay and pay had every raise been the campus median. The shares add up to the whole difference.">
            Where the difference from typical raises came from
          </CardTitle>
          <GapBreakdown breakdown={raiseCtx.breakdown} />
        </Card>
      )}
      {/* Mounted only on this tab: its query follows a whole cohort through every snapshot, and DuckDB
          runs one query at a time, so it must not queue ahead of the overview's. */}
      {tab === 'trends' && trend[0]?.job_code && (
        <StartingGroup
          personKey={key}
          first={{ snapshotId: trend[0].id, label: trend[0].label, jobCode: trend[0].job_code, title: trend[0].title ?? trend[0].job_code }}
        />
      )}
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="md">
      <HistoryTable rows={rows} comparisons={raiseCtx.ready ? raiseCtx.comparisons : undefined} csvName={name} />
        </Tabs.Panel>

        {/* Everything above on one page, to print or save: what the Reports page's one-person report was. Its
            queries run only once the tab is open. */}
        <Tabs.Panel value="report" pt="md">
          {tab === 'report' && (
            <>
              {/* The measure its figures use (G2), shown where they are: the rest of the page reads fixed ones. */}
              <Group justify="space-between" mb="sm" gap="sm">
                <PayMeasure />
                <Button variant="default" leftSection={<IconPrinter size={ICON.control} />} onClick={() => window.print()}>
                  Print / Save as PDF
                </Button>
              </Group>
              <div className="print-area"><PersonDashboard personKey={key} metric={metric} /></div>
            </>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
