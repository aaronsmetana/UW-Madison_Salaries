import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, SimpleGrid, Divider, Tooltip, Paper, ThemeIcon, Anchor, Badge } from '@mantine/core';
import { IconCoin, IconReportMoney, IconUsers, IconBuildingBank, IconBriefcase } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { usd, usdCompact, num } from '../lib/format';
import { SearchBox } from '../components/SearchBox';

interface KpiData { icon: ReactNode; label: string; value: string; color: string; hint?: string }

/** One system-wide stat: centered icon+label over its value — a tight, symmetrical column. */
function Kpi({ icon, label, value, color, hint }: KpiData) {
  const valueNode = (
    <Text fw={700} fz={22} ta="center" style={{ letterSpacing: '-0.01em' }}>
      {value}
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

export default function Home() {
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    `SELECT sum(salary * COALESCE(fte, 1)) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    !!snap
  );
  const payroll = payrollRows?.[0]?.total ?? null;

  const { data: dimRows } = useSql<{ schools: number; titles: number }>(
    ['home-dims', snap ?? ''],
    `SELECT count(DISTINCT school) schools, count(DISTINCT job_code) titles
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')}`,
    !!snap
  );
  const dims = dimRows?.[0];

  const cleanLabel = (s?: string) => s?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? undefined;
  const firstSnap = cleanLabel(summary?.snapshots?.[0]?.label);
  const latestLabel = summary?.latest?.label;

  const kpis: KpiData[] = [
    { label: 'Median salary', value: usd(summary?.latest?.median), icon: <IconCoin size={16} />, color: 'pos' },
    { label: 'Employees', value: num(summary?.latest?.headcount), icon: <IconUsers size={16} />, color: 'accent' },
    { label: 'Total Payroll', value: usdCompact(payroll), hint: payroll != null ? usd(payroll) : undefined, icon: <IconReportMoney size={16} />, color: 'accent' },
    { label: 'Schools/Divisions', value: num(dims?.schools), icon: <IconBuildingBank size={16} />, color: 'accent' },
    { label: 'Unique Titles', value: num(dims?.titles), icon: <IconBriefcase size={16} />, color: 'accent' },
  ];

  return (
    <Box style={{ minHeight: 'calc(100dvh - 200px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Stack gap="xl" w="100%">
        {/* Hero title with a soft, theme-aware glow behind it. */}
        <Box style={{ position: 'relative' }}>
          <Box
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(680px, 90%)',
              height: 220,
              background: 'radial-gradient(60% 60% at 50% 50%, var(--mantine-color-accent-light) 0%, transparent 70%)',
              opacity: 0.6,
              pointerEvents: 'none',
              filter: 'blur(8px)',
            }}
          />
          <Stack gap={6} align="center" style={{ position: 'relative' }}>
            <Title order={1} ta="center" style={{ letterSpacing: '-0.02em', fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
              UW–Madison Salaries
            </Title>
            <Text c="dimmed" ta="center" maw={580} size="lg">
              Search anyone by name to see their salary, how it changed over the years, and how they stack up against everyone with the same title.
            </Text>
          </Stack>
        </Box>

        {/* Hero search + empty-state content share one centered width. */}
        <Stack gap="lg" maw={760} mx="auto" w="100%">
          <SearchBox size="lg" autoFocus placeholder="Search for an employee by name…" />

          {/* System-wide stats (as of the latest snapshot) — the whole card links to General Comparisons. */}
          <Anchor component={Link} to="/explore" underline="never" c="inherit" style={{ display: 'block' }}>
            <Paper withBorder radius="lg" px="lg" pt="xl" pb="lg" w="100%" style={{ position: 'relative', overflow: 'visible' }}>
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
              <Text size="xs" c="accent.7" fw={600} ta="center" mt="md">Browse schools &amp; titles in General Comparisons →</Text>
            </Paper>
          </Anchor>

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
