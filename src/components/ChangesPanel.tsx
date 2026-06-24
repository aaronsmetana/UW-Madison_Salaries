import { useEffect, useMemo, useState } from 'react';
import { Stack, Card, Text, Group, Select, SimpleGrid, Table, Alert, Anchor } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { AXIS_TICK, GRID } from '../lib/chartStyle';
import { Link } from 'react-router-dom';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay, whereAll, filterKey } from '../lib/queries';
import { usd, num, pct, fullName } from '../lib/format';
import { dropdownProps } from '../lib/selectProps';
import { ChartData } from './ChartData';
import { StatCard } from './StatCard';

interface Mover { person_key: string; fn: string; ln: string; title: string | null; a_pay: number; b_pay: number; delta: number; pct: number }
interface Promo { person_key: string; fn: string; ln: string; a_title: string | null; b_title: string | null; delta: number | null }
interface SummaryRow { stayers: number; joiners: number; leavers: number; title_changes: number; median_raise: number | null }

function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard size="sm" label={label} value={value} />;
}

export function ChangesPanel() {
  const { scope, metric, filters } = useControls();
  const where = whereAll(scope, filters);
  const { data: summary } = useSummary();
  const snaps = useMemo(() => summary?.snapshots ?? [], [summary]);

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [filterSchool, setFilterSchool] = useState<string | null>(null);
  const [filterDept, setFilterDept] = useState<string | null>(null);
  useEffect(() => {
    if (snaps.length >= 2 && !fromId && !toId) {
      setFromId(snaps[snaps.length - 2].id);
      setToId(snaps[snaps.length - 1].id);
    }
  }, [snaps, fromId, toId]);

  const enabled = !!fromId && !!toId && fromId !== toId;
  const A = sqlStr(fromId ?? '');
  const B = sqlStr(toId ?? '');
  // In-panel school/department filter — scopes the whole panel (composes with the global scope).
  const localWhere = `${where}${filterSchool ? ` AND school = ${sqlStr(filterSchool)}` : ''}${filterDept ? ` AND department = ${sqlStr(filterDept)}` : ''}`;
  const scopeKey = `${scope.kind === 'school' ? scope.value : ''}|${filterKey(filters)}|${filterSchool ?? ''}|${filterDept ?? ''}`;

  // Only offer divisions/departments present in BOTH snapshots. UW renamed and split divisions in the
  // 2025 reorg (e.g. "Sch of Med & Public Health" → "School of Medicine and Public Health"), so a unit
  // labelled differently across the pair can't be matched by name and would read as all-new-hires.
  const { data: schoolOpts } = useSql<{ school: string }>(
    ['chg-schools', fromId, toId],
    `SELECT school FROM (
        SELECT school FROM salaries WHERE snapshot_id = ${A} AND school IS NOT NULL GROUP BY school
        INTERSECT
        SELECT school FROM salaries WHERE snapshot_id = ${B} AND school IS NOT NULL GROUP BY school
     ) ORDER BY school`,
    enabled
  );
  const deptSchoolClause = filterSchool ? ` AND school = ${sqlStr(filterSchool)}` : '';
  const { data: deptOpts } = useSql<{ department: string }>(
    ['chg-depts', fromId, toId, filterSchool ?? ''],
    `SELECT department FROM (
        SELECT department FROM salaries WHERE snapshot_id = ${A} AND department IS NOT NULL${deptSchoolClause} GROUP BY department
        INTERSECT
        SELECT department FROM salaries WHERE snapshot_id = ${B} AND department IS NOT NULL${deptSchoolClause} GROUP BY department
     ) ORDER BY department`,
    enabled
  );

  // Drop a selected school/department that isn't present in both snapshots (e.g. after moving "From"
  // across the 2025 reorg) so the panel reverts to a valid scope instead of reading as all-new-hires.
  useEffect(() => {
    if (!schoolOpts || !filterSchool) return;
    if (!schoolOpts.some((x) => x.school === filterSchool)) { setFilterSchool(null); setFilterDept(null); }
  }, [schoolOpts, filterSchool]);
  useEffect(() => {
    if (!deptOpts || !filterDept) return;
    if (!deptOpts.some((x) => x.department === filterDept)) setFilterDept(null);
  }, [deptOpts, filterDept]);

  // Restrict both sides to people with a paid appointment so unpaid $0 affiliates don't read as
  // joiners/leavers (a $0-only person has NULL personPay and is dropped by the HAVING).
  const cte = `WITH a AS (SELECT person_key, ${personPay(metric)} pay, arg_max(job_code, salary) job, arg_max(title, salary) title, arg_max(school, salary) school
                          FROM salaries WHERE snapshot_id = ${A} AND ${localWhere} GROUP BY person_key HAVING ${personPay(metric)} > 0),
                    b AS (SELECT person_key, ${personPay(metric)} pay, arg_max(job_code, salary) job, arg_max(title, salary) title, arg_max(school, salary) school,
                                 any_value(first_name) fn, any_value(last_name) ln
                          FROM salaries WHERE snapshot_id = ${B} AND ${localWhere} GROUP BY person_key HAVING ${personPay(metric)} > 0)`;

  const { data: sumData } = useSql<SummaryRow>(
    ['chg-sum', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL) stayers,
            count(*) FILTER (WHERE a.person_key IS NULL) joiners,
            count(*) FILTER (WHERE b.person_key IS NULL) leavers,
            count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL AND a.job IS DISTINCT FROM b.job) title_changes,
            median((b.pay - a.pay) / a.pay) FILTER (WHERE a.pay > 0 AND b.pay > 0) median_raise
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key`,
    enabled
  );
  const s = sumData?.[0];

  const moverSelect = `${cte}
     SELECT b.person_key, b.fn, b.ln, b.title, a.pay a_pay, b.pay b_pay, (b.pay - a.pay) delta, (b.pay - a.pay) / a.pay pct
     FROM a JOIN b ON a.person_key = b.person_key WHERE a.pay > 0 AND b.pay > 0`;
  const { data: raises } = useSql<Mover>(['chg-raise', fromId, toId, scopeKey, metric], `${moverSelect} ORDER BY delta DESC LIMIT 12`, enabled);
  const { data: cuts } = useSql<Mover>(['chg-cut', fromId, toId, scopeKey, metric], `${moverSelect} ORDER BY delta ASC LIMIT 12`, enabled);
  const { data: promos } = useSql<Promo>(
    ['chg-promo', fromId, toId, scopeKey, metric],
    `${cte} SELECT b.person_key, b.fn, b.ln, a.title a_title, b.title b_title, (b.pay - a.pay) delta
     FROM a JOIN b ON a.person_key = b.person_key WHERE a.job IS DISTINCT FROM b.job ORDER BY delta DESC LIMIT 12`,
    enabled
  );

  const { data: decompData } = useSql<{ total_change: number; raises: number; hires: number; departures: number }>(
    ['chg-decomp', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT
       coalesce(sum(b.pay) FILTER (WHERE b.person_key IS NOT NULL), 0) - coalesce(sum(a.pay) FILTER (WHERE a.person_key IS NOT NULL), 0) total_change,
       coalesce(sum(b.pay - a.pay) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL), 0) raises,
       coalesce(sum(b.pay) FILTER (WHERE a.person_key IS NULL), 0) hires,
       -coalesce(sum(a.pay) FILTER (WHERE b.person_key IS NULL), 0) departures
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key`,
    enabled
  );
  const d = decompData?.[0];

  const { data: raiseDist } = useSql<{ pct_bucket: number; n: number }>(
    ['chg-dist', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT bucket * 5 AS pct_bucket, count(*) n FROM (
       SELECT floor(least(greatest((b.pay - a.pay) / a.pay, -0.25), 0.5) * 100 / 5) AS bucket
       FROM a JOIN b ON a.person_key = b.person_key WHERE a.pay > 0 AND b.pay > 0
     ) GROUP BY bucket ORDER BY bucket`,
    enabled
  );

  const { data: mobility } = useSql<{ person_key: string; fn: string; ln: string; a_school: string | null; b_school: string | null; delta: number }>(
    ['chg-mobility', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT b.person_key, b.fn, b.ln, a.school a_school, b.school b_school, (b.pay - a.pay) delta
     FROM a JOIN b ON a.person_key = b.person_key
     WHERE a.school IS DISTINCT FROM b.school ORDER BY abs(b.pay - a.pay) DESC LIMIT 12`,
    enabled
  );

  const { data: equityRows } = useSql<{ top10_share: number | null; n_raised: number }>(
    ['chg-equity', fromId, toId, scopeKey, metric],
    `${cte}, r AS (SELECT (b.pay - a.pay) raise FROM a JOIN b ON a.person_key = b.person_key WHERE a.pay > 0 AND b.pay > 0 AND b.pay > a.pay)
     SELECT count(*) n_raised,
       CASE WHEN sum(raise) > 0 THEN round(100.0 * sum(raise) FILTER (WHERE raise >= (SELECT quantile_cont(raise, 0.9) FROM r)) / sum(raise), 1) ELSE NULL END top10_share
     FROM r`,
    enabled
  );
  const equity = equityRows?.[0];

  const { data: flows } = useSql<{ a_title: string | null; b_title: string | null; n: number; med_delta: number | null }>(
    ['chg-flows', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT a.title a_title, b.title b_title, count(*) n, round(median(b.pay - a.pay)) med_delta
     FROM a JOIN b ON a.person_key = b.person_key WHERE a.job IS DISTINCT FROM b.job
     GROUP BY a.title, b.title ORDER BY n DESC LIMIT 15`,
    enabled
  );

  const isTTC = !!fromId && !!toId && fromId.includes('pre') && toId.includes('post');
  const opts = [...snaps].reverse().map((x) => ({ value: x.id, label: x.label }));
  const fromLabel = snaps.find((x) => x.id === fromId)?.label ?? '—';
  const toLabel = snaps.find((x) => x.id === toId)?.label ?? '—';
  const scopeText = filterDept ? ` in ${filterDept}` : filterSchool ? ` in ${filterSchool}` : '';

  const moverRows = (rows?: Mover[]) =>
    (rows ?? []).map((m) => (
      <Table.Tr key={m.person_key}>
        <Table.Td>
          <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{fullName(m.fn, m.ln)}</Anchor>
          <Text size="xs" c="dimmed">{m.title}</Text>
        </Table.Td>
        <Table.Td ta="right">{usd(m.a_pay)} → {usd(m.b_pay)}</Table.Td>
        <Table.Td ta="right" c={m.delta >= 0 ? 'pos' : 'red'}>{m.delta >= 0 ? '+' : ''}{usd(m.delta)}</Table.Td>
        <Table.Td ta="right">{pct(m.pct)}</Table.Td>
      </Table.Tr>
    ));

  return (
    <Stack gap="lg">
      <Group align="flex-end" wrap="wrap" gap="md">
        <Select {...dropdownProps('sm')} size="xs" w={150} label="From" data={opts} value={fromId} onChange={setFromId} allowDeselect={false} />
        <Select {...dropdownProps('sm')} size="xs" w={150} label="To" data={opts} value={toId} onChange={setToId} allowDeselect={false} />
        <Select
          {...dropdownProps('sm')}
          size="xs" w={230} label="School" placeholder="All UW" searchable clearable
          data={(schoolOpts ?? []).map((x) => x.school)}
          value={filterSchool}
          onChange={(v) => { setFilterSchool(v); setFilterDept(null); }}
        />
        <Select
          {...dropdownProps('sm')}
          size="xs" w={250} label="Department" placeholder="All departments" searchable clearable
          data={(deptOpts ?? []).map((x) => x.department)}
          value={filterDept}
          onChange={setFilterDept}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Division/department filters list only units present in both snapshots; some were renamed or split
        in the 2025 reorganization, so a unit may not be selectable across that boundary.
      </Text>

      {s && enabled && (
        <Text size="sm" c="dimmed">
          Between <b>{fromLabel}</b> and <b>{toLabel}</b>{scopeText}: {num(s.stayers)} stayed, {num(s.joiners)} joined,
          {' '}{num(s.leavers)} left; median raise {s.median_raise == null ? '—' : pct(s.median_raise)}.
        </Text>
      )}

      {isTTC && (
        <Alert color="accent" title="TTC reclassification boundary">
          This pair spans the Nov-2021 Title &amp; Total Compensation restructure — nearly everyone's title/job
          code changed at once. Treat "title changes" here as a structural reclassification, not promotions.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        <Stat label="Continuing" value={num(s?.stayers)} />
        <Stat label="New hires" value={num(s?.joiners)} />
        <Stat label="Departures" value={num(s?.leavers)} />
        <Stat label="Title changes" value={num(s?.title_changes)} />
        <Stat label="Median raise" value={s?.median_raise == null ? '—' : pct(s.median_raise)} />
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="sm">Payroll change decomposition</Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Stat label="Total change" value={usd(d?.total_change)} />
          <Stat label="From raises (continuing)" value={usd(d?.raises)} />
          <Stat label="From new hires" value={usd(d?.hires)} />
          <Stat label="From departures" value={usd(d?.departures)} />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="xs">Raises + new hires + departures reconcile to the total change.</Text>
        {equity && equity.top10_share != null && (
          <Text size="sm" mt="sm">
            Raise concentration: the top 10% of raised staff captured <b>{equity.top10_share}%</b> of all raise
            dollars ({num(equity.n_raised)} people got a raise).
          </Text>
        )}
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="sm">Raise distribution (% change, continuing staff)</Text>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={(raiseDist ?? []).map((r) => ({ label: `${r.pct_bucket}%`, n: r.n }))} margin={{ left: 12, right: 12 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} />
            <YAxis width={48} tick={AXIS_TICK} />
            <Tooltip formatter={(v: number) => [num(v), 'People']} />
            <Bar dataKey="n" name="People" fill="var(--bar)" />
          </BarChart>
        </ResponsiveContainer>
        <ChartData caption="Raise distribution (% change)" columns={['% bin', 'People']} rows={(raiseDist ?? []).map((r) => [`${r.pct_bucket}%`, r.n])} />
        <Text size="xs" c="dimmed">5% bins; values clamped to [−25%, +50%].</Text>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Biggest raises</Text>
          <Table><Table.Tbody>{moverRows(raises)}</Table.Tbody></Table>
        </Card>
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Biggest decreases</Text>
          <Table><Table.Tbody>{moverRows(cuts)}</Table.Tbody></Table>
        </Card>
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="sm">Title / job-code changes {isTTC ? '(reclassification)' : '(promotions & laterals)'}</Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>From → To title</Table.Th>
              <Table.Th ta="right">Pay change</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(promos ?? []).map((p) => (
              <Table.Tr key={p.person_key}>
                <Table.Td>
                  <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`}>{fullName(p.fn, p.ln)}</Anchor>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.a_title ?? '—'} → {p.b_title ?? '—'}</Text>
                </Table.Td>
                <Table.Td ta="right" c={(p.delta ?? 0) >= 0 ? 'pos' : 'red'}>
                  {p.delta == null ? '—' : `${p.delta >= 0 ? '+' : ''}${usd(p.delta)}`}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {(flows ?? []).length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Top title transitions (flows)</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>From → To title</Table.Th>
                <Table.Th ta="right">People</Table.Th>
                <Table.Th ta="right">Median pay Δ</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(flows ?? []).map((f, i) => (
                <Table.Tr key={i}>
                  <Table.Td><Text size="sm">{f.a_title ?? '—'} → {f.b_title ?? '—'}</Text></Table.Td>
                  <Table.Td ta="right">{num(f.n)}</Table.Td>
                  <Table.Td ta="right" c={(f.med_delta ?? 0) >= 0 ? 'pos' : 'red'}>
                    {f.med_delta == null ? '—' : `${f.med_delta >= 0 ? '+' : ''}${usd(f.med_delta)}`}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <ChartData caption="Title transitions" columns={['From', 'To', 'People', 'Median pay change']} rows={(flows ?? []).map((f) => [f.a_title, f.b_title, f.n, f.med_delta])} />
        </Card>
      )}

      {(mobility ?? []).length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Internal moves (changed school)</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th>From → To school</Table.Th>
                <Table.Th ta="right">Pay change</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(mobility ?? []).map((m) => (
                <Table.Tr key={m.person_key}>
                  <Table.Td>
                    <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{fullName(m.fn, m.ln)}</Anchor>
                  </Table.Td>
                  <Table.Td><Text size="sm">{m.a_school ?? '—'} → {m.b_school ?? '—'}</Text></Table.Td>
                  <Table.Td ta="right" c={(m.delta ?? 0) >= 0 ? 'pos' : 'red'}>
                    {m.delta == null ? '—' : `${m.delta >= 0 ? '+' : ''}${usd(m.delta)}`}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
