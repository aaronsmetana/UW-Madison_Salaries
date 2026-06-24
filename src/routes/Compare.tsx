import { useMemo, useState } from 'react';
import { Stack, Title, Text, Card, Table, Loader, SegmentedControl, Group, Select, Pill, Button, SimpleGrid, ThemeIcon, Paper } from '@mantine/core';
import { IconUser, IconBriefcase, IconBuildingBank, IconArrowsDiff } from '@tabler/icons-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter,
} from 'recharts';
import { AXIS_TICK, GRID, Y_PAD } from '../lib/chartStyle';
import { PageHeader } from '../components/PageHeader';
import { useTray } from '../state/tray';
import { useControls } from '../state/controls';
import { useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay, paidHeadcount } from '../lib/queries';
import { usd, num, pct } from '../lib/format';
import { ChartData } from '../components/ChartData';
import { SearchBox } from '../components/SearchBox';
import { ControlBar } from '../app/ControlBar';
import { dropdownProps } from '../lib/selectProps';

const PALETTE = [
  'var(--mantine-color-accent-6)', 'var(--mantine-color-pos-6)', 'var(--mantine-color-orange-6)',
  'var(--mantine-color-grape-6)', 'var(--mantine-color-cyan-7)', 'var(--mantine-color-red-6)',
  'var(--mantine-color-lime-7)', 'var(--mantine-color-pink-6)',
];

interface PRow { person_key: string; label: string; date: string; pay: number; tenure: number | null }
interface SRow { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface TStatRow { job_code: string; headcount: number; med: number | null; p25: number | null; p75: number | null; p90: number | null }
interface TTrendRow { job_code: string; label: string; date: string; med: number }

export default function Compare() {
  const { items, add, remove, clear } = useTray();
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const [xMode, setXMode] = useState<'date' | 'tenure'>('date');

  const persons = items.filter((i) => i.type === 'person');
  const schools = items.filter((i) => i.type === 'school');
  const titles = items.filter((i) => i.type === 'title');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');
  const titleCodes = titles.map((t) => sqlStr(t.id)).join(',');

  // ── option lists for the in-page pickers ──────────────────────────────────
  const { data: schoolOpts } = useSql<{ school: string }>(
    ['cmp-school-opts', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );
  const { data: titleOpts } = useSql<{ job_code: string; title: string; n: number }>(
    ['cmp-title-opts', snap ?? '', metric],
    `SELECT job_code, arg_max(title, salary) title, ${paidHeadcount(metric)} n
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IS NOT NULL
     GROUP BY job_code ORDER BY n DESC`,
    !!snap
  );

  const { data: pdata, isFetching: pLoading } = useSql<PRow>(
    ['cmp-people', personIds, metric],
    `SELECT person_key, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    persons.length > 0
  );

  const { data: sdata, isFetching: sLoading } = useSql<SRow>(
    ['cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, ${paidHeadcount(metric)} headcount,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames}) GROUP BY school`,
    schools.length > 0 && !!snap
  );

  // Titles — side-by-side (current snapshot), per-person salary sums within each title.
  const { data: tdata, isFetching: tLoading } = useSql<TStatRow>(
    ['cmp-titles', titleCodes, snap ?? '', metric],
    `WITH pp AS (SELECT person_key, job_code, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IN (${titleCodes}) GROUP BY person_key, job_code)
     SELECT job_code, count(*) headcount, median(pay) med,
        quantile_cont(pay, 0.25) p25, quantile_cont(pay, 0.75) p75, quantile_cont(pay, 0.90) p90
     FROM pp WHERE pay > 0 GROUP BY job_code`,
    titles.length > 0 && !!snap
  );

  // Titles — median salary over time.
  const { data: ttrend } = useSql<TTrendRow>(
    ['cmp-title-trend', titleCodes, metric],
    `WITH pp AS (SELECT snapshot_id, job_code, person_key,
          any_value(snapshot_label) AS lbl, any_value(snapshot_date) AS dt, ${personPay(metric)} pay
        FROM salaries WHERE job_code IN (${titleCodes}) AND ${expr} > 0
        GROUP BY snapshot_id, job_code, person_key)
     SELECT job_code, any_value(lbl) AS "label", any_value(dt) date, median(pay) med
     FROM pp GROUP BY snapshot_id, job_code ORDER BY date`,
    titles.length > 0
  );

  const { data: standingData } = useSql<{ person_key: string; label: string; date: string; pctile: number }>(
    ['cmp-standing', personIds, metric],
    `WITH pop AS (SELECT snapshot_id, any_value(snapshot_label) AS "label", any_value(snapshot_date) date, school, person_key, ${personPay(metric)} pay
                  FROM salaries WHERE ${expr} > 0 GROUP BY snapshot_id, school, person_key),
          ranked AS (SELECT *, percent_rank() OVER (PARTITION BY snapshot_id, school ORDER BY pay) pr FROM pop)
     SELECT person_key, label, date, round(pr * 100) pctile FROM ranked WHERE person_key IN (${personIds}) ORDER BY date`,
    persons.length > 0
  );

  const labelMap = useMemo(() => new Map(persons.map((p) => [p.id, p.label])), [persons]);
  const titleLabelMap = useMemo(() => new Map(titles.map((t) => [t.id, t.label])), [titles]);

  const standingSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of standingData ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pctile;
      byLabel.set(r.label, row);
    }
    return [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [standingData]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { label: string; date: string; pay: number; tenure: number | null }[]>();
    for (const r of pdata ?? []) {
      const arr = m.get(r.person_key) ?? [];
      arr.push({ label: r.label, date: r.date, pay: r.pay, tenure: r.tenure });
      m.set(r.person_key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return m;
  }, [pdata]);

  const { series, latest } = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    const latestByPerson = new Map<string, number>();
    for (const r of pdata ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.person_key] = r.pay;
      byLabel.set(r.label, row);
      latestByPerson.set(r.person_key, r.pay);
    }
    const series = [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { series, latest: latestByPerson };
  }, [pdata]);

