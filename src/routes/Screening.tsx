import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Stack, Card, Group, Select, NumberInput, Button, Table, Badge, Text, Alert, ScrollArea } from '@mantine/core';
import { IconListSearch, IconInfoCircle, IconArrowRight, IconDownload } from '@tabler/icons-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, focusControl } from '../components/EmptyState';
import { SortableTh, type SortState } from '../components/SortableTh';
import { LoadingState } from '../components/Loading';
import { Eyebrow } from '../components/Eyebrow';
import { ICON } from '../lib/ui';
import { dropdownProps } from '../lib/selectProps';
import { usd, num, fmtYears, fullName } from '../lib/format';
import { toReal } from '../lib/cpi';
import { useSql, useActiveSnapshotId, useGrades, useSummary } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { computeScreeningResults, type ScreeningResult } from '../lib/screening';
import { downloadCSV } from '../lib/csv';

const TENURE_EXPR = `date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25`;

interface SubjectRow {
  person_key: string; fn: string | null; ln: string | null; title: string | null; job_code: string | null;
  school: string | null; department: string | null; pay: number; tenure: number | null;
  grade_number: number | null; grade_basis: string | null; comp_basis: string | null; flsa_status: string | null;
}
interface CohortRowSql { person_key: string; job_code: string; comp_basis: string | null; pay: number; tenure: number | null }
interface HistRowSql { person_key: string; snapshot_date: string; pay: number }

const PAGE_SIZE = 100;
const DEFAULT_MIN_N = 4;

