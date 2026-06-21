import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Stack, Title, Text, Group, Button, Select, SegmentedControl, Card, Table, SimpleGrid, Divider, Paper,
  Checkbox, NumberInput, TextInput, Alert, ThemeIcon, Drawer, Badge, Progress, Switch, Accordion,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconDownload, IconPrinter, IconChartBar, IconScale, IconTrendingUp, IconCheck, IconHistory,
  IconAdjustments,
} from '@tabler/icons-react';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, earningsExpr, personPay, paidHeadcount } from '../lib/queries';
import { dropdownProps } from '../lib/selectProps';
import { useTray } from '../state/tray';
import { usd, num, pct, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { PersonDashboard } from '../components/PersonDashboard';
import { SearchBox } from '../components/SearchBox';

interface SchoolCard { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
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
  const schools = items.filter((i) => i.type === 'school');
  const schoolNames = schools.map((s) => sqlStr(s.id)).join(',');
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

  const { data: cmpSchools } = useSql<SchoolCard>(
    ['rpt-cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, ${paidHeadcount(metric)} headcount,
        sum(${earningsExpr(metric)}) FILTER (WHERE ${expr} > 0) payroll,
        median(${expr}) FILTER (WHERE ${expr} > 0) med,
        quantile_cont(${expr}, 0.90) FILTER (WHERE ${expr} > 0) p90
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IN (${schoolNames}) GROUP BY school`,
    type === 'comparison' && schools.length > 0 && !!snap
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

  // ── Targets: experience-adjusted median by default; an above-median (75th-pctile) target when the
  //    user asserts supplemental qualifications justify it. ──
  const baseTarget = expMedian ?? med ?? null; // experience-adjusted parity (falls back to title median)
  const elevatedTarget = peer?.p75 ?? baseTarget; // above-median, justified by added qualifications
  const primaryTarget = (aboveMedian ? elevatedTarget : baseTarget) ?? null;
  const belowTarget = subjectPay != null && primaryTarget != null && subjectPay < primaryTarget;
  const targetDelta = belowTarget && primaryTarget != null && subjectPay != null ? primaryTarget - subjectPay : 0;
  const targetPct = belowTarget && subjectPay ? targetDelta / subjectPay : 0;
  // Plain-language reason the target number was chosen (shown under the hero figure).
  const targetBasis = aboveMedian
    ? `the 75th-percentile pay for this title — an above-median target justified by ${[certs.trim() && 'added certifications', education.trim() && 'further education/training', supervises && 'expanded supervisory scope'].filter(Boolean).join(', ') || 'added qualifications'}`
    : expMedian != null
      ? `the median pay of same-title peers with at least ${tenureYears != null ? `${tenureYears.toFixed(0)} years` : 'the same'} of tenure`
      : peer?.p75 != null ? 'the 75th-percentile pay for this title' : 'the median pay for this title';

  // Standing vs the market midpoint — compa-ratio < 1.0 is the standard HR trigger for an adjustment.
  const compaRatio = med != null && med > 0 && subjectPay != null ? subjectPay / med : null;

  // Highest-paid single peer (otherPeers is sorted highest-first) — the ladder's ceiling rung.
  const topPeer = otherPeers[0] ?? null;
  // Deficit to the title median — the "basic correction to market baseline" framing.
  const medianDeficit = med != null && subjectPay != null && subjectPay < med ? med - subjectPay : 0;

  // Equal experience, unequal pay — same-title peers with ≤ the subject's tenure who still earn more.
  // The hardest-to-rebut argument; computed across the full UW peer population (works with an empty tray).
  const equalExp = useMemo(() => {
    if (!peerListRows || tenureYears == null || subjectPay == null) return null;
    const lower = peerListRows.filter((p) => p.tenure != null && p.tenure <= tenureYears && p.pay > subjectPay);
    const maxGap = lower.length ? Math.max(...lower.map((p) => p.pay - subjectPay)) : 0;
    return { count: lower.length, maxGap, total: peerListRows.length };
  }, [peerListRows, tenureYears, subjectPay]);

  // Below the title median over time — chronic vs one-off underpayment.
  const longevity = useMemo(() => {
    const rows = (medHist ?? []).filter((r) => r.pay != null && r.pay > 0 && r.med != null);
    if (!rows.length) return null;
    const below = rows.filter((r) => (r.pay as number) < (r.med as number));
    let years: number | null = null;
    if (below.length) {
      const first = new Date(below[0].date).getTime();
      const last = new Date(rows[rows.length - 1].date).getTime();
      years = Math.max(0, (last - first) / (365.25 * 864e5));
    }
    return { belowCount: below.length, total: rows.length, years };
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

  // Adjustment ladder — anchors the modest recommended ask between a floor (median) and the headroom
  // to senior / top-paid peers, so the request reads as conservative rather than arbitrary.
  const ladder = useMemo(() => {
    if (subjectPay == null) return [] as { label: string; target: number; delta: number; recommended?: boolean }[];
    const rungs: { label: string; target: number; delta: number; recommended?: boolean }[] = [];
    if (med != null && med > subjectPay) rungs.push({ label: 'Minimum — title median', target: med, delta: med - subjectPay });
    if (primaryTarget != null && primaryTarget > subjectPay) rungs.push({ label: aboveMedian ? 'Recommended — above-median (justified)' : 'Recommended — experience-adjusted median', target: primaryTarget, delta: primaryTarget - subjectPay, recommended: true });
    if (peer?.p75 != null && peer.p75 > subjectPay) rungs.push({ label: 'Full parity — senior peers (75th pct)', target: peer.p75, delta: peer.p75 - subjectPay });
    if (topPeer && topPeer.pay > subjectPay) rungs.push({ label: `Ceiling — top-paid peer (${fullName(topPeer.fn, topPeer.ln)})`, target: topPeer.pay, delta: topPeer.pay - subjectPay });
    const seen = new Set<number>();
    return rungs.filter((r) => { const k = Math.round(r.target); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [subjectPay, med, primaryTarget, peer, topPeer, aboveMedian]);

  // Operational-risk math: a conservative 50%-of-salary turnover cost vs the one-time parity raise.
  const replacementBaseline = subjectPay != null ? subjectPay * 0.5 : 0;
  const netSavings = replacementBaseline - targetDelta;

  // ── Why — the three distinct proofs, each shown exactly once. Any with missing data drops out. ──
  const proofs: { icon: ReactNode; value: string; label: string; detail: string }[] = subjectPay == null ? [] : [
    // 1. Below market
    ...(percentile != null ? [{
      icon: <IconChartBar size={22} />,
      value: `${ordinal(percentile)} percentile`,
      label: compaRatio != null ? `compa-ratio ${compaRatio.toFixed(2)}` : 'of same-title peers',
      detail: medianDeficit > 0 ? `below the title median by ${usd(medianDeficit)}` : 'at or above the title median',
    }] : []),
    // 2. Equal experience, unequal pay
    ...(equalExp && equalExp.count > 0 ? [{
      icon: <IconScale size={22} />,
      value: `${num(equalExp.count)} of ${num(equalExp.total)}`,
      label: 'peers paid more with ≤ your experience',
      detail: `up to +${usd(equalExp.maxGap)} — experience doesn't explain it`,
    }] : []),
    // 3. Sustained
    ...(longevity && longevity.total > 1 && longevity.belowCount > 0 ? [{
      icon: <IconHistory size={22} />,
      value: `${longevity.belowCount} of ${longevity.total}`,
      label: 'snapshots below the median',
      detail: longevity.years != null && longevity.years >= 1 ? `≈ ${longevity.years.toFixed(0)} yrs — chronic, not a one-off` : 'chronic, not a one-off',
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
                      {aboveMedian ? 'to an above-median level justified by added qualifications.' : 'to reach the experience-adjusted median for same-title peers.'}
                    </Text>
                    <Text size="sm" c="dimmed" mt={6}>
                      Why this number: {usd(primaryTarget)} is {targetBasis} — i.e. parity for equal work and experience, not a premium.
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
                          <Text size="xs" c="dimmed" mt={6}>{p.detail}</Text>
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
                    {/* Adjustment ladder — floor / recommended / headroom */}
                    {ladder.length > 1 && (
                      <Accordion.Item value="ladder">
                        <Accordion.Control icon={<IconTrendingUp size={18} />}>Adjustment ladder</Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap={6}>
                            {ladder.map((r) => (
                              <Group
                                key={r.label}
                                justify="space-between"
                                wrap="nowrap"
                                style={r.recommended ? { background: 'var(--mantine-color-indigo-light)', borderRadius: 6, padding: '6px 10px', margin: '0 -10px' } : undefined}
                              >
                                <Group gap="xs" wrap="nowrap">
                                  {r.recommended && <Badge size="xs" variant="filled" color="indigo" tt="none">Recommended</Badge>}
                                  <Text size="sm" fw={r.recommended ? 700 : 500}>{r.label}</Text>
                                </Group>
                                <Group gap="lg" wrap="nowrap">
                                  <Text size="sm" c="dimmed">{usd(r.target)}</Text>
                                  <Text size="sm" fw={700} c="green.7" style={{ minWidth: 72, textAlign: 'right' }}>+{usd(r.delta)}</Text>
                                </Group>
                              </Group>
                            ))}
                          </Stack>
                          <Text size="xs" c="dimmed" mt="sm">
                            The recommended figure is the conservative ask; the higher rungs show the headroom to senior and top-paid peers.
                          </Text>
                        </Accordion.Panel>
                      </Accordion.Item>
                    )}

                    {/* Peer comparison — the named-peer matrix with tenure + inline salary bars */}
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
                                const lessExp = !r.isSubject && r.tenure != null && tenureYears != null && r.tenure <= tenureYears && gap > 0;
                                return (
                                  <Table.Tr key={r.key} style={r.isSubject ? { background: 'var(--mantine-color-indigo-light)' } : undefined}>
                                    <Table.Td>
                                      {r.isSubject
                                        ? <><b>{r.name}</b> <Badge size="xs" variant="light" color="indigo" tt="none" ml={4}>Review Subject</Badge></>
                                        : <>{r.name}{lessExp && <Badge size="xs" variant="light" color="indigo" tt="none" ml={6}>less experience</Badge>}</>}
                                    </Table.Td>
                                    <Table.Td>{r.title ?? '—'}</Table.Td>
                                    {showTenure && <Table.Td ta="right">{r.tenure != null ? `${r.tenure.toFixed(1)} yr` : '—'}</Table.Td>}
                                    {superviseOn && (
                                      <Table.Td>
                                        {r.isSubject ? `${supN} ${supN === 1 ? 'report' : 'reports'}` : peersSupervise ? 'Supervisor' : '—'}
                                      </Table.Td>
                                    )}
                                    <Table.Td style={{ minWidth: 180 }}>
                                      <Text size="sm" fw={r.isSubject ? 700 : 500}>{usd(r.pay)}</Text>
                                      <div style={{ marginTop: 3, height: 6, borderRadius: 3, background: 'var(--mantine-color-gray-2)' }}>
                                        <div style={{ width: `${(r.pay / maxPay) * 100}%`, height: '100%', borderRadius: 3, background: r.isSubject ? CAND : PEER }} />
                                      </div>
                                    </Table.Td>
                                    <Table.Td ta="right">
                                      {r.isSubject ? (
                                        <Text span size="xs" c="dimmed">baseline</Text>
                                      ) : (
                                        <Text span fw={gap > 0 ? 800 : 700} fz={gap > 0 ? 'md' : 'sm'} c="dimmed">
                                          {gap > 0 ? '+' : gap < 0 ? '−' : ''}{usd(Math.abs(gap))}
                                        </Text>
                                      )}
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
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

                    {/* Market baseline & methodology */}
                    <Accordion.Item value="method">
                      <Accordion.Control icon={<IconChartBar size={18} />}>Market baseline &amp; methodology</Accordion.Control>
                      <Accordion.Panel>
                        {(tenureYears != null || med != null) && (
                          <SimpleGrid cols={{ base: 2, sm: 3 }} mb="md">
                            <Stat label="Tenure" value={tenureYears != null ? `${tenureYears.toFixed(1)} yrs` : '—'} />
                            {med != null && <Stat label="Title median" value={usd(med)} />}
                            {med != null && <Stat label="Deficit to median" value={medianDeficit > 0 ? `−${usd(medianDeficit)}` : 'At/above median'} />}
                          </SimpleGrid>
                        )}
                        {schools.length > 0 && (
                          <Table mb="md">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>School</Table.Th>
                                <Table.Th ta="right">Headcount</Table.Th>
                                <Table.Th ta="right">Median</Table.Th>
                                <Table.Th ta="right">90th pctile</Table.Th>
                                <Table.Th ta="right">Total payroll</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {(cmpSchools ?? []).map((s) => (
                                <Table.Tr key={s.school}>
                                  <Table.Td>{s.school}</Table.Td>
                                  <Table.Td ta="right">{num(s.headcount)}</Table.Td>
                                  <Table.Td ta="right">{usd(s.med)}</Table.Td>
                                  <Table.Td ta="right">{usd(s.p90)}</Table.Td>
                                  <Table.Td ta="right">{usd(s.payroll)}</Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        )}
                        <Text size="xs" c="dimmed">
                          Methodology: "parity" = the median pay of everyone sharing the subject's job code at this snapshot;
                          the experience-adjusted figure is the median for same-title peers with at least the subject's tenure.
                          Supervisory scope is self-reported (not in the salary dataset).
                        </Text>
                      </Accordion.Panel>
                    </Accordion.Item>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} fz="lg">{value}</Text>
    </Paper>
  );
}

function Footer() {
  return (
    <Text size="xs" c="dimmed" mt="xl">
      Source: UW–Madison salary data (Wisconsin public record). Salaries shown are the full annual rate unless
      the FTE-adjusted or base-pay metric is selected. Zero/unreported salaries are excluded from statistics.
      Person identity is matched on name + date of hire and is best-effort.
    </Text>
  );
}
