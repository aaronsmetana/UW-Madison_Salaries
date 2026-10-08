import type { ReactNode } from 'react';
import { ShowAll, useShowAll } from './ShowAll';
import { Accordion, Anchor, Box, Card, Group, List, Paper, ScrollArea, SimpleGrid, Skeleton, Table, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { CardTitle } from './CardTitle';
import { NewBadge } from './NewBadge';
import { useDepartmentChanges, useGrades, useLatestStep, useRelease, useSql, useSummary } from '../lib/hooks';
import { GRADED_APPT } from '../lib/queries';
import { belowMinimumSql, bandScaleSql, isRange } from '../lib/bands';
import { fmtChange, fmtDate, num, pct, usd } from '../lib/format';
import { sqlStr } from '../lib/duckdb';

/**
 * The Data page's account of the newest release: what it holds against the one before, the pay step it
 * carried, the salary ranges if they came with it, who is now paid below their grade's minimum, and what
 * was reorganized or renamed. Every figure is read from the build (summary, reference status, raise steps,
 * departments) or the data itself; none is typed in, so the next release rewrites all of it.
 */

/** One headline figure: the number, what it is, and a line of context. */
function Figure({ label, value, sub, attr }: { label: string; value: ReactNode; sub?: ReactNode; attr?: string }) {
  return (
    <Paper withBorder p="sm" radius="md" data-figure={attr}>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="lg" className="whats-new-value">{value}</Text>
      {sub && <Text size="xs" c="dimmed">{sub}</Text>}
    </Paper>
  );
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

export function WhatsNew() {
  const release = useRelease();
  const step = useLatestStep('fte');
  const { data: depts } = useDepartmentChanges();
  const below = useBelowMinimum(release?.latest.id);
  const retitled = useRetitled(release?.previous?.id, release?.latest.id);
  if (!release) return <Skeleton height={220} radius="lg" />;
  const { latest, previous, ref } = release;
  const deptStep = depts?.steps.find((s) => s.to === latest.id);
  const change = (a?: number | null, b?: number | null) => (a != null && b ? a / b - 1 : null);
  const stepIsFromPrevious = step && previous && step.from_id === previous.id && step.to_id === latest.id;
  const acrossTheBoard = stepIsFromPrevious && step.share >= 0.5;

  return (
    <Card id="whats-new" className="whats-new" data-release={latest.id}>
      <CardTitle
        order={3}
        anchorId="whats-new"
        sub={previous ? `Against ${previous.label}, the release before it.` : undefined}
        right={<NewBadge />}
      >
        The {release.month} release
      </CardTitle>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
        <Figure attr="people" label="People paid" value={num(latest.headcount)} sub={previous ? `${fmtChange(change(latest.headcount, previous.headcount))} vs ${previous.label}` : undefined} />
        <Figure attr="median" label="Median pay" value={usd(latest.median)} sub={previous ? `${fmtChange(change(latest.median, previous.median))} vs ${previous.label}` : undefined} />
        {stepIsFromPrevious && (
          acrossTheBoard
            ? <Figure attr="step" label="Most common raise" value={`+${(step.raise * 100).toFixed(1)}%`} sub={`${pct(step.share, 0)} of ${num(step.n)} got exactly this`} />
            : <Figure attr="step" label="Median raise" value={step.median == null ? '—' : fmtChange(step.median)} sub={`${num(step.n)} kept their title and appointment`} />
        )}
        {release.rangesUpdated && ref && (
          <Figure attr="ranges" label="Salary ranges" value={ref.structure_change != null ? fmtChange(ref.structure_change) : 'Updated'} sub={`cover ${pct(ref.coverage, 0)} of graded appointments`} />
        )}
      </SimpleGrid>
      <List size="sm" spacing="xs" className="whats-new-list">
        {acrossTheBoard && (
          <List.Item data-item="step">
            <b>An across-the-board step.</b> {pct(step.share, 0)} of the {num(step.n)} people who kept the same title and
            appointment since {previous?.label} were raised exactly {(step.raise * 100).toFixed(1)}%.{' '}
            <Anchor component={Link} to="/explore?tab=changes" inherit>See every raise in Changes →</Anchor>
          </List.Item>
        )}
        {release.rangesUpdated && ref && (
          <List.Item data-item="ranges">
            <b>Salary ranges updated.</b> UW–Madison&apos;s published structure, retrieved {fmtDate(ref.retrieved_at)}, now gives a range
            for {pct(ref.coverage, 0)} of graded appointments and a minimum for {pct(ref.floor_coverage, 0)} more
            {ref.structure_change != null ? <>; its figures are {fmtChange(ref.structure_change)} on the ones this site carried before</> : null}.{' '}
            <Anchor href="#salary-ranges" inherit>The ranges →</Anchor>
          </List.Item>
        )}
        {below && below.n > 0 && ref?.status === 'ok' && (
          <List.Item data-item="below-min">
            <b>{num(below.n)} {below.n === 1 ? 'person is' : 'people are'} paid below their grade&apos;s minimum</b>
            {below.hourly > 0 ? `, ${num(below.hourly)} of them hourly` : ''} — read on the full-time rate of the appointment that
            carries the grade.{' '}
            <Anchor component={Link} to="/screening?run=1&flag=below-min" inherit className="below-min-link">Screen them →</Anchor>
          </List.Item>
        )}
        {release.reorganizations.map((r) => (
          <List.Item key={r.school} data-item="reorganization">
            <b>A new division: {r.school}</b> ({num(r.people)} people), formed from{' '}
            {r.from.map((f, i) => (
              <span key={f.school}>{i > 0 ? '; ' : ''}{f.school}&apos;s {listOf(f.departments)} ({num(f.people)} people)</span>
            ))}. Counted by division they read as leaving one and joining the other; it is a reorganization.
          </List.Item>
        ))}
        {retitled && retitled.codes > 0 && (
          <List.Item data-item="retitled">
            <b>{num(retitled.codes)} job titles are worded differently</b> with their job codes unchanged
            {retitled.was && retitled.now ? <> — &ldquo;{retitled.was}&rdquo; is now &ldquo;{retitled.now}&rdquo;</> : null}. Histories
            follow the job code, so none of these reads as a promotion, and search finds a title by its old wording too.
          </List.Item>
        )}
        {deptStep && (deptStep.carried.length > 0 || deptStep.mergers.length > 0) && (
          <List.Item data-item="departments">
            <b>Departments:</b>{' '}
            {deptStep.carried.length > 0 && <>{num(deptStep.carried.length)} renamed, each carried under its new name so its history continues</>}
            {deptStep.carried.length > 0 && deptStep.mergers.length > 0 && '; '}
            {deptStep.mergers.length > 0 && <>{num(deptStep.mergers.length)} merged into new {deptStep.mergers.length === 1 ? 'department' : 'departments'}, whose histories start here</>}.{' '}
            <Anchor href="#departments" inherit>Every change →</Anchor>
          </List.Item>
        )}
      </List>
    </Card>
  );
}

/** "A, B and C". */
function listOf(xs: string[]) {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The published salary structure the app reads every pay band against: where it comes from, what it
 * covers, how it is used, and the figures — grades with a range, and grades with a minimum only.
 */
export function SalaryRanges() {
  const { data: grades } = useGrades();
  const release = useRelease();
  const ref = release?.ref;
  // The figures are the same on every schedule (lib/bands); the 12-month rows list each grade once.
  const rows = (grades ?? []).filter((g) => g.basis === 'annual_12mo').sort((a, b) => a.grade - b.grade);
  const ranges = rows.filter((g): g is typeof g & { max: number } => isRange(g));
  const floors = rows.filter((g) => !isRange(g));
  // The first rows of each, the rest on "Show all" (G11): the page's one scroll, not two boxes inside it.
  const rangePage = useShowAll(ranges, ranges.length);
  const floorPage = useShowAll(floors, floors.length);
  const none = ref && ref.coverage != null && ref.floor_coverage != null ? Math.max(0, 1 - ref.coverage - ref.floor_coverage) : null;
  return (
    <Card id="salary-ranges" className="salary-ranges">
      <CardTitle
        order={3}
        anchorId="salary-ranges"
        sub={ref?.retrieved_at ? `UW–Madison's published salary structure, retrieved ${fmtDate(ref.retrieved_at)}. HR states no effective date.` : undefined}
        right={release?.rangesUpdated ? <NewBadge /> : undefined}
      >
        Salary ranges
      </CardTitle>
      <Box maw="var(--measure)">
        <Text size="sm">
          Every pay-band figure on this site — a person&apos;s place in their range, the compa-ratio, Screening&apos;s
          &ldquo;below market floor&rdquo; (85% of the midpoint) and &ldquo;below grade minimum&rdquo; — reads these, from the{' '}
          <Anchor href={ref?.source_url ?? 'https://hr.wisc.edu/pay/salary-structure/'} target="_blank" rel="noopener noreferrer" inherit>
            Office of Human Resources&apos; salary structure
          </Anchor>
          . Grades 15–35 are published as ranges. Most of grades 51–99 are published with a minimum only, which says whether
          pay is below it and nothing that needs a top.
        </Text>
        <Text size="sm" mt="xs">
          A band is compared with the <b>full-time rate</b> of the appointment that carries the grade, never with part-time
          pay. Hourly pay is annualized at 2,080 hours, as the source reports it; 9-month appointments are compared at their
          12-month equivalent, which is how the source has reported them since Sep 2025 (before that, the band is scaled to
          the 9-month amount, HR&apos;s own 9/11).
        </Text>
      </Box>
      {ref && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mt="md" className="salary-ranges-coverage">
          <Figure attr="range-coverage" label="Graded appointments with a range" value={pct(ref.coverage, 0)} sub={`${num(ref.matched_rows)} of ${num(ref.graded_rows)}`} />
          <Figure attr="floor-coverage" label="With a minimum only" value={pct(ref.floor_coverage ?? null, 0)} sub={ref.floor_rows != null ? `${num(ref.floor_rows)} more` : undefined} />
          <Figure attr="no-range" label="None published" value={none == null ? '—' : pct(none, 0)} sub={'“Contact your division”, “varies by job title”'} />
        </SimpleGrid>
      )}
      {ref?.structure_change != null && (
        <Text size="sm" mt="md" data-structure-change>
          The figures are <b>{fmtChange(ref.structure_change)}</b> on the ranges this site carried before, measured over the grades both
          carried.
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mt="md">
        <Box>
          <Text size="sm" fw={600} mb={6}>Grades with a range ({num(ranges.length)})</Text>
          <ScrollArea.Autosize type="auto" offsetScrollbars="present" viewportProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Grades with a range' }}>
            <Table striped={false} verticalSpacing={6} className="salary-ranges-table" data-kind="range">
              <Table.Thead>
                <Table.Tr><Table.Th>Grade</Table.Th><Table.Th ta="right">Minimum</Table.Th><Table.Th ta="right">Midpoint</Table.Th><Table.Th ta="right">Maximum</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rangePage.shown.map((g) => (
                  <Table.Tr key={g.grade} data-grade={g.grade}>
                    <Table.Td>{g.grade}</Table.Td>
                    <Table.Td ta="right">{usd(g.min)}</Table.Td>
                    <Table.Td ta="right">{usd((g.min + g.max) / 2)}</Table.Td>
                    <Table.Td ta="right">{usd(g.max)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <ShowAll shown={rangePage.shown.length} total={rangePage.total} onShowAll={rangePage.showAll} />
        </Box>
        <Box>
          <Text size="sm" fw={600} mb={6}>Grades with a minimum only ({num(floors.length)})</Text>
          <ScrollArea.Autosize type="auto" offsetScrollbars="present" viewportProps={{ role: 'region', tabIndex: 0, 'aria-label': 'Grades with a minimum only' }}>
            <Table striped={false} verticalSpacing={6} className="salary-ranges-table" data-kind="minimum">
              <Table.Thead>
                <Table.Tr><Table.Th>Grade</Table.Th><Table.Th ta="right">Minimum</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {floorPage.shown.map((g) => (
                  <Table.Tr key={g.grade} data-grade={g.grade}>
                    <Table.Td>{g.grade}</Table.Td>
                    <Table.Td ta="right">{usd(g.min)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          <ShowAll shown={floorPage.shown.length} total={floorPage.total} onShowAll={floorPage.showAll} />
        </Box>
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="sm">
        12-month salary figures, the same on each schedule the data uses. Grades HR lists as &ldquo;Contact your division&rdquo;,
        &ldquo;Varies by job title&rdquo; or &ldquo;Not applicable&rdquo; carry no figure here.
      </Text>
    </Card>
  );
}

/**
 * Department renames, release by release: the ones carried under their new name, mergers left as they
 * were, and the departments that ended some other way, with where their people went.
 */
export function DepartmentRenames() {
  const { data } = useDepartmentChanges();
  const { data: summary } = useSummary();
  const label = (id: string) => summary?.snapshots.find((s) => s.id === id)?.label ?? id;
  const steps = [...(data?.steps ?? [])].reverse().filter((s) => s.carried.length || s.mergers.length || s.gone.length);
  const newest = summary?.latest?.id;
  const share = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Card id="departments" className="data-wide department-renames">
      <CardTitle
        order={3}
        anchorId="departments"
        sub={data ? `${num(data.mapped)} renames carried across every release.` : undefined}
      >
        Department renames
      </CardTitle>
      <Text size="sm" maw="var(--measure)">
        The source renames departments between releases. A department is carried under its new name when at least{' '}
        {share(data?.rule.share ?? 0.75)} of its continuing people sit in one new department of the same school, at least{' '}
        {data?.rule.min ?? 3} of them, and at least {share(data?.rule.share ?? 0.75)} of that department&apos;s continuing people came from
        it — so its history runs on under the name in use now. Several departments merging into one are left as they were:
        carrying a merger would file every older unit under the new name and wipe its history.
      </Text>
      <Accordion variant="contained" mt="md" multiple order={4} defaultValue={newest ? [newest] : []}>
        {steps.map((s) => (
          <Accordion.Item key={s.to} value={s.to} data-step={s.to}>
            <Accordion.Control>
              <Group gap={8} wrap="wrap">
                <Text size="sm" fw={600}>{label(s.from)} → {label(s.to)}</Text>
                <Text size="xs" c="dimmed">
                  {num(s.carried.length)} renamed · {num(s.mergers.length)} merged · {num(s.gone.length)} ended
                </Text>
                {s.to === newest && <NewBadge />}
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {s.carried.length > 0 && (
                <Box mb="md">
                  <Text size="xs" fw={700} mb={4}>Renamed, carried under the new name</Text>
                  <Table verticalSpacing={6} className="dept-table" data-kind="carried">
                    <Table.Thead><Table.Tr><Table.Th>School</Table.Th><Table.Th>Was</Table.Th><Table.Th>Now</Table.Th><Table.Th ta="right">People</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {s.carried.map((r) => (
                        <Table.Tr key={`${r.school}|${r.from}`}>
                          <Table.Td>{r.school}</Table.Td><Table.Td>{r.from}</Table.Td><Table.Td>{r.to}</Table.Td>
                          <Table.Td ta="right">{num(r.carried)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Box>
              )}
              {s.mergers.length > 0 && (
                <Box mb="md">
                  <Text size="xs" fw={700} mb={4}>Merged, not carried</Text>
                  <List size="sm" spacing={2}>
                    {s.mergers.map((m) => (
                      <List.Item key={`${m.school}|${m.to}`}>
                        {m.from.map((f) => f.department).join(' + ')} → <b>{m.to}</b> <Text span c="dimmed" size="xs">({m.school})</Text>
                      </List.Item>
                    ))}
                  </List>
                </Box>
              )}
              {s.gone.length > 0 && (
                <Box>
                  <Text size="xs" fw={700} mb={4}>Ended otherwise ({num(s.gone.length)})</Text>
                  <Text size="xs" c="dimmed" mb={4}>Where most of each one&apos;s continuing people went.</Text>
                  <List size="sm" spacing={2}>
                    {s.gone.map((g) => (
                      <List.Item key={`${g.school}|${g.department}`}>
                        {g.department} <Text span c="dimmed" size="xs">({g.school})</Text>
                        {g.to ? <> — {share(g.share)} of {num(g.carried)} to {g.to}{g.to_school && g.to_school !== g.school ? ` (${g.to_school})` : ''}</> : <> — {g.people === 1 ? 'its one person is not in the next release' : `none of its ${num(g.people)} people are in the next release`}</>}
                      </List.Item>
                    ))}
                  </List>
                </Box>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Card>
  );
}
