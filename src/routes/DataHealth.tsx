import type { ReactNode } from 'react';
import { Stack, Title, Text, Table, Badge, Loader, Alert, Group, Code, Anchor, Card, List, Accordion, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useManifest, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { num, usd, pct } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import type { SnapshotInfo } from '../lib/manifest';

const STATUS_COLOR: Record<string, string> = { ok: 'green', warning: 'yellow', error: 'red', info: 'gray' };
const REPO_URL = 'https://github.com/aaronsmetana/UW-Madison_Salaries';

/** Snapshot-over-snapshot delta chip for the ingestion table. */
function Delta({ frac }: { frac: number | null }) {
  if (frac == null) return <Text span size="xs" c="dimmed">—</Text>;
  if (Math.abs(frac) < 0.0005) return <Text span size="xs" c="dimmed">0.0%</Text>;
  const up = frac >= 0;
  return <Text span size="xs" c={up ? 'pos' : 'red'}>{up ? '▲' : '▼'} {pct(Math.abs(frac))}</Text>;
}

/** Table header with an optional explanatory tooltip (dotted "help" underline). */
function Th({ children, tip, ta }: { children: ReactNode; tip?: string; ta?: 'right' }) {
  if (!tip) return <Table.Th ta={ta}>{children}</Table.Th>;
  return (
    <Table.Th ta={ta}>
      <Tooltip label={tip} multiline w={250} withArrow>
        <span style={{ borderBottom: '1px dotted var(--mantine-color-dimmed)', cursor: 'help' }}>{children}</span>
      </Tooltip>
    </Table.Th>
  );
}

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
  const { data: dupStats } = useSql<{ dup_names: number; total_people: number }>(
    ['id-review-count', snapId ?? ''],
    `SELECT
        (SELECT count(*) FROM (SELECT first_name, last_name FROM salaries WHERE snapshot_id = ${sqlStr(snapId ?? '')}
            AND first_name IS NOT NULL AND last_name IS NOT NULL
            GROUP BY first_name, last_name HAVING count(DISTINCT person_key) > 1)) dup_names,
        count(DISTINCT person_key) total_people
     FROM salaries WHERE snapshot_id = ${sqlStr(snapId ?? '')}`,
    !!snapId
  );
  const ds = dupStats?.[0];

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">Failed to load manifest: {(error as Error).message}</Alert>;

  const snaps = (manifest?.snapshots ?? []).filter((s) => s.row_count) as SnapshotInfo[];
  const dict = (manifest?.snapshots ?? []).find((s) => 'data_dictionary_url' in (s as object)) as
    | (SnapshotInfo & { data_dictionary_url?: string })
    | undefined;
  const latestSnap = snaps.length
    ? [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).at(-1)
    : undefined;
  // Chronological order, with Pre-TTC before Post-TTC for the shared Nov-2021 date.
  const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : 1);
  const orderedSnaps = [...snaps].sort(
    (a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id)
  );
  const dpct = (cur?: number | null, prev?: number | null) =>
    cur != null && prev != null && prev !== 0 ? (cur - prev) / prev : null;

  const toc: [string, string][] = [
    ['#source', 'Source'],
    ['#disclaimer', 'Disclaimer'],
    ['#privacy', 'Privacy'],
    ['#how-it-works', 'How figures work'],
    ['#methodology', 'Methodology'],
    ['#snapshots', 'Snapshots'],
    ...((dups ?? []).length > 0 ? ([['#duplicates', 'Duplicates']] as [string, string][]) : []),
  ];

  return (
    <Stack gap="lg" className="tab-rise">
      <PageHeader
        title="Data · About"
        description="Per-snapshot ingestion health, detected column mappings, and source provenance. Salary data is a Wisconsin public record obtained via union open-records requests. Every figure is a point-in-time, best-effort transcription — treat it as approximate and verify against official sources."
      />

      <Group gap="sm" wrap="wrap">
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" style={{ letterSpacing: '0.04em' }}>Jump to</Text>
        {toc.map(([href, label]) => (
          <Anchor key={href} href={href} size="xs">{label}</Anchor>
        ))}
      </Group>

      <Card withBorder padding="lg" id="source">
        <Title order={4} mb="xs">Data source &amp; acknowledgment</Title>
        <Stack gap="sm">
          <Text size="sm">
            The UW–Madison salary report files presented here are <b>public records</b>, obtained through
            Wisconsin open-records requests (Wisconsin Public Records Law, Wis. Stat. §§ 19.31–19.39) filed by{' '}
            <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" fw={600}>United Faculty &amp; Academic Staff (UFAS)</Anchor>
            {' '}— <b>AFT Local 223, AFL-CIO</b>, the union representing UW–Madison faculty and academic staff.
            UFAS advocates for the pay, working conditions, and rights of campus faculty and academic staff;
            <b> their open-records work is what makes this transparency possible, and the credit for these records
            belongs to them.</b>
          </Text>
          <Text size="sm">
            This site is an independent project built by Aaron Smetana to make those public records easier to
            explore. It is <b>not affiliated with, operated by, or endorsed by UFAS or UW–Madison</b> — any
            errors or interpretations here are the project's alone, not theirs.</Text>
          <Group gap="lg">
            <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" size="sm" fw={600}>
              Visit UFAS Local 223 →
            </Anchor>
            <Anchor href="https://docs.legis.wisconsin.gov/statutes/statutes/19/ii" target="_blank" rel="noopener noreferrer" size="sm">
              Wisconsin Public Records Law →
            </Anchor>
            <Anchor href="https://www.doj.state.wi.us/office-open-government/office-open-government" target="_blank" rel="noopener noreferrer" size="sm">
              File your own records request →
            </Anchor>
          </Group>
        </Stack>
      </Card>

      <Alert
        color="orange"
        variant="light"
        radius="md"
        icon={<IconAlertTriangle size={20} />}
        title="Accuracy & disclaimer — these numbers may not reflect reality"
        id="disclaimer"
        styles={{ title: { fontSize: 'var(--mantine-h4-font-size)', fontWeight: 700 } }}
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
          <Text size="sm" mt={4}>
            This is an <b>independent, best-effort project</b> and is <b>not affiliated with or endorsed by
            UW–Madison</b>. Salary data is a Wisconsin public record. The information is provided "as is," may be
            inaccurate or incomplete, and carries <b>no warranty and no liability</b> — verify against official
            UW–Madison or State of Wisconsin sources before relying on it for any decision.
          </Text>
        </Stack>
      </Alert>

      <Card withBorder padding="lg" id="privacy">
        <Title order={4} mb="xs">Privacy &amp; responsible use</Title>
        <Stack gap="sm">
          <Text size="sm">
            These records name <b>real people</b>. The salaries of public-university employees are a Wisconsin
            public record, but "public" is not a license to harass, dox, shame, or target anyone. Please use this
            site to understand pay structures, ranges, and equity — not to make judgments about individuals.
          </Text>
          <Text size="sm">
            Only the fields released in the public salary reports are shown — name, title, department, school,
            pay, FTE, and hire date. <b>No</b> home addresses, contact details, ID numbers, demographic data, or
            anything beyond the released report is collected or displayed.
          </Text>
          <Text size="sm">
            A salary here is gross annualized pay for a role at a point in time — <b>not</b> a person's total
            compensation, their take-home, or their worth. And because people are matched by name + hire date
            with no employee ID, the most consequential possible error is a salary attributed to the{' '}
            <b>wrong named person</b> (two people merged, or one split in two).
          </Text>
        </Stack>
      </Card>

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

      <Card withBorder padding="lg" id="methodology">
        <Title order={4} mb="xs">Methodology, reproducibility &amp; downloads</Title>
        <Stack gap="sm">
          <Text size="sm">
            This project is open source. The ingestion code, column-detection logic, and applied corrections are
            all public, so you can audit exactly how each published spreadsheet becomes the data shown here — or
            reproduce it from the raw records yourself.
          </Text>
          <Group gap="lg">
            <Anchor href={REPO_URL} target="_blank" rel="noopener noreferrer" size="sm" fw={600}>Source code &amp; ingestion →</Anchor>
            <Anchor href={`${import.meta.env.BASE_URL}data/salaries.parquet`} size="sm">Download dataset (Parquet) →</Anchor>
            <Anchor href={`${import.meta.env.BASE_URL}data/manifest.json`} target="_blank" rel="noopener noreferrer" size="sm">Ingestion manifest (JSON) →</Anchor>
            {dict?.data_dictionary_url && (
              <Anchor href={dict.data_dictionary_url} target="_blank" rel="noopener noreferrer" size="sm">Source data dictionary →</Anchor>
            )}
          </Group>

          <Text size="sm" fw={700} mt="xs">What's in a record</Text>
          <Text size="sm">
            Each appointment row carries: name (first &amp; last), title &amp; job code, school &amp; department,
            grade &amp; basis, salary / FTE-adjusted salary / base pay, FTE, pay-rate type, FLSA status, employee
            category &amp; type, and hire date — tagged with the snapshot it came from. The three "Pay" views are
            derived from those columns; nothing else about a person is stored.
          </Text>

          {latestSnap && Object.keys(latestSnap.detected_mapping).length > 0 && (
            <Accordion variant="contained" mt="xs">
              <Accordion.Item value="mapping">
                <Accordion.Control>
                  <Text size="sm" fw={600}>Detected column mappings — {latestSnap.snapshot_label}</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text size="xs" c="dimmed" mb="sm">
                    How each column in the source spreadsheet was auto-mapped to a field in this app (detection
                    runs per snapshot; this is the latest). A mis-detection here is one way a value can be mislabeled.
                  </Text>
                  <Table withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Field (in this app)</Table.Th>
                        <Table.Th>Source column (in the spreadsheet)</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {Object.entries(latestSnap.detected_mapping).map(([field, col]) => (
                        <Table.Tr key={field}>
                          <Table.Td><Code>{field}</Code></Table.Td>
                          <Table.Td>{col}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {latestSnap.unmapped_headers.length > 0 && (
                    <Text size="xs" c="dimmed" mt="sm">
                      Unmapped (ignored) source columns: {latestSnap.unmapped_headers.join(', ')}.
                    </Text>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Stack>
      </Card>

      <Card withBorder padding="lg" id="snapshots">
        <Title order={4} mb="xs">Per-snapshot ingestion</Title>
        <Text size="xs" c="dimmed" mb="md">
          <b>{num(manifest?.total_rows)}</b> records · <b>{num(snaps.length)}</b> snapshots ·
          schema v{manifest?.schema_version} · last built {manifest?.generated_at?.slice(0, 16).replace('T', ' ')}
          {dict?.data_dictionary_url && (
            <> · <Anchor href={dict.data_dictionary_url} target="_blank" rel="noopener noreferrer" inherit>data dictionary →</Anchor></>
          )}
        </Text>
        <Table.ScrollContainer minWidth={920}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Th>Snapshot</Th>
            <Th>Source (file · sheet)</Th>
            <Th ta="right" tip="Rows in the source spreadsheet — one per appointment (a person can hold several).">Rows</Th>
            <Th ta="right" tip="Distinct identities in the dump (name + hire date).">People</Th>
            <Th ta="right" tip="People with at least one paid appointment — the headcount used across the site.">Paid</Th>
            <Th ta="right" tip="Change in paid headcount vs the previous snapshot.">Δ paid</Th>
            <Th ta="right" tip="Appointments with no salary (affiliates given campus access), excluded from headcount and salary stats.">Unpaid $0</Th>
            <Th ta="right" tip="Median paid salary (full-time rate as reported in the source).">Median</Th>
            <Th ta="right" tip="Change in median vs the previous snapshot.">Δ median</Th>
            <Th>Status</Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orderedSnaps.map((s, i) => {
            const prev = orderedSnaps[i - 1];
            return (
            <Table.Tr key={s.snapshot_id} style={{ background: s.note ? 'var(--mantine-color-default-hover)' : undefined }}>
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
              <Table.Td ta="right">{i > 0 ? <Delta frac={dpct(s.distinct_people_paid, prev?.distinct_people_paid)} /> : '—'}</Table.Td>
              <Table.Td ta="right">{num(s.zero_or_null_salary)}</Table.Td>
              <Table.Td ta="right">{usd(s.salary_median)}</Table.Td>
              <Table.Td ta="right">{i > 0 ? <Delta frac={dpct(s.salary_median, prev?.salary_median)} /> : '—'}</Table.Td>
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
            );
          })}
        </Table.Tbody>
      </Table>
        </Table.ScrollContainer>
        <Text size="xs" c="dimmed" mt="sm">
          <b>People</b> = distinct identities in the dump. <b>Paid</b> = people with at least one paid appointment —
          the "headcount" used across the site. <b>Unpaid $0</b> = appointments with no salary (affiliates given
          campus access), excluded from headcount and salary stats. A <b>shaded row</b> carries a note worth reading
          (e.g. the Nov-2021 TTC relabel or the Oct-2023 scope change). <b>Status</b>: OK = ingested cleanly;
          INFO/WARNING = a flagged note; ERROR = a problem in that dump.
        </Text>
      </Card>

      {(dups ?? []).length > 0 && (
        <Card withBorder padding="lg" id="duplicates">
          <Title order={4} mb="xs">Possible duplicate identities (review)</Title>
          <Text size="sm" mb="xs">
            People are matched across snapshots by <b>name + hire date</b> (no employee ID exists in the source).
            That can fail two ways: one name can <b>split</b> into two records (shown below), or — harder to spot —
            two different people can be <b>merged</b> into one. Below are names resolving to more than one person
            in the latest snapshot; usually these are genuinely different people who share a name, but each is
            worth a glance.
          </Text>
          {ds && (
            <Text size="xs" c="dimmed" mb="sm">
              {num(ds.dup_names)} shared-name groups across {num(ds.total_people)} people
              {ds.total_people ? ` (~${pct(ds.dup_names / ds.total_people)})` : ''}; showing the top {num((dups ?? []).length)}.
            </Text>
          )}
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
