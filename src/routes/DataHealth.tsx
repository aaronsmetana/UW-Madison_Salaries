import { Stack, Title, Text, Table, Badge, Loader, Alert, Group, Code, Anchor, Card, List } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useManifest, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import type { SnapshotInfo } from '../lib/manifest';

const STATUS_COLOR: Record<string, string> = { ok: 'green', warning: 'yellow', error: 'red', info: 'gray' };

export default function DataHealth() {
  const { data: manifest, isLoading, error } = useManifest();
  const snapId = useActiveSnapshotId();
  const { data: dups } = useSql<{ first_name: string; last_name: string; keys: number }>(
    ['id-review', snapId ?? ''],
    `SELECT first_name, last_name, count(DISTINCT person_key) keys
     FROM salaries WHERE snapshot_id = ${sqlStr(snapId ?? '')} AND first_name IS NOT NULL AND last_name IS NOT NULL
     GROUP BY first_name, last_name HAVING count(DISTINCT person_key) > 1 ORDER BY keys DESC, last_name LIMIT 30`,
    !!snapId
  );

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">Failed to load manifest: {(error as Error).message}</Alert>;

  const snaps = (manifest?.snapshots ?? []).filter((s) => s.row_count) as SnapshotInfo[];
  const dict = (manifest?.snapshots ?? []).find((s) => 'data_dictionary_url' in (s as object)) as
    | (SnapshotInfo & { data_dictionary_url?: string })
    | undefined;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Data · About"
        description="Per-snapshot ingestion health, detected column mappings, and source provenance. Salary data is a Wisconsin public record obtained via union open-records requests. Every figure is a point-in-time, best-effort transcription — treat it as approximate and verify against official sources."
      />

      <Card withBorder padding="lg">
        <Title order={4} mb="xs">Data source &amp; acknowledgment</Title>
        <Text size="sm">
          The UW–Madison salary report files presented here are public records, obtained through Wisconsin
          open-records requests filed by{' '}
          <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" fw={600}>United Faculty &amp; Academic Staff (UFAS)</Anchor>
          {' '}— <b>AFT Local 223, AFL-CIO</b>, the union representing UW–Madison faculty and academic staff.
          UFAS advocates for the pay, working conditions, and rights of campus faculty and academic staff;
          their open-records work is what makes this transparency possible.
        </Text>
        <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" size="sm" fw={600} mt="sm" display="inline-block">
          Visit UFAS Local 223 →
        </Anchor>
      </Card>

      <Alert
        color="orange"
        variant="light"
        radius="md"
        icon={<IconAlertTriangle size={20} />}
        title="Accuracy & disclaimer — these numbers may not reflect reality"
        id="disclaimer"
      >
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Every figure here is a point-in-time, gross, best-effort transcription of a public spreadsheet —
            treat all of it as approximate, not as a person's verified pay.
          </Text>
          <Text size="sm">A number can be wrong or misleading for many reasons. For example:</Text>
          <List size="sm" spacing={4}>
            <List.Item><b>Part-time staff</b> — the "Full-time rate" view is the annual rate, which is <i>more</i> than a half-time person actually earned.</List.Item>
            <List.Item><b>Multiple appointments</b> — a person's pay is blended across roles, so a split or joint appointment may not read as you'd expect.</List.Item>
            <List.Item><b>Bonuses &amp; deferred pay</b> — coaches, executives, and others may receive supplemental, overload, deferred, or one-time compensation that isn't in these reports.</List.Item>
            <List.Item><b>Changes between snapshots</b> — raises, promotions, leaves, or appointment changes that happen between two reports aren't captured, so true earnings can be higher or lower than any single number shown.</List.Item>
            <List.Item><b>Gross, not take-home</b> — amounts are gross annualized figures and exclude benefits, taxes, and retirement.</List.Item>
            <List.Item><b>Nominal dollars</b> — figures are not inflation-adjusted, so cross-year comparisons overstate real growth.</List.Item>
            <List.Item><b>Nov 2021 (TTC)</b> — nearly every title, job code, and grade changed at once in a structural reclassification; those are relabels, not promotions or raises.</List.Item>
            <List.Item><b>Oct 2023 scope change</b> — some reports excluded students/trainees, so headcount and joiner/leaver counts across that point partly reflect coverage, not real hiring or attrition.</List.Item>
            <List.Item><b>Column mapping</b> — columns are auto-detected from each spreadsheet; a mis-mapped column can attach the wrong value to a field.</List.Item>
            <List.Item><b>Identity matching</b> — people are matched by name + hire date with <b>no employee ID</b>, so two different people can be merged into one, or one person split into two — meaning a salary can be attributed to the <b>wrong named person</b>.</List.Item>
            <List.Item><b>Name formatting &amp; transcription</b> — ALL-CAPS source names are auto-cased and can be mangled; values are read from published spreadsheets and may carry source or ingestion errors.</List.Item>
          </List>
          <Text size="sm" c="dimmed" mt={4}>
            This is an <b>independent, best-effort project</b> and is <b>not affiliated with or endorsed by
            UW–Madison</b>. Salary data is a Wisconsin public record. The information is provided "as is," may be
            inaccurate or incomplete, and carries <b>no warranty and no liability</b> — verify against official
            UW–Madison or State of Wisconsin sources before relying on it for any decision.
          </Text>
        </Stack>
      </Alert>

      <Card withBorder padding="lg" id="how-it-works">
        <Title order={4} mb="xs">How these figures are calculated</Title>
        <Stack gap="sm">
          <Text size="sm">
            Each source row is one <b>appointment</b>, carrying a full-time annual <b>rate</b> and an{' '}
            <b>FTE</b> (appointment percentage — e.g. 0.5 = half-time). The "Pay" control switches between three views:
          </Text>
          <Stack gap={4} pl="md">
            <Text size="sm"><b>Actual pay</b> — rate × FTE (the reported FTE-adjusted salary); closest to what the person was actually paid.</Text>
            <Text size="sm"><b>Full-time rate</b> — the listed annual rate. For part-time staff this is <i>more</i> than they actually earned.</Text>
            <Text size="sm"><b>Base pay</b> — base salary as reported; may exclude supplemental or overload pay.</Text>
          </Stack>
          <Text size="sm">
            A person holding <b>more than one paid appointment</b> is combined by summing each appointment's
            actual (rate × FTE) earnings, so split roles aren't double-counted. Unpaid <b>$0</b> affiliate
            appointments are excluded from headcount, medians, and totals.
          </Text>

          <Text size="sm" fw={700} mt="xs">A snapshot in time</Text>
          <Text size="sm">
            Every figure reflects a single periodic report. Pay, FTE, title, and grade change between
            snapshots, and raises or appointment changes that happen between reports aren't captured — so a
            person's true earnings can be higher or lower than any single number shown here. Amounts are gross
            annualized figures (not take-home) and exclude benefits. See the accuracy &amp; disclaimer callout
            above for the full list of caveats.
          </Text>
        </Stack>
      </Card>

      <Group gap="xl">
        <Text size="sm"><b>{num(manifest?.total_rows)}</b> records</Text>
        <Text size="sm"><b>{num(snaps.length)}</b> snapshots</Text>
        <Text size="sm">schema v{manifest?.schema_version}</Text>
        <Text size="sm" c="dimmed">built {manifest?.generated_at?.slice(0, 16).replace('T', ' ')}</Text>
        {dict?.data_dictionary_url && (
          <Anchor href={dict.data_dictionary_url} target="_blank" rel="noopener noreferrer" size="sm">
            Source data dictionary →
          </Anchor>
        )}
      </Group>

      <Table.ScrollContainer minWidth={760}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Snapshot</Table.Th>
            <Table.Th>Source (file · sheet)</Table.Th>
            <Table.Th ta="right">Rows</Table.Th>
            <Table.Th ta="right">People</Table.Th>
            <Table.Th ta="right">Paid</Table.Th>
            <Table.Th ta="right">Unpaid $0</Table.Th>
            <Table.Th ta="right">Median</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {snaps.map((s) => (
            <Table.Tr key={s.snapshot_id}>
              <Table.Td>
                <Text size="sm" fw={500}>{s.snapshot_label}</Text>
                <Code>{s.snapshot_id}</Code>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{s.source_file}</Text>
                <Text size="xs" c="dimmed">{s.source_sheet}</Text>
              </Table.Td>
              <Table.Td ta="right">{num(s.row_count)}</Table.Td>
              <Table.Td ta="right">{num(s.distinct_people)}</Table.Td>
              <Table.Td ta="right">{s.distinct_people_paid != null ? num(s.distinct_people_paid) : '—'}</Table.Td>
              <Table.Td ta="right">{num(s.zero_or_null_salary)}</Table.Td>
              <Table.Td ta="right">{usd(s.salary_median)}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[s.status] ?? 'gray'} variant="filled" radius="sm">
                  {s.status.toUpperCase()}
                </Badge>
                {s.messages.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>{s.messages.join('; ')}</Text>
                )}
                {s.unmapped_headers.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>unmapped: {s.unmapped_headers.join(', ')}</Text>
                )}
                {s.note && (
                  <Text size="xs" fs="italic" c="accent" mt={2}>{s.note}</Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed">
        <b>People</b> = distinct identities in the dump. <b>Paid</b> = people with at least one paid appointment —
        the "headcount" used across the site. <b>Unpaid $0</b> = appointments with no salary (affiliates given
        campus access), excluded from headcount and salary stats.
      </Text>

      {(dups ?? []).length > 0 && (
        <Card withBorder padding="lg">
          <Text size="sm" fw={600} mb="xs">Possible duplicate identities (review)</Text>
          <Text size="xs" c="dimmed" mb="sm">
            Same name resolving to more than one person (different hire dates) in the latest snapshot — usually
            genuinely different people, but worth a glance. Confirm true duplicates via data/corrections.json.
          </Text>
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th ta="right">Distinct identities</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(dups ?? []).map((d) => (
                <Table.Tr key={`${d.first_name} ${d.last_name}`}>
                  <Table.Td fw={500}>{d.first_name} {d.last_name}</Table.Td>
                  <Table.Td ta="right">
                    <Badge variant="light" color="yellow" radius="sm">{d.keys}</Badge>
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
