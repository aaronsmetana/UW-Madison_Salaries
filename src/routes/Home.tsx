import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Divider, Tooltip, Paper, ThemeIcon, Anchor, Badge, Card } from '@mantine/core';
import {
  IconCoin, IconReportMoney, IconUsers, IconBuildingBank, IconBriefcase, IconReportAnalytics, IconListSearch,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId, useHomeStats } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { FTE_MULT } from '../lib/queries';
import { usd, usdCompact, num } from '../lib/format';
// Same compact currency the peer-range quartile labels use, so the two charts read alike.
import { fmtK, assignLabelRows } from '../lib/chartStyle';
import { useCountUp, useReveal, prefersReducedMotion } from '../lib/motion';
import { SearchBox } from '../components/SearchBox';
import { Eyebrow } from '../components/Eyebrow';
import { useDocTitle } from '../lib/useDocTitle';
import { ICON } from '../lib/ui';

interface KpiData { icon: ReactNode; label: string; value: number | null; format: (n: number) => string; color: string; hint?: string }

/** One system-wide stat: centered icon+label over its value, which counts up from 0 as the data loads. */
function Kpi({ icon, label, value, format, color, hint }: KpiData) {
  const animated = useCountUp(value, 1000);
  const valueNode = (
    <Text fw={700} fz={22} ta="center" style={{ letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
      {animated == null ? '—' : format(Math.round(animated))}
    </Text>
  );
  return (
    <Stack gap={2} align="center" style={{ flex: 1, minWidth: 0, paddingInline: 8 }}>
      {/* Five tiles share a 760px row, so the icon leaves ~110px for the label — enough for "DIVISIONS"
          but not "MEDIAN SALARY". Allow a second line and reserve its height on every tile, so the longer
          labels stay readable and all five values still sit on one baseline. */}
      <Group gap={6} justify="center" align="center" wrap="nowrap" mih={30}>
        <ThemeIcon size={22} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Eyebrow ta="center" lineClamp={2} style={{ lineHeight: 1.2 }}>{label}</Eyebrow>
      </Group>
      {hint ? <Tooltip label={hint} withArrow>{valueNode}</Tooltip> : valueNode}
    </Stack>
  );
}

/**
 * The system-wide pay distribution, drawn by hand off `home-stats.json` — deliberately not Recharts,
 * which is a 376KB chunk the landing page otherwise never loads.
 *
 * Replaces a 120x38 sparkline that was stretched to ~740px: at a 19:1 aspect the curve flattened into
 * a near-straight line, so the one chart on the landing page showed no shape at all. A taller box plus
 * quartile markers makes it read as a distribution rather than decoration. `preserveAspectRatio="none"`
 * with `vector-effect="non-scaling-stroke"` lets the geometry span any width while strokes stay 1px.
 */
/** Height of one marker-label row, in px — the stagger step when labels collide. Must exceed the
 *  label's own rendered line box (xxs at lh 1.2 ≈ 13px) or two "different" rows still touch, which
 *  looks like the collision the stagger exists to prevent. */
const LABEL_ROW_H = 16;

function Distribution({
  bins, p25, median, p75, cap, overflow, headcount,
}: {
  bins: { bucket: number; n: number }[];
  p25: number | null;
  median: number | null;
  p75: number | null;
  cap: number | null;
  overflow: number | null;
  headcount: number | null;
}) {
  const revealed = useReveal(bins.length >= 3);
  const labelRowRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [labelRows, setLabelRows] = useState<number[]>([0, 0, 0]);

  // p25 and median sit close together on a right-skewed curve, so their labels overlap and render as
  // one unreadable run — the same failure PeerRangeBar hit. Reuse its pure row-assignment helper
  // against measured DOM geometry rather than guessing from percentages, and re-measure once the
  // webfont lands (a swap changes label widths after the first pass).
  useLayoutEffect(() => {
    const row = labelRowRef.current;
    if (!row) return;
    const measure = () => {
      const els = labelRefs.current.filter((el): el is HTMLDivElement => !!el);
      if (!els.length) return;
      // `offsetLeft` IS the centre here: the label is positioned by `left: X%` and then visually
      // recentred with translateX(-50%), which does not move offsetLeft. Adding half the width would
      // shift every centre right by that much and quietly corrupt the collision math.
      const next = assignLabelRows(
        els.map((el) => el.offsetLeft),
        els.map((el) => el.offsetWidth),
      );
      setLabelRows((prev) => (prev.length === next.length && prev.every((r, i) => r === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    labelRefs.current.forEach((el) => el && ro.observe(el));
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [bins, p25, median, p75]);

  if (bins.length < 3) return null;

  const W = 1000, H = 120;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const lo = bins[0].bucket;
  const hi = bins[bins.length - 1].bucket;
  const span = hi - lo || 1;
  const X = (v: number) => ((v - lo) / span) * W;
  const Y = (n: number) => H - (n / maxN) * (H - 4) - 2;
  const pts = bins.map((b) => `${X(b.bucket).toFixed(1)},${Y(b.n).toFixed(1)}`);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ');
  const area = `M0,${H} ${pts.map((p) => `L${p}`).join(' ')} L${W},${H} Z`;

  // Only draw a marker that actually falls inside the plotted range.
  const inRange = (v: number | null): v is number => v != null && v >= lo && v <= hi;
  const marks: { v: number; label: string; strong: boolean }[] = [
    ...(inRange(p25) ? [{ v: p25, label: 'p25', strong: false }] : []),
    ...(inRange(median) ? [{ v: median, label: 'median', strong: true }] : []),
    ...(inRange(p75) ? [{ v: p75, label: 'p75', strong: false }] : []),
  ];

  return (
    <div style={{ marginTop: 'var(--mantine-spacing-lg)' }}>
      <div
        style={{
          transform: revealed ? 'scaleY(1)' : 'scaleY(0.04)',
          transformOrigin: 'bottom',
          opacity: revealed ? 1 : 0,
          transition: 'transform 700ms ease-out, opacity 500ms ease-out',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={120} aria-hidden style={{ display: 'block' }}>
          <defs>
            <linearGradient id="home-dist" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#home-dist)" />
          <path d={line} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {marks.map((m) => (
            <line
              key={m.label}
              x1={X(m.v)} x2={X(m.v)} y1={m.strong ? 4 : 26} y2={H}
              stroke={m.strong ? 'var(--mantine-color-accent-7)' : 'var(--mantine-color-gray-5)'}
              strokeWidth={m.strong ? 1.5 : 1}
              strokeDasharray={m.strong ? undefined : '2 3'}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* Marker labels live in HTML, not SVG: `preserveAspectRatio="none"` would stretch SVG text
          horizontally by whatever factor the box is scaled by. */}
      <div
        ref={labelRowRef}
        style={{ position: 'relative', height: Math.max(1, ...labelRows.map((r) => r + 1)) * LABEL_ROW_H, marginTop: 2 }}
      >
        {marks.map((m, i) => (
          <Text
            key={m.label}
            ref={(el: HTMLDivElement | null) => { labelRefs.current[i] = el; }}
            size="xxs"
            lh={1.2}
            c={m.strong ? 'accent.7' : 'dimmed'}
            fw={m.strong ? 700 : 500}
            className={m.strong ? 'accent7-text' : undefined}
            style={{
              position: 'absolute',
              left: `${(X(m.v) / W) * 100}%`,
              top: (labelRows[i] ?? 0) * LABEL_ROW_H,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
            }}
          >
            {m.label} {fmtK(m.v)}
          </Text>
        ))}
      </div>

      <Group justify="space-between" gap={0} mt={2}>
        <Text size="xs" c="dimmed">{fmtK(lo)}</Text>
        <Text size="xs" c="dimmed">{cap != null ? `${fmtK(cap)}+` : `${fmtK(hi)}+`}</Text>
      </Group>
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        Actual pay{headcount != null ? ` across ${num(headcount)} employees` : ''}
        {/* Say what the cap hides rather than truncating the tail silently. */}
        {overflow ? ` · ${num(overflow)} above ${fmtK(cap ?? 0)} not shown` : ''}
      </Text>
    </div>
  );
}

/**
 * One "here is what this thing does" tile in the band below the fold. Each carries a live figure from
 * summary.json / home-stats.json rather than a static blurb, so the band can never drift out of date
 * with the data — and so the landing page still renders without booting DuckDB.
 */
function ShowcaseCard({ icon, title, blurb, stat, to }: {
  icon: ReactNode;
  title: string;
  blurb: string;
  stat: ReactNode;
  to: string;
}) {
  return (
    <Anchor component={Link} to={to} underline="never" c="inherit" style={{ display: 'block', height: '100%' }}>
      <Card className="card-hover showcase-card" padding="lg" style={{ height: '100%' }}>
        <ThemeIcon size={34} radius="md" variant="light" color="accent" mb="sm">
          {icon}
        </ThemeIcon>
        <Text fw={700} fz="md" style={{ letterSpacing: '-0.01em' }}>
          {title} <span className="showcase-arrow">→</span>
        </Text>
        <Text size="sm" c="dimmed" mt={4} style={{ lineHeight: 1.5 }}>{blurb}</Text>
        <Text size="xs" c="dimmed" mt="sm" fw={600}>{stat}</Text>
      </Card>
    </Anchor>
  );
}

/** A quiet line that gently cross-fades through a few computed facts (static under reduced motion). */
function RotatingFact({ facts }: { facts: string[] }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (facts.length < 2 || prefersReducedMotion()) return;
    const id = setInterval(() => {
      setShow(false);
      // Held in a ref so unmounting mid-fade cancels the swap too — clearing only the interval
      // leaves this one pending and it sets state on a gone component.
      swapTimer.current = setTimeout(() => { setI((p) => (p + 1) % facts.length); setShow(true); }, 350);
    }, 6000);
    return () => {
      clearInterval(id);
      if (swapTimer.current) clearTimeout(swapTimer.current);
    };
  }, [facts.length]);
  if (!facts.length) return null;
  return (
    <Text size="xs" c="dimmed" ta="center" style={{ opacity: show ? 1 : 0, transition: 'opacity 350ms ease' }}>
      {facts[i % facts.length]}
    </Text>
  );
}

export default function Home() {
  useDocTitle(null);
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  // The precomputed artifact only covers the latest snapshot. It's usable once loaded, as long as
  // the page isn't pinned to some other (older) snapshot — in which case we fall back to live SQL.
  const { data: homeStats, isError: homeStatsFailed } = useHomeStats();
  const artifactUsable = !!homeStats && (snap == null || snap === homeStats.snapshot_id);
  const needsSql = !!snap && (homeStatsFailed || (!!homeStats && !artifactUsable));

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    `SELECT sum(salary * ${FTE_MULT}) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    needsSql
  );
  const payroll = artifactUsable ? homeStats.payroll_total : (payrollRows?.[0]?.total ?? null);

  const { data: dimRows } = useSql<{ schools: number; titles: number; lo: number | null; hi: number | null }>(
    ['home-dims', snap ?? ''],
    `SELECT count(DISTINCT school) schools, count(DISTINCT job_code) titles,
            min(salary) FILTER (WHERE salary > 0) lo, max(salary) FILTER (WHERE salary > 0) hi
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')}`,
    needsSql
  );
  const dims = useMemo(
    () =>
      artifactUsable
        ? { schools: homeStats.schools, titles: homeStats.titles, lo: homeStats.salary_lo, hi: homeStats.salary_hi }
        : dimRows?.[0],
    [artifactUsable, homeStats, dimRows]
  );

  // Distribution sparkline + rotating facts (lightweight aggregates over the latest snapshot).
  const { data: binRows } = useSql<{ bucket: number; n: number }>(
    ['home-bins', snap ?? ''],
    `SELECT floor(salary / 10000) * 10000 AS bucket, count(*) AS n FROM salaries
     WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0 AND salary < 250000
     GROUP BY bucket ORDER BY bucket`,
    needsSql
  );
  const bins = artifactUsable ? homeStats.bins : (binRows ?? []);

  const { data: titleTopRows } = useSql<{ title: string; n: number }>(
    ['home-toptitle', snap ?? ''],
    `SELECT title, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND title IS NOT NULL GROUP BY title ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topTitle = artifactUsable ? homeStats.top_title : (titleTopRows?.[0] ?? null);
  const { data: divTopRows } = useSql<{ school: string; n: number }>(
    ['home-topdiv', snap ?? ''],
    `SELECT school, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL GROUP BY school ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topDivision = artifactUsable ? homeStats.top_division : (divTopRows?.[0] ?? null);
  // p90 (top-10% line) + median tenure, deduped per person.
  const { data: factStats } = useSql<{ p90: number | null; tenure: number | null }>(
    ['home-facts', snap ?? ''],
    `WITH p AS (
        SELECT person_key, sum(salary) FILTER (WHERE salary > 0) AS pay,
               any_value(date_of_hire) AS doh, any_value(snapshot_date) AS sd
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)
     SELECT quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90,
            median(date_diff('day', CAST(doh AS DATE), CAST(sd AS DATE)) / 365.25) FILTER (WHERE doh IS NOT NULL) tenure
     FROM p`,
    needsSql
  );
  const p90 = artifactUsable ? homeStats.p90 : (factStats?.[0]?.p90 ?? null);
  const tenure = artifactUsable ? homeStats.median_tenure_years : (factStats?.[0]?.tenure ?? null);
  const { data: byCat } = useSql<{ cat: string; med: number }>(
    ['home-bycat', snap ?? ''],
    `SELECT employee_category cat, median(salary) FILTER (WHERE salary > 0) med, count(*) n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND employee_category IS NOT NULL
     GROUP BY employee_category ORDER BY n DESC LIMIT 3`,
    needsSql
  );
  const categoryMedians = artifactUsable
    ? homeStats.category_medians
    : (byCat ?? []).map((c) => ({ category: c.cat, median: c.med }));

  // All facts are computed at runtime from summary.json + home-stats.json (or live SQL), so they
  // auto-update on data import — no hardcoded values to maintain when the salary data refreshes.
  const facts = useMemo(() => {
    const f: string[] = [];
    const first = summary?.snapshots?.[0];
    const med0 = first?.median ?? null;
    const medNow = summary?.latest?.median ?? null;
    if (med0 != null && medNow != null && med0 > 0) {
      const up = Math.round(((medNow - med0) / med0) * 100);
      const yr = first?.date?.slice(0, 4);
      f.push(`Median pay rose from ${usd(med0)}${yr ? ` (${yr})` : ''} to ${usd(medNow)} — up ~${up}%`);
    }
    if (topTitle?.title) f.push(`Most common title: ${topTitle.title} (${num(topTitle.n)} people)`);
    if (topDivision?.school) f.push(`Largest division: ${topDivision.school} (${num(topDivision.n)} people)`);
    if (p90 != null) f.push(`The top 10% earn more than ${usd(p90)}`);
    if (dims?.lo != null && dims?.hi != null) f.push(`Pay ranges from ${usd(dims.lo)} to ${usd(dims.hi)}`);
    if (tenure != null) f.push(`Median tenure is ${tenure.toFixed(1)} years`);
    if (categoryMedians.length) f.push(`Median pay by group — ${categoryMedians.map((c) => `${c.category} ${usd(c.median)}`).join(' · ')}`);
    return f;
  }, [summary, topTitle, topDivision, p90, dims, tenure, categoryMedians]);

  const cleanLabel = (s?: string) => s?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? undefined;
  const firstSnap = cleanLabel(summary?.snapshots?.[0]?.label);
  const latestLabel = summary?.latest?.label;

  // Labels are kept to one word each so all five wrap identically (i.e. not at all): "MEDIAN SALARY"
  // and "UNIQUE TITLES" were the only two that broke to a second line, which left the row visibly
  // ragged even with the reserved label height. The precise figure stays in the hover for Payroll.
  const kpis: KpiData[] = [
    { label: 'Median', value: summary?.latest?.median ?? null, format: usd, hint: 'Median actual pay across all employees', icon: <IconCoin size={ICON.control} />, color: 'pos' },
    { label: 'Employees', value: summary?.latest?.headcount ?? null, format: num, icon: <IconUsers size={ICON.control} />, color: 'accent' },
    { label: 'Payroll', value: payroll, format: usdCompact, hint: payroll != null ? usd(payroll) : undefined, icon: <IconReportMoney size={ICON.control} />, color: 'accent' },
    { label: 'Divisions', value: dims?.schools ?? null, format: num, icon: <IconBuildingBank size={ICON.control} />, color: 'accent' },
    { label: 'Titles', value: dims?.titles ?? null, format: num, icon: <IconBriefcase size={ICON.control} />, color: 'accent' },
  ];

  return (
    <Box style={{ paddingBlock: 'clamp(24px, 6vh, 64px)', position: 'relative' }}>
      <div className="hero-dotgrid" aria-hidden />
      <Stack gap="xl" w="100%" style={{ position: 'relative', zIndex: 1 }}>
        {/* Hero title with a soft, theme-aware glow that breathes behind it. */}
        <Box style={{ position: 'relative' }}>
          <Box
            aria-hidden
            className="hero-aurora"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 'min(680px, 90%)',
              height: 220,
              background: 'radial-gradient(60% 60% at 50% 50%, var(--mantine-color-accent-light) 0%, transparent 70%)',
              opacity: 0.6,
              pointerEvents: 'none',
              filter: 'blur(8px)',
              transform: 'translate(-50%, -50%)',
            }}
          />
          <Stack gap={6} align="center" className="hero-rise" style={{ position: 'relative' }}>
            <Title order={1} ta="center" style={{ letterSpacing: '-0.02em', fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
              <Text span inherit c="bright">UW–Madison </Text>
              <Text span inherit c="accent.7" className="accent7-text">Salaries</Text>
            </Title>
            <Text c="dimmed" ta="center" maw={580} size="lg">
              Search anyone by name to see their salary, how it changed over the years, and how they stack up against everyone with the same title.
            </Text>
          </Stack>
        </Box>

        {/* Hero search + empty-state content share one centered width and reveal in a gentle cascade. */}
        <Stack gap="lg" maw={760} mx="auto" w="100%" className="hero-rise">
          <SearchBox size="lg" autoFocus placeholder="Search for an employee by name…" />

          {/* System-wide stats (as of the latest snapshot) — the whole card links to General Comparisons. */}
          <Anchor component={Link} to="/explore" underline="never" c="inherit" style={{ display: 'block' }}>
            <Paper className="home-stats" withBorder radius="lg" px="lg" pt="xl" pb="lg" w="100%" style={{ position: 'relative', overflow: 'visible' }}>
              {/* Centered title chip straddling the top border. */}
              <Badge
                variant="default"
                radius="sm"
                size="sm"
                style={{ position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%, -50%)' }}
              >
                System-Wide
              </Badge>
              {/* Desktop: one even row of five, split by faint vertical dividers. */}
              <Group gap={0} wrap="nowrap" align="stretch" visibleFrom="sm">
                {kpis.map((k, i) => (
                  <Fragment key={k.label}>
                    {i > 0 && <Divider orientation="vertical" />}
                    <Kpi {...k} />
                  </Fragment>
                ))}
              </Group>
              {/* Narrow: wrap into a grid (no vertical dividers — spacing separates them). */}
              <SimpleGrid cols={{ base: 2, xs: 3 }} spacing="md" verticalSpacing="lg" hiddenFrom="sm">
                {kpis.map((k) => <Kpi key={k.label} {...k} />)}
              </SimpleGrid>
              <Distribution
                bins={bins}
                p25={artifactUsable ? homeStats.p25 : null}
                median={artifactUsable ? homeStats.p50 : (summary?.latest?.median ?? null)}
                p75={artifactUsable ? homeStats.p75 : null}
                cap={artifactUsable ? homeStats.bin_cap : null}
                overflow={artifactUsable ? homeStats.bins_overflow : null}
                headcount={summary?.latest?.headcount ?? null}
              />
              <Text size="xs" c="accent.7" className="accent7-text" fw={600} ta="center" mt="md">
                Browse schools &amp; titles in General Comparisons <span className="browse-arrow">→</span>
              </Text>
            </Paper>
          </Anchor>

          <RotatingFact facts={facts} />

          {summary?.snapshot_count != null && firstSnap && latestLabel && (
            <Text size="xs" c="dimmed" ta="center">
              <Anchor component={Link} to="/data" c="dimmed" underline="hover">
                Data based on {num(summary.snapshot_count)} snapshots ({firstSnap} – {latestLabel}) • Latest: {latestLabel}
              </Anchor>
            </Text>
          )}

          {/* Snapshot/FTE disclaimer — a quiet caption, not an alert. */}
          <Text size="xs" c="dimmed" ta="center" fs="italic" maw={640} mx="auto" mt={-8}>
            Figures are point-in-time snapshots; an employee's FTE (appointment %) and pay rate can change between
            snapshots, so actual pay earned may be higher or lower than the amounts shown.{' '}
            <Anchor component={Link} to="/data" c="dimmed" underline="always" fs="normal">How this data works →</Anchor>
          </Text>
        </Stack>

        {/* Below the fold. The hero column above stays narrow on purpose; this band is wider because
            its job is different — the page used to end here, ~450px above the fold on a laptop, with
            nothing indicating that Compare, Reports, Screening or the division pages existed at all.
            Everything here reads from the same two JSON artifacts the stats card uses, so the landing
            page still never touches DuckDB. */}
        <Stack gap="md" maw={1100} mx="auto" w="100%" mt="xl">
          <Group justify="center" gap={8}>
            <Eyebrow c="dimmed">Also in here</Eyebrow>
          </Group>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
            <ShowcaseCard
              to="/paycheck"
              icon={<IconBriefcase size={ICON.nav} />}
              title="Look up a title"
              blurb="See a title's full pay distribution, who holds it, and how it varies by school."
              stat={dims?.titles != null ? `${num(dims.titles)} titles` : '\u00a0'}
            />
            <ShowcaseCard
              to="/explore"
              icon={<IconBuildingBank size={ICON.nav} />}
              title="Compare divisions"
              blurb="Headcount, median pay and top earners side by side across every school."
              stat={dims?.schools != null ? `${num(dims.schools)} divisions` : '\u00a0'}
            />
            <ShowcaseCard
              to="/reports"
              icon={<IconReportAnalytics size={ICON.nav} />}
              title="Build an equity case"
              blurb="Run the UW salary guidelines for one person and print the brief for HR."
              stat="Parity · compression · market"
            />
            <ShowcaseCard
              to="/screening"
              icon={<IconListSearch size={ICON.nav} />}
              title="Screen a whole unit"
              blurb="Rank everyone in a school or department by how strong their case looks."
              stat={summary?.latest?.headcount != null ? `${num(summary.latest.headcount)} employees` : '\u00a0'}
            />
          </SimpleGrid>
        </Stack>
      </Stack>
    </Box>
  );
}
