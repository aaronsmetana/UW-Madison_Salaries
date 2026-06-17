import { useSearchParams, Link } from 'react-router-dom';
import {
  Stack, Title, Text, Card, Group, Select, NumberInput, SimpleGrid, Table, Anchor, Loader, Badge, Box, Skeleton,
} from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useSql, useActiveSnapshotId, useGrades } from '../lib/hooks';
import { useControls } from '../state/controls';
import { salaryExpr, personPay } from '../lib/queries';
import { sqlStr } from '../lib/duckdb';
import { usd, num } from '../lib/format';
import { PayBandBar } from '../components/PayBandBar';
import { SalaryHistogram } from '../components/SalaryHistogram';

function ordinal(p: number): string {
  const r = Math.round(p);
  const v = r % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return r + (s[(v - 20) % 10] || s[v] || s[0]);
}

interface PctRow { scope: string; pct: number; n: number; med: number | null; p25: number | null; p75: number | null }

export default function PayCheck() {
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || null;
  const school = params.get('sch') || null;
  const salStr = params.get('sal');
  const salary = salStr ? Number(salStr) : NaN;

  const snap = useActiveSnapshotId();
  const { metric } = useControls();
  const expr = salaryExpr(metric);
  const { data: grades } = useGrades();

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

  // option lists
  const { data: titles } = useSql<{ job_code: string; title: string; n: number }>(
    ['pc-titles', snap ?? ''],
    `SELECT job_code, arg_max(title, salary) title, count(DISTINCT person_key) n
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
  const titleLabel = (titles ?? []).find((t) => t.job_code === code)?.title ?? code ?? '';

  const ready = !!snap && !!code && Number.isFinite(salary) && salary > 0;
  const base = `snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(code ?? '')}`;

  // percentile within the title (and title+school)
  const { data: pct } = useSql<PctRow>(
    ['pc-pct', snap ?? '', code, school, salary, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT 'title' AS "scope", round(100.0 * avg(CASE WHEN pay <= ${salary} THEN 1 ELSE 0 END), 1) pct,
        count(*) n, median(pay) med, quantile_cont(pay, 0.25) p25, quantile_cont(pay, 0.75) p75 FROM pp WHERE pay > 0
     ${school ? `UNION ALL SELECT 'title_school' AS "scope", round(100.0 * avg(CASE WHEN pay <= ${salary} THEN 1 ELSE 0 END), 1) pct,
        count(*) n, median(pay) med, quantile_cont(pay, 0.25) p25, quantile_cont(pay, 0.75) p75 FROM pp WHERE pay > 0 AND school = ${sqlStr(school)}` : ''}`,
    ready
  );
  const titleRow = pct?.find((r) => r.scope === 'title');
  const schoolRow = pct?.find((r) => r.scope === 'title_school');

  // distribution for the title (per-person salary sums, with a "you" marker)
  const { data: payRows } = useSql<{ pay: number }>(
    ['pc-pays', snap ?? '', code, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    ready
  );
  const pays = (payRows ?? []).map((r) => r.pay);

  // by-school market view
  const { data: bySchool } = useSql<{ school: string; n: number; med: number | null }>(
    ['pc-school', snap ?? '', code, metric],
    `SELECT school, count(DISTINCT person_key) n, median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${base} AND school IS NOT NULL GROUP BY school ORDER BY n DESC`,
    ready
  );

  // modal grade for this title → official band
  const { data: gradeRow } = useSql<{ grade_number: number; grade_basis: string }>(
    ['pc-grade', snap ?? '', code],
    `SELECT grade_number, grade_basis FROM salaries WHERE ${base} AND grade_number IS NOT NULL
     GROUP BY grade_number, grade_basis ORDER BY count(*) DESC LIMIT 1`,
    ready
  );
  const g = gradeRow?.[0];
  const band = g && grades ? grades.find((x) => x.grade === g.grade_number && x.basis === g.grade_basis) : undefined;

  return (
    <Stack gap="lg">
      <Box pl="md" style={{ borderLeft: '3px solid var(--mantine-color-indigo-5)' }}>
        <Title order={1} style={{ letterSpacing: '-0.02em', fontSize: 'clamp(1.75rem, 3vw, 2.5rem)' }}>
          Search title salaries
        </Title>
        <Text c="dimmed" maw={640} mt={6} size="lg">
          Pick a title and (optionally) enter a salary to see exactly where it lands among everyone in that title — within UW and within a school. Any salary you enter stays in your browser.
        </Text>
      </Box>

      <Card padding="lg">
        <Group align="flex-end" wrap="wrap" gap="xl" maw={920}>
          <Select
            label="Your title"
            placeholder="Search titles…"
            data={titleData}
            value={code}
            onChange={(v) => setP('code', v)}
            searchable
            w={340}
            nothingFoundMessage="No matching title"
            rightSection={<IconChevronDown size={18} stroke={2} />}
          />
          <Select
            label="Your school (optional)"
            placeholder="All UW"
            data={(schools ?? []).map((s) => s.school)}
            value={school}
            onChange={(v) => setP('sch', v)}
            searchable
            clearable
            w={300}
          />
          <NumberInput
            label="Your annual salary"
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
        <Text size="xs" c="dimmed" mt="xs">Private — your salary is never uploaded or stored.</Text>
      </Card>

      {!ready ? (
        <Stack gap="lg">
          <Text c="dimmed" ta="center">
            Choose a title above (and optionally enter a salary) to see where it lands. Your results will appear here:
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Skeleton height={104} radius="lg" />
            <Skeleton height={104} radius="lg" />
          </SimpleGrid>
          {/* Mock distribution chart: faint axes + pulsing skeleton bars. */}
          <Card withBorder padding="lg">
            <Skeleton height={12} width={200} radius="sm" mb="lg" />
            <Box style={{ position: 'relative', height: 200 }}>
              <div style={{ position: 'absolute', left: 36, top: 0, bottom: 28, width: 1, background: 'var(--mantine-color-default-border)' }} />
              <div style={{ position: 'absolute', left: 36, right: 0, bottom: 28, height: 1, background: 'var(--mantine-color-default-border)' }} />
              <Group gap="sm" align="flex-end" wrap="nowrap" style={{ position: 'absolute', left: 52, right: 8, bottom: 29, height: 168 }}>
                {[45, 80, 130, 165, 120, 70, 40].map((h, i) => (
                  <Skeleton key={i} height={h} radius="sm" style={{ flex: 1 }} />
                ))}
              </Group>
            </Box>
          </Card>
        </Stack>
      ) : !pct ? (
        <Loader />
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: school ? 2 : 1 }}>
            <Card padding="lg" shadow="sm">
              <Text size="sm" c="dimmed">Among all {titleLabel} at UW</Text>
              <Title order={2}>{titleRow ? `${ordinal(titleRow.pct)} percentile` : '—'}</Title>
              <Text size="sm" c="dimmed">
                paid more than {titleRow?.pct ?? 0}% of {num(titleRow?.n)} · median {usd(titleRow?.med)} · p25 {usd(titleRow?.p25)} · p75 {usd(titleRow?.p75)}
              </Text>
            </Card>
            {school && schoolRow && (
              <Card padding="lg" shadow="sm">
                <Text size="sm" c="dimmed">Among {titleLabel} in {school}</Text>
                <Title order={2}>{ordinal(schoolRow.pct)} percentile</Title>
                <Text size="sm" c="dimmed">
                  more than {schoolRow.pct}% of {num(schoolRow.n)} · median {usd(schoolRow.med)}
                </Text>
              </Card>
            )}
          </SimpleGrid>

          {band && (
            <Card padding="lg">
              <Text size="sm" fw={600} mb="md">Official pay band — grade {g?.grade_number}</Text>
              <PayBandBar min={band.min} max={band.max} value={salary} />
            </Card>
          )}

          <Card padding="lg">
            <Text size="sm" fw={600} mb="md">Where you fall in the {titleLabel} pay distribution</Text>
            <SalaryHistogram
              values={pays}
              markerValue={salary}
              markerLabel="you"
              tooFewText={`Only ${num(pays.length)} ${pays.length === 1 ? 'person has' : 'people have'} this title — too few to chart a meaningful distribution.`}
            />
          </Card>

          <Card padding="lg">
            <Group justify="space-between" mb="md">
              <Text size="sm" fw={600}>This title across schools (market view)</Text>
              {code && <Anchor component={Link} to={`/title/${encodeURIComponent(code)}`} size="sm">Full title page →</Anchor>}
            </Group>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(bySchool ?? []).map((s) => (
                  <Table.Tr key={s.school}>
                    <Table.Td>
                      {s.school}
                      {school === s.school && <Badge ml="xs" size="xs" variant="light">you</Badge>}
                    </Table.Td>
                    <Table.Td ta="right">{num(s.n)}</Table.Td>
                    <Table.Td ta="right">{usd(s.med)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  );
}
