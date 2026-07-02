import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Stack, Title, Text, Group, Button, Card, Table, Badge, Alert, Anchor, NumberInput, Tabs, Paper, ScrollArea,
} from '@mantine/core';
import {
  ResponsiveContainer, ComposedChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceDot, ReferenceLine, ReferenceArea, LabelList,
} from 'recharts';
import { AXIS_TICK, GRID } from '../lib/chartStyle';
import { lineGlowDefs } from '../components/chartDefs';
import { IconAlertTriangle, IconPlus, IconArrowRight } from '@tabler/icons-react';
import { useSql, useGrades, useSummary } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, pct, fullName } from '../lib/format';
import { percentile } from '../lib/stats';
import { useCountUp, useMounted, prefersReducedMotion } from '../lib/motion';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { TenurePayScatter, type ScatterPoint } from '../components/TenurePayScatter';
import { PayBandBar } from '../components/PayBandBar';
import { PeerRangeBar } from '../components/PeerRangeBar';
import { SalaryHistogram } from '../components/SalaryHistogram';
import { ChartData } from '../components/ChartData';
import { LoadingState } from '../components/Loading';

/** Salary-trend hover card: the title at that snapshot, actual pay, and the full-time rate breakdown. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; title: string | null; salary: number; rate?: number; fte?: number; appts?: number; med?: number | null } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const partTime = d.rate != null && Math.round(d.rate) !== Math.round(d.salary);
  return (
    <Paper withBorder shadow="sm" p="xs">
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Actual paid: {usd(d.salary)}</Text>
      {partTime && <Text size="xs" c="dimmed">Full-time rate: {usd(d.rate)}</Text>}
      {d.fte != null && <Text size="xs" c="dimmed">Appointment: {Math.round(d.fte * 100)}% FTE</Text>}
      {d.med != null && <Text size="xs" c="dimmed">Title median: {usd(d.med)}</Text>}
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </Paper>
  );
}

/** Title-change marker on the actual-pay line: a diamond with a faint halo (Recharts injects cx/cy). */
function TitleChangeDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  const s = 6;
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="var(--mantine-color-accent-6)" opacity={0.15} />
      <path
        d={`M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy} Z`}
        fill="var(--mantine-color-accent-7)"
        stroke="var(--mantine-color-body)"
        strokeWidth={1.5}
      />
    </g>
  );
}

/** Small +X% / −X% pill above each trend point — the raise vs the previous snapshot (null on the first).
 *  Floats a consistent gap above its dot (enough to clear the title-change diamond too); only when the dot
 *  sits near the top of the plot does it drop below instead, so the pill never collides with the top edge. */
function YoyLabel(props: { x?: number; y?: number; value?: number | null }) {
  const { x, y, value } = props;
  if (x == null || y == null || value == null) return null;
  const up = value >= 0;
  const txt = `${up ? '+' : ''}${(value * 100).toFixed(1)}%`;
  const color = up ? 'var(--mantine-color-pos-7)' : 'var(--mantine-color-red-7)';
  const w = txt.length * 6 + 8;
  const h = 15;
  const cy = y > 48 ? y - 22 : y + 22; // uniform float above; flip below only when too close to the top
  return (
    <g>
      <rect x={x - w / 2} y={cy - h / 2} width={w} height={h} rx={7} fill="var(--mantine-color-body)" fillOpacity={0.85} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
      <text x={x} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={color}>{txt}</text>
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
function TrendLegend({ hasTitleChange, hasFte, hasGradeBand, mode }: { hasTitleChange: boolean; hasFte: boolean; hasGradeBand: boolean; mode: 'actual' | 'rate' }) {
  const item = (swatch: ReactNode, label: string) => (
    <Group gap={6} wrap="nowrap" align="center">
      {swatch}
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
  return (
    <Group gap="lg" mt="xs" wrap="wrap">
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-accent-6)" strokeWidth={2} /></svg>,
        mode === 'actual' ? 'Actual pay' : 'Salary rate',
      )}
      {item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-gray-5)" strokeWidth={2} strokeDasharray="5 3" /></svg>,
        'Title median — resets at each title change',
      )}
      {hasGradeBand && item(
        <svg width={22} height={12} aria-hidden><line x1={1} y1={6} x2={21} y2={6} stroke="var(--mantine-color-gray-5)" strokeWidth={1} strokeDasharray="4 4" /></svg>,
        'Grade band min / max',
      )}
      {hasFte && item(
        <svg width={22} height={12} aria-hidden>
          <rect x={1} y={4} width={20} height={7} fill="var(--mantine-color-pos-6)" fillOpacity={0.18} />
          <line x1={1} y1={4} x2={21} y2={4} stroke="var(--mantine-color-pos-6)" strokeWidth={2} />
        </svg>,
        'Appointment (FTE) — lower chart',
      )}
      {hasTitleChange && item(
        <svg width={14} height={14} aria-hidden><path d="M7,1 L13,7 L7,13 L1,7 Z" fill="var(--mantine-color-accent-7)" /></svg>,
        'Title change',
      )}
      {hasTitleChange && item(
        <svg width={10} height={14} aria-hidden><line x1={5} y1={1} x2={5} y2={13} stroke="var(--mantine-color-gray-4)" strokeWidth={1} strokeDasharray="2 3" /></svg>,
        'New title era',
      )}
    </Group>
  );
}

/** Wrap a title-era divider label onto at most two balanced lines (≤26 chars each) so the full title
 *  shows without truncation and without overrunning the chart. Short titles stay on one line. */
function wrapTitle(s: string): string[] {
  const words = s.split(/\s+/);
  if (s.length <= 20 || words.length === 1) return [s];
  let best: string[] = [s];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) <= 26 && Math.abs(a.length - b.length) < bestDiff) {
      best = [a, b];
      bestDiff = Math.abs(a.length - b.length);
    }
  }
  return best;
}

/** Custom label for a title era: the full (wrapped) title, stacked just above the plot. Recharts injects
 *  `viewBox` ({ x, y }) for the vertical reference line. `anchor='start'` left-aligns it — used for the
 *  leftmost era (e.g. a pre-TTC title), which sits at the chart's left edge and has no divider. */
function TitleChangeLabel({ viewBox, title, anchor = 'middle' }: { viewBox?: { x?: number; y?: number }; title?: string | null; anchor?: 'middle' | 'start' }) {
  if (!viewBox || viewBox.x == null || viewBox.y == null || !title) return null;
  const lines = wrapTitle(title);
  const { x, y } = viewBox;
  return (
    <text textAnchor={anchor} fontSize={10} fill="var(--mantine-color-dimmed)">
      {lines.map((ln, i) => (
        <tspan key={i} x={x} y={y - 5 - (lines.length - 1 - i) * 11}>{ln}</tspan>
      ))}
    </text>
  );
}

/** A metadata pill (label + bold value) surfacing one source column under the name. Renders nothing
 *  when the value is blank, so pills only appear for fields the data actually has. */
