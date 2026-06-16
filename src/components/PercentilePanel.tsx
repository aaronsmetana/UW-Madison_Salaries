import { useState } from 'react';
import { Card, Stack, Group, NumberInput, Select, SimpleGrid, Text } from '@mantine/core';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr } from '../lib/queries';
import { usd, num } from '../lib/format';

interface PctRow { pop: string; pct: number; n: number; med: number | null }

function ord(p: number): string {
  const r = Math.round(p);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = r % 100;
  return r + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function PercentilePanel() {
  const { metric, scope } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const [salary, setSalary] = useState<number | string>('');
  const [school, setSchool] = useState<string | null>(scope.kind === 'school' ? scope.value : null);

  const { data: schools } = useSql<{ school: string }>(
    ['pf-schools', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );

  const v = typeof salary === 'number' ? salary : Number(salary);
  const enabled = !!snap && Number.isFinite(v) && v > 0;

  // per-person totals at the snapshot, then percentile of v within All-UW and the chosen school
  const cte = `WITH pp AS (SELECT person_key, sum(${expr}) pay, any_value(school) school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)`;
  const { data: pct } = useSql<PctRow>(
    ['pf', snap ?? '', metric, v, school ?? ''],
    `${cte}
     SELECT 'All UW' pop, round(100.0 * avg(CASE WHEN pay <= ${v} THEN 1 ELSE 0 END), 1) pct, count(*) n, median(pay) med FROM pp WHERE pay > 0
     ${school ? `UNION ALL SELECT ${sqlStr(school)} pop, round(100.0 * avg(CASE WHEN pay <= ${v} THEN 1 ELSE 0 END), 1) pct, count(*) n, median(pay) med FROM pp WHERE pay > 0 AND school = ${sqlStr(school)}` : ''}`,
    enabled
  );

  const popWhere = school ? `school = ${sqlStr(school)}` : 'TRUE';
  const { data: dist } = useSql<{ bucket: number; n: number }>(
    ['pf-dist', snap ?? '', metric, school ?? ''],
    `SELECT (floor(${expr} / 20000) * 20000)::BIGINT bucket, count(*) n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND ${popWhere} AND ${expr} > 0 GROUP BY 1 ORDER BY 1`,
    enabled
  );
  const distData = (dist ?? []).map((d) => ({ label: `${Math.round(d.bucket / 1000)}k`, n: d.n }));
  const markerLabel = enabled ? `${Math.round((Math.floor(v / 20000) * 20000) / 1000)}k` : null;

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg">
        <Group align="flex-end">
          <NumberInput
            label="Your (or any) annual salary"
            placeholder="e.g. 95000"
            value={salary}
            onChange={setSalary}
            min={0}
            step={1000}
            thousandSeparator=","
            prefix="$"
            w={220}
          />
          <Select
            label="Compare within school (optional)"
            placeholder="All UW only"
            data={(schools ?? []).map((s) => s.school)}
            value={school}
            onChange={setSchool}
            searchable
            clearable
            w={320}
          />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Your entry stays in your browser — it is never uploaded or stored.
        </Text>
      </Card>

      {enabled && (
        <>
          <SimpleGrid cols={{ base: 1, sm: school ? 2 : 1 }}>
            {(pct ?? []).map((p) => (
              <Card withBorder padding="lg" key={p.pop}>
                <Text size="sm" c="dimmed">{p.pop}</Text>
                <Text fw={700} size="xl">{p.pct == null ? '—' : `${ord(p.pct)} percentile`}</Text>
                <Text size="xs" c="dimmed">
                  paid more than {p.pct}% of {num(p.n)} people · median {usd(p.med)}
                </Text>
              </Card>
            ))}
          </SimpleGrid>

          <Card withBorder padding="lg">
            <Text size="sm" fw={600} mb="md">
              Distribution {school ? `— ${school}` : '— All UW'} ($20k bins, “you” marked)
            </Text>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distData} margin={{ left: 12, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis width={48} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="n" fill="var(--mantine-color-indigo-4)" />
                {markerLabel && (
                  <ReferenceLine x={markerLabel} stroke="var(--mantine-color-red-6)" strokeWidth={2} label={{ value: 'you', position: 'top', fontSize: 11 }} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </Stack>
  );
}
