import { useMemo, useState } from 'react';
import {
  Stack, Card, Text, Group, Table, Badge, Anchor, SimpleGrid, ScrollArea, TextInput, Alert, ActionIcon,
} from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useSql, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay, paidHeadcount } from '../lib/queries';
import { usd, num, fullName } from '../lib/format';
import type { Metric } from '../state/controls';
import { useTray } from '../state/tray';
import { PeerRangeBar } from './PeerRangeBar';
import { PayBandBar } from './PayBandBar';
import { CardTitle } from './CardTitle';
import { TrayButton } from './TrayButton';
import { SortableTh, type SortState } from './SortableTh';
import { GLOSSARY } from '../lib/glossary';
import { StatSkeleton, ChartSkeleton, TableSkeleton } from './Loading';
import { SalaryHistogram } from './SalaryHistogram';
import { StatCard } from './StatCard';
import { ICON } from '../lib/ui';
import { PercentileNote } from './PercentileNote';


function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard size="sm" label={label} value={value} />;
}

interface StatsRow { title: string | null; n: number; med: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null }
interface PersonRow { person_key: string; fn: string | null; ln: string | null; school: string | null; department: string | null; tenure: number | null; pay: number }
type PeopleSortKey = 'name' | 'school' | 'department' | 'tenure' | 'salary';
interface SchoolRow { school: string; n: number; med: number | null }
interface PctRow { scope: string; pct: number; n: number }