export default function Screening() {
  /** The scope card, so the empty state can put the cursor in it. */
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const nav = useNavigate();
  const { add } = useTray();
  const snap = useActiveSnapshotId();
  const { data: grades } = useGrades();
  const { data: summary } = useSummary();
  const campusHeadcount = summary?.latest?.headcount ?? null;

  // The run lives in the URL, like every other view in this app ("Controls live in the URL -> every
  // view is shareable/bookmarkable", state/controls.tsx). A screen is the most link-worthy thing here
  // — it is what you send to a steward — and it used to evaporate on reload.
  const [params, setParams] = useSearchParams();
  const runParams = useMemo(() => {
    if (!params.get('run')) return null;
    const n = Number(params.get('minN'));
    return {
      school: params.get('sch') ?? '',
      department: params.get('dept') ?? '',
      minN: Number.isFinite(n) && n >= 2 ? n : DEFAULT_MIN_N,
    };
  }, [params]);

  // Form state is seeded from the URL but edits freely until Screen is pressed, so typing in the
  // pickers doesn't re-run the query on every keystroke.
  const [school, setSchool] = useState<string>(() => params.get('sch') ?? '');
  const [department, setDepartment] = useState<string>(() => params.get('dept') ?? '');
  const [minN, setMinN] = useState<number>(() => {
    const n = Number(params.get('minN'));
    return Number.isFinite(n) && n >= 2 ? n : DEFAULT_MIN_N;
  });
  const [showAll, setShowAll] = useState(false);

  const unscoped = !school && !department;

  const run = () => {
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('run', '1');
        if (school) n.set('sch', school); else n.delete('sch');
        if (department) n.set('dept', department); else n.delete('dept');
        if (minN !== DEFAULT_MIN_N) n.set('minN', String(minN)); else n.delete('minN');
        return n;
      },
      { replace: true }
    );
    setShowAll(false);
  };

  const { data: schoolOpts } = useSql<{ school: string }>(
    ['screen-schools', snap ?? ''],
    `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL ORDER BY school`,
    !!snap
  );
  const { data: deptOpts } = useSql<{ department: string }>(
    ['screen-depts', snap ?? '', school],
    `SELECT DISTINCT department FROM salaries
     WHERE snapshot_id = ${sqlStr(snap ?? '')} AND department IS NOT NULL ${school ? `AND school = ${sqlStr(school)}` : ''}
     ORDER BY department`,
    !!snap
  );

  const scopeWhere = useMemo(() => {
    if (!runParams) return 'FALSE';
    const parts = ['TRUE'];
    if (runParams.school) parts.push(`school = ${sqlStr(runParams.school)}`);
    if (runParams.department) parts.push(`department = ${sqlStr(runParams.department)}`);
    return parts.join(' AND ');
  }, [runParams]);

  const { data: subjects, isFetching: loadingSubjects } = useSql<SubjectRow>(
    ['screen-subjects', snap ?? '', scopeWhere],
    `WITH pp AS (
       SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(title) title,
         any_value(job_code) job_code, any_value(school) school, any_value(department) department,
         any_value(grade_number) grade_number, any_value(grade_basis) grade_basis,
         any_value(comp_basis) comp_basis, any_value(flsa_status) flsa_status,
         ${personPay('fte')} pay, any_value(${TENURE_EXPR}) tenure
       FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND ${scopeWhere}
       GROUP BY person_key
     )
     SELECT * FROM pp WHERE pay > 0`,
    !!runParams && !!snap
  );

  const jobCodes = useMemo(() => [...new Set((subjects ?? []).map((s) => s.job_code).filter((j): j is string => !!j))], [subjects]);
  const jobCodesIn = jobCodes.map(sqlStr).join(',');

  const { data: cohortRows, isFetching: loadingCohort } = useSql<CohortRowSql>(
    ['screen-cohort', snap ?? '', jobCodesIn],
    `WITH pp AS (
       SELECT person_key, any_value(job_code) job_code, any_value(comp_basis) comp_basis,
         ${personPay('fte')} pay, any_value(${TENURE_EXPR}) tenure
       FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code IN (${jobCodesIn})
       GROUP BY person_key
     )
     SELECT * FROM pp WHERE pay > 0`,
    !!runParams && !!snap && jobCodes.length > 0
  );

  const { data: histRows, isFetching: loadingHist } = useSql<HistRowSql>(
    ['screen-hist', scopeWhere, snap ?? ''],
    // Scope decides WHO (membership at the latest snapshot), not which rows — then pull each scoped
    // person's FULL pay history regardless of the school/department they held it under. Filtering
    // every snapshot by the scope would truncate a school-mover's earlier pay points and skew the
    // real-erosion flag (which reads the first vs. last point of the series).
    `WITH scoped AS (
       SELECT DISTINCT person_key FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND ${scopeWhere}
     ),
     pp AS (
       SELECT s.person_key, s.snapshot_id, any_value(s.snapshot_date) snapshot_date, ${personPay('fte')} pay
       FROM salaries s JOIN scoped USING (person_key)
       GROUP BY s.person_key, s.snapshot_id
     )
     SELECT person_key, snapshot_date, pay FROM pp WHERE pay > 0`,
    !!runParams && !!snap
  );

  const loading = loadingSubjects || loadingCohort || loadingHist;

  const results = useMemo<ScreeningResult[]>(() => {
    if (!runParams || !subjects) return [];
    return computeScreeningResults({
      subjects: subjects.map((s) => ({
        person_key: s.person_key, name: fullName(s.fn, s.ln) || s.person_key, title: s.title, job_code: s.job_code,
        school: s.school, department: s.department, pay: s.pay, tenure: s.tenure,
        grade_number: s.grade_number, grade_basis: s.grade_basis, comp_basis: s.comp_basis, flsa_status: s.flsa_status,
      })),
      cohortRows: (cohortRows ?? []).map((r) => ({ person_key: r.person_key, job_code: r.job_code, comp_basis: r.comp_basis, pay: r.pay, tenure: r.tenure })),
      payHistory: (histRows ?? []).map((r) => ({ person_key: r.person_key, year: Number(String(r.snapshot_date).slice(0, 4)), pay: r.pay })),
      grades: (grades ?? []).map((g) => ({ grade: g.grade, basis: g.basis, min: g.min, max: g.max })),
      minCohortN: runParams.minN,
      toReal,
    }).sort((a, b) => b.score - a.score);
  }, [runParams, subjects, cohortRows, histRows, grades]);

  // Sortable like every other table in the app; score-descending stays the default because that is
  // the ranking the page exists to produce.
  type ScreenSortKey = 'name' | 'title' | 'school' | 'tenure' | 'pay' | 'score';
  const [sort, setSort] = useState<SortState<ScreenSortKey>>({ key: 'score', dir: 'desc' });
  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const val = (r: ScreeningResult) =>
      key === 'name' ? r.name
      : key === 'title' ? (r.title ?? '')
      : key === 'school' ? (r.school ?? '')
      : key === 'tenure' ? (r.tenure ?? -1)
      : key === 'pay' ? r.pay
      : r.score;
    return [...results].sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [results, sort]);

  const visible = showAll ? sorted : sorted.slice(0, PAGE_SIZE);

  // Export the whole ranking, not just the visible page — the point of a screen is to hand the list
  // to someone. Flags are flattened to their own columns so the CSV is filterable in a spreadsheet.
  const exportCsv = () =>
    downloadCSV(
      `uw-screening-${runParams?.school || 'all'}${runParams?.department ? `-${runParams.department}` : ''}-${snap ?? 'latest'}.csv`,
      sorted.map((r) => ({
        name: r.name,
        title: r.title ?? '',
        school: r.school ?? '',
        department: r.department ?? '',
        tenure_years: r.tenure != null ? r.tenure.toFixed(1) : '',
        pay: Math.round(r.pay),
        cohort_n: r.cohortN,
        percentile: r.percentile ?? '',
        gap_to_median: r.gapToMed != null ? Math.round(r.gapToMed) : '',
        tenure_inversions: r.tenureInvCount,
        compression: r.compressionCount,
        below_market: r.belowMarket ? 'yes' : 'no',
        real_dollar_decline: r.realErosion ? 'yes' : 'no',
        case_strength: r.scoreLabel,
        score: r.score,
      }))
    );

  const draftReport = (r: ScreeningResult) => {
    add({ type: 'person', id: r.key, label: r.name });
    // Pass ?subject= so Reports opens ON this person even when the tray already holds others —
    // Reports hydrates its subject from ?subject= on mount (and keeps it while it's a valid tray
    // member, which the add above guarantees). Without it, the tray's existing primary would win.
    nav(`/reports?type=comparison&subject=${encodeURIComponent(r.key)}`);
  };

  return (
    <Stack gap="lg">
      <PageHeader
        title="Screening"
        description="Check a whole school or department at once against the UW Salary Administration Guidelines. Everyone is ranked by how strong their case looks across three tests: parity, compression, and the market floor."
      />

      <Card withBorder padding="lg" ref={scopeRef}>
        <Eyebrow mb={8}>Scope</Eyebrow>
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select
            label="School / division"
            placeholder="All schools"
            data={(schoolOpts ?? []).map((s) => ({ value: s.school, label: s.school }))}
            value={school || null}
            onChange={(v) => { setSchool(v ?? ''); setDepartment(''); }}
            clearable
            searchable
            w={280}
            {...dropdownProps('md')}
          />
          <Select
            label="Department"
            placeholder="All departments"
            data={(deptOpts ?? []).map((d) => ({ value: d.department, label: d.department }))}
            value={department || null}
            onChange={(v) => setDepartment(v ?? '')}
            clearable
            searchable
            w={280}
            {...dropdownProps('md')}
          />
          <NumberInput
            label="Min. cohort size"
            description="Below this, parity/compression are skipped"
            value={minN}
            onChange={(v) => setMinN(typeof v === 'number' ? v : DEFAULT_MIN_N)}
            min={2}
            max={50}
            w={180}
          />
          <Button
            leftSection={<IconListSearch size={ICON.control} />}
            onClick={run}
          >
            {unscoped && campusHeadcount != null ? `Screen all ${num(campusHeadcount)}` : 'Screen'}
          </Button>
        </Group>
        {/* An unscoped run pulls every employee and their full pay history into the browser and scores
            each against their whole title cohort — tens of millions of operations on the main thread,
            behind a single "Screening…" label. It is a legitimate thing to want; it just shouldn't be
            the thing you fall into because the empty state suggested it. Say what it costs. */}
        {unscoped && (
          <Text size="xs" c="dimmed" mt="sm">
            No scope selected — this screens every employee at once and can take a while to compute.
            Picking a school or department is much faster.
          </Text>
        )}
      </Card>

      <Alert icon={<IconInfoCircle size={ICON.control} />} color="accent" variant="light">
        Reporting lines aren't in the public data, so supervisory (15% differential) checks aren't
        screened here — those live inside each individual report.
      </Alert>

      {!runParams ? (
        <EmptyState
          icon={<IconListSearch size={ICON.feature} />}
          title="No screen run yet"
          hint="Choose a school or department, then run the screen to rank everyone in it by case strength."
          action={<Button variant="light" onClick={() => focusControl(scopeRef)}>Choose a scope</Button>}
        />
      ) : loading ? (
        <LoadingState label="Screening…" />
      ) : results.length === 0 ? (
        <EmptyState icon={<IconListSearch size={ICON.feature} />} title="No one in scope" hint="Try a broader school/department." />
      ) : (
        <Card withBorder padding={0}>
          <Group justify="space-between" p="md" pb="xs" wrap="wrap" gap="sm">
            <Text size="sm" c="dimmed">
              {results.length} people ranked by case strength{showAll || results.length <= PAGE_SIZE ? '' : ` — showing top ${PAGE_SIZE}`}.
            </Text>
            <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.inline} />} onClick={exportCsv}>
              CSV
            </Button>
          </Group>
          <ScrollArea.Autosize mah={720} type="auto">
            <Table stickyHeader striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <SortableTh sortKey="name" label="Name" sort={sort} onSort={setSort} />
                  <SortableTh sortKey="title" label="Title" sort={sort} onSort={setSort} />
                  <SortableTh sortKey="school" label="School" sort={sort} onSort={setSort} />
                  <SortableTh sortKey="tenure" label="Tenure" sort={sort} onSort={setSort} align="right" />
                  <SortableTh sortKey="pay" label="Pay" sort={sort} onSort={setSort} align="right" />
                  <Table.Th>Flags</Table.Th>
                  <SortableTh sortKey="score" label="Case strength" sort={sort} onSort={setSort} align="right" />
                  <Table.Th w={140} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((r) => (
                  <Table.Tr key={r.key}>
                    <Table.Td>{r.name}</Table.Td>
                    <Table.Td>{r.title ?? '—'}</Table.Td>
                    <Table.Td>{r.school ?? '—'}</Table.Td>
                    <Table.Td ta="right">{r.tenure != null ? fmtYears(r.tenure) : '—'}</Table.Td>
                    <Table.Td ta="right">{usd(r.pay)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        {r.tooFewPeers && <Badge size="sm" variant="light" color="gray">Too few peers</Badge>}
                        {r.tenureInvCount > 0 && <Badge size="sm" variant="light" color="red">Inversion ×{r.tenureInvCount}</Badge>}
                        {r.compressionCount > 0 && <Badge size="sm" variant="light" color={r.compressionInvertedCount > 0 ? 'red' : 'orange'}>Compression ×{r.compressionCount}</Badge>}
                        {r.belowMarket && <Badge size="sm" variant="light" color="orange">Below market floor</Badge>}
                        {r.realErosion && <Badge size="sm" variant="light" color="orange">Real-dollar decline</Badge>}
                        {!r.tooFewPeers && r.tenureInvCount === 0 && r.compressionCount === 0 && !r.belowMarket && !r.realErosion && (
                          <Badge size="sm" variant="light" color="gray">No flags</Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Badge variant="light" color={r.scoreLabel === 'Strong' ? 'pos' : r.scoreLabel === 'Moderate' ? 'accent' : 'gray'}>
                        {r.scoreLabel} · {r.score}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="default" rightSection={<IconArrowRight size={ICON.compact} />} onClick={() => draftReport(r)}>
                        Draft report
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
          {!showAll && results.length > PAGE_SIZE && (
            <Group justify="center" p="md">
              <Button variant="default" onClick={() => setShowAll(true)}>Show all {results.length}</Button>
            </Group>
          )}
        </Card>
      )}
    </Stack>
  );
}
