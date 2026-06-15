import { Stack, Title, Text, Table, Badge, Loader, Alert, Group, Code, Anchor } from '@mantine/core';
import { useManifest } from '../lib/hooks';
import { num, usd } from '../lib/format';
import type { SnapshotInfo } from '../lib/manifest';

const STATUS_COLOR: Record<string, string> = { ok: 'teal', warning: 'yellow', error: 'red', info: 'gray' };

export default function DataHealth() {
  const { data: manifest, isLoading, error } = useManifest();

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
          Wisconsin public record. Person matching (name + hire date) is best-effort.
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

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Snapshot</Table.Th>
            <Table.Th>Source (file · sheet)</Table.Th>
            <Table.Th ta="right">Rows</Table.Th>
            <Table.Th ta="right">People</Table.Th>
            <Table.Th ta="right">$0/null</Table.Th>
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
              <Table.Td ta="right">{num(s.zero_or_null_salary)}</Table.Td>
              <Table.Td ta="right">{usd(s.salary_median)}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[s.status] ?? 'gray'} variant="light">
                  {s.status}
                </Badge>
                {s.messages.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>{s.messages.join('; ')}</Text>
                )}
                {s.unmapped_headers.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>unmapped: {s.unmapped_headers.join(', ')}</Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
