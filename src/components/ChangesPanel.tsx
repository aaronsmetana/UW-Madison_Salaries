import { useEffect, useMemo, useState } from 'react';
import { Stack, Card, Text, Group, Select, SimpleGrid, Table, Alert, Anchor, Button, Paper } from '@mantine/core';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { AXIS_TICK, GRID } from '../lib/chartStyle';
import { IconDownload } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useControls } from '../state/controls';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay, whereAll, filterKey } from '../lib/queries';
import { usd, num, pct, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { dropdownProps } from '../lib/selectProps';
import { ChartData } from './ChartData';
import { StatCard } from './StatCard';

interface Mover { person_key: string; fn: string; ln: string; title: string | null; school: string | null; a_pay: number; b_pay: number; delta: number; pct: number }
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
     SELECT b.person_key, b.fn, b.ln, b.title, b.school, a.pay a_pay, b.pay b_pay, (b.pay - a.pay) delta, (b.pay - a.pay) / a.pay pct
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

  // Net headcount flow per division: who hired more than they lost (and vice versa) over the window.
  const { data: netFlows } = useSql<{ school: string; joined: number; departed: number }>(
    ['chg-netflows', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT coalesce(a.school, b.school) school,
        count(*) FILTER (WHERE a.person_key IS NULL) joined,
        count(*) FILTER (WHERE b.person_key IS NULL) departed
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key
     WHERE coalesce(a.school, b.school) IS NOT NULL
     GROUP BY coalesce(a.school, b.school)
     HAVING count(*) FILTER (WHERE a.person_key IS NULL) + count(*) FILTER (WHERE b.person_key IS NULL) > 0`,
    enabled
  );
  const netTop = useMemo(() => {
    const rows = (netFlows ?? []).map((r) => ({ ...r, net: r.joined - r.departed }));
    const gainers = [...rows].sort((a, b) => b.net - a.net).slice(0, 6);
    const losers = [...rows].sort((a, b) => a.net - b.net).slice(0, 6).filter((r) => r.net < 0);
    return { gainers, losers };
  }, [netFlows]);

  const isTTC = !!fromId && !!toId && fromId.includes('pre') && toId.includes('post');
  const opts = [...snaps].reverse().map((x) => ({ value: x.id, label: x.label }));
  const fromLabel = snaps.find((x) => x.id === fromId)?.label ?? '—';
  const toLabel = snaps.find((x) => x.id === toId)?.label ?? '—';
  const scopeText = filterDept ? ` in ${filterDept}` : filterSchool ? ` in ${filterSchool}` : '';

  // Quick snapshot-pair presets.
  const setPair = (a: string, b: string) => { setFromId(a); setToId(b); setFilterSchool(null); setFilterDept(null); };
  const presetLatest = () => { if (snaps.length >= 2) setPair(snaps[snaps.length - 2].id, snaps[snaps.length - 1].id); };
  const presetYoY = () => {
    const last = snaps[snaps.length - 1];
    if (!last) return;
    const target = new Date(last.date); target.setFullYear(target.getFullYear() - 1);
    const prior = [...snaps].filter((x) => new Date(x.date) <= target).at(-1) ?? snaps[0];
    setPair(prior.id, last.id);
  };
  const presetTTC = () => {
    const post = snaps.find((x) => x.id.endsWith('-post')) ?? snaps[0];
    const last = snaps[snaps.length - 1];
    if (post && last) setPair(post.id, last.id);
  };

  // Waterfall steps: net payroll change = raises + new hires − departures.
  const waterfall = useMemo(() => {
    if (!d) return [];
    const r = d.raises, h = d.hires, dep = d.departures, tot = d.total_change;
    const s2 = r + h;
    const step = (name: string, base: number, amount: number, kind: 'pos' | 'red' | 'net') => ({ name, base, bar: Math.abs(amount), amount, kind });
    return [
      step('Raises', Math.min(0, r), r, r >= 0 ? 'pos' : 'red'),
      step('New hires', Math.min(r, s2), h, h >= 0 ? 'pos' : 'red'),
      step('Departures', Math.min(s2, tot), dep, 'red'),
      step('Net change', Math.min(0, tot), tot, 'net'),
    ];
  }, [d]);
  const wfColor = (kind: string, amount: number) =>
    kind === 'net' ? (amount >= 0 ? 'var(--mantine-color-accent-6)' : 'var(--mantine-color-red-6)')
      : kind === 'pos' ? 'var(--mantine-color-pos-6)' : 'var(--mantine-color-red-5)';

  // Share of continuing staff who got any raise, and the bucket the median raise lands in (histogram marker).
  const raisedPct = equity?.n_raised != null && s?.stayers ? equity.n_raised / s.stayers : null;
  const medBucketLabel = s?.median_raise != null
    ? `${Math.floor(Math.max(-0.25, Math.min(0.5, s.median_raise)) * 100 / 5) * 5}%`
    : null;

  const exportMovers = () =>
    downloadCSV(`uw-pay-changes-${fromId}-to-${toId}.csv`, [...(raises ?? []), ...(cuts ?? [])].map((m) => ({
      name: fullName(m.fn, m.ln), title: m.title ?? '', school: m.school ?? '',
      from_pay: Math.round(m.a_pay), to_pay: Math.round(m.b_pay), change: Math.round(m.delta), pct: `${(m.pct * 100).toFixed(1)}%`,
    })));
  const exportFlows = () =>
    downloadCSV(`uw-title-flows-${fromId}-to-${toId}.csv`, (flows ?? []).map((f) => ({
      from_title: f.a_title ?? '', to_title: f.b_title ?? '', people: f.n, median_pay_change: f.med_delta ?? '',
    })));

  const moverRows = (rows?: Mover[]) =>
    (rows ?? []).map((m) => (
      <Table.Tr key={m.person_key}>
        <Table.Td>
          <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{fullName(m.fn, m.ln)}</Anchor>
          <Text size="xs" c="dimmed" lineClamp={1}>{[m.title, m.school].filter(Boolean).join(' · ')}</Text>
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
      <Group gap="xs" wrap="wrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.03em' }}>Quick range</Text>
        <Button size="compact-xs" variant="default" onClick={presetLatest}>Latest pair</Button>
        <Button size="compact-xs" variant="default" onClick={presetYoY}>Year over year</Button>
        <Button size="compact-xs" variant="default" onClick={presetTTC}>Since TTC</Button>
      </Group>

      <Text size="xs" c="dimmed">
        Division/department filters list only units present in both snapshots; some were renamed or split
        in the 2025 reorganization, so a unit may not be selectable across that boundary.
      </Text>

      {s && enabled && (
        <Text size="sm" c="dimmed">
          Between <b>{fromLabel}</b> and <b>{toLabel}</b>{scopeText}: ≈{num(s.stayers)} stayed, ≈{num(s.joiners)} joined,
          {' '}≈{num(s.leavers)} left (left = not present in {toLabel}); median raise {s.median_raise == null ? '—' : pct(s.median_raise)}
          {raisedPct != null ? ` — but ${pct(raisedPct)} of continuing staff got some raise` : ''}.
        </Text>
      )}

      <Alert color="gray" title="People are matched by name only">
        UW's public records carry no employee ID, so a person is tracked across snapshots by first + last name.
        Anyone who changed their name appears as both a departure and a new hire, and two distinct people who
        share a name are merged — so joined/left counts are approximate (hence the ≈). A median raise of 0%
        means the typical continuing employee's pay was unchanged between these two snapshots, not that nobody
        got a raise.
      </Alert>

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
        {waterfall.length > 0 && (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={waterfall} margin={{ left: 12, right: 12, top: 8 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis width={64} tickFormatter={(v) => usd(v)} tick={AXIS_TICK} />
              <Tooltip
                cursor={{ fill: 'var(--mantine-color-default-hover)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const w = payload[0].payload as { name: string; amount: number };
                  return (
                    <Paper withBorder shadow="sm" p="xs">
                      <Text size="sm" fw={600}>{w.name}</Text>
                      <Text size="sm" c={w.amount >= 0 ? 'pos' : 'red'}>{w.amount >= 0 ? '+' : ''}{usd(w.amount)}</Text>
                    </Paper>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="var(--mantine-color-default-border)" />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="bar" stackId="w" isAnimationActive={false}>
                {waterfall.map((w, i) => <Cell key={i} fill={wfColor(w.kind, w.amount)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card withBorder padding="lg">
        <Text size="sm" fw={600} mb="sm">Raise distribution (% change, continuing staff)</Text>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={(raiseDist ?? []).map((r) => ({ label: `${r.pct_bucket}%`, n: r.n }))} margin={{ left: 12, right: 12, top: 8 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} />
            <YAxis width={48} tick={AXIS_TICK} />
            <Tooltip formatter={(v: number) => [num(v), 'People']} cursor={{ fill: 'var(--mantine-color-default-hover)' }} />
            {medBucketLabel && (
              <ReferenceLine x={medBucketLabel} stroke="var(--mantine-color-accent-6)" strokeDasharray="3 3"
                label={{ value: 'median', position: 'top', fontSize: 10, fill: 'var(--mantine-color-accent-7)' }} />
            )}
            <Bar dataKey="n" name="People">
              {(raiseDist ?? []).map((r, i) => (
                <Cell key={i} fill={r.pct_bucket < 0 ? 'var(--mantine-color-red-5)' : r.pct_bucket === 0 ? 'var(--mantine-color-gray-4)' : 'var(--mantine-color-pos-5)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ChartData caption="Raise distribution (% change)" columns={['% bin', 'People']} rows={(raiseDist ?? []).map((r) => [`${r.pct_bucket}%`, r.n])} />
        <Text size="xs" c="dimmed">5% bins; values clamped to [−25%, +50%]. Green = raise, red = cut, grey = no change; the dashed line marks the median.</Text>
      </Card>

      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm" fw={600}>Biggest pay changes (continuing staff)</Text>
          <Button size="compact-xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportMovers} disabled={!(raises ?? []).length}>
            CSV
          </Button>
        </Group>
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
      </Stack>

      {(netTop.gainers.length > 0 || netTop.losers.length > 0) && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="sm">Net headcount flow by division</Text>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <div>
              <Text size="xs" c="pos" fw={700} tt="uppercase" mb={4}>Net gainers</Text>
              <Table>
                <Table.Tbody>
                  {netTop.gainers.map((r) => (
                    <Table.Tr key={r.school}>
                      <Table.Td><Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`}>{r.school}</Anchor></Table.Td>
                      <Table.Td ta="right" c="dimmed">+{num(r.joined)} / −{num(r.departed)}</Table.Td>
                      <Table.Td ta="right" c={r.net >= 0 ? 'pos' : 'red'} fw={600}>{r.net >= 0 ? '+' : ''}{num(r.net)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            <div>
              <Text size="xs" c="red" fw={700} tt="uppercase" mb={4}>Net losers</Text>
              <Table>
                <Table.Tbody>
                  {netTop.losers.map((r) => (
                    <Table.Tr key={r.school}>
                      <Table.Td><Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`}>{r.school}</Anchor></Table.Td>
                      <Table.Td ta="right" c="dimmed">+{num(r.joined)} / −{num(r.departed)}</Table.Td>
                      <Table.Td ta="right" c="red" fw={600}>{num(r.net)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="xs">Net = paid staff who joined the division minus those who left it (same name-matching caveat applies).</Text>
        </Card>
      )}

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
          <Group justify="space-between" mb="sm">
            <Text size="sm" fw={600}>Top title transitions (flows)</Text>
            <Button size="compact-xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportFlows} disabled={!(flows ?? []).length}>
              CSV
            </Button>
          </Group>
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
