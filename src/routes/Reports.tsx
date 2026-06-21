import { useEffect, useMemo, useState } from 'react';
import {
  Stack, Title, Text, Group, Button, Select, SegmentedControl, Card, Table, SimpleGrid, Divider, Paper,
  Checkbox, NumberInput, TextInput, Alert, ThemeIcon, Drawer, Badge, Progress,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDownload, IconPrinter, IconChartBar, IconUsers, IconUsersGroup, IconAdjustments } from '@tabler/icons-react';
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
interface TrayPerson { person_key: string; fn: string; ln: string; title: string | null; pay: number }

const SECTIONS = [
  { value: 'highlights', label: 'Headline cards' },
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
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title, ${personPay(metric)} pay
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && persons.length > 0 && !!snap
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

  // ── Targets: experience/scope-adjusted is primary; market median is secondary ──
  const primaryTarget = expMedian ?? peer?.p75 ?? med ?? null;
  const belowTarget = subjectPay != null && primaryTarget != null && subjectPay < primaryTarget;
  const targetDelta = belowTarget && primaryTarget != null && subjectPay != null ? primaryTarget - subjectPay : 0;
  const targetPct = belowTarget && subjectPay ? targetDelta / subjectPay : 0;
  // Plain-language reason the target number was chosen (shown under the hero figure).
  const targetBasis = expMedian != null
    ? `the median pay of same-title peers with at least ${tenureYears != null ? `${tenureYears.toFixed(0)} years` : 'the same'} of tenure`
    : peer?.p75 != null ? 'the 75th-percentile pay for this title' : 'the median pay for this title';

  // Largest gap to a single higher-paid peer (otherPeers is sorted highest-first).
  const topPeer = otherPeers[0] ?? null;
  const topPeerGap = topPeer && subjectPay != null ? topPeer.pay - subjectPay : 0;
  // Deficit to the title median — the "basic correction to market baseline" framing.
  const medianDeficit = med != null && subjectPay != null && subjectPay < med ? med - subjectPay : 0;

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
      const total = a.length >= 2 && a[0] ? (a[a.length - 1] - a[0]) / a[0] : null;
      return { total, raises };
    };
    const peers = [...byPerson.entries()].filter(([k]) => k !== subjectKey).map(([, a]) => calc(a));
    const subjArr = subjectKey ? byPerson.get(subjectKey) : undefined;
    const subjC = subjArr ? calc(subjArr) : null;
    const totals = peers.map((p) => p.total).filter((v): v is number => v != null);
    return {
      avgGrowth: totals.length ? totals.reduce((s, v) => s + v, 0) / totals.length : null,
      avgRaises: peers.length ? peers.reduce((s, p) => s + p.raises, 0) / peers.length : null,
      subjGrowth: subjC?.total ?? null,
      subjRaises: subjC?.raises ?? null,
    };
  }, [peerHist, subjectKey]);

  // Peer Parity Matrix rows — the candidate is pinned to the top as a permanent baseline, then peers
  // sorted highest-paid first (otherPeers is already sorted desc).
  const tableRows = useMemo(() => {
    const rows: { key: string; name: string; title: string | null; pay: number; isSubject: boolean }[] =
      otherPeers.map((p) => ({ key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, pay: p.pay, isSubject: false }));
    if (subjectPay != null) rows.unshift({ key: '__subject__', name: subjectName, title: subj?.title ?? null, pay: subjectPay, isSubject: true });
    return rows;
  }, [otherPeers, subjectPay, subjectName, subj]);
  const maxPay = Math.max(1, ...tableRows.map((r) => r.pay));

  // Scales for the progression comparison bars.
  const gMax = Math.max(progression.avgGrowth ?? 0, progression.subjGrowth ?? 0, 0.0001);
  const rMax = Math.max(progression.avgRaises ?? 0, progression.subjRaises ?? 0, 1);

  // Smart progression display: only show the growth gap when the candidate is genuinely BEHIND on
  // total growth; otherwise a high % is just a low-base artifact — show that framing instead.
  const showProgression = progression.subjGrowth != null && progression.avgGrowth != null && progression.subjGrowth < progression.avgGrowth;
  const showBaseDisadvantage = progression.subjGrowth != null && progression.avgGrowth != null && progression.subjGrowth >= progression.avgGrowth;

  // Operational-risk math: a conservative 50%-of-salary turnover cost vs the one-time parity raise.
  const replacementBaseline = subjectPay != null ? subjectPay * 0.5 : 0;
  const netSavings = replacementBaseline - targetDelta;

  // ── Three fixed headline cards: percentile, largest peer gap, peers compared ──
  const cards = subjectPay == null ? [] : [
    {
      icon: <IconChartBar size={20} />, color: 'indigo', // candidate standing — slate blue
      value: percentile != null ? `${ordinal(percentile)} percentile` : '—',
      label: peer?.n ? `among ${num(peer.n)} same-title peers` : 'of same-title peers',
    },
    {
      icon: <IconUsers size={20} />, color: 'gray', // peer comparison — neutral
      value: topPeerGap > 0 ? `−${usd(topPeerGap)}` : belowTarget ? `−${usd(targetDelta)}` : 'At parity',
      label: topPeerGap > 0 && topPeer
        ? `vs ${fullName(topPeer.fn, topPeer.ln)}, the top-paid peer`
        : belowTarget ? 'below the parity target' : 'vs same-title peers',
    },
    {
      icon: <IconUsersGroup size={20} />, color: 'gray', // peers — neutral
      value: num(peer?.n ?? 0),
      label: 'same-title peers compared',
    },
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

                {/* The Ask — one persuasive sentence */}
                <Text fz="lg" mb="lg">
                  {belowTarget && primaryTarget != null ? (
                    <>
                      Requesting an adjustment from <b>{usd(subjectPay)}</b> to <b>{usd(primaryTarget)}</b>{' '}
                      (<Text span fw={700} c="green.7">+{usd(targetDelta)}, {pct(targetPct)}</Text>) to reach parity with same-title peers.
                    </>
                  ) : subjectPay != null ? (
                    <>{subjectFirst} is at or above the parity target{primaryTarget != null ? ` (${usd(primaryTarget)})` : ''} — recommend maintaining current pay.</>
                  ) : (
                    'No salary on record for the subject in this snapshot.'
                  )}
                </Text>

                {/* Hero target number — the experience/scope-adjusted target, only when below it */}
                {belowTarget && primaryTarget != null && (
                  <Paper radius="md" p="xl" bg="var(--mantine-color-indigo-light)" mb="md">
                    <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>
                      Target salary — experience &amp; scope adjusted
                    </Text>
                    <Text fw={800} c="green.8" lh={1} style={{ fontSize: 'clamp(2.5rem, 6vw, 3.5rem)', letterSpacing: '-0.02em' }}>
                      {usd(primaryTarget)}
                    </Text>
                    <Text size="sm" c="dimmed" mt={6}>
                      Why this number: {usd(primaryTarget)} is {targetBasis} — i.e. parity for equal work and experience, not a premium.
                    </Text>
                    <Group gap="xl" mt="md" wrap="wrap">
                      <div>
                        <Text size="xs" c="dimmed">Current ({METRIC_LABEL[metric]})</Text>
                        <Text fw={600} fz="lg">{usd(subjectPay)}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Suggested adjustment</Text>
                        <Text fw={700} fz="lg" c="green.7">+{usd(targetDelta)} ({pct(targetPct)})</Text>
                      </div>
                      {med != null && (
                        <div>
                          <Text size="xs" c="dimmed">Title median (parity)</Text>
                          <Text fw={500} fz="sm" c="dimmed">{usd(med)}</Text>
                        </div>
                      )}
                    </Group>
                    {supervises && (
                      <Text size="xs" c="dimmed" mt="sm">Plus supervisory scope ({supN} {supN === 1 ? 'report' : 'staff'}) beyond title.</Text>
                    )}
                  </Paper>
                )}

                {!jobCode && (
                  <Alert color="gray" mb="lg">No job code on record for {subjectName} in this snapshot, so title-market benchmarking is unavailable.</Alert>
                )}

                {/* Three headline cards: percentile · salary gap · peers compared */}
                {has('highlights') && cards.length > 0 && (
                  <SimpleGrid cols={{ base: 1, sm: 3 }} mb="lg">
                    {cards.map((h, i) => (
                      <Card key={i} withBorder radius="md" shadow="sm" padding="lg">
                        <ThemeIcon variant="light" color={h.color} size={38} radius="md">{h.icon}</ThemeIcon>
                        <Text fw={800} fz={26} mt="sm" lh={1.1}>{h.value}</Text>
                        <Text size="sm" c="dimmed" mt={4}>{h.label}</Text>
                      </Card>
                    ))}
                  </SimpleGrid>
                )}

                {/* Deficit to median — frame the ask as a baseline correction, not a premium */}
                {medianDeficit > 0 && (
                  <Text size="sm" mb="lg">
                    Even against the plain title median ({usd(med)}), {subjectFirst} sits{' '}
                    <Text span fw={700}>{usd(medianDeficit)}</Text> short — this request is a correction to the
                    market baseline, not a premium.
                  </Text>
                )}

                {/* Historical Investment & Progression Gap — only when the candidate is genuinely behind */}
                {showProgression && (
                  <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
                    <Text size="sm" fw={700}>Historical Investment &amp; Progression Gap</Text>
                    <Text size="xs" c="dimmed" mb="md">
                      {subjectFirst}'s pay has grown far less than the peers now out-earning them — wage compression that compounds every year it goes uncorrected.
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
                      <div>
                        <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="xs" style={{ letterSpacing: '0.05em' }}>Total pay growth on record</Text>
                        <ProgRow label="Peers (avg)" value={progression.avgGrowth} display={progression.avgGrowth != null ? pct(progression.avgGrowth) : '—'} max={gMax} color="gray.5" />
                        <ProgRow label={subjectFirst} value={progression.subjGrowth} display={progression.subjGrowth != null ? pct(progression.subjGrowth) : '—'} max={gMax} color="indigo.6" emphasize />
                      </div>
                      <div>
                        <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb="xs" style={{ letterSpacing: '0.05em' }}>Raises on record</Text>
                        <ProgRow label="Peers (avg)" value={progression.avgRaises} display={progression.avgRaises != null ? progression.avgRaises.toFixed(1) : '—'} max={rMax} color="gray.5" />
                        <ProgRow label={subjectFirst} value={progression.subjRaises} display={progression.subjRaises != null ? String(progression.subjRaises) : '—'} max={rMax} color="indigo.6" emphasize />
                      </div>
                    </SimpleGrid>
                  </Card>
                )}

                {/* Fallback when the candidate's % growth isn't lower — a high % off a depressed base. */}
                {showBaseDisadvantage && (
                  <Card withBorder radius="md" shadow="sm" padding="md" mb="lg">
                    <Text size="sm" fw={700} mb={4}>Historical Base Disadvantage</Text>
                    <Text size="sm">
                      {subjectFirst}'s higher percentage pay growth is a mathematical byproduct of a severely depressed
                      starting salary — a low base inflates the percentage while absolute pay stays below the market rate.
                    </Text>
                  </Card>
                )}

                {/* Peer Parity Matrix — chart + table merged: inline salary bars right in the table */}
                {has('peers') && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Peer Parity Matrix</Text>
                    {otherPeers.length > 0 ? (
                      <Card withBorder radius="md" shadow="sm" p={0} mb="lg" style={{ maxWidth: 880, overflow: 'hidden' }}>
                        <Table striped highlightOnHover verticalSpacing="sm">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Name</Table.Th>
                              <Table.Th>Title</Table.Th>
                              {superviseOn && <Table.Th>Staff managed</Table.Th>}
                              <Table.Th>Salary</Table.Th>
                              <Table.Th ta="right">vs {subjectFirst}</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {tableRows.map((r) => {
                              const gap = r.pay - (subjectPay ?? 0); // how much more the peer earns
                              return (
                                <Table.Tr key={r.key} style={r.isSubject ? { background: 'var(--mantine-color-indigo-light)' } : undefined}>
                                  <Table.Td>
                                    {r.isSubject
                                      ? <><b>{r.name}</b> <Badge size="xs" variant="light" color="indigo" tt="none" ml={4}>Review Subject</Badge></>
                                      : r.name}
                                  </Table.Td>
                                  <Table.Td>{r.title ?? '—'}</Table.Td>
                                  {superviseOn && (
                                    <Table.Td>
                                      {r.isSubject ? `${supN} ${supN === 1 ? 'report' : 'reports'}` : peersSupervise ? 'Supervisor' : '—'}
                                    </Table.Td>
                                  )}
                                  {/* Salary with an inline proportional bar showing the pay distance */}
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
                      </Card>
                    ) : (
                      <Text size="sm" c="dimmed" mb="lg">Add more people to the tray to compare {subjectFirst} against direct peers.</Text>
                    )}
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

                {/* Supervision callout — a real argument, kept in the printed document */}
                {supervises && (
                  <Paper withBorder radius="md" shadow="sm" p="md" mb="lg">
                    <Text size="sm" fw={600}>Added responsibilities</Text>
                    <Text size="sm">
                      {subjectName} supervises {supN} {supN === 1 ? 'person' : 'people'}
                      {superviseNote ? ` (${superviseNote})` : ''} — managerial scope beyond the base title.
                    </Text>
                  </Paper>
                )}

                <Footer />

                {/* Appendix — supporting detail, screen-only so the printed PDF stays tight */}
                <div className="no-print">
                  <Divider my="lg" label="Appendix — supporting detail" labelPosition="center" />

                  {/* Market baseline — emphasize the correction to median, not the top of market */}
                  {(tenureYears != null || med != null) && (
                    <Card withBorder radius="md" shadow="sm" padding="lg" mb="lg">
                      <Text size="sm" fw={600} mb="xs">Market baseline</Text>
                      <SimpleGrid cols={{ base: 2, sm: 3 }}>
                        <Stat label="Tenure" value={tenureYears != null ? `${tenureYears.toFixed(1)} yrs` : '—'} />
                        {med != null && <Stat label="Title median" value={usd(med)} />}
                        {med != null && <Stat label="Deficit to median" value={medianDeficit > 0 ? `−${usd(medianDeficit)}` : 'At/above median'} />}
                      </SimpleGrid>
                    </Card>
                  )}

                  {schools.length > 0 && (
                    <>
                      <Text size="sm" fw={600} mb="xs">Schools (context)</Text>
                      <Table mb="lg">
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
                    </>
                  )}

                  <Text size="xs" c="dimmed">
                    Methodology: "parity" = the median pay of everyone sharing the subject's job code at this snapshot;
                    the experience-adjusted figure is the median for same-title peers with at least the subject's tenure.
                    Supervisory scope is self-reported (not in the salary dataset).
                  </Text>
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
