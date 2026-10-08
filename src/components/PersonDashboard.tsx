import { useMemo } from 'react';
import { Stack, Title, Text, Card, Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot, ReferenceLine, Customized } from 'recharts';
import { AXIS_TICK, GRID, Y_PAD, fmtUsd, chartKeys } from '../lib/chartStyle';
import { useSql, useGrades, useSummary } from '../lib/hooks';
import { PayBandNote } from './PayBandNote';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay, reportingAcross, standingSql, poolPercentile, gradedAppt } from '../lib/queries';
import { snapX, snapAxisProps, reportingBreaks, KNOWN_BREAKS } from '../lib/snapTime';
import { titleEras } from '../lib/payHistory';
import { BreakLabels } from './chart/BreakLabel';
import { useRaiseContext } from '../lib/raiseContext';
import { GapBreakdown } from './GapBreakdown';
import { METRIC_LABEL, type Metric } from '../state/controls';
import { usd, num, plural, fullName, spanLabel, fmtChange, fmtToday, fmtYears, fmtGrade } from '../lib/format';
import { TipSurface } from './chart/ChartTooltip';
import { EndLabels } from './chart/EndLabels';
import { PeerRangeBar } from './PeerRangeBar';
import { PayBandBar } from './PayBandBar';
import { bandFor, belowMinimum, isRange } from '../lib/bands';
import { SalaryHistogram } from './SalaryHistogram';
import { ChartData } from './ChartData';
import { PercentileNote } from './PercentileNote';
import { percentile } from '../lib/stats';
import { CardTitle } from './CardTitle';
import { HistoryTable } from './HistoryTable';
import { StatCard, StatRow } from './StatCard';
import { LoadingState } from './Loading';
import { ICON } from '../lib/ui';
import { chartAnim, MOTION, prefersReducedMotion } from '../lib/motion';

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
  pay: number | null;
  earn: number | null;
  rate_raw: number | null;
  salary_fte_adjusted: number | null;
  comp_basis: string | null;
  fte: number | null;
  date_of_hire: string | null;
  grade_number: number | null;
  grade_basis: string | null;
}
interface PeerStats { n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; hi: number | null }

/** Salary-trend hover card: full month, the title at that snapshot (it can change), and salary. */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: { full: string; title: string | null; salary: number | null; appts?: number; med?: number | null; gap?: boolean } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // A gap row only breaks the line at a reporting change; there is no snapshot there.
  if (d.gap || d.salary == null) return null;
  return (
    <TipSurface>
      <Text size="sm" fw={600}>{d.full}</Text>
      <Text size="xs" c="dimmed">Title: {d.title ?? '—'}</Text>
      <Text size="sm">Salary: {usd(d.salary)}</Text>
      {d.med != null && <Text size="xs" c="dimmed">Title median: {usd(d.med)}</Text>}
      {d.appts && d.appts > 1 && (
        <Text size="xs" c="dimmed">Blended across {d.appts} concurrent appointments</Text>
      )}
    </TipSurface>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <StatCard size="sm" label={label} value={value} sub={sub} />;
}

/**
 * Single-page, print-friendly dashboard for one employee: headline stats, salary/title history
 * over time, and how they compare to others in their title. Reuses the same data shapes and
 * charts as the /person/:id profile, reflowed for a report.
 */
