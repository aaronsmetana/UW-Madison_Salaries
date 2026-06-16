import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Stack, Card, Group, Title, Text, Select, NumberInput, Button, SimpleGrid, Anchor, ThemeIcon } from '@mantine/core';
import {
  IconScale, IconUserSearch, IconUsersGroup, IconUsers, IconCoin, IconCalendarStats, IconDatabase, IconArrowRight,
} from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
import { Hero } from '../components/Hero';
import { StatCard } from '../components/StatCard';
import { SearchBox } from '../components/SearchBox';

export default function Home() {
  const nav = useNavigate();
  const snap = useActiveSnapshotId();
  const { data: summary } = useSummary();
  const latest = summary?.latest;

  const [code, setCode] = useState<string | null>(null);
  const [sal, setSal] = useState<number | string>('');

  const { data: titles } = useSql<{ job_code: string; title: string; n: number }>(
    ['pc-titles', snap ?? ''],
    `SELECT job_code, arg_max(title, salary) title, count(DISTINCT person_key) n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );
  const titleData = (titles ?? []).map((t) => ({ value: t.job_code, label: `${t.title} (${t.job_code} · ${num(t.n)})` }));

  const go = () => {
    if (code && typeof sal === 'number' && sal > 0) nav(`/paycheck?code=${encodeURIComponent(code)}&sal=${sal}`);
  };

  return (
    <Stack gap="lg">
      <Hero
        title="UW–Madison Salaries"
        subtitle="Explore public-record UW–Madison salary data across years. See how your pay compares for your title, look up anyone, and compare people or teams."
      />

      {/* Primary action */}
      <Card padding="xl" shadow="sm" withBorder>
        <Group gap="sm" mb="xs">
          <ThemeIcon variant="light" size={36} radius="md"><IconScale size={20} /></ThemeIcon>
          <Title order={3}>Am I paid fairly for my title?</Title>
        </Group>
        <Text c="dimmed" mb="md">Pick your title and enter your salary — see your percentile within that title, the official pay band, and how schools compare. Your number stays in your browser.</Text>
        <Group align="flex-end" wrap="wrap">
          <Select
            label="Your title"
            placeholder="Search titles…"
            data={titleData}
            value={code}
            onChange={setCode}
            searchable
            w={360}
            nothingFoundMessage="No matching title"
          />
          <NumberInput
            label="Your annual salary"
            placeholder="e.g. 120000"
            value={sal}
            onChange={setSal}
            min={0}
            step={1000}
            thousandSeparator=","
            prefix="$"
            w={200}
          />
          <Button size="md" rightSection={<IconArrowRight size={16} />} onClick={go} disabled={!code || !(typeof sal === 'number' && sal > 0)}>
            Check my pay
          </Button>
        </Group>
      </Card>

      {/* Secondary actions */}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card padding="lg" shadow="sm" withBorder>
          <Group gap="sm" mb="xs">
            <ThemeIcon variant="light" color="teal" size={32} radius="md"><IconUserSearch size={18} /></ThemeIcon>
            <Title order={4}>Look up a person</Title>
          </Group>
          <Text c="dimmed" size="sm" mb="sm">Find anyone and see all their known salaries, titles, tenure, and pay-band position over time.</Text>
          <SearchBox />
        </Card>

        <Card padding="lg" shadow="sm" withBorder>
          <Group gap="sm" mb="xs">
            <ThemeIcon variant="light" color="grape" size={32} radius="md"><IconUsersGroup size={18} /></ThemeIcon>
            <Title order={4}>Compare people or a team</Title>
          </Group>
          <Text c="dimmed" size="sm" mb="sm">Add people (or whole schools) to your tray from anywhere, then compare salary trajectories, gaps, and standing.</Text>
          <Button variant="light" component={Link} to="/compare" rightSection={<IconArrowRight size={16} />}>
            Open Compare
          </Button>
        </Card>
      </SimpleGrid>

      {/* Supporting KPIs */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <StatCard label="People (latest)" value={num(latest?.headcount)} icon={<IconUsers size={20} />} />
        <StatCard label="Median salary" value={usd(latest?.median)} icon={<IconCoin size={20} />} color="teal" />
        <StatCard label="Snapshots" value={num(summary?.snapshot_count)} icon={<IconCalendarStats size={20} />} color="grape" />
        <StatCard label="Records" value={num(summary?.total_rows)} icon={<IconDatabase size={20} />} color="cyan" />
      </SimpleGrid>

      <Group justify="center">
        <Anchor component={Link} to="/explore" c="dimmed">Browse all data (schools, trends, changes) → Explore</Anchor>
      </Group>
    </Stack>
  );
}
