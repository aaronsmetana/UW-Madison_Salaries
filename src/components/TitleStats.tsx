import { useMemo, useState } from 'react';
import {
  Stack, Card, Text, Group, Table, Badge, Anchor, SimpleGrid, ScrollArea, TextInput, Button, Alert, Loader,
} from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useSql, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay, paidHeadcount } from '../lib/queries';
import { usd, num, fullName } from '../lib/format';
import type { Metric } from '../state/controls';
import { useTray } from '../state/tray';
import { PeerRangeBar } from './PeerRangeBar';
import { PayBandBar } from './PayBandBar';
import { SalaryHistogram } from './SalaryHistogram';

function ordinal(p: number): string {
  const r = Math.round(p);
  const v = r % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return r + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Stable color per school so people in the same school read as a group. */
function schoolHue(s: string | null): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600} fz="lg">{value}</Text>
    </Card>
  );
}

interface StatsRow { title: string | null; n: number; med: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null }
interface PersonRow { person_key: string; fn: string | null; ln: string | null; school: string | null; department: string | null; pay: number }
interface SchoolRow { school: string; n: number; med: number | null }
interface PctRow { scope: string; pct: number; n: number }

/**
 * Everything-about-a-title view, shared by the Search-Title-Salaries explorer (`/paycheck`, with a
 * title picker + optional school filter + optional salary pin) and the deep-link `/title/:code` page.
 * Title selection drives the whole view; `pinSalary` only adds the "where it lands" markers/percentile.
 */
