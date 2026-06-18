import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, Group, Divider, Paper, ThemeIcon, Anchor } from '@mantine/core';
import { IconCoin, IconReportMoney, IconUsers } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { usd, num } from '../lib/format';
import { SearchBox } from '../components/SearchBox';

/** One system-wide stat: centered icon+label over its value — a tight, symmetrical column. */
function Kpi({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <Stack gap={2} align="center" style={{ flex: 1, minWidth: 0 }}>
      <Group gap={6} justify="center" wrap="nowrap">
        <ThemeIcon size={22} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" lh={1.2} ta="center" lineClamp={1}>
          {label}
        </Text>
      </Group>
      <Text fw={700} fz={22} ta="center" style={{ letterSpacing: '-0.01em' }}>
        {value}
      </Text>
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
  const cleanLabel = (s?: string) => s?.replace(/\s*\((?:Pre|Post)-TTC\)/, '') ?? undefined;
  const firstSnap = cleanLabel(summary?.snapshots?.[0]?.label);
  const latestLabel = summary?.latest?.label;

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
              background: 'radial-gradient(60% 60% at 50% 50%, var(--mantine-color-indigo-light) 0%, transparent 70%)',
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
          <SearchBox prominent autoFocus placeholder="Search for an employee by name…" />

          {/* System-wide stats (as of the latest snapshot) */}
          <Paper withBorder radius="lg" px="lg" py="md" w="100%">
            <Group justify="space-between" align="baseline" mb="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.06em' }}>
                System-wide
              </Text>
              {latestLabel && (
                <Text size="xs" c="dimmed">latest snapshot · {latestLabel}</Text>
              )}
            </Group>
            <Group gap="md" align="stretch" wrap="nowrap">
              <Kpi label="Median salary" value={usd(summary?.latest?.median)} icon={<IconCoin size={16} />} color="teal" />
              <Divider orientation="vertical" />
              <Kpi label="Employees" value={num(summary?.latest?.headcount)} icon={<IconUsers size={16} />} color="blue" />
              <Divider orientation="vertical" />
              <Kpi label="Total payroll" value={usd(payroll)} icon={<IconReportMoney size={16} />} color="indigo" />
            </Group>
          </Paper>

          {summary?.snapshot_count != null && firstSnap && latestLabel && (
            <Text size="xs" c="dimmed" ta="center">
              <Anchor component={Link} to="/data" c="dimmed" underline="hover">
                {num(summary.snapshot_count)} snapshots spanning {firstSnap} – {latestLabel}
              </Anchor>
            </Text>
          )}
        </Stack>

        {/* Credit + data-source attribution */}
        <Group justify="center" gap={8} mt="xs">
          <Text size="xs" c="dimmed">Built by Aaron Smetana</Text>
          <Text size="xs" c="dimmed">·</Text>
          <Text size="xs" c="dimmed">
            Salary report files sourced from the work of{' '}
            <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer">UFAS Local 223</Anchor>
          </Text>
        </Group>
      </Stack>
    </Box>
  );
}
