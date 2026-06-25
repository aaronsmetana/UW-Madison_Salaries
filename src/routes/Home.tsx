import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Divider, Tooltip, Paper, ThemeIcon, Anchor, Badge } from '@mantine/core';
import { IconCoin, IconReportMoney, IconUsers, IconBuildingBank, IconBriefcase } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { usd, usdCompact, num } from '../lib/format';
import { useCountUp, prefersReducedMotion } from '../lib/motion';
import { SearchBox } from '../components/SearchBox';

interface KpiData { icon: ReactNode; label: string; value: number | null; format: (n: number) => string; color: string; hint?: string }

/** One system-wide stat: centered icon+label over its value, which counts up from 0 as the data loads. */
function Kpi({ icon, label, value, format, color, hint }: KpiData) {
  const animated = useCountUp(value, 1000);
  const valueNode = (
    <Text fw={700} fz={22} ta="center" style={{ letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
      {animated == null ? '—' : format(animated)}
    </Text>
  );
  return (
    <Stack gap={2} align="center" style={{ flex: 1, minWidth: 0, paddingInline: 8 }}>
      <Group gap={6} justify="center" wrap="nowrap">
        <ThemeIcon size={22} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text c="dimmed" lh={1.2} ta="center" lineClamp={1} tt="uppercase" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
          {label}
        </Text>
      </Group>
      {hint ? <Tooltip label={hint} withArrow>{valueNode}</Tooltip> : valueNode}
    </Stack>
  );
}

/** Hand-rolled mini area sparkline of the system-wide pay distribution (no Recharts on the landing bundle).
 *  Draws in (scales up from the baseline) once on mount. */
function Sparkline({ bins, median }: { bins: { bucket: number; n: number }[]; median: number | null }) {
  // Reveal once the bins actually arrive (mount happens before the data, so a plain mount flag wouldn't animate).
  const [revealed, setRevealed] = useState(prefersReducedMotion);
  useEffect(() => {
    if (bins.length < 3 || revealed) return;
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, [bins.length, revealed]);
  if (bins.length < 3) return null;
  const mounted = revealed;
  const W = 120, H = 38;
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const lo = bins[0].bucket;
  const hi = bins[bins.length - 1].bucket;
  const span = hi - lo || 1;
  const X = (b: number) => ((b - lo) / span) * W;
  const Y = (n: number) => H - (n / maxN) * (H - 2) - 1;
  const pts = bins.map((b) => `${X(b.bucket).toFixed(1)},${Y(b.n).toFixed(1)}`);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ');
  const area = `M0,${H} ${pts.map((p) => `L${p}`).join(' ')} L${W},${H} Z`;
  const medX = median != null && median >= lo && median <= hi ? X(median) : null;
  return (
    <div style={{ marginTop: 'var(--mantine-spacing-md)' }}>
      <div
        style={{
          transform: mounted ? 'scaleY(1)' : 'scaleY(0.04)',
          transformOrigin: 'bottom',
          opacity: mounted ? 1 : 0,
          transition: 'transform 700ms ease-out, opacity 500ms ease-out',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={38} aria-hidden style={{ display: 'block' }}>
          <defs>
            <linearGradient id="home-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#home-spark)" />
          <path d={line} fill="none" stroke="var(--mantine-color-accent-6)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {medX != null && (
            <line x1={medX} x2={medX} y1={2} y2={H} stroke="var(--mantine-color-gray-5)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        System-wide pay distribution{median != null ? ` · median ${usd(median)}` : ''}
      </Text>
    </div>
  );
}

/** A quiet line that gently cross-fades through a few computed facts (static under reduced motion). */
function RotatingFact({ facts }: { facts: string[] }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (facts.length < 2 || prefersReducedMotion()) return;
    const id = setInterval(() => {
      setShow(false);
      setTimeout(() => { setI((p) => (p + 1) % facts.length); setShow(true); }, 350);
    }, 4500);
    return () => clearInterval(id);
  }, [facts.length]);
  if (!facts.length) return null;
  return (
    <Text size="xs" c="dimmed" ta="center" style={{ opacity: show ? 1 : 0, transition: 'opacity 350ms ease' }}>
      {facts[i % facts.length]}
    </Text>
  );
}

export default function Home() {
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    `SELECT sum(salary * COALESCE(fte, 1)) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    !!snap
  );
  const payroll = payrollRows?.[0]?.total ?? null;

  const { data: dimRows } = useSql<{ schools: number; titles: number; lo: number | null; hi: number | null }>(
    ['home-dims', snap ?? ''],
    `SELECT count(DISTINCT school) schools, count(DISTINCT job_code) titles,
            min(salary) FILTER (WHERE salary > 0) lo, max(salary) FILTER (WHERE salary > 0) hi
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')}`,
    !!snap
  );
  const dims = dimRows?.[0];

  // Distribution sparkline + rotating facts (lightweight aggregates over the latest snapshot).
  const { data: binRows } = useSql<{ bucket: number; n: number }>(
    ['home-bins', snap ?? ''],
    `SELECT floor(salary / 10000) * 10000 AS bucket, count(*) AS n FROM salaries
     WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0 AND salary < 400000
     GROUP BY bucket ORDER BY bucket`,
    !!snap
  );
  const bins = binRows ?? [];

  const { data: titleTop } = useSql<{ title: string; n: number }>(
    ['home-toptitle', snap ?? ''],
    `SELECT title, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND title IS NOT NULL GROUP BY title ORDER BY n DESC LIMIT 1`,
    !!snap
  );
  const { data: divTop } = useSql<{ school: string; n: number }>(
    ['home-topdiv', snap ?? ''],
    `SELECT school, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL GROUP BY school ORDER BY n DESC LIMIT 1`,
    !!snap
  );

  const facts = useMemo(() => {
    const f: string[] = [];
    if (titleTop?.[0]?.title) f.push(`Most common title: ${titleTop[0].title} (${num(titleTop[0].n)} people)`);
    if (divTop?.[0]?.school) f.push(`Largest division: ${divTop[0].school} (${num(divTop[0].n)} people)`);
    if (dims?.lo != null && dims?.hi != null) f.push(`Pay ranges from ${usd(dims.lo)} to ${usd(dims.hi)}`);
    return f;
  }, [titleTop, divTop, dims]);

  const cleanLabel = (s?: string) => s?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? undefined;
  const firstSnap = cleanLabel(summary?.snapshots?.[0]?.label);
  const latestLabel = summary?.latest?.label;

  const kpis: KpiData[] = [
    { label: 'Median salary', value: summary?.latest?.median ?? null, format: usd, icon: <IconCoin size={16} />, color: 'pos' },
    { label: 'Employees', value: summary?.latest?.headcount ?? null, format: num, icon: <IconUsers size={16} />, color: 'accent' },
    { label: 'Total Payroll', value: payroll, format: usdCompact, hint: payroll != null ? usd(payroll) : undefined, icon: <IconReportMoney size={16} />, color: 'accent' },
    { label: 'Schools/Divisions', value: dims?.schools ?? null, format: num, icon: <IconBuildingBank size={16} />, color: 'accent' },
    { label: 'Unique Titles', value: dims?.titles ?? null, format: num, icon: <IconBriefcase size={16} />, color: 'accent' },
  ];

  return (
    <Box style={{ minHeight: 'calc(100dvh - 200px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
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
            <div className="hero-title">
              <Title order={1} ta="center" className="hero-title-text" style={{ letterSpacing: '-0.02em', fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
                UW–Madison Salaries
              </Title>
            </div>
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
              <Sparkline bins={bins} median={summary?.latest?.median ?? null} />
              <Text size="xs" c="accent.7" fw={600} ta="center" mt="md">
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
      </Stack>
    </Box>
  );
}