/**
 * Everything-about-a-title view, rendered by the Search-Title-Salaries explorer (`/paycheck`, with a
 * title picker + optional school filter + optional salary pin). The legacy `/title/:code` URL now
 * redirects here. Title selection drives the whole view; `pinSalary` only adds the "where it lands"
 * markers/percentile.
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
        any_value(school) school, any_value(department) department,
        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 AS tenure,
        ${personPay(metric)} pay
        FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, tenure, pay FROM pp WHERE pay > 0 ORDER BY pay DESC LIMIT 1000`,
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
  // Clicking a histogram bar filters the list below to that salary range (persists across a title/school
  // change the same way the name search above already does, since this component isn't remounted then).
  const [binFilter, setBinFilter] = useState<{ lo: number; hi: number } | null>(null);
  const [peopleSort, setPeopleSort] = useState<SortState<PeopleSortKey>>({ key: 'salary', dir: 'desc' });
  // Pay rank is anchored to the underlying pay-desc query order, independent of the table's current
  // display sort — "#12" always means "12th highest pay for this title," not "12th row shown."
  const payRank = useMemo(() => new Map(people.map((p, i) => [p.person_key, i + 1])), [people]);
  const filteredPeople = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = people
      .filter((p) => !t || fullName(p.fn, p.ln).toLowerCase().includes(t))
      .filter((p) => !binFilter || (p.pay >= binFilter.lo && p.pay <= binFilter.hi));
    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      switch (peopleSort.key) {
        case 'name': cmp = fullName(a.fn, a.ln).localeCompare(fullName(b.fn, b.ln)); break;
        case 'school': cmp = (a.school ?? '').localeCompare(b.school ?? ''); break;
        case 'department': cmp = (a.department ?? '').localeCompare(b.department ?? ''); break;
        case 'tenure': cmp = (a.tenure ?? 0) - (b.tenure ?? 0); break;
        default: cmp = a.pay - b.pay;
      }
      return peopleSort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [people, q, binFilter, peopleSort]);

  const scopeLabel = school ? ` in ${school}` : '';

  if (isLoading) {
    return (
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <StatSkeleton size="hero" />
          <SimpleGrid cols={2} spacing="lg">
            <StatSkeleton size="sm" />
            <StatSkeleton size="sm" />
          </SimpleGrid>
        </SimpleGrid>
        <Card withBorder padding="lg"><ChartSkeleton /></Card>
        <Card withBorder padding="lg"><TableSkeleton /></Card>
      </Stack>
    );
  }
  if (!s || s.n === 0) return <Alert color="gray">No one with this title{scopeLabel} in this snapshot.</Alert>;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <StatCard
          size="hero"
          lead
          label={`Median salary · this title${scopeLabel}`}
          value={usd(s.med)}
          sub={`${num(s.n)} ${s.n === 1 ? 'person' : 'people'} · job code ${jobCode}`}
        />
        <SimpleGrid cols={2} spacing="lg">
          <Stat label="Range (p25–p75)" value={`${usd(s.p25)} – ${usd(s.p75)}`} />
          <Stat label="Spread (min–max)" value={`${usd(s.lo)} – ${usd(s.hi)}`} />
        </SimpleGrid>
      </SimpleGrid>

      {pinned && s.lo != null && s.p25 != null && s.med != null && s.p75 != null && s.hi != null && (
        <Card withBorder padding="lg">
          <CardTitle>Where {usd(pinSalary)} lands among {titleLabel}{scopeLabel}</CardTitle>
          <PeerRangeBar min={s.lo} p25={s.p25} median={s.med} p75={s.p75} max={s.hi} value={pinSalary!} values={pays} />
          {titleRow && (
            <PercentileNote
              pct={titleRow.pct}
              n={titleRow.n}
              pool={`people with this title${school ? ' across UW' : ''}`}
              subject={<b>{usd(pinSalary)}</b>}
              mt="md"
            />
          )}
          {school && schoolRow && (
            <PercentileNote
              pct={schoolRow.pct}
              n={schoolRow.n}
              pool={`people with this title within ${school}`}
              subject={<b>{usd(pinSalary)}</b>}
              mt={4}
            />
          )}
        </Card>
      )}

      <Card withBorder padding="lg">
        <CardTitle>Salary distribution{scopeLabel}</CardTitle>
        <SalaryHistogram
          values={pays}
          markerValue={pinned ? pinSalary : null}
          markerLabel="Pinned Salary"
          tooFewText={`Only ${num(s.n)} ${s.n === 1 ? 'person has' : 'people have'} this title${scopeLabel} — too few to chart a meaningful distribution.`}
          onBinClick={setBinFilter}
        />
        <Text size="xs" c="dimmed" mt={4}>Click a bar to filter the people list below to that range.</Text>
      </Card>

      {band && (
        <Card withBorder padding="lg">
          <CardTitle>Official pay band — grade {g?.grade_number}</CardTitle>
          <PayBandBar
            min={band.min}
            max={band.max}
            value={pinned ? pinSalary : null}
            quartiles
            benchmarks={s.med != null ? [{ value: s.med, label: 'title median' }] : []}
          />
        </Card>
      )}

      <Card withBorder padding="lg">
        <CardTitle
          mb="sm"
          right={pinned && rank != null && (
            <Text size="sm" c="dimmed">{usd(pinSalary)} would rank <b>#{rank}</b> of {num(s.n)}</Text>
          )}
        >
          People with this title{scopeLabel}
        </CardTitle>
        {binFilter && (
          <Badge
            variant="light"
            color="accent"
            mb="sm"
            rightSection={
              <ActionIcon size={14} radius="xl" variant="transparent" color="accent" aria-label="Clear salary range filter" onClick={() => setBinFilter(null)}>
                <IconX size={11} />
              </ActionIcon>
            }
          >
            {usd(binFilter.lo)} – {usd(binFilter.hi)}
          </Badge>
        )}
        <TextInput
          size="md"
          mb="sm"
          placeholder="Search within this title…"
          leftSection={<IconSearch size={ICON.control} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <ScrollArea.Autosize mah={460} type="auto" offsetScrollbars="present">
          <Table stickyHeader miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={48} ta="right">#</Table.Th>
                <SortableTh sortKey="name" label="Name" sort={peopleSort} onSort={setPeopleSort} />
                <SortableTh sortKey="school" label="School" sort={peopleSort} onSort={setPeopleSort} />
                <SortableTh sortKey="department" label="Department" sort={peopleSort} onSort={setPeopleSort} />
                <SortableTh sortKey="tenure" label="Tenure" tip={GLOSSARY.tenure} sort={peopleSort} onSort={setPeopleSort} align="right" />
                <SortableTh sortKey="salary" label="Salary" sort={peopleSort} onSort={setPeopleSort} align="right" />
                <Table.Th w={132} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredPeople.map((p) => {
                const realRank = payRank.get(p.person_key) ?? 0;
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
                    <Table.Td><Text span size="sm" lineClamp={1}>{p.school ?? '—'}</Text></Table.Td>
                    <Table.Td><Text span size="sm" c="dimmed" lineClamp={1}>{p.department ?? '—'}</Text></Table.Td>
                    <Table.Td ta="right">{p.tenure != null ? `${Math.max(0, p.tenure).toFixed(1)} yrs` : '—'}</Table.Td>
                    <Table.Td ta="right">{usd(p.pay)}</Table.Td>
                    <Table.Td ta="right">
                      <TrayButton
                        inTray={inTray}
                        addLabel="Add to tray"
                        stopPropagation
                        onAdd={() => add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) })}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        {people.length >= 1000 && <Text size="xs" c="dimmed" mt="xs">Showing the top 1,000 by pay.</Text>}
      </Card>

      <Card withBorder padding="lg">
        <CardTitle>Pay by school (market view)</CardTitle>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>School</Table.Th>
              <Table.Th ta="right">People</Table.Th>
              <Table.Th ta="right">Median</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(bySchool ?? []).map((r) => (
              <Table.Tr key={r.school} style={{ background: school === r.school ? 'var(--mantine-color-accent-light)' : undefined }}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
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
    </Stack>
  );
}
