import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Stack, Title, Text, SimpleGrid, Group, Anchor, Card, ThemeIcon } from '@mantine/core';
import { IconDatabase, IconCoin, IconReportMoney, IconScale, IconUsersGroup } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
import { SearchBox } from '../components/SearchBox';

/** Compact KPI: icon + label on one line, value below — fits short and long numbers cleanly. */
function Kpi({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap={8} wrap="nowrap">
        <ThemeIcon size={30} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" lh={1.2}>
          {label}
        </Text>
      </Group>
      <Text fw={700} fz={20} mt={8} style={{ letterSpacing: '-0.01em' }}>
        {value}
      </Text>
    </Card>
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

  return (
    <Stack gap="xl">
      <Stack gap={6} align="center" mt={{ base: 'md', sm: 48 }}>
        <Title order={1} ta="center" style={{ letterSpacing: '-0.02em' }}>
          UW–Madison Salaries
        </Title>
        <Text c="dimmed" ta="center" maw={560}>
          Search public-record salaries by name, see what someone makes, and compare them to everyone with the same title.
        </Text>
      </Stack>

      {/* Wide hero search; stat cards sit centered beneath it. */}
      <Stack gap="lg" maw={1150} mx="auto" w="100%">
        <SearchBox prominent placeholder="Search for an employee by name…" />
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm" maw={760} mx="auto" w="100%">
          <Kpi label="Total records" value={num(summary?.total_rows)} icon={<IconDatabase size={18} />} color="cyan" />
          <Kpi label="Median campus salary" value={usd(summary?.latest?.median)} icon={<IconCoin size={18} />} color="teal" />
          <Kpi label="Total payroll (latest)" value={usd(payroll)} icon={<IconReportMoney size={18} />} color="indigo" />
        </SimpleGrid>
      </Stack>

      <Group justify="center" gap="lg" mt="xs" wrap="wrap">
        <Anchor component={Link} to="/paycheck" c="dimmed">
          <Group gap={6} wrap="nowrap"><IconScale size={16} /> Search title salaries — how does your pay compare?</Group>
        </Anchor>
        <Anchor component={Link} to="/compare" c="dimmed">
          <Group gap={6} wrap="nowrap"><IconUsersGroup size={16} /> Compare people, titles &amp; schools</Group>
        </Anchor>
      </Group>
    </Stack>
  );
}
