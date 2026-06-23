import { Stack, Title, Text, Table, Badge, Loader, Alert, Group, Code, Anchor, Card } from '@mantine/core';
import { useManifest, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd } from '../lib/format';
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
      <div>
        <Title order={2}>Data · About</Title>
        <Text c="dimmed">
          Per-snapshot ingestion health, detected column mappings, and source provenance. Salary data is a
          Wisconsin public record; the periodic salary report files are obtained through the work of{' '}
          <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer">UFAS Local 223</Anchor>.
          Person matching (name + hire date) is best-effort.
        </Text>
      </div>

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
      <Table striped highlightOnHover verticalSpacing="sm">
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
          <Table striped highlightOnHover withTableBorder verticalSpacing="sm">
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
