import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Stack, Title, Text, SimpleGrid, Group, Button, Paper, ThemeIcon, Skeleton } from '@mantine/core';
import {
  IconDatabase, IconCoin, IconReportMoney, IconScale, IconUsersGroup, IconArrowRight, IconTrendingUp,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
import { SearchBox } from '../components/SearchBox';

/** One system-wide stat: icon + label, value below. Borderless — grouped inside a shared container. */
function Kpi({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <div>
      <Group gap={8} wrap="nowrap">
        <ThemeIcon size={30} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" lh={1.2}>
          {label}
        </Text>
      </Group>
      <Text fw={700} fz={22} mt={8} style={{ letterSpacing: '-0.01em' }}>
        {value}
      </Text>
    </div>
  );
}

export default function Home() {
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    `SELECT sum(salary) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    !!snap
  );
  const payroll = payrollRows?.[0]?.total ?? null;

  // "Trending searches" = the most common titles right now → jump straight to a title page.
  const { data: trending } = useSql<{ job_code: string; title: string }>(
    ['home-trending', snap ?? ''],
    `SELECT job_code, arg_max(title, salary) title, count(DISTINCT person_key) n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC LIMIT 8`,
    !!snap
  );

  return (
    <Box style={{ minHeight: 'calc(100dvh - 200px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Stack gap="xl" w="100%">
        <Stack gap={6} align="center">
          <Title order={1} ta="center" style={{ letterSpacing: '-0.02em', fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
            UW–Madison Salaries
          </Title>
          <Text c="dimmed" ta="center" maw={580} size="lg">
            Search anyone by name to see their salary, how it changed over the years, and how they stack up against everyone with the same title.
          </Text>
        </Stack>

        {/* Hero search + empty-state content share one centered width. */}
        <Stack gap="xl" maw={760} mx="auto" w="100%">
          <SearchBox prominent placeholder="Search for an employee by name…" />

          {/* Empty state: trending searches (skeleton chips while loading) */}
          <Stack gap="sm" align="center">
            <Group gap={6} justify="center" c="dimmed">
              <IconTrendingUp size={15} />
              <Text size="xs" tt="uppercase" fw={700} style={{ letterSpacing: '0.06em' }}>
                Trending searches
              </Text>
            </Group>
            <Group justify="center" gap="xs" wrap="wrap">
              {trending
                ? trending.map((t) => (
                    <Button
                      key={t.job_code}
                      component={Link}
                      to={`/title/${encodeURIComponent(t.job_code)}`}
                      variant="light"
                      radius="xl"
                      size="sm"
                    >
                      {t.title}
                    </Button>
                  ))
                : Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} height={32} width={90 + (i % 3) * 36} radius="xl" />
                  ))}
            </Group>
          </Stack>

          {/* System-wide stats */}
          <Paper withBorder radius="lg" px="lg" py="md" w="100%">
            <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="xs" style={{ letterSpacing: '0.06em' }}>
              System-wide
            </Text>
            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="lg" verticalSpacing="sm">
              <Kpi label="Total records" value={num(summary?.total_rows)} icon={<IconDatabase size={18} />} color="cyan" />
              <Kpi label="Median campus salary" value={usd(summary?.latest?.median)} icon={<IconCoin size={18} />} color="teal" />
              <Kpi label="Total payroll (latest)" value={usd(payroll)} icon={<IconReportMoney size={18} />} color="indigo" />
            </SimpleGrid>
          </Paper>
        </Stack>

        <Group justify="center" gap="md" mt="sm" wrap="wrap">
          <Button component={Link} to="/paycheck" variant="default" size="md" radius="xl" px="xl" leftSection={<IconScale size={18} />} rightSection={<IconArrowRight size={16} />}>
            Search title salaries
          </Button>
          <Button component={Link} to="/compare" variant="default" size="md" radius="xl" px="xl" leftSection={<IconUsersGroup size={18} />} rightSection={<IconArrowRight size={16} />}>
            Compare people, titles &amp; schools
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