  // Title median-over-time pivot: { label, date, [job_code]: med }.
  const titleSeries = useMemo(() => {
    const byLabel = new Map<string, Record<string, string | number>>();
    for (const r of ttrend ?? []) {
      const row = byLabel.get(r.label) ?? { label: r.label, date: r.date };
      row[r.job_code] = r.med;
      byLabel.set(r.label, row);
    }
    return [...byLabel.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [ttrend]);

  // gap to the top earner in the group, per snapshot
  const gapSeries = useMemo(
    () =>
      series.map((row) => {
        const o: Record<string, string | number> = { label: row.label as string };
        const vals = persons.map((p) => row[p.id]).filter((v): v is number => typeof v === 'number');
        const max = vals.length ? Math.max(...vals) : null;
        if (max != null) persons.forEach((p) => { const v = row[p.id]; if (typeof v === 'number') o[p.id] = v - max; });
        return o;
      }),
    [series, persons]
  );

  const cadence = useMemo(
    () =>
      persons.map((p) => {
        const arr = (perPerson.get(p.id) ?? []).filter((x) => x.pay > 0);
        let raises = 0;
        let sumPct = 0;
        let streak = 0;
        let longest = 0;
        for (let i = 1; i < arr.length; i++) {
          const delta = arr[i].pay - arr[i - 1].pay;
          if (delta > 0) {
            raises++;
            sumPct += delta / arr[i - 1].pay;
            streak = 0;
          } else {
            streak++;
            longest = Math.max(longest, streak);
          }
        }
        return { id: p.id, label: p.label, raises, avgPct: raises ? sumPct / raises : null, longest, periods: Math.max(0, arr.length - 1) };
      }),
    [perPerson, persons]
  );

  const titleSelectData = (titleOpts ?? []).map((t) => ({ value: t.job_code, label: `${t.title} (${t.job_code} · ${num(t.n)})` }));

  return (
    <Stack gap="lg">
      <PageHeader
        title="Compare People, Titles & Schools"
        description="Search and add anyone, any title, or any school, then compare salaries side by side. Selections are saved (your tray) so you can keep building across pages."
      />

      <ControlBar inline />

      {/* ── Build your comparison: three labeled add blocks ── */}
      <Card withBorder padding="lg">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconUser size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add person</Text></Group>
            <SearchBox placeholder="Search a person by name…" size="md" onPick={(h) => add({ type: 'person', id: h.person_key, label: h.name })} />
          </Paper>
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconBriefcase size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add title</Text></Group>
            <Select
              {...dropdownProps('md')}
              placeholder="Search a title…"
              data={titleSelectData}
              value={null}
              onChange={(v) => {
                if (!v) return;
                const t = titleOpts?.find((x) => x.job_code === v);
                add({ type: 'title', id: v, label: t?.title ?? v });
              }}
              searchable
              nothingFoundMessage="No matching title"
            />
          </Paper>
          <Paper p="sm" radius="md" withBorder shadow="xs">
            <Group gap={6} mb={8}><IconBuildingBank size={15} /><Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.05em' }}>Add school / division</Text></Group>
            <Select
              {...dropdownProps('md')}
              placeholder="Search a school…"
              data={(schoolOpts ?? []).map((s) => s.school)}
              value={null}
              onChange={(v) => v && add({ type: 'school', id: v, label: v })}
              searchable
              nothingFoundMessage="No matching school"
            />
          </Paper>
        </SimpleGrid>

        {items.length > 0 && (
          <>
            <SelectedRow label="People" items={persons} onRemove={remove} colored />
            <SelectedRow label="Titles" items={titles} onRemove={remove} colored />
            <SelectedRow label="Schools" items={schools} onRemove={remove} />
            {(persons.length > 0 || titles.length > 0) && (
              <Text size="xs" c="dimmed" mt={6}>The colored dots are the key for the charts below.</Text>
            )}
            <Group justify="flex-end" mt="sm">
              <Button size="xs" variant="subtle" color="gray" onClick={clear}>Clear all</Button>
            </Group>
          </>
        )}
      </Card>

      {items.length === 0 && (
        <Card withBorder padding="xl">
          <Stack align="center" gap="sm" py={48}>
            <ThemeIcon size={64} radius="xl" variant="light" color="accent">
              <IconArrowsDiff size={32} />
            </ThemeIcon>
            <Title order={3} ta="center">Build a side-by-side comparison</Title>
            <Text c="dimmed" ta="center" maw={480}>
              Add people, titles, or schools using the search boxes above — or the ＋ Compare buttons around the app — and they’ll line up here with charts and tables.
            </Text>
          </Stack>
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Group justify="space-between" mb="md">
            <Text size="sm" fw={600}>People — salary trajectory</Text>
            <SegmentedControl
              size="xs"
              value={xMode}
              onChange={(v) => setXMode(v as 'date' | 'tenure')}
              data={[{ value: 'date', label: 'By date' }, { value: 'tenure', label: 'By tenure' }]}
            />
          </Group>
          {pLoading ? (
            <Loader />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={300}>
                {xMode === 'date' ? (
                  <LineChart data={series} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" tick={AXIS_TICK} />
                    <YAxis tickFormatter={(v) => usd(v)} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip formatter={(v: number, key) => [usd(v), labelMap.get(String(key)) ?? key]} />
                    {persons.map((p, i) => (
                      <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
                    ))}
                  </LineChart>
                ) : (
                  <ScatterChart margin={{ left: 12, right: 12 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="tenure" name="Tenure" unit="y" tick={AXIS_TICK} />
                    <YAxis type="number" dataKey="pay" tickFormatter={(v) => usd(v)} width={80} tick={AXIS_TICK} padding={Y_PAD} />
                    <Tooltip formatter={(v: number, k) => (k === 'pay' ? usd(v) : `${Number(v).toFixed(1)} yrs`)} />
                    {persons.map((p, i) => (
                      <Scatter
                        key={p.id}
                        name={p.label}
                        data={(perPerson.get(p.id) ?? []).filter((x) => x.tenure != null && x.pay > 0).map((x) => ({ tenure: x.tenure, pay: x.pay }))}
                        line
                        fill={PALETTE[i % PALETTE.length]}
                      />
                    ))}
                  </ScatterChart>
                )}
              </ResponsiveContainer>
              <ChartData
                caption="Salary by snapshot"
                columns={['Snapshot', ...persons.map((p) => p.label)]}
                rows={series.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
              />
              <Text size="xs" c="dimmed" mt={4}>
                {xMode === 'tenure' ? 'Aligned by years since hire — compares people at the same career stage.' : 'By calendar snapshot.'}
              </Text>
            </>
          )}
        </Card>
      )}

      {persons.length > 1 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Pay gap to the top earner in this group</Text>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={gapSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tickFormatter={(v) => usd(v)} width={80} tick={AXIS_TICK} padding={Y_PAD} />
              <Tooltip formatter={(v: number, key) => [usd(v), labelMap.get(String(key)) ?? key]} />
              {persons.map((p, i) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Pay gap to the top earner by snapshot"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={gapSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">0 = highest-paid in the group at that snapshot; below 0 = behind by that amount.</Text>
        </Card>
      )}

      {persons.length > 0 && standingSeries.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Relative standing within school (percentile over time)</Text>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={standingSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis domain={[0, 100]} width={48} tick={AXIS_TICK} unit="%" padding={Y_PAD} />
              <Tooltip formatter={(v: number, key) => [`${v}th pctile`, labelMap.get(String(key)) ?? key]} />
              {persons.map((p, i) => (
                <Line key={p.id} type="monotone" dataKey={p.id} name={p.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Percentile within school over time"
            columns={['Snapshot', ...persons.map((p) => p.label)]}
            rows={standingSeries.map((row) => [row.label as string, ...persons.map((p) => row[p.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">Each person's percentile among peers in their own school at that snapshot.</Text>
        </Card>
      )}

      {persons.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Raise cadence &amp; stagnation</Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th ta="right">Latest</Table.Th>
                <Table.Th ta="right">Raises</Table.Th>
                <Table.Th ta="right">Avg raise</Table.Th>
                <Table.Th ta="right">Longest no-raise streak</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cadence.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.label}</Table.Td>
                  <Table.Td ta="right">{usd(latest.get(c.id) ?? null)}</Table.Td>
                  <Table.Td ta="right">{c.raises} / {c.periods}</Table.Td>
                  <Table.Td ta="right">{c.avgPct == null ? '—' : pct(c.avgPct)}</Table.Td>
                  <Table.Td ta="right">{c.longest} {c.longest === 1 ? 'period' : 'periods'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {titles.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Titles — side-by-side (current snapshot)</Text>
          {tLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Title</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right">25th</Table.Th>
                  <Table.Th ta="right">75th</Table.Th>
                  <Table.Th ta="right">90th</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(tdata ?? []).map((t) => (
                  <Table.Tr key={t.job_code}>
                    <Table.Td>{titleLabelMap.get(t.job_code) ?? t.job_code}</Table.Td>
                    <Table.Td ta="right">{num(t.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(t.med)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p25)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p75)}</Table.Td>
                    <Table.Td ta="right">{usd(t.p90)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}

      {titles.length > 0 && titleSeries.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Titles — median salary over time</Text>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={titleSeries} margin={{ left: 12, right: 12 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS_TICK} />
              <YAxis tickFormatter={(v) => usd(v)} width={80} tick={AXIS_TICK} padding={Y_PAD} />
              <Tooltip formatter={(v: number, key) => [usd(v), titleLabelMap.get(String(key)) ?? key]} />
              {titles.map((t, i) => (
                <Line key={t.id} type="monotone" dataKey={t.id} name={t.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ChartData
            caption="Median salary per title over time"
            columns={['Snapshot', ...titles.map((t) => t.label)]}
            rows={titleSeries.map((row) => [row.label as string, ...titles.map((t) => row[t.id] ?? null)])}
          />
          <Text size="xs" c="dimmed">Median salary per title at each snapshot.</Text>
        </Card>
      )}

      {schools.length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="md">Schools — side-by-side (current snapshot)</Text>
          {sLoading ? (
            <Loader />
          ) : (
            <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">Headcount</Table.Th>
                  <Table.Th ta="right">Median</Table.Th>
                  <Table.Th ta="right">90th pctile</Table.Th>
                  <Table.Th ta="right">Total payroll</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(sdata ?? []).map((s) => (
                  <Table.Tr key={s.school}>
                    <Table.Td>{s.school}</Table.Td>
                    <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                    <Table.Td ta="right">{usd(s.med)}</Table.Td>
                    <Table.Td ta="right">{usd(s.p90)}</Table.Td>
                    <Table.Td ta="right">{usd(s.payroll)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </Table.ScrollContainer>
          )}
        </Card>
      )}
    </Stack>
  );
}

/**
 * A removable-pill row for one selection type; renders nothing when empty.
 * When `colored`, each pill shows its persistent chart color (matching the line
 * colors below, by position) so the tags double as the charts' legend.
 */
function SelectedRow({ label, items, onRemove, colored = false }: { label: string; items: { type: string; id: string; label: string }[]; onRemove: (id: string) => void; colored?: boolean }) {
  if (items.length === 0) return null;
  return (
    <Group gap="xs" mt="sm" wrap="wrap">
      <Text size="xs" c="dimmed" w={56}>{label}</Text>
      {items.map((i, idx) => (
        <Pill key={`${i.type}:${i.id}`} withRemoveButton onRemove={() => onRemove(i.id)}>
          {colored && (
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: PALETTE[idx % PALETTE.length],
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            />
          )}
          {i.label}
        </Pill>
      ))}
    </Group>
  );
}
