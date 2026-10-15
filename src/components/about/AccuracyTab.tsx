import { Anchor, Box, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { CardTitle } from '../CardTitle';
import { useSummary } from '../../lib/hooks';
import { num } from '../../lib/format';
import { REAL_BASE_YEAR } from '../../lib/cpi';
import { ICON } from '../../lib/ui';
import { RecordChips, RuleRows, SectionLink, type Rule } from './shared';

/**
 * How far a number here can be trusted, in full: the eleven ways one can be wrong or mislead, grouped by what
 * goes wrong, then the use these records ask of a reader. The Overview gives the short form of both.
 */
export function AccuracyTab({ snapshots }: { snapshots: number }) {
  const { data: summary } = useSummary();
  const joined = summary?.joined_people;
  const groups: { id: string; title: string; rows: Rule[] }[] = [
    { id: 'leaves-out', title: 'What the pay figure leaves out', rows: [
      { term: 'Bonuses and deferred pay', text: 'Coaches, executives and others may receive supplemental, overload, deferred or one-time compensation that is not in these reports.' },
      { term: 'Gross, not take-home', text: 'Amounts are gross annualized figures. Benefits, taxes and retirement are excluded.' },
      { term: 'Nominal dollars', text: `Figures are as reported, not inflation-adjusted. A person's salary trend, Divisions › Trends and Compare offer a ${REAL_BASE_YEAR} $ view based on CPI-U annual averages; treat it as a rough guide, since the latest year or two are estimated from partial-year data.` },
      { term: 'Changes between snapshots', text: 'Raises, promotions, leaves or appointment changes that happen between two reports are not captured, so true earnings can be higher or lower than any number shown.',
        link: <SectionLink id="snapshots" fw={500} className="nowrap">The {num(snapshots)} snapshots →</SectionLink> },
    ] },
    { id: 'describes', title: 'Who a row really describes', rows: [
      { term: 'Part-time staff', text: 'The Full-time rate view is the annual rate, which is more than a half-time person actually earned.',
        link: <SectionLink id="how-it-works" fw={500} className="nowrap">Two ways to read pay →</SectionLink> },
      { term: 'Multiple appointments', text: 'A person is named by their main appointment and paid the sum of their salaried ones. An hourly job held beside them is listed, not added, because its hours are not reported.' },
      { id: 'identity', term: 'Identity matching', text: <>People are matched by name and hire date, with no employee ID. When a hire date changes — corrected by the source, or a rehire — one record ends and another begins; if no one else shares the name and both sit in the same division with the same title or department, they are joined{joined ? ` (${num(joined)} people)` : ''}, and the latest hire date is shown. Two people can still be merged, or one split, so a salary can be attributed to the <b>wrong person</b>.</>,
        link: <SectionLink id="duplicates" fw={500} className="nowrap">Possible duplicates →</SectionLink> },
      { term: 'Names and transcription', text: 'ALL-CAPS source names are auto-cased and can be mangled. Values are read from published spreadsheets and may carry source or ingestion errors.' },
    ] },
    { id: 'source-changed', title: 'When the source itself changed', rows: [
      { term: 'Nov 2021 · TTC', text: 'Nearly every title, job code and grade changed at once in a structural reclassification. Those are relabels, not promotions or raises.',
        link: <SectionLink id="ttc" fw={500} className="nowrap">See the note →</SectionLink> },
      { term: 'Oct 2023 · scope change', text: 'Some reports excluded students and trainees, so headcount and joiner/leaver counts across that point partly reflect coverage, not real hiring or attrition.',
        link: <SectionLink id="scope-change" fw={500} className="nowrap">See the note →</SectionLink> },
      { term: 'Column mapping', text: 'Columns are auto-detected from each spreadsheet. A mis-mapped column can attach the wrong value to a field.',
        link: <SectionLink id="mapping" fw={500} className="nowrap">Each sheet&apos;s mapping →</SectionLink> },
    ] },
  ];
  const total = groups.reduce((t, g) => t + g.rows.length, 0);
  return (
    <Stack gap="lg">
      <Card id="disclaimer" className="caveats-card" data-caveats={total}>
        <CardTitle anchorId="disclaimer">
          <Group gap={8} wrap="nowrap" component="span">
            <IconAlertTriangle size={ICON.control} className="caution-icon" aria-hidden />
            These numbers may not reflect reality
          </Group>
        </CardTitle>
        <Text className="lede" maw="72ch">
          Every figure is a <b>point-in-time, gross, best-effort transcription</b> of a public spreadsheet. Treat all of it as
          approximate, never as a person&apos;s verified pay.
        </Text>
        <Group gap={6} wrap="wrap" mt="md" className="caveat-jumps">
          {groups.map((g) => (
            <Anchor key={g.id} href={`#${g.id}`} underline="never" className="jump-chip">
              {g.title} <Text span c="dimmed" fw={500} inherit>{g.rows.length}</Text>
            </Anchor>
          ))}
        </Group>
        {groups.map((g) => (
          <Box key={g.id} id={g.id} mt="lg" className="caveat-group">
            <Title order={3} className="eyebrow-heading">{g.title}</Title>
            <RuleRows rows={g.rows} />
          </Box>
        ))}
        <Text size="sm" c="dimmed" mt="lg" className="muted-box">
          The information is provided as is, may be inaccurate or incomplete, and carries <b>no warranty and no liability</b>.
          Verify against official UW–Madison or State of Wisconsin sources before relying on it for any decision.
        </Text>
      </Card>

      <Card id="privacy">
        <CardTitle anchorId="privacy">Privacy &amp; responsible use</CardTitle>
        <Group align="flex-start" gap="xl" wrap="wrap">
          <Stack gap="sm" style={{ flex: '1 1 420px', minWidth: 0 }}>
            <Text size="sm" maw="64ch">
              These records name <b>real people</b>. The salaries of public-university employees are a Wisconsin public record, but
              “public” is not a license to harass, dox, shame or target anyone.
            </Text>
            <Text size="sm" c="dimmed" maw="64ch">
              Use this site to understand pay structures, ranges and how pay compares, not to make judgments about individuals.
            </Text>
            <Text className="lede privacy-emphasis" fw={600} maw="52ch">
              A salary here is pay for a role at a point in time, not a person&apos;s total compensation or their worth. The most
              consequential error this data can make is naming the{' '}
              <SectionLink id="identity" inherit underline="always">wrong person</SectionLink>.
            </Text>
          </Stack>
          <Box className="muted-panel" style={{ flex: '1 1 300px', minWidth: 0 }}>
            <RecordChips shownLabel="Shown, only as released" note="Nothing beyond the released report is stored." />
          </Box>
        </Group>
      </Card>
    </Stack>
  );
}
