import type { ReactNode } from 'react';
import { Anchor, Button, Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconAlertTriangle, IconBook2, IconBraces, IconBrandGithub, IconDownload } from '@tabler/icons-react';
import { CardTitle } from '../CardTitle';
import { NewBadge } from '../NewBadge';
import { StatCard, StatRow } from '../StatCard';
import { DeltaChip } from '../Delta';
import { useDepartmentChanges, useLatestStep, useRelease, useSql } from '../../lib/hooks';
import { GRADED_APPT } from '../../lib/queries';
import { belowMinimumSql, bandScaleSql } from '../../lib/bands';
import { fmtChange, fmtDate, num, pct, plural } from '../../lib/format';
import { sqlStr } from '../../lib/duckdb';
import { REPO_URL } from '../../lib/links';
import { ICON } from '../../lib/ui';
import { PayViews, RecordChips, RECORD_FIELDS, SectionLink } from './shared';

/** What the Overview's last card needs from the manifest: every figure it gives is read, none typed. */
export interface PipelineFacts {
  snapshots: number;
  columnsMapped: number | null;
  peopleLatest: number | null;
  totalRows: number | null | undefined;
  parquetUrl: string;
  parquetSize: string | null;
  manifestUrl: string;
  manifestSize: string | null;
  dictUrl: string | null;
}

/** People whose full-time rate, on the appointment that carries their grade, is below its minimum — the
 *  rule Screening's flag applies (lib/bands), over the newest snapshot. */
function useBelowMinimum(snapshotId: string | undefined) {
  const { data } = useSql<{ n: number; hourly: number }>(
    ['below-min', snapshotId ?? ''],
    `WITH p AS (SELECT person_key, ${GRADED_APPT} graded FROM salaries WHERE snapshot_id = ${sqlStr(snapshotId ?? '')} GROUP BY person_key)
     SELECT count(*) n, count(*) FILTER (WHERE p.graded.basis = 'hourly') hourly
     FROM p JOIN grades g ON g."grade" = p.graded.grade AND g."basis" = p.graded.basis
     WHERE ${belowMinimumSql('p.graded.rate', `g."min" * ${bandScaleSql('p.graded.comp')}`, 'p.graded.basis')}`,
    !!snapshotId
  );
  return data?.[0] ?? null;
}

/** Job codes whose title reads differently from the release before — each code's most common wording on
 *  each side — and the one most people hold, as the example. */
function useRetitled(from: string | undefined, to: string | undefined) {
  const named = (snap: string) =>
    `SELECT job_code, first(title ORDER BY c DESC, title) t, sum(c) n FROM (
       SELECT job_code, title, count(*) c FROM salaries WHERE snapshot_id = ${sqlStr(snap)} AND job_code IS NOT NULL AND title IS NOT NULL GROUP BY 1, 2
     ) GROUP BY job_code`;
  const { data } = useSql<{ codes: number; was: string | null; now: string | null }>(
    ['retitled', from ?? '', to ?? ''],
    `WITH a AS (${named(from ?? '')}), b AS (${named(to ?? '')}),
          d AS (SELECT a.t was, b.t now, b.n FROM a JOIN b USING (job_code) WHERE lower(a.t) <> lower(b.t))
     SELECT count(*) codes, arg_max(was, n) was, arg_max(now, n) now FROM d`,
    !!from && !!to
  );
  return data?.[0] ?? null;
}

