import { Anchor, Box, Card, Group, Stack, Text, Title } from '@mantine/core';
import { CardTitle } from '../CardTitle';
import { DataPipeline } from '../DataPipeline';
import { DownloadButtons, type PipelineFacts } from './OverviewTab';
import { PayViews, RECORD_FIELDS, RuleRows } from './shared';

/**
 * How a published spreadsheet becomes the numbers here, in full: the seven steps, the rules every figure is
 * calculated by, and how to rebuild it all — the code, the dataset and the fields one record holds.
 */
export function MethodTab({ pipeline, latestLabel }: { pipeline: PipelineFacts; latestLabel: string | null }) {
  return (
    <Stack gap="lg">
      <Card id="pipeline">
        <CardTitle anchorId="pipeline" sub="Each step is in the open-source ingestion, and every count here is read from the manifest, not typed in.">
          From records request to this page
        </CardTitle>
        <DataPipeline
          snapshots={pipeline.snapshots}
          columnsMapped={pipeline.columnsMapped}
          peopleLatest={pipeline.peopleLatest}
          latestLabel={latestLabel}
          totalRows={pipeline.totalRows}
          fileSize={pipeline.parquetSize}
        />
      </Card>

      <Card id="how-it-works">
        <CardTitle anchorId="how-it-works" sub="The Pay control on every page switches between two views.">How these figures are calculated</CardTitle>
        <PayViews />
        <RuleRows className="rule-rows-ruled" rows={[
          { term: 'One row, one appointment', text: 'Each source row carries a full-time annual rate and an FTE, the appointment percentage, where 0.5 is half-time.' },
          { term: 'Hourly appointments', text: 'They report no FTE, so they are counted at their full listed rate rather than as zero. The 2021 and 2022 reports list some hourly pay as the hourly rate itself; those are annualized at 2,080 hours, the way every later report states them.' },
          { term: 'The main appointment', text: 'A person holding more than one paid appointment is named, placed and compared by the one with the highest FTE. An hourly job, with no FTE, comes after any salaried one.' },
          { term: 'Pay across appointments', text: 'The sum of the salaried appointments’ actual (rate × FTE) earnings, so split roles are not double-counted. An hourly job beside a salaried one is left out, since its hours are not reported. Someone holding only hourly jobs is counted at the best-paid one’s rate.' },
          { term: 'Unpaid affiliates', text: '$0 affiliate appointments are excluded from headcount, medians and totals.' },
          { term: 'Same-title comparisons', text: 'On a person’s page, everyone with the same title is compared at their full-time rate in it, so a part-time appointment is not read as underpaid. Their actual pay is given beside it.' },
        ]} />
      </Card>

      <Card id="methodology">
        <Group align="flex-start" gap="xl" wrap="wrap">
          <Stack gap="sm" style={{ flex: '1 1 420px', minWidth: 0 }}>
            <CardTitle anchorId="methodology" mb={0}>Reproduce it yourself</CardTitle>
            <Text size="sm" c="dimmed" maw="64ch">
              This project is open source. The ingestion code, column-detection logic and applied corrections are all public, so
              you can audit how each published spreadsheet becomes the data shown here, or rebuild it from the raw records.
            </Text>
            <DownloadButtons f={pipeline} />
          </Stack>
          <Box className="muted-panel" style={{ flex: '1 1 340px', minWidth: 0 }}>
            <Group justify="space-between" align="baseline" gap="sm" wrap="wrap">
              <Title order={3} fz="sm" fw={650}>What&apos;s in a record: {RECORD_FIELDS.length} fields</Title>
              {pipeline.dictUrl && (
                <Anchor href={pipeline.dictUrl} target="_blank" rel="noopener noreferrer" size="sm" fw={500}>Data dictionary →</Anchor>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={4} mb="sm">
              Each appointment row carries these, tagged with its snapshot. The two Pay views are derived from them; nothing else
              about a person is stored.
            </Text>
            <Group gap={6} wrap="wrap" className="record-fields">
              {RECORD_FIELDS.map((f) => <span key={f} className="field-chip field-chip-plain">{f}</span>)}
            </Group>
          </Box>
        </Group>
      </Card>
    </Stack>
  );
}