function MetaPill({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <Group
      gap={5}
      wrap="nowrap"
      style={{
        display: 'inline-flex',
        background: 'var(--mantine-color-default-hover)',
        borderRadius: 6,
        padding: '2px 8px',
      }}
    >
      <Text span c="dimmed" style={{ fontSize: 11 }}>{label}</Text>
      <Text span fw={500} style={{ fontSize: 11 }}>{value}</Text>
    </Group>
  );
}

/** One horizontal percentile bar for the "Standing" small-multiples: label + rank on the left, a track
 *  with a fill to p% (green above the pool median, neutral below), a 50th-percentile reference line and a
 *  marker tick, and the percentile on the right. The fill + marker sweep in left→right on mount (staggered
 *  by `delay`). */
function PercentileBar({ label, n, below, pct, delay = 0 }: { label: string; n: number; below: number; pct: number; delay?: number }) {
  const mounted = useMounted();
  const above = pct >= 50;
  const fill = above ? 'var(--mantine-color-pos-6)' : 'var(--mantine-color-gray-5)';
  const tick = above ? 'var(--mantine-color-pos-7)' : 'var(--mantine-color-gray-6)';
  const sweep = `600ms ease-out ${delay}ms`;
  return (
    <Group wrap="nowrap" gap="md" align="center">
      <div style={{ width: 210, flexShrink: 0 }}>
        <Text size="sm" fw={500} lineClamp={2} title={label}>{label}</Text>
        <Text size="xs" c="dimmed">#{num(n - below)} of {num(n)}</Text>
      </div>
      <div style={{ flex: 1, position: 'relative', height: 10, background: 'var(--mantine-color-default-hover)', borderRadius: 6 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${mounted ? pct : 0}%`, background: fill, opacity: 0.5, borderRadius: 6, transition: `width ${sweep}` }} />
        {/* pool median (50th) reference */}
        <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--mantine-color-default-border)', transform: 'translateX(-50%)' }} />
        <div style={{ position: 'absolute', left: `${mounted ? pct : 0}%`, top: -3, bottom: -3, width: 4, borderRadius: 2, background: tick, transform: 'translateX(-50%)', transition: `left ${sweep}` }} />
      </div>
      <Text size="sm" fw={700} c={above ? 'pos.7' : 'dimmed'} style={{ width: 104, flexShrink: 0, textAlign: 'right' }}>
        {pct}th <Text span size="xs" fw={500} c="dimmed">pctile</Text>
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

export default function Person() {
  const { id } = useParams();
  const key = decodeURIComponent(id ?? '');
  const nav = useNavigate();
  const { add, has } = useTray();

  const { data, isLoading, error } = useSql<Row>(
    ['person', key],
    `SELECT first_name, last_name, snapshot_id, snapshot_label, snapshot_date, school, department,
            title, job_code, salary, salary_fte_adjusted, fte, date_of_hire, employee_category,
            grade_number, grade_basis, salary_grade_raw, flsa_status, comp_basis, pay_rate_type,
            employee_type, contract_type
     FROM salaries WHERE person_key = ${sqlStr(key)} ORDER BY snapshot_date`,
    !!key
  );
  const { data: grades } = useGrades();

  const { data: summary } = useSummary();

  const rows = useMemo(() => data ?? [], [data]);
  const latest = rows[rows.length - 1];
  const name = (latest ? fullName(latest.first_name, latest.last_name) : '') || key;

  // Flag people who aren't in the most recent snapshot (likely no longer employed).
  const campusLatest = summary?.snapshots[summary.snapshots.length - 1] ?? null;
  const departed = !!(latest && campusLatest && String(latest.snapshot_date) < String(campusLatest.date));

  // Salary trend: one point per snapshot. `salary` (the plotted line) is ACTUAL pay — the reported
  // FTE-adjusted figure (Σ salary_fte_adjusted, falling back to rate × FTE), summed across concurrent
  // appointments. We also carry the full-time `rate` (Σ salary) and total `fte` for the breakdown.
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
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...by.values()]
      .map((g) => {
        const appts = g.rows.length;
        const paid = g.rows.reduce((s, r) => s + (r.salary_fte_adjusted ?? (r.salary ?? 0) * (r.fte ?? 1)), 0);
        const rate = g.rows.reduce((s, r) => s + (r.salary ?? 0), 0);
        const fte = g.rows.reduce((s, r) => s + (r.fte ?? 1), 0);
        // primary appointment = highest FTE (tie-break highest salary) — drives the displayed title
        const primary = g.rows.reduce((best, r) => {
          const bf = best.fte ?? 0, rf = r.fte ?? 0;
          return rf > bf || (rf === bf && (r.salary ?? 0) > (best.salary ?? 0)) ? r : best;
        }, g.rows[0]);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary: paid, rate, fte, title: primary.title, job_code: primary.job_code, appts };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

  // Median pay for the title the person held at each snapshot (market context for the trend).
  const { data: titleMedRows } = useSql<{ snapshot_id: string; med: number | null; med_rate: number | null }>(
    ['person-title-med', key],
    `WITH me AS (SELECT snapshot_id, arg_max(job_code, salary) job FROM salaries
        WHERE person_key = ${sqlStr(key)} AND job_code IS NOT NULL GROUP BY snapshot_id),
      pp AS (SELECT s.snapshot_id, s.person_key, ${personPay('fte')} pay,
          sum(s.salary) FILTER (WHERE s.salary > 0) rate
        FROM salaries s JOIN me ON s.snapshot_id = me.snapshot_id AND s.job_code = me.job
        GROUP BY s.snapshot_id, s.person_key)
     SELECT snapshot_id, median(pay) med, median(rate) med_rate FROM pp WHERE pay > 0 GROUP BY snapshot_id`,
    !!key
  );
  const trendData = useMemo(() => {
    const med = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med]));
    const medRate = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med_rate]));
    // `era` increments at each title change so the median can be drawn as disconnected per-title segments.
    let era = 0;
    return trend.map((t, i) => {
      if (i > 0 && t.job_code !== trend[i - 1].job_code) era++;
      return { ...t, med: med.get(t.id) ?? null, medRate: medRate.get(t.id) ?? null, era };
    });
  }, [trend, titleMedRows]);

  // Distinct title eras (for disconnected median segments) and the points where the title changes.
  const eras = useMemo(() => [...new Set(trendData.map((t) => t.era))], [trendData]);
  const titleChanges = useMemo(
    () => trendData.filter((t, i) => i > 0 && t.era !== trendData[i - 1].era),
    [trendData],
  );
  // Plot rows: carry each metric's year-over-year change (vs the previous snapshot) so the line can label
  // every step with its raise %.
  const trendPlot = useMemo(
    () => trendData.map((t, i) => {
      const prev = i > 0 ? trendData[i - 1] : null;
      return {
        ...t,
        yoyActual: prev && prev.salary ? (t.salary - prev.salary) / prev.salary : null,
        yoyRate: prev && prev.rate ? (t.rate - prev.rate) / prev.rate : null,
      };
    }),
    [trendData],
  );
  // Hide the FTE sub-chart entirely when the appointment never changes — a flat 100% line is pure noise.
  const fteVaries = useMemo(
    () => new Set(trendData.map((t) => Math.round((t.fte ?? 1) * 100))).size > 1,
    [trendData],
  );
  // First/last x-label of each title era → faint alternating background bands behind the line.
  const eraSpans = useMemo(() => {
    const m = new Map<number, { x1: string; x2: string }>();
    for (const t of trendData) {
      const cur = m.get(t.era);
      if (!cur) m.set(t.era, { x1: t.label, x2: t.label });
      else cur.x2 = t.label;
    }
    return [...m.entries()].map(([era, s]) => ({ era, ...s }));
  }, [trendData]);


  // Appointment count per snapshot (for the "split" flag in the history table).
  const apptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.snapshot_id, (m.get(r.snapshot_id) ?? 0) + 1);
    return m;
  }, [rows]);

  // History rows ordered chronologically, with pre-TTC above post-TTC for the shared-date pair.
  const historyRows = useMemo(() => {
    const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : id.endsWith('-post') ? 1 : 0);
    return [...rows].sort(
      (a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id)
    );
  }, [rows]);

  // Per-snapshot job-code summary so the history badges/Δ compare the SAME title across snapshots
  // (not the adjacent row, which interleaves concurrent appointments and yields bogus "New title"/−100%).
  const snapHistory = useMemo(() => {
    const order: string[] = [];
    const index = new Map<string, number>();
    const bySnap = new Map<string, { date: string; jobs: Map<string, number> }>();
    for (const r of historyRows) {
      let s = bySnap.get(r.snapshot_id);
      if (!s) { s = { date: String(r.snapshot_date), jobs: new Map() }; bySnap.set(r.snapshot_id, s); index.set(r.snapshot_id, order.length); order.push(r.snapshot_id); }
      if (r.job_code != null) {
        const actual = r.salary_fte_adjusted ?? (r.salary ?? 0) * (r.fte ?? 1);
        s.jobs.set(r.job_code, (s.jobs.get(r.job_code) ?? 0) + actual);
      }
    }
    return { order, index, bySnap };
  }, [historyRows]);

  const tenureYears = useMemo(() => {
    const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
    if (!hire) return null;
    return Math.max(0, (Date.now() - new Date(hire).getTime()) / (365.25 * 864e5));
  }, [rows]);

  const firstSalary = trend[0]?.salary ?? null; // actual paid
  const lastSalary = trend[trend.length - 1]?.salary ?? null; // actual paid
  const animatedPay = useCountUp(lastSalary); // hero value counts up once on mount (reduced-motion → final)
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;
  // Span of available salary data (oldest → latest snapshot) — the window the change is measured over.
  const firstDate = trend[0]?.date ?? null;
  const lastDate = trend[trend.length - 1]?.date ?? null;
  const spanYears = firstDate && lastDate ? (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 864e5) : null;
  const oldestLabel = trend[0]?.label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? null;
  const hireYear = rows.find((r) => r.date_of_hire)?.date_of_hire?.slice(0, 4) ?? trend[0]?.date?.slice(0, 4) ?? null;
  // Full-time rate (and its growth) — shown alongside actual pay where they diverge (FTE changes).
  const firstRate = trend[0]?.rate ?? null;
  const lastRate = trend[trend.length - 1]?.rate ?? null;
  const lastFte = trend[trend.length - 1]?.fte ?? null;
  const rateChange = firstRate && lastRate ? (lastRate - firstRate) / firstRate : null;
  const partTime = lastRate != null && lastSalary != null && Math.round(lastRate) !== Math.round(lastSalary);
  const chgDiffer = totalChange != null && rateChange != null && Math.abs(totalChange - rateChange) > 0.005;
  const sgnPct = (x: number | null) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

  // One-line career summary under the header. Only surface a prior title when it's a genuine *pre-TTC* title
  // (the person's earliest record is the pre-TTC snapshot and the title differs from now) — we can't assume the
  // hire-era title otherwise, so those people just get "At UW since {year} · {current title}".
  const careerLine = useMemo(() => {
    const firstTitle = trend[0]?.title;
    const latestTitle = latest?.title;
    if (!latestTitle || trend.length === 0) return null;
    const hireYear = rows.find((r) => r.date_of_hire)?.date_of_hire?.slice(0, 4) ?? null;
    const at = hireYear ? `At UW since ${hireYear}` : null;
    const hasPreTTC = !!trend[0]?.id?.endsWith('-pre') && !!firstTitle && firstTitle !== latestTitle;
    if (hasPreTTC) {
      const lead = at ? `${at} · Title before TTC` : 'Title before TTC';
      return `${lead}: ${firstTitle}; now ${latestTitle}.`;
    }
    return `${[at, latestTitle].filter(Boolean).join(' · ')}.`;
  }, [trend, latest, rows]);

  const band = useMemo(() => {
    if (!latest || latest.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === latest.grade_number && g.basis === latest.grade_basis) ?? null;
  }, [latest, grades]);

  const lastSnap = latest?.snapshot_id ?? '';
  // Percentile pools (latest snapshot): per-pool counts of people and how many earn less than the
  // subject, so each percentile can be computed with the shared (n − 1) definition in JS.
  const mine = lastSalary ?? 0;
  const selfSchool = sqlStr(latest?.school ?? '');
  const selfDept = sqlStr(latest?.department ?? '');
  const selfJob = sqlStr(latest?.job_code ?? '');
  const selfGrade = latest?.grade_number ?? -1;
  const { data: standingRows } = useSql<{
    n_all: number; b_all: number; n_div: number; b_div: number; n_dept: number; b_dept: number;
    n_grade: number; b_grade: number; n_title: number; b_title: number;
  }>(
    ['standing', key, lastSnap, mine],
    `WITH pp AS (SELECT person_key, ${personPay('fte')} pay, any_value(school) school,
        any_value(department) department, any_value(grade_number) grade_number, any_value(job_code) job_code
      FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} GROUP BY person_key)
     SELECT
       count(*) FILTER (WHERE pay > 0) n_all,
       count(*) FILTER (WHERE pay > 0 AND pay < ${mine}) b_all,
       count(*) FILTER (WHERE pay > 0 AND school = ${selfSchool}) n_div,
       count(*) FILTER (WHERE pay > 0 AND school = ${selfSchool} AND pay < ${mine}) b_div,
       count(*) FILTER (WHERE pay > 0 AND department = ${selfDept}) n_dept,
       count(*) FILTER (WHERE pay > 0 AND department = ${selfDept} AND pay < ${mine}) b_dept,
       count(*) FILTER (WHERE pay > 0 AND grade_number = ${selfGrade}) n_grade,
       count(*) FILTER (WHERE pay > 0 AND grade_number = ${selfGrade} AND pay < ${mine}) b_grade,
       count(*) FILTER (WHERE pay > 0 AND job_code = ${selfJob}) n_title,
       count(*) FILTER (WHERE pay > 0 AND job_code = ${selfJob} AND pay < ${mine}) b_title
     FROM pp`,
    !!latest && lastSalary != null && lastSalary > 0
  );
  const standingPools = useMemo(() => {
    const r = standingRows?.[0];
    if (!r) return [];
    const pctOf = (below: number, n: number) => (n <= 1 ? null : Math.round((below / (n - 1)) * 100));
    const raw = [
      { label: 'All UW–Madison', n: r.n_all, below: r.b_all, ok: true },
      { label: latest?.school ?? 'Division', n: r.n_div, below: r.b_div, ok: !!latest?.school },
      { label: latest?.department ?? 'Department', n: r.n_dept, below: r.b_dept, ok: !!latest?.department },
      { label: latest?.grade_number != null ? `Salary grade ${latest.grade_number}` : 'Salary grade', n: r.n_grade, below: r.b_grade, ok: latest?.grade_number != null },
      { label: latest?.title ?? 'Title', n: r.n_title, below: r.b_title, ok: !!latest?.job_code },
    ];
    return raw
      .filter((x) => x.ok && x.n >= 2)
      .map((x) => ({ label: x.label, n: x.n, below: x.below, pct: pctOf(x.below, x.n)! }));
  }, [standingRows, latest]);

  // Same-title peers = everyone sharing this person's job_code at the latest snapshot.
  const jobCode = latest?.job_code ?? null;
  const { data: peerStatsRows } = useSql<PeerStats>(
    ['peer-stats', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, ${personPay('fte')} pay, sum(salary) FILTER (WHERE salary > 0) rate FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi,
            median(rate) med_rate, quantile_cont(rate, 0.75) p75_rate FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peers } = useSql<PeerRow>(
    ['peer-list', jobCode ?? '', lastSnap],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(school) school, any_value(department) department,
        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 AS tenure,
        ${personPay('fte')} pay
        FROM salaries WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, tenure, pay FROM pp WHERE pay > 0 ORDER BY pay DESC`,
    !!lastSnap && !!jobCode
  );
  // ── Cohort (All vs Same-school): every overview stat derives from the SAME filtered peer set. ──
  const [cohort, setCohort] = useState<'all' | 'school'>('all');
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
  const cohortPct = lastSalary != null && cohortPays.length > 1 ? percentile(lastSalary, cohortPays) : null;

  // Pay-vs-tenure scatter points for the active cohort (only peers with a known tenure can be plotted).
  const scatterPoints = useMemo<ScatterPoint[]>(
    () => cohortList
      .filter((p) => p.tenure != null && Number.isFinite(p.tenure))
      .map((p) => ({
        tenure: Math.max(0, p.tenure as number),
        pay: p.pay,
        sameSchool: p.person_key !== key && !!p.school && p.school === latest?.school,
        isSelf: p.person_key === key,
        name: fullName(p.fn, p.ln) || '—',
      })),
    [cohortList, key, latest],
  );
  const selfScatter = useMemo(() => {
    const s = cohortList.find((p) => p.person_key === key);
    return s && s.tenure != null && Number.isFinite(s.tenure) ? { tenure: Math.max(0, s.tenure), pay: s.pay } : null;
  }, [cohortList, key]);

  const [trendMode, setTrendMode] = useState<'actual' | 'rate'>('actual');
  const reduceMotion = prefersReducedMotion(); // gate the trend-line draw-in (and other JS-driven motion)

  // Long titles (e.g. "Professor") can have 1000+ peers — page the table instead of rendering
  // every row. Auto-expand if the subject would otherwise be scrolled off the first page.
  const [showAllPeers, setShowAllPeers] = useState(false);
  useEffect(() => {
    if (cohortRank != null && cohortRank > 25) setShowAllPeers(true);
  }, [cohortRank]);
  const visiblePeers = showAllPeers ? cohortList : cohortList.slice(0, 25);

  // Scroll the peer list so this person's row is centered/visible (viewport only — no page jump).
  const peerViewportRef = useRef<HTMLDivElement>(null);
  const subjectRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const vp = peerViewportRef.current;
    const row = subjectRowRef.current;
    if (!vp || !row) return;
    const vpRect = vp.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    vp.scrollTop += rowRect.top - vpRect.top - vp.clientHeight / 2 + rowRect.height / 2;
  }, [peers, showAllPeers]);

  const [pctRaise, setPctRaise] = useState<number>(2);
  const [years, setYears] = useState<number>(5);

  // Raise presets: the person's own historical CAGR (rate) and the title-median's CAGR — annualized
  // over the available span so they read as a sensible "%/yr".
  const cagr = (first: number | null | undefined, last: number | null | undefined) =>
    first != null && last != null && first > 0 && spanYears != null && spanYears >= 0.5
      ? (Math.pow(last / first, 1 / spanYears) - 1) * 100
      : null;
  const recentAvgPct = cagr(firstRate, lastRate);
  const medRateSeries = trendData.map((t) => t.medRate).filter((x): x is number => x != null);
  const titleGrowthPct = medRateSeries.length >= 2 ? cagr(medRateSeries[0], medRateSeries[medRateSeries.length - 1]) : null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const projectedRate = lastRate != null ? lastRate * Math.pow(1 + pctRaise / 100, years) : null;
  // Quick-target presets: the annualized %/yr needed to reach a target rate over the current `years`.
  const targetRaisePct = (t: number | null | undefined) =>
    lastRate != null && lastRate > 0 && years > 0 && t != null && t > lastRate
      ? r1((Math.pow(t / lastRate, 1 / years) - 1) * 100)
      : null;
  const medTargetPct = targetRaisePct(peer?.med_rate);
  const maxTargetPct = band ? targetRaisePct(band.max) : null;

  if (isLoading) return <LoadingState label="Loading person…" />;
  if (error) return <Alert color="red">Failed to load person: {(error as Error).message}</Alert>;
  if (!rows.length) return <Alert color="gray">No records found for this person.</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ paddingLeft: 'var(--mantine-spacing-md)', borderLeft: '3px solid var(--mantine-color-accent-5)' }}>
          <Title order={1} style={{ letterSpacing: '-0.02em', fontSize: 'clamp(1.75rem, 3vw, 2.5rem)' }}>{name}</Title>
          <Text c="dimmed">
            {latest?.job_code ? (
              <Anchor component={Link} to={`/paycheck?code=${encodeURIComponent(latest.job_code)}`}>{latest?.title}</Anchor>
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
          {careerLine && <Text size="sm" c="dimmed" mt={4}>{careerLine}</Text>}
          {/* Source columns the page otherwise hides, surfaced as a wrapping row of pills (null ones omitted). */}
          <Group gap={7} wrap="wrap" mt="sm">
            <MetaPill label="Grade" value={latest?.salary_grade_raw ?? (latest?.grade_number != null ? String(latest.grade_number) : null)} />
            <MetaPill label="Job code" value={latest?.job_code} />
            <MetaPill label="FLSA" value={latest?.flsa_status} />
            <MetaPill label="Basis" value={latest?.comp_basis} />
            <MetaPill label="Pay type" value={latest?.pay_rate_type} />
            <MetaPill label="Category" value={latest?.employee_category} />
            <MetaPill label="Type" value={[latest?.employee_type, latest?.contract_type].filter(Boolean).join(' · ') || null} />
          </Group>
        </div>
        <Button
          variant={has(key) ? 'light' : 'filled'}
          onClick={() => add({ type: 'person', id: key, label: name })}
          disabled={has(key)}
        >
          {has(key) ? 'In tray' : '+ Add to tray'}
        </Button>
      </Group>

      {departed && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
          Not in the latest snapshot ({campusLatest?.label}) — may no longer be employed. Last seen {latest?.snapshot_label}.
        </Alert>
      )}

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="pay">Pay &amp; standing</Tabs.Tab>
          <Tabs.Tab value="trends">Salary trend</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="lg" className="tab-rise">
            {/* Lead + supporting stat row: Actual pay dominates; Salary growth · Tenure are quieter. */}
            <div className="stat-cells">
              {/* Lead — Actual pay: signature accent rail + a date chip top-right; the value counts up on mount. */}
              <Card
                withBorder
                radius="sm"
                p="lg"
                className="stat-lead"
                bg="var(--mantine-color-default-hover)"
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--accent-grad)' }} />
                <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
                  <Text tt="uppercase" c="dimmed" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
                    Actual pay
                  </Text>
                  {latest?.snapshot_label && (
                    <Badge variant="light" color="accent" radius="sm" tt="none" style={{ fontWeight: 600, flexShrink: 0 }}>
                      {latest.snapshot_label}
                    </Badge>
                  )}
                </Group>
                <Group gap={8} align="center" wrap="nowrap" mt={6}>
                  <Text fw={700} style={{ fontSize: 38, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{usd(animatedPay)}</Text>
                  {lastFte != null && Math.abs(lastFte - 1) > 0.005 && (
                    <Badge variant="light" color="gray" radius="sm" tt="none" style={{ fontWeight: 600 }}>
                      {+lastFte.toFixed(2)} FTE
                    </Badge>
                  )}
                </Group>
                {latest?.title && <Text size="sm" c="dimmed" mt={4}>{latest.title}</Text>}
                {partTime && (
                  <Text size="xs" c="dimmed" mt={2}>full-time rate {usd(lastRate)}</Text>
                )}
              </Card>

              {/* Salary growth — the change %, with the timeframe inline so the window reads as part of the
                  number; the snapshot count / window-start (and any rate divergence) sit below as context. */}
              <Card withBorder radius="sm" p="lg">
                <Text tt="uppercase" c="dimmed" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>Salary growth</Text>
                <Group gap={8} align="baseline" wrap="nowrap" mt={6}>
                  <Text fw={700} c={totalChange == null ? undefined : totalChange < 0 ? 'red.7' : 'pos.7'} style={{ fontSize: 24, lineHeight: 1.1 }}>
                    {sgnPct(totalChange)}
                  </Text>
                  {spanYears != null && spanYears >= 0.1 && (
                    <Text size="sm" c="dimmed">over {spanYears.toFixed(1)} yrs</Text>
                  )}
                </Group>
                {oldestLabel && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {num(trend.length)} snapshot{trend.length === 1 ? '' : 's'} · since {oldestLabel}{chgDiffer ? ` · rate ${sgnPct(rateChange)}` : ''}
                  </Text>
                )}
              </Card>

              {/* Tenure */}
              <Card withBorder radius="sm" p="lg">
                <Text tt="uppercase" c="dimmed" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>Tenure</Text>
                <Text fw={700} mt={6} style={{ fontSize: 24, lineHeight: 1.1 }}>
                  {tenureYears == null ? '—' : (
                    <>{tenureYears.toFixed(1)}<Text span fw={500} c="dimmed" style={{ fontSize: 14 }}> yrs</Text></>
                  )}
                </Text>
                {hireYear && <Text size="xs" c="dimmed" mt={2}>since {hireYear}</Text>}
              </Card>
            </div>

            {peer && peer.n === 1 && jobCode && (
              <Card withBorder padding="lg">
                <Text size="sm">
                  {name} is the only employee at UW with the title {latest?.title} (job code {jobCode}) in the latest snapshot — no one else to compare against.
                </Text>
                <Group justify="flex-end" mt="md">
                  <Button component={Link} to={`/paycheck?code=${encodeURIComponent(jobCode)}`} variant="default" size="xs" rightSection={<IconArrowRight size={14} />}>
                    Go to title page
                  </Button>
                </Group>
              </Card>
            )}

            {peer && peer.n > 1 && lastSalary != null && jobCode && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
                  <Text size="sm" fw={600}>How this person compares to others with the same title</Text>
                  {allCount > schoolCount && (
                    <SegmentedToggle
                      value={cohort}
                      onChange={(v) => setCohort(v as 'all' | 'school')}
                      options={[
                        { id: 'all', label: `All ${num(allCount)}` },
                        { id: 'school', label: `Same school ${num(schoolCount)}` },
                      ]}
                    />
                  )}
                </Group>
                <Text size="xs" c="dimmed" mb="md">
                  {cohort === 'school'
                    ? `Among ${num(cohortStats?.n ?? 0)} ${(cohortStats?.n ?? 0) === 1 ? 'person' : 'people'} with the title ${latest?.title} — same title, same school (${latest?.school}).`
                    : `Among ${num(allCount)} people with the title ${latest?.title} (job code ${jobCode}) in the latest snapshot.`}
                </Text>
                {cohortStats && cohortStats.n >= 2 ? (
                  <>
                    <PeerRangeBar min={cohortStats.lo} p25={cohortStats.p25} median={cohortStats.med} p75={cohortStats.p75} max={cohortStats.hi} value={lastSalary} />
                    {cohortPct != null && (
                      <Text size="sm" mt="sm" mb="md">
                        Paid more than <b>{cohortPct}%</b> of {cohort === 'school' ? 'same-school peers with this title' : 'people with this title'}.
                      </Text>
                    )}
                    <SalaryHistogram
                      values={cohortPays}
                      markerValue={lastSalary}
                      markerLabel="this person"
                      domain={allPaysDomain}
                      tooFewText={`Only ${num(cohortStats.n)} ${cohortStats.n === 1 ? 'person has' : 'people have'} this title here — too few to chart a distribution.`}
                    />
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    {name} is the only person with this title in {latest?.school} — switch to “All {num(allCount)}” to compare against everyone with the title.
                  </Text>
                )}
                <Group justify="flex-end" mt="md">
                  <Button component={Link} to={`/paycheck?code=${encodeURIComponent(jobCode)}`} variant="default" size="xs" rightSection={<IconArrowRight size={14} />}>
                    Go to title page
                  </Button>
                </Group>
              </Card>
            )}

            {scatterPoints.length >= 4 && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap" align="flex-start">
                  <div>
                    <Text size="sm" fw={600}>Pay vs. tenure — same title</Text>
                    <Text size="xs" c="dimmed">Where this person sits against what tenure alone predicts for {latest?.title}.</Text>
                  </div>
                  {allCount > schoolCount && (
                    <SegmentedToggle
                      value={cohort}
                      onChange={(v) => setCohort(v as 'all' | 'school')}
                      options={[
                        { id: 'all', label: `All ${num(allCount)}` },
                        { id: 'school', label: `Same school ${num(schoolCount)}` },
                      ]}
                    />
                  )}
                </Group>
                <TenurePayScatter points={scatterPoints} self={selfScatter} titleLabel={latest?.title ?? 'this title'} />
              </Card>
            )}

            {peers && peers.length > 1 && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="md" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    Others with this title{cohort === 'school' ? ` · ${latest?.school}` : ''}
                  </Text>
                  {cohortRank != null && (
                    <Text size="sm" c="dimmed">
                      {name} ranks <b>#{cohortRank}</b> of {num(cohortList.length)} by salary
                    </Text>
                  )}
                </Group>
                <ScrollArea.Autosize mah={460} type="auto" offsetScrollbars="present" viewportRef={peerViewportRef}>
                  <Table stickyHeader miw={760}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={48} ta="right">#</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>School</Table.Th>
                        <Table.Th>Department</Table.Th>
                        <Table.Th ta="right">Tenure</Table.Th>
                        <Table.Th ta="right">Salary</Table.Th>
                        <Table.Th w={132} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visiblePeers.map((p, i) => {
                        const isYou = p.person_key === key;
                        const inTray = has(p.person_key);
                        const sameSchool = !isYou && !!p.school && p.school === latest?.school;
                        return (
                          <Table.Tr
                            key={p.person_key}
                            className={`peer-row${sameSchool ? ' peer-same-school' : ''}`}
                            ref={isYou ? subjectRowRef : undefined}
                            onClick={() => !isYou && nav(`/person/${encodeURIComponent(p.person_key)}`)}
                            tabIndex={isYou ? undefined : 0}
                            role={isYou ? undefined : 'button'}
                            onKeyDown={(e) => {
                              if (!isYou && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                nav(`/person/${encodeURIComponent(p.person_key)}`);
                              }
                            }}
                            style={{ cursor: isYou ? 'default' : 'pointer', background: isYou ? 'var(--mantine-color-accent-light)' : undefined }}
                          >
                            <Table.Td ta="right" c="dimmed">{i + 1}</Table.Td>
                            <Table.Td>
                              <Text span size="sm" c={isYou ? undefined : 'accent'} fw={isYou ? 700 : undefined}>
                                {fullName(p.fn, p.ln) || '—'}
                              </Text>
                              {isYou && <Badge ml="xs" size="xs" variant="filled">this person</Badge>}
                            </Table.Td>
                            <Table.Td title={sameSchool ? `Same school as ${name}` : undefined}>
                              <Text span size="sm" lineClamp={1}>{p.school ?? '—'}</Text>
                            </Table.Td>
                            <Table.Td><Text span size="sm" c="dimmed" lineClamp={1}>{p.department ?? '—'}</Text></Table.Td>
                            <Table.Td ta="right" fw={isYou ? 700 : undefined}>{p.tenure != null ? `${Math.max(0, p.tenure).toFixed(1)} yrs` : '—'}</Table.Td>
                            <Table.Td ta="right" fw={isYou ? 700 : undefined}>{usd(p.pay)}</Table.Td>
                            <Table.Td ta="right">
                              <Button
                                className="peer-add"
                                size="compact-xs"
                                variant={inTray ? 'light' : 'filled'}
                                color={inTray ? 'gray' : 'accent'}
                                radius="xl"
                                leftSection={inTray ? undefined : <IconPlus size={12} />}
                                disabled={inTray}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) });
                                }}
                              >
                                {inTray ? 'In tray' : 'Add to tray'}
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
                {cohortList.length > 25 && (
                  <Group justify="center" mt="sm">
                    <Button variant="subtle" size="xs" onClick={() => setShowAllPeers((v) => !v)}>
                      {showAllPeers ? 'Show top 25 only' : `Show all ${num(cohortList.length)}`}
                    </Button>
                  </Group>
                )}
                {cohort === 'all' && latest?.school && peers.some((p) => p.person_key !== key && p.school === latest.school) && (
                  <Text size="xs" c="dimmed" mt="xs">Rows shaded green share {name}'s school ({latest.school}).</Text>
                )}
              </Card>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="pay" pt="md">
          <Stack gap="lg" className="tab-rise">
      {/* 4a — Standing: a percentile bar per pool, so all five comparisons read at a glance. */}
      {standingPools.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb={2}>Standing — where this pay ranks in each pool (latest snapshot)</Text>
          <Text size="xs" c="dimmed" mb="md">Rank and percentile across each pool this person belongs to.</Text>
          <Stack gap="sm">
            {standingPools.map((p, i) => (
              <PercentileBar key={p.label} label={p.label} n={p.n} below={p.below} pct={p.pct} delay={i * 90} />
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="md">Percentile = share of the pool this person out-earns; the centre line marks the pool median (50th). Green = above median. Pools with only one person are omitted.</Text>
        </Card>
      )}

      {/* 4b — Pay band: full-time rate within the OFFICIAL grade range + headroom. (Title median/p75 live on
              the Overview title bar, so this card is purely the HR grade-structure lens.) */}
      {band && lastRate != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb={2}>
            Pay band — grade {latest?.grade_number} · official HR range
          </Text>
          <Text size="xs" c="dimmed" mb="md">
            Where the full-time rate sits in grade {latest?.grade_number}'s official min–max, and the room to the top.
          </Text>
          <PayBandBar min={band.min} max={band.max} value={lastRate} quartiles />
          {lastRate >= band.max ? (
            <Text size="sm" mt="md">
              At or above the top of grade {latest?.grade_number}'s band (max {usd(band.max)}) — effectively maxed out.
            </Text>
          ) : (
            <Text size="sm" mt="md">
              <Text span fw={700} c="pos.7">{usd(band.max - lastRate)}</Text> of headroom to the top of grade {latest?.grade_number}'s band
              <Text span c="dimmed"> (grade max {usd(band.max)}).</Text>
            </Text>
          )}
        </Card>
      )}

      {/* 4c — Raise / what-if: presets, steppers, the projected rate, and where it lands on the band. */}
      {lastRate != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb={4}>Raise / what-if simulator</Text>
          <Text size="xs" c="dimmed" mb="sm">Projects the full-time salary rate; actual pay scales with FTE.</Text>
          <Group gap="xs" mb="md" wrap="wrap">
            {[
              { label: 'Flat 2%', val: 2 },
              ...(recentAvgPct != null && recentAvgPct > 0 ? [{ label: `My recent avg ≈${r1(recentAvgPct)}%`, val: r1(recentAvgPct) }] : []),
              ...(titleGrowthPct != null && titleGrowthPct > 0 ? [{ label: `Title median growth ≈${r1(titleGrowthPct)}%`, val: r1(titleGrowthPct) }] : []),
              ...(medTargetPct != null ? [{ label: `Reach title median (${medTargetPct}%/yr)`, val: medTargetPct }] : []),
              ...(maxTargetPct != null ? [{ label: `Reach band max (${maxTargetPct}%/yr)`, val: maxTargetPct }] : []),
            ].map((c) => {
              const sel = Math.abs(pctRaise - c.val) < 0.05;
              return (
                <Button key={c.label} size="compact-sm" radius="xl" variant={sel ? 'light' : 'default'} color="accent" onClick={() => setPctRaise(c.val)}>
                  {c.label}
                </Button>
              );
            })}
          </Group>
          <Group align="flex-end" wrap="wrap">
            <NumberInput label="Annual raise %" value={pctRaise} onChange={(v) => setPctRaise(typeof v === 'number' ? v : 0)} w={150} step={0.5} min={0} suffix="%" />
            <NumberInput label="Years" value={years} onChange={(v) => setYears(typeof v === 'number' ? v : 0)} w={120} min={0} max={40} />
            <div>
              <Text size="xs" c="dimmed">Projected full-time rate</Text>
              <Text fw={700} size="xl">{projectedRate != null ? usd(projectedRate) : '—'}</Text>
              {projectedRate != null && lastRate != null && (
                <Text size="xs" c="dimmed">
                  <Text span c="pos.7" fw={600}>+{usd(projectedRate - lastRate)}</Text> vs today
                  {lastFte != null && Math.abs(lastFte - 1) > 0.005 ? ` · actual ${usd(projectedRate * lastFte)}` : ''}
                </Text>
              )}
            </div>
          </Group>

          {band && projectedRate != null && (
            <div style={{ marginTop: 'var(--mantine-spacing-md)' }}>
              <Text size="xs" c="dimmed" mb={6}>Projected position in {years}y (gray tick = today)</Text>
              <PayBandBar min={band.min} max={band.max} value={projectedRate} benchmarks={[{ value: lastRate, label: 'today' }]} />
            </div>
          )}

          {band && lastRate >= band.max && (
            <Text size="xs" c="dimmed" mt="md">
              This rate is already at or above the top of grade {latest?.grade_number}'s pay band ({usd(band.max)}) — effectively maxed out, so there are no years to reach the cap at the current raise rate.
            </Text>
          )}
          {band && lastRate < band.max && pctRaise > 0 && (
            <Text size="xs" c="dimmed" mt="md">
              At {pctRaise}%/yr, ~{Math.ceil(Math.log(band.max / lastRate) / Math.log(1 + pctRaise / 100))} yrs to reach the band max ({usd(band.max)}).
            </Text>
          )}
          {pctRaise === 0 && (
            <Text size="xs" c="dimmed" mt="md">Enter a raise above 0% to project years to the band max.</Text>
          )}
        </Card>
      )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="trends" pt="md">
      <Card withBorder padding="lg">
        <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
          <div>
            <Text size="sm" fw={600}>Salary over time</Text>
            <Text size="xs" c="dimmed">Rate is the full-time salary; Actual pay scales it by FTE.</Text>
          </div>
          <SegmentedToggle
            value={trendMode}
            onChange={(v) => setTrendMode(v as 'actual' | 'rate')}
            options={[{ id: 'actual', label: 'Actual pay' }, { id: 'rate', label: 'Rate' }]}
          />
        </Group>
        {/* Hero salary chart: a ComposedChart with a gradient area + soft-glow line, faint title-era bands,
            grade-band reference lines, and per-step raise % labels. The FTE sub-chart below appears only when
            the appointment actually varies; when it's hidden, the date labels move onto this chart's x-axis. */}
        <ResponsiveContainer width="100%" height={fteVaries ? 244 : 300}>
          <ComposedChart data={trendPlot} syncId="person-trend" margin={{ left: 12, right: 30, top: titleChanges.length ? 40 : 22, bottom: 0 }}>
            <defs>{lineGlowDefs('trend')}</defs>
            {/* Faint alternating background band per title era. */}
            {eras.length > 1 && eraSpans.map((s) => (
              <ReferenceArea
                key={`era-${s.era}`}
                yAxisId="pay"
                x1={s.x1}
                x2={s.x2}
                fill={s.era % 2 === 1 ? 'var(--mantine-color-accent-6)' : 'transparent'}
                fillOpacity={0.05}
                stroke="none"
                ifOverflow="extendDomain"
              />
            ))}
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="label"
              tick={fteVaries ? false : AXIS_TICK}
              tickLine={false}
              tickMargin={fteVaries ? undefined : 10}
              height={fteVaries ? 8 : 34}
              axisLine={{ stroke: 'var(--mantine-color-default-border)' }}
            />
            <YAxis yAxisId="pay" tickFormatter={(v) => usd(v)} width={80} tick={AXIS_TICK} padding={{ top: 6, bottom: 0 }} />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--mantine-color-accent-5)', strokeWidth: 1, strokeDasharray: '4 3' }} />
            {/* Official grade pay-band floor / ceiling for context (kept as separate siblings — Recharts does
                not traverse a Fragment's children). */}
            {/* Grade pay-band floor/ceiling, labelled on the RIGHT — next to the current (latest) salary,
                the band that's actually in effect today (the band can shift as the grade changes over time). */}
            {band && (
              <ReferenceLine yAxisId="pay" y={band.min} stroke="var(--mantine-color-gray-5)" strokeWidth={1} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: `grade min ${usd(band.min)}`, position: 'insideBottomRight', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
            )}
            {band && (
              <ReferenceLine yAxisId="pay" y={band.max} stroke="var(--mantine-color-gray-5)" strokeWidth={1} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: `grade max ${usd(band.max)}`, position: 'insideTopRight', fontSize: 10, fill: 'var(--mantine-color-dimmed)' }} />
            )}
            {/* Label the leftmost title era too (e.g. a pre-TTC title) — it begins at the chart's left edge
                and so has no divider; left-anchored so it isn't clipped. */}
            {eras.length > 1 && trendData[0]?.title && (
              <ReferenceLine
                yAxisId="pay"
                x={trendData[0].label}
                stroke="none"
                label={<TitleChangeLabel title={trendData[0].title} anchor="start" />}
              />
            )}
            {/* Title-change dividers segment the chart into title eras. */}
            {titleChanges.map((t) => (
              <ReferenceLine
                key={`div-${t.id}`}
                yAxisId="pay"
                x={t.label}
                stroke="var(--mantine-color-gray-4)"
                strokeWidth={1}
                strokeDasharray="2 4"
                label={<TitleChangeLabel title={t.title} />}
              />
            ))}
            {/* Gradient area fill under the active metric. */}
            <Area yAxisId="pay" type="monotone" dataKey={trendMode === 'actual' ? 'salary' : 'rate'} stroke="none" fill="url(#trend-area-grad)" isAnimationActive={false} legendType="none" />
            {/* Title median, one disconnected dashed segment per era. */}
            {eras.map((e) => (
              <Line
                key={`med-${e}`}
                yAxisId="pay"
                type="monotone"
                dataKey={(d) => (d.era === e ? (trendMode === 'actual' ? d.med : d.medRate) : null)}
                name="Title median"
                stroke="var(--mantine-color-gray-5)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
                legendType="none"
                isAnimationActive={false}
              />
            ))}
            {/* Soft glow: a blurred, semi-transparent copy beneath the crisp line. */}
            <Line yAxisId="pay" type="monotone" dataKey={trendMode === 'actual' ? 'salary' : 'rate'} stroke="var(--mantine-color-accent-6)" strokeWidth={6} strokeOpacity={0.4} dot={false} legendType="none" isAnimationActive={false} filter="url(#trend-line-glow)" />
            {/* Primary line + per-step raise % labels + haloed active dot. */}
            <Line yAxisId="pay" type="monotone" dataKey={trendMode === 'actual' ? 'salary' : 'rate'} name={trendMode === 'actual' ? 'Actual pay' : 'Salary rate'} stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot activeDot={<ActiveDot />} isAnimationActive={!reduceMotion} animationDuration={800} animationEasing="ease-out">
              <LabelList dataKey={trendMode === 'actual' ? 'yoyActual' : 'yoyRate'} content={<YoyLabel />} />
            </Line>
            {titleChanges.map((t) => {
              const y = trendMode === 'actual' ? t.salary : t.rate;
              return y != null ? (
                <ReferenceDot key={`tc-${t.id}`} yAxisId="pay" x={t.label} y={y} shape={<TitleChangeDot />} />
              ) : null;
            })}
          </ComposedChart>
        </ResponsiveContainer>

        {fteVaries && (
          <>
            {/* Distinct gap between the salary baseline and the FTE chart below. */}
            <div style={{ height: 36 }} />
            <ResponsiveContainer width="100%" height={108}>
              <AreaChart data={trendPlot} syncId="person-trend" margin={{ left: 12, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickMargin={10} height={34} />
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
                  type="monotone"
                  dataKey="fte"
                  name="Appointment (FTE)"
                  stroke="var(--mantine-color-pos-6)"
                  strokeWidth={2}
                  fill="var(--mantine-color-pos-6)"
                  fillOpacity={0.18}
                  dot
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
        <TrendLegend hasTitleChange={titleChanges.length > 0} hasFte={fteVaries} hasGradeBand={!!band} mode={trendMode} />
        <ChartData caption="Salary over time" columns={['Snapshot', 'Actual pay', 'Full-time rate', 'Title median']} rows={trendData.map((t) => [t.label, t.salary, t.rate, t.med])} />
      </Card>
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="md">
      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Title & salary history</Text>
        <Table.ScrollContainer minWidth={880}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Snapshot</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Job code</Table.Th>
              <Table.Th>School / Dept</Table.Th>
              <Table.Th ta="right">Rate</Table.Th>
              <Table.Th ta="right">Actual pay</Table.Th>
              <Table.Th ta="right">Raise</Table.Th>
              <Table.Th ta="right">FTE</Table.Th>
              <Table.Th>Basis</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {historyRows.map((r, i) => {
              // Compare to the SAME job code in the prior snapshot (not the adjacent interleaved row).
              const pos = snapHistory.index.get(r.snapshot_id) ?? 0;
              const priorId = pos > 0 ? snapHistory.order[pos - 1] : null;
              const priorSnap = priorId ? snapHistory.bySnap.get(priorId) : null;
              const inPrior = !!r.job_code && !!priorSnap && priorSnap.jobs.has(r.job_code);
              const isNew = !!priorSnap && !!r.job_code && !inPrior;
              const ttcReclass = isNew && String(priorSnap!.date) === String(r.snapshot_date);
              const actual = r.salary_fte_adjusted ?? (r.salary ?? 0) * (r.fte ?? 1);
              const priorActual = inPrior ? priorSnap!.jobs.get(r.job_code!)! : null;
              const deltaPct = priorActual ? (actual - priorActual) / priorActual : null;
              // Org move = Division/Department changed vs the previous displayed row.
              const prevRow = i > 0 ? historyRows[i - 1] : null;
              const orgMoved = !!prevRow && ((r.school ?? '') !== (prevRow.school ?? '') || (r.department ?? '') !== (prevRow.department ?? ''));
              return (
                <Table.Tr key={`${r.snapshot_id}-${i}`}>
                  <Table.Td>
                    <Badge variant="light" size="sm">{r.snapshot_label}</Badge>
                    {(apptCounts.get(r.snapshot_id) ?? 0) > 1 && (
                      <Badge variant="light" color="orange" size="xs" ml={6}>split</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.title ?? '—'}
                    {isNew && (
                      <Badge ml="xs" size="xs" variant="light" color={ttcReclass ? 'gray' : 'accent'}>
                        {ttcReclass ? 'Reclassified (TTC)' : 'New title'}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{r.job_code ?? '—'}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.school ?? '—'}</Text>
                    <Group gap={6} wrap="nowrap">
                      {orgMoved && (
                        <span
                          title="Division/Department changed from the prior snapshot"
                          style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mantine-color-orange-6)', flexShrink: 0, display: 'inline-block' }}
                        />
                      )}
                      <Text size="xs" c="dimmed">{r.department ?? ''}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{usd(r.salary)}</Table.Td>
                  <Table.Td ta="right">{usd(actual)}</Table.Td>
                  <Table.Td ta="right">
                    {deltaPct != null ? (
                      deltaPct === 0 ? (
                        <Text size="sm" c="dimmed">0%</Text>
                      ) : (
                        <Text size="sm" fw={600} c={deltaPct > 0 ? 'pos' : 'orange'}>
                          {deltaPct > 0 ? '+' : ''}{pct(deltaPct)}
                        </Text>
                      )
                    ) : isNew && !ttcReclass && pos > 0 ? (
                      <Badge size="xs" variant="light" color="accent">promotion</Badge>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{r.fte ?? '—'}</Table.Td>
                  <Table.Td><Text size="xs">{r.comp_basis ?? '—'}</Text></Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        </Table.ScrollContainer>
      </Card>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