export function TitleStats({ jobCode, snap, metric, school = null, pinSalary = null }: {
  jobCode: string;
  snap: string;
  metric: Metric;
  school?: string | null;
  pinSalary?: number | null;
}) {
  const expr = salaryExpr(metric);
  const nav = useNavigate();
  const { add, has } = useTray();
  const { data: grades } = useGrades();
  const enabled = !!snap && !!jobCode;
  const pinned = pinSalary != null && Number.isFinite(pinSalary) && pinSalary > 0;

  const titleBase = `snapshot_id = ${sqlStr(snap)} AND job_code = ${sqlStr(jobCode)}`; // all schools
  const base = school ? `${titleBase} AND school = ${sqlStr(school)}` : titleBase;       // scoped to filter

  const { data: statRows, isLoading } = useSql<StatsRow>(
    ['ts-stats', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, arg_max(title, salary) title, ${personPay(metric)} pay FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT any_value(title) title, count(*) FILTER (WHERE pay > 0) n,
        median(pay) FILTER (WHERE pay > 0) med, quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75, min(pay) FILTER (WHERE pay > 0) lo,
        max(pay) FILTER (WHERE pay > 0) hi FROM pp`,
    enabled
  );
  const s = statRows?.[0];
  const titleLabel = s?.title ?? jobCode;

  const { data: payRows } = useSql<{ pay: number }>(
    ['ts-pays', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    enabled
  );
  const pays = useMemo(() => (payRows ?? []).map((r) => r.pay), [payRows]);

  const { data: peopleRows } = useSql<PersonRow>(
    ['ts-people', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(school) school, any_value(department) department, ${personPay(metric)} pay
        FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, pay FROM pp WHERE pay > 0 ORDER BY pay DESC LIMIT 1000`,
    enabled
  );
  const people = useMemo(() => peopleRows ?? [], [peopleRows]);

  const { data: bySchool } = useSql<SchoolRow>(
    ['ts-school', jobCode, snap, metric],
    `SELECT school, ${paidHeadcount(metric)} n, median(${expr}) FILTER (WHERE ${expr} > 0) med
     FROM salaries WHERE ${titleBase} AND school IS NOT NULL GROUP BY school ORDER BY n DESC`,
    enabled
  );

  const { data: pct } = useSql<PctRow>(
    ['ts-pct', jobCode, snap, school ?? '', pinSalary ?? 0, metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school FROM salaries WHERE ${titleBase} GROUP BY person_key)
     SELECT 'title' AS "scope", round(100.0 * avg(CASE WHEN pay <= ${pinSalary ?? 0} THEN 1 ELSE 0 END), 1) pct, count(*) n FROM pp WHERE pay > 0
     ${school ? `UNION ALL SELECT 'title_school' AS "scope", round(100.0 * avg(CASE WHEN pay <= ${pinSalary ?? 0} THEN 1 ELSE 0 END), 1) pct, count(*) n FROM pp WHERE pay > 0 AND school = ${sqlStr(school)}` : ''}`,
    enabled && pinned
  );
  const titleRow = pct?.find((r) => r.scope === 'title');
  const schoolRow = pct?.find((r) => r.scope === 'title_school');

  const { data: gradeRow } = useSql<{ grade_number: number; grade_basis: string }>(
    ['ts-grade', jobCode, snap],
    `SELECT grade_number, grade_basis FROM salaries WHERE ${titleBase} AND grade_number IS NOT NULL
     GROUP BY grade_number, grade_basis ORDER BY count(*) DESC LIMIT 1`,
    enabled
  );
  const g = gradeRow?.[0];
  const band = g && grades ? grades.find((x) => x.grade === g.grade_number && x.basis === g.grade_basis) : undefined;

  // Where an entered salary would rank within the (scoped) title population.
  const rank = useMemo(() => {
    if (!pinned || !pays.length) return null;
    return pays.filter((p) => p > pinSalary!).length + 1;
  }, [pinned, pays, pinSalary]);

  const [q, setQ] = useState('');
  const filteredPeople = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return people;
    return people.filter((p) => fullName(p.fn, p.ln).toLowerCase().includes(t));
  }, [people, q]);

  const scopeLabel = school ? ` in ${school}` : '';

  if (isLoading) return <Loader />;
  if (!s || s.n === 0) return <Alert color="gray">No one with this title{scopeLabel} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label={`People${scopeLabel ? ' (' + school + ')' : ''}`} value={num(s.n)} />
        <Stat label="Median" value={usd(s.med)} />
        <Stat label="Lowest" value={usd(s.lo)} />
        <Stat label="Highest" value={usd(s.hi)} />
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt={-8}>p25 {usd(s.p25)} · median {usd(s.med)} · p75 {usd(s.p75)}{scopeLabel}</Text>

      {pinned && s.lo != null && s.p25 != null && s.med != null && s.p75 != null && s.hi != null && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Where {usd(pinSalary)} lands among {titleLabel}{scopeLabel}</Text>
          <PeerRangeBar min={s.lo} p25={s.p25} median={s.med} p75={s.p75} max={s.hi} value={pinSalary!} />
          {titleRow && (
            <Text size="sm" mt="md">
              <b>{usd(pinSalary)}</b> is at the <b>{ordinal(titleRow.pct)} percentile</b> — paid more than {titleRow.pct}% of {num(titleRow.n)} people with this title{school ? ' across UW' : ''}.
            </Text>
          )}
          {school && schoolRow && (
            <Text size="sm" mt={4}>Within {school}: {ordinal(schoolRow.pct)} percentile (more than {schoolRow.pct}% of {num(schoolRow.n)}).</Text>
          )}
        </Card>
      )}

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Salary distribution{scopeLabel}</Text>
        <SalaryHistogram
          values={pays}
          markerValue={pinned ? pinSalary : null}
          markerLabel="your salary"
          tooFewText={`Only ${num(s.n)} ${s.n === 1 ? 'person has' : 'people have'} this title${scopeLabel} — too few to chart a meaningful distribution.`}
        />
      </Card>

      {band && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Official pay band — grade {g?.grade_number}</Text>
          <PayBandBar min={band.min} max={band.max} value={pinned ? pinSalary : null} />
        </Card>
      )}

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="md">Pay by school (market view)</Text>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>School</Table.Th>
              <Table.Th ta="right">People</Table.Th>
              <Table.Th ta="right">Median</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(bySchool ?? []).map((r) => (
              <Table.Tr key={r.school} style={{ background: school === r.school ? 'var(--mantine-color-indigo-light)' : undefined }}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: `hsl(${schoolHue(r.school)} 55% 55%)` }} />
                    <Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`}>{r.school}</Anchor>
                    {school === r.school && <Badge size="xs" variant="light">filtered</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{num(r.n)}</Table.Td>
                <Table.Td ta="right">{usd(r.med)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm" wrap="nowrap">
          <Text size="sm" fw={600}>People with this title{scopeLabel}</Text>
          {pinned && rank != null && (
            <Text size="sm" c="dimmed">{usd(pinSalary)} would rank <b>#{rank}</b> of {num(s.n)}</Text>
          )}
        </Group>
        <TextInput
          size="md"
          mb="sm"
          placeholder="Search within this title…"
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <ScrollArea.Autosize mah={460} type="auto" offsetScrollbars="present">
          <Table striped highlightOnHover stickyHeader miw={680}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={48} ta="right">#</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>School</Table.Th>
                <Table.Th>Department</Table.Th>
                <Table.Th ta="right">Salary</Table.Th>
                <Table.Th w={132} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredPeople.map((p) => {
                const realRank = people.indexOf(p) + 1;
                const inTray = has(p.person_key);
                return (
                  <Table.Tr
                    key={p.person_key}
                    className="peer-row"
                    onClick={() => nav(`/person/${encodeURIComponent(p.person_key)}`)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav(`/person/${encodeURIComponent(p.person_key)}`); } }}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td ta="right" c="dimmed">{realRank}</Table.Td>
                    <Table.Td><Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`} onClick={(e) => e.stopPropagation()}>{fullName(p.fn, p.ln) || '—'}</Anchor></Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: p.school ? `hsl(${schoolHue(p.school)} 55% 55%)` : 'var(--mantine-color-gray-4)' }} />
                        <Text span size="sm" lineClamp={1}>{p.school ?? '—'}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td><Text span size="sm" c="dimmed" lineClamp={1}>{p.department ?? '—'}</Text></Table.Td>
                    <Table.Td ta="right">{usd(p.pay)}</Table.Td>
                    <Table.Td ta="right">
                      <Button
                        className="peer-add"
                        size="compact-xs"
                        variant={inTray ? 'light' : 'filled'}
                        color={inTray ? 'gray' : 'indigo'}
                        radius="xl"
                        leftSection={inTray ? undefined : <IconPlus size={12} />}
                        disabled={inTray}
                        onClick={(e) => { e.stopPropagation(); add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) }); }}
                      >
                        {inTray ? 'In tray' : 'Add to tray'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        {people.length >= 1000 && <Text size="xs" c="dimmed" mt="xs">Showing the top 1,000 by pay.</Text>}
      </Card>
    </Stack>
  );
}