/** "A, B and C". */
function listOf(xs: string[]) {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** One thing the release changed: a bold name, a sentence, and where it leads. */
function Change({ item, title, link, children }: { item: string; title: ReactNode; link?: ReactNode; children: ReactNode }) {
  return (
    <div className="whats-new-change" data-item={item}>
      <Title order={3} fz="sm" fw={700}>{title}</Title>
      <Text size="sm" c="dimmed" mt={2}>{children}</Text>
      {link && <Text size="sm" mt={4} fw={500}>{link}</Text>}
    </div>
  );
}

/**
 * The newest release against the one before: its four figures, then what it changed — the pay step it carried,
 * the salary ranges if they came with it, a division formed, titles reworded, departments renamed, who is now paid
 * below their grade's minimum. Every figure is read from the build (summary, reference status, raise steps,
 * departments) or the data; none is typed in, so the next release rewrites all of it.
 */
function WhatsNewCard() {
  const release = useRelease();
  const step = useLatestStep('fte');
  const { data: depts } = useDepartmentChanges();
  const below = useBelowMinimum(release?.latest.id);
  const retitled = useRetitled(release?.previous?.id, release?.latest.id);
  if (!release) return <Skeleton height={320} radius="lg" />;
  const { latest, previous, ref } = release;
  const deptStep = depts?.steps.find((s) => s.to === latest.id);
  const change = (a?: number | null, b?: number | null) => (a != null && b ? a / b - 1 : null);
  const stepIsFromPrevious = step && previous && step.from_id === previous.id && step.to_id === latest.id;
  const acrossTheBoard = stepIsFromPrevious && step.share >= 0.5;
  const vs = previous ? ` vs ${previous.label}` : '';
  return (
    <Card id="whats-new" className="whats-new" data-release={latest.id}>
      <CardTitle
        anchorId="whats-new"
        sub={previous ? `Compared with ${previous.label}, the release before it.` : undefined}
        right={<NewBadge />}
      >
        What&apos;s new in the {release.month} release
      </CardTitle>
      <StatRow cols={{ base: 2, sm: 4 }} label="The release in four figures">
        <StatCard figure="people" label="People paid" value={num(latest.headcount)}
          sub={previous ? <DeltaChip size="sm" tone="neutral" frac={change(latest.headcount, previous.headcount)} suffix={vs} /> : undefined} />
        {/* Per person, said: the snapshot table's median counts rows, and says that. */}
        <StatCard figure="median" label="Median pay, per person" value={latest.median == null ? '—' : `$${num(Math.round(latest.median))}`}
          sub={previous ? <DeltaChip size="sm" frac={change(latest.median, previous.median)} suffix={vs} /> : undefined} />
        {stepIsFromPrevious && (
          acrossTheBoard
            ? <StatCard figure="step" label="Most common raise" value={`+${(step.raise * 100).toFixed(1)}%`} sub={`${pct(step.share, 0)} of ${num(step.n)} got exactly this`} />
            : <StatCard figure="step" label="Median raise" value={step.median == null ? '—' : fmtChange(step.median)} sub={`${num(step.n)} kept their title and appointment`} />
        )}
        {release.rangesUpdated && ref && (
          <StatCard figure="ranges" label="Salary range figures" value={ref.structure_change != null ? fmtChange(ref.structure_change) : 'Updated'}
            sub={`Up on the last set; now cover ${pct(ref.coverage, 0)} of graded appointments`} />
        )}
      </StatRow>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" verticalSpacing="md" mt="lg" className="whats-new-list">
        {acrossTheBoard && (
          <Change item="step" title="An across-the-board step"
            link={<Anchor component={Link} to={`/raises?from=${previous!.id}&to=${latest.id}`} inherit>See every raise →</Anchor>}>
            {pct(step.share, 0)} of the {num(step.n)} people who kept the same title and appointment since {previous?.label} were
            raised exactly {(step.raise * 100).toFixed(1)}%.
          </Change>
        )}
        {release.rangesUpdated && ref && (
          <Change item="ranges" title="Salary ranges updated" link={<SectionLink id="salary-ranges" inherit>The ranges →</SectionLink>}>
            UW–Madison&apos;s published structure, retrieved {fmtDate(ref.retrieved_at)}, now gives a range for {pct(ref.coverage, 0)} of graded
            appointments and a minimum for {pct(ref.floor_coverage, 0)} more
            {ref.structure_change != null ? <>; its figures are {fmtChange(ref.structure_change)} on the ones this site carried before</> : null}.
          </Change>
        )}
        {release.reorganizations.map((r) => (
          <Change key={r.school} item="reorganization" title="A new division"
            link={<Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`} inherit>The new division →</Anchor>}>
            {r.school} ({num(r.people)} people), formed from{' '}
            {r.from.map((f, i) => <span key={f.school}>{i > 0 ? '; ' : ''}{f.school}&apos;s {listOf(f.departments)} ({num(f.people)} people)</span>)}.
            Counted by division they read as leaving one and joining the other; it is a reorganization, not people leaving.
          </Change>
        ))}
        {deptStep && (deptStep.carried.length > 0 || deptStep.mergers.length > 0) && (
          <Change item="departments" link={<SectionLink id="departments" inherit>Every change →</SectionLink>}
            title={[deptStep.carried.length ? `${plural(deptStep.carried.length, 'department')} renamed` : '', deptStep.mergers.length ? `${num(deptStep.mergers.length)} merged` : ''].filter(Boolean).join(', ')}>
            {deptStep.carried.length > 0 && <>Renamed ones carry their history under the new name. </>}
            {deptStep.mergers.length > 0 && <>Merged ones start a new history here.</>}
          </Change>
        )}
        {retitled && retitled.codes > 0 && (
          <Change item="retitled" title={`${num(retitled.codes)} job titles are worded differently`}>
            Their job codes are unchanged{retitled.was && retitled.now ? <> — &ldquo;{retitled.was}&rdquo; is now &ldquo;{retitled.now}&rdquo;</> : null}. Histories
            follow the job code, so none of these reads as a promotion, and search finds a title by its old wording too.
          </Change>
        )}
        {below && below.n > 0 && ref?.status === 'ok' && (
          <Change item="below-min" title={`${num(below.n)} ${below.n === 1 ? 'person is' : 'people are'} paid below their grade's minimum`}
            link={<Anchor component={Link} to="/screening?run=1&flag=below-min" inherit className="below-min-link">Screen them →</Anchor>}>
            {below.hourly > 0 ? `${num(below.hourly)} of them hourly; ` : ''}read on the full-time rate of the appointment that carries the grade.
          </Change>
        )}
      </SimpleGrid>
    </Card>
  );
}

/** The short form of the Accuracy tab's caveats: three of each kind, a line each. */
const CAVEAT_SUMMARY: { title: string; items: [string, string][] }[] = [
  { title: 'What the pay figure leaves out', items: [
    ['Bonuses and deferred pay.', 'Supplemental, overload or one-time pay is not in these reports.'],
    ['Benefits and taxes.', 'Amounts are gross; benefits, taxes and retirement are excluded.'],
    ['Inflation.', 'Dollars are nominal. A few charts offer an approximate inflation-adjusted view.'],
  ] },
  { title: 'Who a row really describes', items: [
    ['Part-time staff.', 'The full-time rate is more than a half-time person earned.'],
    ['Several appointments.', 'Named by the main one, paid the sum of the salaried ones.'],
    ['Name + hire date.', 'There is no employee ID, so two people can merge or one can split.'],
  ] },
  { title: 'When the source itself changed', items: [
    ['Nov 2021, TTC.', 'Nearly every title, job code and grade was relabeled at once.'],
    ['Oct 2023, scope.', 'Some reports dropped students and trainees from headcount.'],
    ['Between snapshots.', 'Raises or leaves between two reports are not captured.'],
  ] },
];

function RelyCard() {
  return (
    <Card id="rely" className="rely-card">
      <CardTitle anchorId="rely" right={<SectionLink id="disclaimer" size="sm" fw={500}>All 11 caveats, in full →</SectionLink>}>
        <Group gap={8} wrap="nowrap" component="span">
          <IconAlertTriangle size={ICON.control} className="caution-icon" aria-hidden />
          Before you rely on a number
        </Group>
      </CardTitle>
      <Text className="lede" maw="72ch">
        Every figure is a <b>point-in-time, gross, best-effort transcription</b> of a public spreadsheet. Treat it as approximate,
        never as a person&apos;s verified pay.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg" mt="md">
        {CAVEAT_SUMMARY.map((g) => (
          <div key={g.title}>
            <Title order={3} className="eyebrow-heading">{g.title}</Title>
            <ul className="caveat-list">
              {g.items.map(([term, text]) => <li key={term}><b>{term}</b> {text}</li>)}
            </ul>
          </div>
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="md" maw="var(--measure)">
        Provided as is, with no warranty. Check official UW–Madison or State of Wisconsin sources before relying on any figure
        for a decision.
      </Text>
    </Card>
  );
}

function PayViewsCard() {
  return (
    <Card id="pay-views">
      <CardTitle anchorId="pay-views" sub="The Pay control on every page switches between them."
        right={<SectionLink id="how-it-works" size="sm" fw={500}>How every figure is calculated →</SectionLink>}>
        Two ways to read pay
      </CardTitle>
      <PayViews />
      <Text size="sm" c="dimmed" mt="md" maw="var(--measure)">
        Someone with several appointments is named and placed by the main one (the highest FTE) and paid the sum of their
        salaried ones. Unpaid $0 affiliate appointments are left out of every count.
      </Text>
    </Card>
  );
}

function SourceCard() {
  return (
    <Card id="source">
      <CardTitle anchorId="source">Where the records come from</CardTitle>
      <Stack gap="sm">
        <Text size="sm">
          These are public records, obtained through Wisconsin open-records requests (Wis. Stat. §§ 19.31–19.39) filed by{' '}
          <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" fw={600} inherit>
            United Faculty &amp; Academic Staff (UFAS), AFT Local 223
          </Anchor>
          , the union representing UW–Madison faculty and academic staff. Their open-records work is what makes this
          transparency possible, and the credit for these records belongs to them.
        </Text>
        <Text size="sm" c="dimmed">
          This site is an independent project by Aaron Smetana. It is <b>not affiliated with or endorsed by UFAS or
          UW–Madison</b>, and any errors or interpretations are its own.
        </Text>
        <Group gap="lg" wrap="wrap">
          <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" size="sm" fw={500}>UFAS Local 223 →</Anchor>
          <Anchor href="https://docs.legis.wisconsin.gov/statutes/statutes/19/ii" target="_blank" rel="noopener noreferrer" size="sm" fw={500}>
            Wisconsin Public Records Law →
          </Anchor>
          <Anchor href="https://www.doj.state.wi.us/office-open-government/office-open-government" target="_blank" rel="noopener noreferrer" size="sm" fw={500}>
            File your own request →
          </Anchor>
        </Group>
      </Stack>
    </Card>
  );
}

function PrivacySummaryCard() {
  return (
    <Card id="privacy-summary">
      <CardTitle anchorId="privacy-summary" right={<SectionLink id="privacy" size="sm" fw={500}>Responsible use →</SectionLink>}>
        These records name real people
      </CardTitle>
      <Text size="sm" mb="md">
        Public-employee pay is public record, but public is not a license to harass, dox, shame or target anyone. Use it to
        understand pay structures, not to judge individuals.
      </Text>
      <RecordChips />
    </Card>
  );
}

/** The seven steps in one glance, each with what it counts; How it's built tells each in full. */
function PipelineSummaryCard({ f }: { f: PipelineFacts }) {
  const steps: [string, string, string][] = [
    ['Records request', 'Wis. Stat. § 19.35', 'UFAS requests the salary report. Nothing is scraped or estimated.'],
    ['Spreadsheet returned', plural(f.snapshots, 'workbook'), 'One row per appointment; the only input.'],
    ['Columns detected', f.columnsMapped != null ? `${f.columnsMapped} columns` : '—', 'Headers matched to fields, per report.'],
    ['Rows become people', f.peopleLatest != null ? `${num(f.peopleLatest)} people` : '—', 'Linked by name and hire date.'],
    ['Kept as snapshots', f.totalRows != null ? `${num(f.totalRows)} rows` : '—', 'Added beside the old ones, never over them.'],
    ['One file', 'salaries.parquet', `${f.parquetSize ? `${f.parquetSize}, the` : 'The'} same file you can download.`],
    ['Your browser', 'DuckDB-WASM', 'Queried locally. No server sees who you look up.'],
  ];
  return (
    <Card id="pipeline-summary">
      <CardTitle anchorId="pipeline-summary" sub="Every step is in the open-source ingestion, and every count here is read from the manifest."
        right={<SectionLink id="pipeline" size="sm" fw={500}>Step-by-step detail →</SectionLink>}>
        From records request to your browser
      </CardTitle>
      <ol className="pipeline-tiles">
        {steps.map(([title, metric, text], i) => (
          <li key={title} className="pipeline-tile">
            <span className="pipeline-dot" aria-hidden>{i + 1}</span>
            <Text size="sm" fw={650}>{title}</Text>
            <code className="formula-pill">{metric}</code>
            <Text size="xs" c="dimmed">{text}</Text>
          </li>
        ))}
      </ol>
      <DownloadButtons f={f} />
    </Card>
  );
}

/** The four things a reader can take away: the dataset, its manifest, the dictionary, the code. */
export function DownloadButtons({ f, code = true }: { f: PipelineFacts; code?: boolean }) {
  return (
    <Group gap="sm" wrap="wrap" mt="md" className="data-downloads">
      <Button component="a" className="data-dl-btn" href={f.parquetUrl} download variant="default" leftSection={<IconDownload size={ICON.compact} aria-hidden />}>
        Dataset <Text span c="dimmed" ml={6} inherit fw={400}>Parquet{f.parquetSize ? ` · ${f.parquetSize}` : ''}</Text>
      </Button>
      <Button component="a" className="data-dl-btn" href={f.manifestUrl} target="_blank" rel="noopener noreferrer" variant="default" leftSection={<IconBraces size={ICON.compact} aria-hidden />}>
        Manifest <Text span c="dimmed" ml={6} inherit fw={400}>JSON{f.manifestSize ? ` · ${f.manifestSize}` : ''}</Text>
      </Button>
      {f.dictUrl && (
        <Button component="a" className="data-dl-btn" href={f.dictUrl} target="_blank" rel="noopener noreferrer" variant="default" leftSection={<IconBook2 size={ICON.compact} aria-hidden />}>
          Data dictionary <Text span c="dimmed" ml={6} inherit fw={400}>{RECORD_FIELDS.length} fields</Text>
        </Button>
      )}
      {code && (
        <Button component="a" className="data-dl-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer" variant="default" leftSection={<IconBrandGithub size={ICON.compact} aria-hidden />}>
          Ingestion code <Text span c="dimmed" ml={6} inherit fw={400}>GitHub</Text>
        </Button>
      )}
    </Group>
  );
}

export function OverviewTab({ pipeline }: { pipeline: PipelineFacts }) {
  return (
    <Stack gap="lg">
      <WhatsNewCard />
      <RelyCard />
      <PayViewsCard />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <SourceCard />
        <PrivacySummaryCard />
      </SimpleGrid>
      <PipelineSummaryCard f={pipeline} />
    </Stack>
  );
}

