import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Stack, Title, Text, Group, Button, Select, SegmentedControl, Card, Table, SimpleGrid, Divider, Paper,
  Checkbox, NumberInput, TextInput, Alert, ThemeIcon, Drawer, Badge, Progress, Switch, Accordion,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconDownload, IconPrinter, IconChartBar, IconScale, IconCheck, IconHistory, IconAdjustments,
} from '@tabler/icons-react';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay } from '../lib/queries';
import { dropdownProps } from '../lib/selectProps';
import { useTray } from '../state/tray';
import { usd, num, pct, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { PersonDashboard } from '../components/PersonDashboard';
import { SearchBox } from '../components/SearchBox';

interface Subject {
  pay: number | null; rate: number | null; title: string | null; job_code: string | null;
  grade_number: number | null; grade_basis: string | null;
  school: string | null; department: string | null; date_of_hire: string | null;
}
interface PeerStat { n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; p90: number | null; hi: number | null }
interface TrayPerson { person_key: string; fn: string; ln: string; title: string | null; pay: number; tenure: number | null }

const SECTIONS = [
  { value: 'highlights', label: 'Evidence (3 proofs)' },
  { value: 'peers', label: 'Peer comparison' },
];

function ordinal(n: number): string {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Strict three-color palette for the whole report: candidate = slate blue, peers = neutral gray,
// target / positive raise = emerald green. (No alarm colors — this is a calm, premium HR document.)
const CAND = 'var(--mantine-color-indigo-6)';
const PEER = 'var(--mantine-color-gray-5)';

export default function Reports() {
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { data: summary } = useSummary();
  const { items } = useTray();
  const [settingsOpen, { open: openSettings, close: closeSettings }] = useDisclosure(false);
  const snapLabel = summary?.snapshots.find((x) => x.id === snap)?.label ?? snap ?? '—';
  const generated = new Date().toISOString().slice(0, 10);

  const [type, setType] = useState('person');

  // ── Report on person: pick any employee; history rows power the CSV export ──
  const [selPerson, setSelPerson] = useState<{ key: string; name: string } | null>(null);
  const { data: personHistory } = useSql<{ snapshot: string; title: string | null; job_code: string | null; school: string | null; pay: number | null; fte: number | null }>(
    ['rpt-person-hist', selPerson?.key ?? '', metric],
    `SELECT snapshot_label AS snapshot, title, job_code, school, ${expr} AS pay, fte
     FROM salaries WHERE person_key = ${sqlStr(selPerson?.key ?? '')} ORDER BY snapshot_date`,
    type === 'person' && !!selPerson
  );

  // ── Justification report (tray) ─────────────────────────────────────────
  const persons = items.filter((i) => i.type === 'person');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');

  const [subjectKey, setSubjectKey] = useState<string | null>(null);
  useEffect(() => {
    if (persons.length && (!subjectKey || !persons.some((p) => p.id === subjectKey))) {
      setSubjectKey(persons[0].id);
    }
    if (!persons.length && subjectKey) setSubjectKey(null);
  }, [persons, subjectKey]);
  const subjectName = persons.find((p) => p.id === subjectKey)?.label ?? '';
  const subjectFirst = subjectName.split(' ')[0] || 'They';

  const [sections, setSections] = useState<string[]>(SECTIONS.map((s) => s.value));
  const has = (s: string) => sections.includes(s);

  const [superviseOn, setSuperviseOn] = useState(false);
  const [superviseCount, setSuperviseCount] = useState<number | ''>(0);
  const [superviseNote, setSuperviseNote] = useState('');
  const [peersSupervise, setPeersSupervise] = useState(false); // assert the compared peers also supervise
  const supN = typeof superviseCount === 'number' ? superviseCount : 0;
  const supervises = superviseOn && supN > 0;

  // Supplemental justification: optionally aim above the median when added qualifications support it.
  const [aboveMedian, setAboveMedian] = useState(false);
  const [certs, setCerts] = useState('');
  const [education, setEducation] = useState('');

  const cmpReady = type === 'comparison' && !!snap && !!subjectKey;

  const { data: subjRows } = useSql<Subject>(
    ['rpt-subj', subjectKey, snap ?? '', metric],
    `SELECT ${personPay(metric)} pay, ${personPay('full')} rate,
        arg_max(title, ${expr}) title, arg_max(job_code, ${expr}) job_code,
        arg_max(grade_number, ${expr}) grade_number, arg_max(grade_basis, ${expr}) grade_basis,
        any_value(school) school, any_value(department) department, min(date_of_hire) date_of_hire
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key = ${sqlStr(subjectKey ?? '')}`,
    cmpReady
  );
  const subj = subjRows?.[0];
  const subjectPay = subj?.pay ?? null;
  const jobCode = subj?.job_code ?? null;

  const { data: peerStatRows } = useSql<PeerStat>(
    ['rpt-peerstat', jobCode ?? '', snap ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
        quantile_cont(pay, 0.75) p75, quantile_cont(pay, 0.90) p90, max(pay) hi FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );
  const peer = peerStatRows?.[0];

  const { data: peerListRows } = useSql<{ pay: number; tenure: number | null }>(
    ['rpt-peerlist', jobCode ?? '', snap ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT pay, tenure FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );

  const { data: trayPeople } = useSql<TrayPerson>(
    ['rpt-tray', personIds, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && persons.length > 0 && !!snap
  );

  // Title median per snapshot vs the subject's pay — powers the "below the median over time" longevity stat.
  const { data: medHist } = useSql<{ date: string; med: number | null; pay: number | null }>(
    ['rpt-med-hist', jobCode ?? '', subjectKey ?? '', metric],
    `WITH per_snap AS (
        SELECT snapshot_id, any_value(snapshot_date) date, person_key, ${personPay(metric)} pay
        FROM salaries WHERE job_code = ${sqlStr(jobCode ?? '')} GROUP BY snapshot_id, person_key),
      m AS (SELECT snapshot_id, any_value(date) date, median(pay) FILTER (WHERE pay > 0) med FROM per_snap GROUP BY snapshot_id),
      s AS (SELECT snapshot_id, pay FROM per_snap WHERE person_key = ${sqlStr(subjectKey ?? '')})
     SELECT m.date date, m.med med, s.pay pay FROM m JOIN s USING (snapshot_id) ORDER BY date`,
    cmpReady && !!jobCode
  );

  // Full pay history for everyone in the tray — powers the peer-vs-subject progression comparison.
  const { data: peerHist } = useSql<{ person_key: string; date: string; pay: number }>(
    ['rpt-peer-hist', personIds, metric],
    `SELECT person_key, any_value(snapshot_date) date, ${personPay(metric)} pay
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    type === 'comparison' && persons.length > 0
  );

  // ── Derived stats ───────────────────────────────────────────────────────
  const tenureYears = useMemo(() => {
    if (!subj?.date_of_hire) return null;
    return Math.max(0, (Date.now() - new Date(subj.date_of_hire).getTime()) / (365.25 * 864e5));
  }, [subj]);

  const percentile = useMemo(() => {
    if (!peerListRows?.length || subjectPay == null) return null;
    const below = peerListRows.filter((p) => p.pay <= subjectPay).length;
    return Math.round((100 * below) / peerListRows.length);
  }, [peerListRows, subjectPay]);

  const expMedian = useMemo(() => {
    if (!peerListRows || tenureYears == null) return null;
    const cohort = peerListRows.filter((p) => p.tenure != null && p.tenure >= tenureYears - 1).map((p) => p.pay);
    return cohort.length >= 5 ? median(cohort) : null;
  }, [peerListRows, tenureYears]);

  const med = peer?.med ?? null; // market parity (title median) — shown as a secondary reference

  const otherPeers = useMemo(
    () => (trayPeople ?? [])
      .filter((p) => p.person_key !== subjectKey)
      .map((p) => ({ ...p, delta: (subjectPay ?? 0) - p.pay }))
      .sort((a, b) => b.pay - a.pay),
    [trayPeople, subjectKey, subjectPay]
  );

  // ── Targets: tenure-adjusted median by default (tenure = years since UW–Madison date of hire);
  //    an above-median (75th-pctile) target when the user asserts supplemental qualifications justify it. ──
  const baseTarget = expMedian ?? med ?? null; // tenure-adjusted parity (falls back to title median)
  const elevatedTarget = peer?.p75 ?? baseTarget; // above-median, justified by added qualifications
  const primaryTarget = (aboveMedian ? elevatedTarget : baseTarget) ?? null;
  const belowTarget = subjectPay != null && primaryTarget != null && subjectPay < primaryTarget;
  const targetDelta = belowTarget && primaryTarget != null && subjectPay != null ? primaryTarget - subjectPay : 0;
  const targetPct = belowTarget && subjectPay ? targetDelta / subjectPay : 0;
  // Plain-language reason the target number was chosen (shown under the hero figure).
  const targetBasis = aboveMedian
    ? `the 75th-percentile pay for this title — an above-median target justified by ${[certs.trim() && 'added certifications', education.trim() && 'further education/training', supervises && 'expanded supervisory scope'].filter(Boolean).join(', ') || 'added qualifications'}`
    : expMedian != null
      ? `the median pay of same-title peers with at least ${tenureYears != null ? `${tenureYears.toFixed(0)} years` : 'the same'} of UW–Madison tenure`
      : peer?.p75 != null ? 'the 75th-percentile pay for this title' : 'the median pay for this title';

  // Deficit to the title median — the "basic correction to market baseline" framing.
  const medianDeficit = med != null && subjectPay != null && subjectPay < med ? med - subjectPay : 0;

  // Tenure inversion — same-title peers with STRICTLY LESS UW–Madison tenure than the subject who are
  // nonetheless paid more. The hardest-to-rebut argument; computed across the full UW peer population.
  const tenureInversion = useMemo(() => {
    if (!peerListRows || tenureYears == null || subjectPay == null) return null;
    const lower = peerListRows.filter((p) => p.tenure != null && p.tenure < tenureYears && p.pay > subjectPay);
    const maxGap = lower.length ? Math.max(...lower.map((p) => p.pay - subjectPay)) : 0;
    return { count: lower.length, maxGap, total: peerListRows.length };
  }, [peerListRows, tenureYears, subjectPay]);

  // Below the title median over time. `streakYears` = distinct calendar years in the most-recent
  // unbroken run of below-median snapshots — the honest "consecutive years in market deficit" figure.
  const longevity = useMemo(() => {
    const rows = (medHist ?? []).filter((r) => r.pay != null && r.pay > 0 && r.med != null);
    if (!rows.length) return null;
    const below = rows.filter((r) => (r.pay as number) < (r.med as number));
    const streakDates: string[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i].pay as number) < (rows[i].med as number)) streakDates.push(rows[i].date);
      else break;
    }
    const streakYears = new Set(streakDates.map((d) => new Date(d).getFullYear())).size;
    return { belowCount: below.length, total: rows.length, streak: streakDates.length, streakYears };
  }, [medHist]);

  // Peer-vs-subject career progression (total growth + raise count) from full histories.
  const progression = useMemo(() => {
    const byPerson = new Map<string, number[]>();
    for (const r of peerHist ?? []) {
      if (r.pay == null || r.pay <= 0) continue;
      const arr = byPerson.get(r.person_key) ?? [];
      arr.push(r.pay);
      byPerson.set(r.person_key, arr);
    }
    const calc = (a: number[]) => {
      let raises = 0;
      for (let i = 1; i < a.length; i++) if (a[i] > a[i - 1]) raises++;
      const abs = a.length >= 2 ? a[a.length - 1] - a[0] : null; // absolute dollars gained
      return { abs, raises };
    };
    const peers = [...byPerson.entries()].filter(([k]) => k !== subjectKey).map(([, a]) => calc(a));
    const subjArr = subjectKey ? byPerson.get(subjectKey) : undefined;
    const subjC = subjArr ? calc(subjArr) : null;
    const absVals = peers.map((p) => p.abs).filter((v): v is number => v != null);
    return {
      avgAbs: absVals.length ? absVals.reduce((s, v) => s + v, 0) / absVals.length : null,
      subjAbs: subjC?.abs ?? null,
    };
  }, [peerHist, subjectKey]);

  // Peer Parity Matrix rows — the candidate is pinned to the top as a permanent baseline, then peers
  // sorted highest-paid first (otherPeers is already sorted desc).
  const tableRows = useMemo(() => {
    const rows: { key: string; name: string; title: string | null; pay: number; tenure: number | null; isSubject: boolean }[] =
      otherPeers.map((p) => ({ key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, pay: p.pay, tenure: p.tenure ?? null, isSubject: false }));
    if (subjectPay != null) rows.unshift({ key: '__subject__', name: subjectName, title: subj?.title ?? null, pay: subjectPay, tenure: tenureYears, isSubject: true });
    return rows;
  }, [otherPeers, subjectPay, subjectName, subj, tenureYears]);
  const maxPay = Math.max(1, ...tableRows.map((r) => r.pay));
  const showTenure = tableRows.some((r) => r.tenure != null);

  // Scale for the absolute-dollar divergence bars, and whether to show them (subject gained fewer $).
  const aMax = Math.max(progression.avgAbs ?? 0, progression.subjAbs ?? 0, 1);
  const showDivergence = progression.subjAbs != null && progression.avgAbs != null && progression.subjAbs < progression.avgAbs;

  // Equity anomaly — the single most damning tray peer: less UW tenure than the subject, biggest pay
  // surplus. Surfaced as the "smoking gun" callout on its row in the peer table.
  const anomalyKey = useMemo(() => {
    if (subjectPay == null || tenureYears == null) return null;
    let best: { key: string; gap: number } | null = null;
    for (const r of tableRows) {
      if (r.isSubject || r.tenure == null) continue;
      if (r.tenure < tenureYears && r.pay > subjectPay) {
        const gap = r.pay - subjectPay;
        if (!best || gap > best.gap) best = { key: r.key, gap };
      }
    }
    return best?.key ?? null;
  }, [tableRows, subjectPay, tenureYears]);

  // Operational-risk math: a conservative 50%-of-salary turnover cost vs the one-time parity raise.
  const replacementBaseline = subjectPay != null ? subjectPay * 0.5 : 0;
  const netSavings = replacementBaseline - targetDelta;

  // ── Why — the three distinct proofs, each shown exactly once. Any with missing data drops out. ──
  const proofs: { icon: ReactNode; value: string; label: string; detail: string }[] = subjectPay == null ? [] : [
    // 1. Below market
    ...(percentile != null ? [{
      icon: <IconChartBar size={22} />,
      value: `${ordinal(percentile)} percentile`,
      label: medianDeficit > 0 ? 'Current pay sits below the strict title median.' : 'Current pay is at or above the title median.',
      detail: '',
    }] : []),
    // 2. Tenure inversion — phrased so it can't read as a rank
    ...(tenureInversion && tenureInversion.count > 0 ? [{
      icon: <IconScale size={22} />,
      value: `${num(tenureInversion.count)} peers`,
      label: 'tenure inversions — less UW tenure, higher pay',
      detail: `paid up to +${usd(tenureInversion.maxGap)} more with fewer years at UW`,
    }] : []),
    // 3. Sustained — consecutive years in market deficit
    ...(longevity && longevity.streak > 0 ? [{
      icon: <IconHistory size={22} />,
      value: `${longevity.streakYears} ${longevity.streakYears === 1 ? 'year' : 'years'}`,
      label: 'consecutive years in market deficit',
      detail: longevity.streak >= longevity.total ? 'below the title median in every year on record' : 'most recent unbroken run below the median',
    }] : []),
  ];

  const benchmarkCsv = () => {
    const rows = (peerListRows ?? []).map((p) => ({ pay: p.pay, tenure_years: p.tenure?.toFixed?.(1) ?? '' }));
    downloadCSV(`${subjectName || 'subject'}-title-peers-${snap}.csv`, rows as unknown as Record<string, unknown>[]);
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" className="no-print" wrap="wrap" gap="md">
        <Title order={2}>Reports</Title>
        <Group gap="md">
          <SegmentedControl
            radius="xl"
            value={type}
            onChange={setType}
            data={[
              { value: 'person', label: 'On a Specified Person' },
              { value: 'comparison', label: 'Salary Increase Justification (People In Tray)' },
            ]}
          />
          <Button.Group>
            {type === 'comparison' && persons.length > 0 && (
              <Button variant="default" leftSection={<IconAdjustments size={16} />} onClick={openSettings}>
                Customize
              </Button>
            )}
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              disabled={type === 'person' ? !personHistory?.length : !peerListRows?.length}
              onClick={() =>
                type === 'person'
                  ? downloadCSV(`${selPerson?.name ?? 'employee'}-history.csv`, (personHistory ?? []) as unknown as Record<string, unknown>[])
                  : benchmarkCsv()
              }
            >
              Download CSV
            </Button>
            <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          </Button.Group>
        </Group>
      </Group>

      {type === 'person' && (
        <>
          <Card withBorder padding="lg" className="no-print">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.05em' }}>
              Report on
            </Text>
            <SearchBox
              placeholder="Search an employee by name…"
              onPick={(h) => setSelPerson({ key: h.person_key, name: h.name })}
            />
            {selPerson && <Text size="sm" mt="sm">Showing report for <b>{selPerson.name}</b>.</Text>}
          </Card>

          {selPerson ? (
            <div className="print-area">
              <PersonDashboard personKey={selPerson.key} metric={metric} />
            </div>
          ) : (
            <Card withBorder padding="xl">
              <Text c="dimmed">Search and pick an employee above to generate a single-page report on their pay, title history, and how they compare to others in their title.</Text>
            </Card>
          )}
        </>
      )}

      {type === 'comparison' && (
        <>
          {persons.length === 0 ? (
            <Card withBorder padding="xl">
              <Text c="dimmed">Add people to the tray (the search/＋ Compare buttons around the app), then pick a subject to build a salary-adjustment justification.</Text>
            </Card>
          ) : (
            <>
              {/* Build controls live in a side panel so they don't clutter the document. */}
              <Drawer opened={settingsOpen} onClose={closeSettings} position="right" size="sm" title="Customize report" className="no-print">
                <Stack gap="md">
                  <Select
                    {...dropdownProps('md')}
                    label="Subject (raise case)"
                    data={persons.map((p) => ({ value: p.id, label: p.label }))}
                    value={subjectKey}
                    onChange={setSubjectKey}
                  />
                  <div>
                    <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.05em' }}>
                      Include in report
                    </Text>
                    <Checkbox.Group value={sections} onChange={setSections}>
                      <Stack gap="xs">
                        {SECTIONS.map((s) => (
                          <Checkbox key={s.value} value={s.value} label={s.label} />
                        ))}
                      </Stack>
                    </Checkbox.Group>
                  </div>
                  <Divider />
                  <Checkbox
                    label="I also supervise, not as a responsibility of title"
                    checked={superviseOn}
                    onChange={(e) => setSuperviseOn(e.currentTarget.checked)}
                  />
                  <NumberInput
                    label="# of people"
                    value={superviseCount}
                    onChange={(v) => setSuperviseCount(typeof v === 'number' ? v : 0)}
                    min={0}
                    w={140}
                    disabled={!superviseOn}
                  />
                  <TextInput
                    label="Note (optional)"
                    placeholder="e.g. a team of 8 / 4 direct reports"
                    value={superviseNote}
                    onChange={(e) => setSuperviseNote(e.currentTarget.value)}
                    disabled={!superviseOn}
                  />
                  <Checkbox
                    label="The compared peers are also supervisors (comparable scope)"
                    checked={peersSupervise}
                    onChange={(e) => setPeersSupervise(e.currentTarget.checked)}
                    disabled={!superviseOn}
                  />
                  <Divider />
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
                    Supplemental justification
                  </Text>
                  <Switch
                    label="Target above the median (justified by added qualifications)"
                    checked={aboveMedian}
                    onChange={(e) => setAboveMedian(e.currentTarget.checked)}
                  />
                  <TextInput
                    label="Certifications"
                    placeholder="e.g. PMP, CISSP, AWS Solutions Architect"
                    value={certs}
                    onChange={(e) => setCerts(e.currentTarget.value)}
                    disabled={!aboveMedian}
                  />
                  <TextInput
                    label="Education / training completed"
                    placeholder="e.g. M.S. completed 2024"
                    value={education}
                    onChange={(e) => setEducation(e.currentTarget.value)}
                    disabled={!aboveMedian}
                  />
                </Stack>
              </Drawer>

              {/* The report */}
              <Card withBorder padding="xl" className="print-area">
                <Title order={3}>Internal Equity &amp; Parity Review</Title>
                <Text c="dimmed" mt={2}>
                  Prepared for <Text span fw={600} c="bright">{subjectName}</Text>
                  {` · ${[subj?.title, subj?.grade_number != null ? `grade ${subj.grade_number}` : null, subj?.school, snapLabel, METRIC_LABEL[metric], `prepared ${generated}`].filter(Boolean).join(' · ')}`}
                </Text>
                <Divider my="md" />

                {/* Recommendation — the single ask: target number, sentence, why, current → adjustment */}
                {belowTarget && primaryTarget != null ? (
                  <Paper radius="md" p="xl" bg="var(--mantine-color-indigo-light)" mb="lg">
                    <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>
                      Recommendation
                    </Text>
                    <Text fw={800} c="green.8" lh={1} style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', letterSpacing: '-0.02em' }}>
                      {usd(primaryTarget)}
                    </Text>
                    <Text mt={8}>
                      Adjust <b>{subjectName}</b> from <b>{usd(subjectPay)}</b> to <b>{usd(primaryTarget)}</b>{' '}
                      (<Text span fw={700} c="green.7">+{usd(targetDelta)}, {pct(targetPct)}</Text>){' '}
                      {aboveMedian ? 'to an above-median level justified by added qualifications.' : 'to reach the tenure-adjusted median for same-title peers.'}
                    </Text>
                    <Text size="sm" c="dimmed" mt={6}>
                      Why this number: {usd(primaryTarget)} is {targetBasis} — i.e. parity for equal work and UW–Madison tenure, not a premium.
                    </Text>
                    {supervises && (
                      <Text size="xs" c="dimmed" mt="sm">Plus supervisory scope ({supN} {supN === 1 ? 'report' : 'staff'}) beyond title.</Text>
                    )}
                  </Paper>
                ) : subjectPay != null ? (
                  <Paper withBorder radius="md" p="lg" mb="lg">
                    <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>Recommendation</Text>
                    <Text fw={700} fz="lg" mt={4}>
                      {subjectFirst} is at or above the parity target{primaryTarget != null ? ` (${usd(primaryTarget)})` : ''} — maintain current pay.
                    </Text>
                  </Paper>
                ) : (
                  <Text fz="lg" mb="lg">No salary on record for the subject in this snapshot.</Text>
                )}

                {/* Basis for an above-median target — only when the user asserts added qualifications */}
                {aboveMedian && (
                  <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
                    <Text size="sm" fw={700} mb={4}>Basis for an above-median target</Text>
                    <Text size="xs" c="dimmed" mb="sm">{subjectFirst} brings qualifications beyond the title baseline that justify pay above the median:</Text>
                    <Stack gap={6}>
                      {certs.trim() && (
                        <Group gap="xs" wrap="nowrap" align="flex-start">
                          <ThemeIcon size={18} radius="xl" variant="light" color="indigo"><IconCheck size={12} /></ThemeIcon>
                          <Text size="sm"><b>Certifications:</b> {certs}</Text>
                        </Group>
                      )}
                      {education.trim() && (
                        <Group gap="xs" wrap="nowrap" align="flex-start">
                          <ThemeIcon size={18} radius="xl" variant="light" color="indigo"><IconCheck size={12} /></ThemeIcon>
                          <Text size="sm"><b>Education / training:</b> {education}</Text>
                        </Group>
                      )}
                      {supervises && (
                        <Group gap="xs" wrap="nowrap" align="flex-start">
                          <ThemeIcon size={18} radius="xl" variant="light" color="indigo"><IconCheck size={12} /></ThemeIcon>
                          <Text size="sm"><b>Supervisory scope:</b> {supN} {supN === 1 ? 'report' : 'reports'}{superviseNote ? ` (${superviseNote})` : ''}</Text>
                        </Group>
                      )}
                      {!certs.trim() && !education.trim() && !supervises && (
                        <Text size="sm" c="dimmed">Add certifications, education, or supervisory scope in Customize to document the basis.</Text>
                      )}
                    </Stack>
                  </Card>
                )}

                {!jobCode && (
                  <Alert color="gray" mb="lg">No job code on record for {subjectName} in this snapshot, so title-market benchmarking is unavailable.</Alert>
                )}

                {/* Why — the three distinct proofs, each shown exactly once */}
                {has('highlights') && proofs.length > 0 && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Why this is an equity correction</Text>
                    <SimpleGrid cols={{ base: 1, sm: Math.min(3, proofs.length) }} mb="lg">
                      {proofs.map((p, i) => (
                        <Card key={i} withBorder radius="md" shadow="sm" padding="lg">
                          <ThemeIcon variant="light" color="indigo" size={38} radius="md">{p.icon}</ThemeIcon>
                          <Text fw={800} fz={26} mt="sm" lh={1.1}>{p.value}</Text>
                          <Text size="sm" c="dimmed" mt={4}>{p.label}</Text>
                          {p.detail && <Text size="xs" c="dimmed" mt={6}>{p.detail}</Text>}
                        </Card>
                      ))}
                    </SimpleGrid>
                  </>
                )}

                {/* Operational risk & replacement analysis — the business case for saying yes */}
                {subjectPay != null && (
                  <Paper withBorder radius="md" shadow="sm" p="md" mb="lg">
                    <Text size="sm" fw={700} mb={4}>Operational Risk &amp; Replacement Analysis</Text>
                    {belowTarget && netSavings > 0 && (
                      <Text size="sm" mb={6}>
                        Granting this parity adjustment saves the department an estimated{' '}
                        <Text span fw={800} c="green.7">{usd(netSavings)}</Text> versus the baseline cost of replacing this role on the open market.
                      </Text>
                    )}
                    <Text size="sm">
                      {belowTarget ? `The one-time ${usd(targetDelta)} adjustment` : `Retaining ${subjectFirst}`} is a fraction of turnover cost:
                      replacing {subjectFirst} is widely estimated at <b>{usd(subjectPay * 0.5)}–{usd(subjectPay * 2)}</b> (roughly
                      0.5×–2× annual salary in recruiting, lost productivity, and 6–12 months of ramp-up at 2026 market rates). Keeping
                      proven institutional knowledge is the lower-cost, lower-risk choice.
                    </Text>
                    <Text size="xs" c="dimmed" mt={6}>
                      Net-savings figure uses a conservative 50%-of-salary replacement estimate — replace with your unit's actual recruiting/onboarding figures.
                    </Text>
                  </Paper>
                )}

                <Footer />

                {/* Supporting detail — collapsible, screen-only so the printed PDF stays a 1-page summary */}
                <div className="no-print">
                  <Divider my="lg" label="Supporting detail" labelPosition="center" />
                  <Accordion variant="separated" multiple>
                    {/* Peer comparison — the named-peer matrix; the equity anomaly is the smoking gun */}
                    {has('peers') && otherPeers.length > 0 && (
                      <Accordion.Item value="peers">
                        <Accordion.Control icon={<IconScale size={18} />}>Peer comparison ({otherPeers.length} named {otherPeers.length === 1 ? 'peer' : 'peers'})</Accordion.Control>
                        <Accordion.Panel>
                          <Table striped highlightOnHover verticalSpacing="sm">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>Title</Table.Th>
                                {showTenure && <Table.Th ta="right">Tenure</Table.Th>}
                                {superviseOn && <Table.Th>Staff managed</Table.Th>}
                                <Table.Th>Salary</Table.Th>
                                <Table.Th ta="right">vs {subjectFirst}</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {tableRows.map((r) => {
                                const gap = r.pay - (subjectPay ?? 0); // how much more the peer earns
                                const lessExp = !r.isSubject && r.tenure != null && tenureYears != null && r.tenure < tenureYears && gap > 0;
                                const isAnomaly = r.key === anomalyKey;
                                return (
                                  <Table.Tr
                                    key={r.key}
                                    style={
                                      r.isSubject
                                        ? { background: 'var(--mantine-color-indigo-light)' }
                                        : isAnomaly
                                          ? { background: 'var(--mantine-color-indigo-0)', boxShadow: 'inset 4px 0 0 var(--mantine-color-indigo-6)' }
                                          : undefined
                                    }
                                  >
                                    <Table.Td>
                                      {r.isSubject
                                        ? <><b>{r.name}</b> <Badge size="xs" variant="light" color="indigo" tt="none" ml={4}>Review Subject</Badge></>
                                        : <>{r.name}{isAnomaly
                                            ? <Badge size="xs" variant="filled" color="indigo" tt="none" ml={6}>Equity Anomaly</Badge>
                                            : lessExp && <Badge size="xs" variant="light" color="indigo" tt="none" ml={6}>less tenure</Badge>}</>}
                                    </Table.Td>
                                    <Table.Td>{r.title ?? '—'}</Table.Td>
                                    {showTenure && <Table.Td ta="right">{r.tenure != null ? `${r.tenure.toFixed(1)} yr` : '—'}</Table.Td>}
                                    {superviseOn && (
                                      <Table.Td>
                                        {r.isSubject ? `${supN} ${supN === 1 ? 'report' : 'reports'}` : peersSupervise ? 'Supervisor' : '—'}
                                      </Table.Td>
                                    )}
                                    {/* Salary on a shared zero-based scale; the slate marker sits at the subject's
                                        pay, so each peer bar's overflow past it equals the true dollar gap. */}
                                    <Table.Td style={{ minWidth: 200 }}>
                                      <Text size="sm" fw={r.isSubject ? 700 : 500}>{usd(r.pay)}</Text>
                                      <div style={{ position: 'relative', marginTop: 3, height: 6, borderRadius: 3, background: 'var(--mantine-color-gray-2)' }}>
                                        <div style={{ width: `${(r.pay / maxPay) * 100}%`, height: '100%', borderRadius: 3, background: r.isSubject ? CAND : PEER }} />
                                        {!r.isSubject && subjectPay != null && (
                                          <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${(subjectPay / maxPay) * 100}%`, width: 2, background: CAND }} />
                                        )}
                                      </div>
                                    </Table.Td>
                                    <Table.Td ta="right">
                                      {r.isSubject ? (
                                        <Text span size="xs" c="dimmed">baseline</Text>
                                      ) : (
                                        <Text span fw={gap > 0 ? 800 : 700} fz={gap > 0 ? 'md' : 'sm'} c={isAnomaly ? 'indigo.7' : 'dimmed'}>
                                          {gap > 0 ? '+' : gap < 0 ? '−' : ''}{usd(Math.abs(gap))}
                                        </Text>
                                      )}
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
                          {anomalyKey && (
                            <Text size="xs" c="dimmed" mt="sm">
                              <b>Equity Anomaly</b> flags the peer with less UW tenure than {subjectFirst} but the largest pay surplus — the clearest sign the gap isn't explained by experience.
                            </Text>
                          )}
                        </Accordion.Panel>
                      </Accordion.Item>
                    )}

                    {/* Pay history — absolute-dollar raise divergence */}
                    {showDivergence && (
                      <Accordion.Item value="history">
                        <Accordion.Control icon={<IconHistory size={18} />}>Pay history — raise divergence</Accordion.Control>
                        <Accordion.Panel>
                          <Text size="xs" c="dimmed" mb="md">
                            Percentage growth flatters a low starting salary. In raw dollars, {subjectFirst}'s raises have lagged — and the gap compounds every year.
                          </Text>
                          <ProgRow label="Peers (avg gained)" value={progression.avgAbs} display={progression.avgAbs != null ? `+${usd(progression.avgAbs)}` : '—'} max={aMax} color="gray.5" />
                          <ProgRow label={`${subjectFirst} (gained)`} value={progression.subjAbs} display={progression.subjAbs != null ? `+${usd(progression.subjAbs)}` : '—'} max={aMax} color="indigo.6" emphasize />
                          {progression.avgAbs != null && progression.subjAbs != null && (
                            <Text size="sm" mt="xs">
                              {subjectFirst} has gained <Text span fw={800}>{usd(progression.avgAbs - progression.subjAbs)}</Text> less in raises than the typical peer over the same period.
                            </Text>
                          )}
                        </Accordion.Panel>
                      </Accordion.Item>
                    )}

                  </Accordion>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

/** One labelled comparison bar (peer vs subject) for the progression section. */
function ProgRow({ label, value, display, max, color, emphasize }: {
  label: string; value: number | null; display: string; max: number; color: string; emphasize?: boolean;
}) {
  const filled = value != null && max > 0 ? Math.max(3, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <Group justify="space-between" gap="xs" mb={3}>
        <Text size="sm" fw={emphasize ? 700 : 500}>{label}</Text>
        <Text size="sm" fw={700} c={emphasize ? 'indigo.7' : undefined}>{display}</Text>
      </Group>
      <Progress value={filled} color={color} size="lg" radius="sm" />
    </div>
  );
}

function Footer() {
  return (
    <Text size="xs" c="dimmed" mt="xl">
      Methodology: the title median is the median pay of everyone sharing the subject's job code at this snapshot;
      the tenure-adjusted target is the median for same-title peers with at least the subject's tenure.
      "Tenure" = years since the UW–Madison date of hire (not total career experience); supervisory scope is self-reported.
      Source: UW–Madison salary data (Wisconsin public record). Salaries shown are the full annual rate unless
      the FTE-adjusted or base-pay metric is selected. Zero/unreported salaries are excluded from statistics.
      Person identity is matched on name + date of hire and is best-effort.
    </Text>
  );
}
