import type { ReactNode } from 'react';
import { Box, Stack, Title, Text, SimpleGrid, Group, Paper, ThemeIcon } from '@mantine/core';
import { IconCoin, IconReportMoney } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { usd } from '../lib/format';
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
    `SELECT sum(salary * COALESCE(fte, 1)) total FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0`,
    !!snap
  );
  const payroll = payrollRows?.[0]?.total ?? null;

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

          {/* System-wide stats */}
          <Paper withBorder radius="lg" px="lg" py="md" w="100%">
            <Group justify="space-between" align="baseline" mb="xs">
              <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.06em' }}>
                System-wide
              </Text>
              {summary?.latest?.label && (
                <Text size="xs" c="dimmed">from the {summary.latest.label} salary report</Text>
              )}
            </Group>
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="lg" verticalSpacing="sm">
              <Kpi label="Median campus salary" value={usd(summary?.latest?.median)} icon={<IconCoin size={18} />} color="teal" />
              <Kpi label="Total payroll" value={usd(payroll)} icon={<IconReportMoney size={18} />} color="indigo" />
            </SimpleGrid>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  );
}
