import { Link } from 'react-router-dom';
import { Stack, Title, Text, SimpleGrid, Group, Anchor } from '@mantine/core';
import { IconDatabase, IconCoin, IconReportMoney, IconScale, IconUsersGroup } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
import { StatCard } from '../components/StatCard';
import { SearchBox } from '../components/SearchBox';

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

      <SearchBox prominent placeholder="Search for an employee by name…" />

      <SimpleGrid cols={{ base: 1, sm: 3 }} maw={760} mx="auto" w="100%">
        <StatCard label="Total records" value={num(summary?.total_rows)} icon={<IconDatabase size={20} />} color="cyan" />
        <StatCard label="Median campus salary" value={usd(summary?.latest?.median)} icon={<IconCoin size={20} />} color="teal" />
        <StatCard label="Total payroll (latest)" value={usd(payroll)} icon={<IconReportMoney size={20} />} color="indigo" />
      </SimpleGrid>

      <Group justify="center" gap="xl" mt="xs">
        <Anchor component={Link} to="/paycheck" c="dimmed">
          <Group gap={6}><IconScale size={16} /> Self-Check: am I paid fairly for my title?</Group>
        </Anchor>
        <Anchor component={Link} to="/compare" c="dimmed">
          <Group gap={6}><IconUsersGroup size={16} /> Compare a team</Group>
        </Anchor>
      </Group>
    </Stack>
  );
}