export function PersonDashboard({ personKey, metric }: { personKey: string; metric: Metric }) {
  const reduceMotion = prefersReducedMotion();
  const expr = salaryExpr(metric);
  const generated = fmtToday();

  const { data, isLoading, error } = useSql<Row>(
    ['dash-person', personKey, metric],
    `SELECT first_name, last_name, snapshot_id, snapshot_label, snapshot_date, school, department,
            title, job_code, ${expr} AS pay, ${earningsExpr(metric)} AS earn, salary AS rate_raw, salary_fte_adjusted, comp_basis, fte, date_of_hire, grade_number, grade_basis
     FROM salaries WHERE person_key = ${sqlStr(personKey)} ORDER BY snapshot_date`,
    !!personKey
  );
  const { data: grades } = useGrades();

  const { data: summary } = useSummary();

  const rows = useMemo(() => data ?? [], [data]);
  const latest = rows[rows.length - 1];
  const name = (latest ? fullName(latest.first_name, latest.last_name) : '') || personKey;

  const campusLatest = summary?.snapshots[summary.snapshots.length - 1] ?? null;
  const departed = !!(latest && campusLatest && String(latest.snapshot_date) < String(campusLatest.date));

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
        // Single appointment → metric value; multiple concurrent → FTE-blended actual earnings.
        const salary = appts > 1 ? g.rows.reduce((s, r) => s + (r.earn ?? 0), 0) : (g.rows[0].pay ?? 0);
        const primary = g.rows.reduce((best, r) => {
          const bf = best.fte ?? 0, rf = r.fte ?? 0;
          return rf > bf || (rf === bf && (r.pay ?? 0) > (best.pay ?? 0)) ? r : best;
        }, g.rows[0]);
        return { id: g.id, label: g.label, full: g.full, date: g.date, salary, title: primary.title, job_code: primary.job_code, appts, basis: primary.comp_basis, grade: primary.grade_number, gradeBasis: primary.grade_basis };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || ttcRank(a.id) - ttcRank(b.id));
  }, [rows]);

  const { data: titleMedRows } = useSql<{ snapshot_id: string; med: number | null }>(
    ['dash-title-med', personKey, metric],
    `WITH me AS (SELECT snapshot_id, arg_max(job_code, salary) job FROM salaries
        WHERE person_key = ${sqlStr(personKey)} AND job_code IS NOT NULL GROUP BY snapshot_id),
      pp AS (SELECT s.snapshot_id, s.person_key, ${personPay(metric)} pay
        FROM salaries s JOIN me ON s.snapshot_id = me.snapshot_id AND s.job_code = me.job
        GROUP BY s.snapshot_id, s.person_key)
     SELECT snapshot_id, median(pay) med FROM pp WHERE pay > 0 GROUP BY snapshot_id`,
    !!personKey
  );
  const trendData = useMemo(() => {
    const med = new Map((titleMedRows ?? []).map((r) => [r.snapshot_id, r.med]));
    return trend.map((t) => ({ ...t, med: med.get(t.id) ?? null }));
  }, [trend, titleMedRows]);
  // The same date axis and the same reporting breaks as /person: a gap row where the pay basis
  // changes footing, so the Sep 2025 9-month change is not drawn as a rise.
  // The same raise context as /person (lib/raiseContext), on the report's metric: how each raise
  // compares, the "if raises had been typical" line, and where the difference came from.
  const raiseCtx = useRaiseContext(personKey, trend, metric);
  const trendPlot = useMemo(() => {
    const breaks = new Set(reportingBreaks(trendData));
    return trendData.flatMap((t, i) => {
      const row = { ...t, x: snapX(t.date, t.id), salary: t.salary as number | null, med: t.med, typical: raiseCtx.typical.get(t.id) ?? null, gap: false };
      if (!breaks.has(i)) return [row];
      const prev = trendData[i - 1];
      return [{ ...prev, x: (snapX(prev.date, prev.id) + row.x) / 2, salary: null, med: null, typical: null, gap: true }, row];
    });
  }, [trendData, raiseCtx.typical]);
  const trendAxis = useMemo(() => snapAxisProps(trendData), [trendData]);
  // Title changes as /person draws them (lib/payHistory `titleEras`), and the reporting break's marker.
  const trendEras = useMemo(() => titleEras(trendData), [trendData]);
  const breakMarks = useMemo(() => trendPlot.flatMap((r, i) => {
    if (!r.gap) return [];
    const next = trendPlot[i + 1];
    const kb = KNOWN_BREAKS.find((k) => k.kind === 'reporting' && k.snapshotId === next?.id);
    return [{ key: next?.id ?? String(i), x: r.x, texts: kb ? [kb.label, kb.short] : ['pay reported differently'] }];
  }), [trendPlot]);
  const reporting = useMemo(() => reportingAcross(trend.map((t) => t.basis)), [trend]);

  // The history table's rows: the rate is the source's `salary`, whatever measure the report's figures use.
  const historyRows = useMemo(() => rows.map((r) => ({ ...r, salary: r.rate_raw })), [rows]);

  // As-of the record's own latest snapshot date (not the viewer's "now") — matches the comparison
  // report's tenure calc (Reports.tsx), so the two report types never disagree on the same person's tenure.
  const tenureYears = useMemo(() => {
    const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
    if (!hire || !latest?.snapshot_date) return null;
    return Math.max(0, (new Date(latest.snapshot_date).getTime() - new Date(hire).getTime()) / (365.25 * 864e5));
  }, [rows, latest]);

  const firstSalary = trend[0]?.salary ?? null;
  const lastSalary = trend[trend.length - 1]?.salary ?? null;
  const totalChange = firstSalary && lastSalary ? (lastSalary - firstSalary) / firstSalary : null;
  const oldestLabel = trend[0]?.label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? null;

  const hire = rows.find((r) => r.date_of_hire)?.date_of_hire;
  const hireYear = hire ? String(hire).slice(0, 4) : null;
  // The title before TTC, when the earliest record is the pre-TTC snapshot and it differs from now; the hire-era
  // title otherwise cannot be assumed. The line used to repeat the title above it, the hire year and the growth
  // figure the tiles below give.
  const careerLine = useMemo(() => {
    const firstTitle = trend[0]?.title;
    const lastTitle = trend[trend.length - 1]?.title;
    const hasPreTTC = !!trend[0]?.id?.endsWith('-pre') && !!firstTitle && firstTitle !== lastTitle;
    return hasPreTTC ? `Title before TTC: ${firstTitle}; now ${lastTitle}.` : null;
  }, [trend]);

  // As on /person: the band is read against the appointment that carries the grade, at its full-time rate.
  const graded = useMemo(
    () => gradedAppt(rows.filter((r) => r.snapshot_id === latest?.snapshot_id).map((r) => ({ ...r, salary: r.rate_raw }))),
    [rows, latest]
  );
  const band = useMemo(() => (graded ? bandFor(grades, graded.grade, graded.basis, graded.comp) : null), [graded, grades]);

  const lastSnap = latest?.snapshot_id ?? '';
  // standingSql: the query /person uses, so the printed report cannot rank this person differently.
  // It used to count people paid the same or less against the whole pool, where the page counts the
  // others paid strictly less — so a tie read "more than 50%" here and the 33rd percentile there.
  const { data: standingRows } = useSql<{ n_all: number; b_all: number; n_div: number; b_div: number }>(
    ['dash-standing', personKey, lastSnap, lastSalary ?? 0, metric],
    standingSql({
      snapshotId: lastSnap, pay: lastSalary ?? 0, metric, school: latest?.school, department: latest?.department,
      grade: latest?.grade_number, gradeBasis: latest?.grade_basis, jobCode: latest?.job_code,
    }),
    !!latest && lastSalary != null && lastSalary > 0
  );
  const standing = useMemo(() => {
    const r = standingRows?.[0];
    return r ? { uw: poolPercentile(r.b_all, r.n_all), sch: latest?.school ? poolPercentile(r.b_div, r.n_div) : null } : null;
  }, [standingRows, latest]);

  const jobCode = latest?.job_code ?? null;
  const { data: peerStatsRows } = useSql<PeerStats>(
    ['dash-peer-stats', jobCode ?? '', lastSnap, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
            quantile_cont(pay, 0.75) p75, max(pay) hi FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peer = peerStatsRows?.[0];

  const { data: peerPayRows } = useSql<{ pay: number }>(
    ['dash-peer-pays', jobCode ?? '', lastSnap, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(lastSnap)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    !!lastSnap && !!jobCode
  );
  const peerPays = useMemo(() => (peerPayRows ?? []).map((r) => r.pay), [peerPayRows]);
  // `percentile()` (lib/stats.ts), not a local formula: this page and /person show the same person
  // against the same pool, so they must not disagree about where they sit.
  const peerPct = useMemo(
    () => (peerPays.length > 1 && lastSalary != null && lastSalary > 0 ? percentile(lastSalary, peerPays) : null),
    [peerPays, lastSalary]
  );
  const peerRank = useMemo(() => {
    if (!peerPays.length || lastSalary == null) return null;
    return peerPays.filter((p) => p > lastSalary).length + 1;
  }, [peerPays, lastSalary]);

  if (isLoading) return <LoadingState label="Loading report…" />;
  if (error) return <Alert color="red">Failed to load person: {(error as Error).message}</Alert>;
  if (!rows.length) return <Alert color="gray">No records found for this person.</Alert>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Employee Report — {name}</Title>
        <Text c="dimmed">
          {[
            latest?.title,
            latest?.grade_number != null ? `grade ${fmtGrade(latest.grade_number, latest.grade_basis)}` : null,
            latest?.school,
            latest?.department,
          ].filter(Boolean).join(' · ')}
          {latest?.title ? ' · ' : ''}as of {latest?.snapshot_label} · {METRIC_LABEL[metric]} · generated {generated}
        </Text>
        {careerLine && <Text size="sm" c="dimmed" mt={4}>{careerLine}</Text>}
      </div>

      {departed && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={ICON.control} />}>
          Not in the latest snapshot ({campusLatest?.label}) — may no longer be employed. Last seen {latest?.snapshot_label}.
        </Alert>
      )}

      {/* Headline figures. Where this person stands is the comparison card's, once: three tiles here said it again. */}
      <StatRow cols={{ base: 1, sm: 3 }}>
        <Stat label="Current salary" value={usd(lastSalary)} />
        <Stat label="Tenure" value={fmtYears(tenureYears)} sub={hireYear ? `at UW since ${hireYear}` : undefined} />
        <Stat
          label={oldestLabel ? `Growth since ${oldestLabel}` : 'Growth'}
          value={totalChange == null ? '—' : `${(totalChange * 100).toFixed(1)}%`}
          sub={totalChange != null && reporting.changes.length
            ? `${fmtChange((1 + totalChange) / reporting.factor - 1)} without the ${reporting.changes[0].sinceLabel} change in ${reporting.changes[0].what}`
            : `across ${plural(trend.length, 'snapshot')}`}
        />
      </StatRow>

      {/* Salary over time */}
      <Card withBorder padding="lg">
        <CardTitle>Salary over time</CardTitle>
        <ResponsiveContainer width="100%" height={280}>
          {/* Top margin: room above a line that ends at the top of the plot for its name (EndLabels). */}
          <LineChart {...chartKeys('Salary over time')} data={trendPlot} margin={{ left: 12, right: 12, top: 18 }}>
            <CartesianGrid {...GRID} />
            <XAxis {...trendAxis} tick={AXIS_TICK} />
            <YAxis tickFormatter={fmtUsd} width={80} tick={AXIS_TICK} padding={Y_PAD} />
            <Tooltip content={<TrendTooltip />} />
            <Line type="monotone" dataKey="med" name="Title median" stroke="var(--mantine-color-dimmed)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} {...chartAnim(reduceMotion, MOTION.slow)} />
            {raiseCtx.typical.size > 1 && (
              <Line type="monotone" className="typical-line" dataKey="typical" name="If raises had been typical" stroke="var(--guide-strong)" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls={false} isAnimationActive={false} />
            )}
            <Line type="monotone" dataKey="salary" name="Salary" stroke="var(--mantine-color-accent-6)" strokeWidth={2} dot {...chartAnim(reduceMotion, MOTION.slow)} />
            {breakMarks.map((b) => (
              <ReferenceLine key={`brk-${b.key}`} x={b.x} stroke="var(--mantine-color-gray-5)" strokeDasharray="2 4" className="reporting-marker" />
            ))}
            {breakMarks.length > 0 && <Customized component={<BreakLabels edge="bottom" marks={breakMarks.map((b) => ({ at: b.x, texts: b.texts }))} />} />}
            {trendData.map((t, i) =>
              i > 0 && trendEras[i] !== trendEras[i - 1] && t.salary != null ? (
                <ReferenceDot key={`tc-${t.id}`} x={snapX(t.date, t.id)} y={t.salary} r={6} fill="var(--mantine-color-accent-7)" stroke="var(--mantine-color-body)" strokeWidth={2} />
              ) : null
            )}
            <Customized
              component={
                <EndLabels
                  endSeries={[
                    { key: 'salary', text: 'Salary', color: 'var(--text-accent)' },
                    { key: 'med', text: 'Title median', color: 'var(--mantine-color-dimmed)' },
                    ...(raiseCtx.typical.size > 1 ? [{ key: 'typical', text: 'If raises had been typical', color: 'var(--mantine-color-dimmed)' }] : []),
                  ]}
                  endBreaks={breakMarks.map((b) => ({ at: b.x, texts: b.texts }))}
                  endBreakEdge="bottom"
                />
              }
            />
          </LineChart>
        </ResponsiveContainer>
        {reporting.changes[0] && (
          <Text size="xs" c="dimmed" mt={4}>
            The line breaks at {reporting.changes[0].sinceLabel}, the change in {reporting.changes[0].what} (×{reporting.changes[0].ratio}).
          </Text>
        )}
        <ChartData caption="Salary over time" columns={['Snapshot', 'Salary', 'Title median', 'If raises had been typical']} rows={trendData.map((t) => [t.label, t.salary, t.med, raiseCtx.typical.get(t.id) ?? null])} unit="snapshots" period={spanLabel(trendData.map((t) => t.label))}
          about="Ringed dots mark a title or role change. The title median is the median for the title held at the time." />
      </Card>

      {raiseCtx.breakdown && raiseCtx.breakdown.shares.length > 0 && (
        <Card withBorder padding="lg">
          <CardTitle>Where the difference from typical raises came from</CardTitle>
          <Text size="xs" c="dimmed" mb="sm">
            Each step's share of the difference between pay and pay had every raise been the campus median; the shares add up to the whole difference.
          </Text>
          <GapBreakdown breakdown={raiseCtx.breakdown} />
        </Card>
      )}

      {/* Title & salary history: the person page's own table, so the printed report cannot disagree with it. */}
      <HistoryTable rows={historyRows} comparisons={raiseCtx.ready ? raiseCtx.comparisons : undefined} csvName={name} />

      {/* Same-title comparison (compact) */}
      {peer && peer.n === 1 && jobCode && (
        <Card withBorder padding="lg">
          <Text size="sm">
            {name} is the only employee at UW with the title {latest?.title} (job code {jobCode}) in the latest snapshot — no one else to compare against.
          </Text>
        </Card>
      )}

      {peer && peer.n > 1 && lastSalary != null && jobCode &&
        peer.lo != null && peer.p25 != null && peer.med != null && peer.p75 != null && peer.hi != null && (
        <Card withBorder padding="lg">
          <CardTitle
            right={peerRank != null && <Text size="sm" c="dimmed">ranks <b>#{peerRank}</b> of {num(peer.n)} by salary</Text>}
          >
            How {name} compares to others with the title {latest?.title}
          </CardTitle>
          <PeerRangeBar min={peer.lo} p25={peer.p25} median={peer.med} p75={peer.p75} max={peer.hi} value={lastSalary} values={peerPays} />
          <PercentileNote pct={peerPct} pool="people with this title" mt="sm" />
          {standing?.uw != null && (
            <Text size="sm" data-standing="campus">
              Across all of UW–Madison, more than <b>{standing.uw}%</b>
              {standing.sch != null && <>; within {latest?.school}, more than <b>{standing.sch}%</b></>}.
            </Text>
          )}
          <Text size="xs" c="dimmed" mt={4} mb="md">
            Among {num(peer.n)} people with job code {jobCode} in the latest snapshot.
          </Text>
          <SalaryHistogram
            values={peerPays}
            markerValue={lastSalary}
            markerLabel="this person"
            tooFewText={`Only ${num(peer.n)} ${peer.n === 1 ? 'person has' : 'people have'} this title — too few to chart a distribution.`}
          />
        </Card>
      )}

      {/* Pay band */}
      {isRange(band) && graded && (
        <Card withBorder padding="lg">
          <CardTitle sub="The full-time rate against the official range.">Grade {graded.grade} pay band</CardTitle>
          <PayBandBar min={band.min} max={band.max} value={graded.rate} />
          <PayBandNote snapshotId={latest?.snapshot_id} />
        </Card>
      )}
      {band && !isRange(band) && graded && (
        <Card withBorder padding="lg">
          <CardTitle sub="The full-time rate against the official minimum.">Grade {graded.grade} minimum</CardTitle>
          <Text size="sm">
            {belowMinimum(graded.rate, band, graded.basis)
              ? `The full-time rate, ${usd(graded.rate)}, is ${usd(band.min - graded.rate)} below grade ${graded.grade}'s minimum of ${usd(band.min)}.`
              : `The full-time rate, ${usd(graded.rate)}, is at or above grade ${graded.grade}'s minimum of ${usd(band.min)}. HR publishes no maximum for this grade.`}
          </Text>
          <PayBandNote snapshotId={latest?.snapshot_id} />
        </Card>
      )}

      <Text size="xs" c="dimmed" mt="md">
        Figures shown are {METRIC_LABEL[metric]}. Title comparison uses everyone sharing this person's job code in their
        latest snapshot. Person identity is matched on
        name + date of hire and is best-effort.
      </Text>
    </Stack>
  );
}
