import { useSearchParams } from 'react-router-dom';
import { Stack, Title, Text, Card, Group, Select, NumberInput, Box } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { useControls } from '../state/controls';
import { paidHeadcount } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { num } from '../lib/format';
import { TitleStats } from '../components/TitleStats';

export default function PayCheck() {
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || null;
  const school = params.get('sch') || null;
  const salStr = params.get('sal');
  const salaryNum = salStr ? Number(salStr) : NaN;
  const pinSalary = Number.isFinite(salaryNum) && salaryNum > 0 ? salaryNum : null;

  const snap = useActiveSnapshotId();
  const { metric } = useControls();

  const setP = (k: string, v: string | number | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v === null || v === '') n.delete(k);
        else n.set(k, String(v));
        return n;
      },
      { replace: true }
    );

  const { data: titles } = useSql<{ job_code: string; title: string; n: number }>(
    ['pc-titles', snap ?? '', metric],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );
  const { data: schools } = useSql<{ school: string }>(
    ['pc-schools', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );
  const titleData = (titles ?? []).map((t) => ({ value: t.job_code, label: `${t.title} (${t.job_code} · ${num(t.n)})` }));

  return (
    <Stack gap="lg">
      <Box pl="md" style={{ borderLeft: '3px solid var(--mantine-color-indigo-5)' }}>
        <Title order={1} style={{ letterSpacing: '-0.02em', fontSize: 'clamp(1.75rem, 3vw, 2.5rem)' }}>
          Search title salaries
        </Title>
        <Text c="dimmed" maw={680} mt={6} size="lg">
          Pick a title to see its pay distribution, the people in it, and how it varies by school.
          Optionally filter to a school or enter a salary to pin where it lands. Any salary you enter stays in your browser.
        </Text>
      </Box>

      <Card padding="lg">
        <Group align="flex-end" wrap="wrap" gap="xl" maw={920}>
          <Select
            size="md"
            label="Title"
            placeholder="Search titles…"
            data={titleData}
            value={code}
            onChange={(v) => setP('code', v)}
            searchable
            w={360}
            nothingFoundMessage="No matching title"
            rightSection={<IconChevronDown size={18} stroke={2} />}
          />
          <Select
            size="md"
            label="School (optional filter)"
            placeholder="All UW"
            data={(schools ?? []).map((s) => s.school)}
            value={school}
            onChange={(v) => setP('sch', v)}
            searchable
            clearable
            w={300}
          />
          <NumberInput
            size="md"
            label="Salary to pin (optional)"
            placeholder="e.g. 120000"
            value={salStr ? Number(salStr) : ''}
            onChange={(v) => setP('sal', typeof v === 'number' ? v : null)}
            min={0}
            step={1000}
            thousandSeparator=","
            prefix="$"
            w={200}
          />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Private — any salary you enter is never uploaded or stored.</Text>
      </Card>

      {!code || !snap ? (
        <Card withBorder padding="xl">
          <Text c="dimmed" ta="center">
            Pick a title above to see its salary distribution, pay by school, and everyone who holds it.
          </Text>
        </Card>
      ) : (
        <TitleStats jobCode={code} snap={snap} metric={metric} school={school} pinSalary={pinSalary} />
      )}
    </Stack>
  );
}
