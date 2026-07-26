import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Card, Group, Select, NumberInput, Button, Table, Badge, Text, Alert, ScrollArea } from '@mantine/core';
import { IconListSearch, IconInfoCircle, IconArrowRight } from '@tabler/icons-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/Loading';
import { Eyebrow } from '../components/Eyebrow';
import { ICON } from '../lib/ui';
import { dropdownProps } from '../lib/selectProps';
import { usd, fmtYears, fullName } from '../lib/format';
import { toReal } from '../lib/cpi';
import { useSql, useActiveSnapshotId, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { computeScreeningResults, type ScreeningResult } from '../lib/screening';

const TENURE_EXPR = `date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25`;

interface SubjectRow {
  person_key: string; fn: string | null; ln: string | null; title: string | null; job_code: string | null;
  school: string | null; department: string | null; pay: number; tenure: number | null;
  grade_number: number | null; grade_basis: string | null; comp_basis: string | null; flsa_status: string | null;
}
interface CohortRowSql { person_key: string; job_code: string; comp_basis: string | null; pay: number; tenure: number | null }
interface HistRowSql { person_key: string; snapshot_date: string; pay: number }

const PAGE_SIZE = 100;

export default function Screening() {
  const nav = useNavigate();
  const { add } = useTray();
  const snap = useActiveSnapshotId();
  const { data: grades } = useGrades();

  const [school, setSchool] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [minN, setMinN] = useState<number>(4);
  const [runParams, setRunParams] = useState<{ school: string; department: string; minN: number } | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const visible = showAll ? results : results.slice(0, PAGE_SIZE);

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
        description="Batch-run the UW Salary Administration Guidelines checks (parity, compression, market floor) across a school or division, ranked by case strength."
      />

      <Card withBorder padding="lg">
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
            onChange={(v) => setMinN(typeof v === 'number' ? v : 4)}
            min={2}
            max={50}
            w={180}
          />
          <Button
            leftSection={<IconListSearch size={ICON.control} />}
            onClick={() => { setRunParams({ school, department, minN }); setShowAll(false); }}
          >
            Screen
          </Button>
        </Group>
      </Card>

      <Alert icon={<IconInfoCircle size={ICON.control} />} color="accent" variant="light">
        Reporting lines aren't in the public data, so supervisory (15% differential) checks aren't
        screened here — those live inside each individual report.
      </Alert>

      {!runParams ? (
        <EmptyState
          icon={<IconListSearch size={ICON.feature} />}
          title="No screen run yet"
          hint="Pick a scope above (or leave it as All schools) and click Screen to rank everyone by case strength."
        />
      ) : loading ? (
        <LoadingState label="Screening…" />
      ) : results.length === 0 ? (
        <EmptyState icon={<IconListSearch size={ICON.feature} />} title="No one in scope" hint="Try a broader school/department." />
      ) : (
        <Card withBorder padding={0}>
          <Group justify="space-between" p="md" pb="xs">
            <Text size="sm" c="dimmed">
              {results.length} people ranked by case strength{showAll || results.length <= PAGE_SIZE ? '' : ` — showing top ${PAGE_SIZE}`}.
            </Text>
          </Group>
          <ScrollArea.Autosize mah={720} type="auto">
            <Table stickyHeader striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>School</Table.Th>
                  <Table.Th ta="right">Tenure</Table.Th>
                  <Table.Th ta="right">Pay</Table.Th>
                  <Table.Th>Flags</Table.Th>
                  <Table.Th ta="right">Case strength</Table.Th>
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
                      <Button size="xs" variant="default" rightSection={<IconArrowRight size={14} />} onClick={() => draftReport(r)}>
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
