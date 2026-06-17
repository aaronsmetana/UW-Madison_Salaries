import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Stack, Title, Text, Group, Button, Select, SegmentedControl, Card, Table, SimpleGrid, Divider, Paper,
  Checkbox, NumberInput, TextInput, Alert, Accordion, ThemeIcon,
} from '@mantine/core';
import { IconDownload, IconPrinter, IconChartBar, IconUsers, IconUsersGroup, IconClock } from '@tabler/icons-react';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, pct } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { PeerRangeBar } from '../components/PeerRangeBar';
import { PayBandBar } from '../components/PayBandBar';
import { PersonDashboard } from '../components/PersonDashboard';
import { SearchBox } from '../components/SearchBox';

interface SchoolCard { school: string; headcount: number; payroll: number | null; med: number | null; p90: number | null }
interface Subject {
  pay: number | null; title: string | null; job_code: string | null;
  grade_number: number | null; grade_basis: string | null;
  school: string | null; department: string | null; date_of_hire: string | null;
}
interface PeerStat { n: number; lo: number | null; p25: number | null; med: number | null; p75: number | null; p90: number | null; hi: number | null }
interface TrayPerson { person_key: string; fn: string; ln: string; title: string | null; pay: number }

const SECTIONS = [
  { value: 'highlights', label: 'Highlights' },
  { value: 'peers', label: 'Direct peers' },
  { value: 'benchmark', label: 'Title benchmark' },
  { value: 'band', label: 'Pay band' },
  { value: 'tenure', label: 'Tenure & growth' },
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

export default function Reports() {
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { data: summary } = useSummary();
  const { data: grades } = useGrades();
  const { items } = useTray();
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
  const supN = typeof superviseCount === 'number' ? superviseCount : 0;
  const supervises = superviseOn && supN > 0;

  const cmpReady = type === 'comparison' && !!snap && !!subjectKey;

  const { data: subjRows } = useSql<Subject>(
    ['rpt-subj', subjectKey, snap ?? '', metric],
    `SELECT sum(${expr}) pay,
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
    `WITH pp AS (SELECT person_key, sum(${expr}) pay FROM salaries
        WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT count(*) n, min(pay) lo, quantile_cont(pay, 0.25) p25, median(pay) med,
        quantile_cont(pay, 0.75) p75, quantile_cont(pay, 0.90) p90, max(pay) hi FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );
  const peer = peerStatRows?.[0];

  const { data: peerListRows } = useSql<{ pay: number; tenure: number | null }>(
    ['rpt-peerlist', jobCode ?? '', snap ?? '', metric],
    `WITH pp AS (SELECT person_key, sum(${expr}) pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT pay, tenure FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );

  const { data: subjHistory } = useSql<{ label: string; date: string; pay: number }>(
    ['rpt-subj-hist', subjectKey, metric],
    `SELECT any_value(snapshot_label) AS "label", any_value(snapshot_date) date, sum(${expr}) pay
     FROM salaries WHERE person_key = ${sqlStr(subjectKey ?? '')} GROUP BY snapshot_id ORDER BY date`,
    cmpReady
  );

  const { data: trayPeople } = useSql<TrayPerson>(
    ['rpt-tray', personIds, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title, sum(${expr}) pay
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && persons.length > 0 && !!snap
  );

  const { data: cmpSchools } = useSql<SchoolCard>(
    ['rpt-cmp-schools', schoolNames, snap ?? '', metric],
    `SELECT school, count(DISTINCT person_key) headcount,
        sum(${expr}) FILTER (WHERE ${expr} > 0) payroll,
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

  const growth = useMemo(() => {
    const hist = (subjHistory ?? []).filter((h) => h.pay > 0);
    if (!hist.length) return null;
    let raises = 0, sum = 0, streak = 0, longest = 0;
    for (let i = 1; i < hist.length; i++) {
      const d = hist[i].pay - hist[i - 1].pay;
      if (d > 0) { raises++; sum += d / hist[i - 1].pay; streak = 0; }
      else { streak++; longest = Math.max(longest, streak); }
    }
    const first = hist[0].pay, last = hist[hist.length - 1].pay;
    return { totalPct: first ? (last - first) / first : null, raises, periods: Math.max(0, hist.length - 1), avgPct: raises ? sum / raises : null, longest };
  }, [subjHistory]);

  const band = useMemo(() => {
    if (!subj || subj.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === subj.grade_number && g.basis === subj.grade_basis) ?? null;
  }, [subj, grades]);

  const med = peer?.med ?? null; // market parity (title median) — shown as a secondary reference

  const otherPeers = useMemo(
    () => (trayPeople ?? [])
      .filter((p) => p.person_key !== subjectKey)
      .map((p) => ({ ...p, delta: (subjectPay ?? 0) - p.pay }))
      .sort((a, b) => b.pay - a.pay),
    [trayPeople, subjectKey, subjectPay]
  );
  const topPaidPeer = otherPeers.filter((p) => p.pay > (subjectPay ?? 0)).sort((a, b) => b.pay - a.pay)[0];

  // ── Targets: experience/scope-adjusted is primary; market median is secondary ──
  const primaryTarget = expMedian ?? peer?.p75 ?? med ?? null;
  const belowTarget = subjectPay != null && primaryTarget != null && subjectPay < primaryTarget;
  const targetDelta = belowTarget && primaryTarget != null && subjectPay != null ? primaryTarget - subjectPay : 0;
  const targetPct = belowTarget && subjectPay ? targetDelta / subjectPay : 0;
  const topPeerGap = topPaidPeer && subjectPay != null ? topPaidPeer.pay - subjectPay : null;

  // ── Highlight reel: three punchy cards (only what sells the increase) ──
  const highlights = useMemo(() => {
    const cards: { icon: ReactNode; color: string; value: string; label: string }[] = [];
    if (subjectPay == null) return cards;
    if (percentile != null) {
      cards.push({
        icon: <IconChartBar size={20} />, color: 'orange',
        value: `${ordinal(percentile)} percentile`,
        label: tenureYears != null
          ? `despite ${tenureYears.toFixed(1)} years of tenure`
          : `among ${num(peer?.n)} ${subj?.title ?? 'peers'} at UW`,
      });
    }
    if (topPeerGap != null && topPeerGap > 0 && topPaidPeer) {
      cards.push({
        icon: <IconUsers size={20} />, color: 'red',
        value: `−${usd(topPeerGap)}`,
        label: `vs ${topPaidPeer.fn} ${topPaidPeer.ln} in a comparable role`,
      });
    } else if (belowTarget) {
      cards.push({
        icon: <IconUsers size={20} />, color: 'red',
        value: `−${usd(targetDelta)}`,
        label: 'below your experience-adjusted target',
      });
    }
    if (supervises) {
      cards.push({
        icon: <IconUsersGroup size={20} />, color: 'indigo',
        value: `${supN} ${supN === 1 ? 'report' : 'staff'}`,
        label: `supervised beyond base title${superviseNote ? ` (${superviseNote})` : ''}`,
      });
    } else if (band && subjectPay < band.max) {
      cards.push({
        icon: <IconUsersGroup size={20} />, color: 'indigo',
        value: `−${usd(band.max - subjectPay)}`,
        label: `below grade ${subj?.grade_number} band maximum`,
      });
    } else if (tenureYears != null) {
      cards.push({
        icon: <IconClock size={20} />, color: 'indigo',
        value: `${tenureYears.toFixed(1)} yrs`,
        label: 'of experience to recognize',
      });
    }
    return cards;
  }, [subjectPay, percentile, tenureYears, peer, subj, topPeerGap, topPaidPeer, belowTarget, targetDelta, supervises, supN, superviseNote, band]);

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
              { value: 'person', label: 'Report On Person' },
              { value: 'comparison', label: 'Salary Increase Justification (People In Tray)' },
            ]}
          />
          <Button.Group>
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
              {/* Controls (not printed) */}
              <Card withBorder padding="lg" className="no-print">
                <Group align="flex-end" wrap="wrap" gap="lg">
                  <Select
                    label="Subject (raise case)"
                    data={persons.map((p) => ({ value: p.id, label: p.label }))}
                    value={subjectKey}
                    onChange={setSubjectKey}
                    w={260}
                  />
                </Group>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="md" mb={6} style={{ letterSpacing: '0.05em' }}>
                  Include in report
                </Text>
                <Checkbox.Group value={sections} onChange={setSections}>
                  <Group gap="lg">
                    {SECTIONS.map((s) => (
                      <Checkbox key={s.value} value={s.value} label={s.label} />
                    ))}
                  </Group>
                </Checkbox.Group>
                <Group align="flex-end" wrap="wrap" gap="md" mt="md">
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
                    w={120}
                    disabled={!superviseOn}
                  />
                  <TextInput
                    label="Note (optional)"
                    placeholder="e.g. a team of 8 / 4 direct reports"
                    value={superviseNote}
                    onChange={(e) => setSuperviseNote(e.currentTarget.value)}
                    w={300}
                    disabled={!superviseOn}
                  />
                </Group>
              </Card>

              {/* The report */}
              <Card withBorder padding="xl" className="print-area">
                <Title order={3}>Salary Adjustment Justification — {subjectName}</Title>
                <Text c="dimmed">
                  {[subj?.title, subj?.grade_number != null ? `grade ${subj.grade_number}` : null, subj?.school]
                    .filter(Boolean)
                    .join(' · ')}
                  {subj?.title ? ' · ' : ''}{snapLabel} · {METRIC_LABEL[metric]} · generated {generated}
                </Text>
                <Divider my="md" />

                {/* Recommendation callout — experience/scope-adjusted target is the headline */}
                <Paper radius="md" p="lg" bg="var(--mantine-color-indigo-light)" mb="lg">
                  {belowTarget && primaryTarget != null ? (
                    <Group justify="space-between" wrap="wrap" gap="md" align="center">
                      <div>
                        <Text size="xs" c="dimmed">Current ({METRIC_LABEL[metric]})</Text>
                        <Text fw={700} fz="xl">{usd(subjectPay)}</Text>
                      </div>
                      <Text fz={28} c="green.7">→</Text>
                      <div>
                        <Text size="xs" c="dimmed">Target salary (experience &amp; scope adjusted)</Text>
                        <Text fw={800} fz={30} c="green.8" lh={1.1}>{usd(primaryTarget)}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Adjustment</Text>
                        <Text fw={700} fz="xl" c="green.7">+{usd(targetDelta)} ({pct(targetPct)})</Text>
                      </div>
                    </Group>
                  ) : (
                    <Text fw={600}>
                      {subjectPay != null
                        ? `Current salary ${usd(subjectPay)}${primaryTarget != null ? ` is at or above the experience-adjusted target (${usd(primaryTarget)})` : ''}.`
                        : 'No salary on record for the subject in this snapshot.'}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" mt="xs">
                    {med != null && `For reference, the ${subj?.title ?? 'title'} market median (parity) is ${usd(med)}.`}
                    {supervises ? ` Plus supervisory scope (${supN} ${supN === 1 ? 'report' : 'staff'}) beyond title.` : ''}
                  </Text>
                </Paper>

                {!jobCode && (
                  <Alert color="gray" mb="lg">No job code on record for {subjectName} in this snapshot, so title-market benchmarking is unavailable.</Alert>
                )}

                {/* Highlight reel — three punchy cards */}
                {has('highlights') && highlights.length > 0 && (
                  <SimpleGrid cols={{ base: 1, sm: 3 }} mb="lg">
                    {highlights.map((h, i) => (
                      <Card key={i} withBorder radius="md" padding="lg">
                        <ThemeIcon variant="light" color={h.color} size={38} radius="md">{h.icon}</ThemeIcon>
                        <Text fw={800} fz={26} mt="sm" lh={1.1}>{h.value}</Text>
                        <Text size="sm" c="dimmed" mt={4}>{h.label}</Text>
                      </Card>
                    ))}
                  </SimpleGrid>
                )}

                {/* Direct peers — the most persuasive evidence, up top */}
                {has('peers') && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Direct peer comparison</Text>
                    {otherPeers.length > 0 ? (
                      <Table striped highlightOnHover style={{ maxWidth: 820 }} mb="lg">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Name</Table.Th>
                            <Table.Th>Title</Table.Th>
                            <Table.Th ta="right">Salary</Table.Th>
                            <Table.Th ta="right">Δ vs {subjectFirst}</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {otherPeers.map((p) => (
                            <Table.Tr key={p.person_key}>
                              <Table.Td>{p.fn} {p.ln}</Table.Td>
                              <Table.Td>{p.title ?? '—'}</Table.Td>
                              <Table.Td ta="right">{usd(p.pay)}</Table.Td>
                              <Table.Td ta="right">
                                <Text span fw={700} fz="sm" c={p.delta < 0 ? 'red.7' : 'teal.7'}>
                                  {p.delta < 0 ? '−' : '+'}{usd(Math.abs(p.delta))}
                                </Text>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    ) : (
                      <Text size="sm" c="dimmed" mb="lg">Add more people to the tray to compare {subjectFirst} against direct peers.</Text>
                    )}
                  </>
                )}

                {/* Title benchmark */}
                {has('benchmark') && peer && peer.n > 0 && subjectPay != null &&
                  peer.lo != null && peer.p25 != null && peer.med != null && peer.p75 != null && peer.hi != null && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Title-market benchmark — {subj?.title}</Text>
                    <PeerRangeBar min={peer.lo} p25={peer.p25} median={peer.med} p75={peer.p75} max={peer.hi} value={subjectPay} target={primaryTarget} />
                    <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md" mb="lg">
                      <Stat label="Percentile" value={percentile != null ? ordinal(percentile) : '—'} />
                      <Stat label="Target (exp-adjusted)" value={primaryTarget != null ? usd(primaryTarget) : '—'} />
                      <Stat label="Gap to target" value={belowTarget ? `−${usd(targetDelta)}` : '—'} />
                      <Stat label="Peers in title" value={num(peer.n)} />
                    </SimpleGrid>
                  </>
                )}

                {/* Pay band */}
                {has('band') && band && subjectPay != null && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Pay-band position — grade {subj?.grade_number}</Text>
                    <PayBandBar min={band.min} max={band.max} value={subjectPay} target={primaryTarget} />
                    <div style={{ height: 16 }} />
                  </>
                )}

                {/* Tenure & experience (lean — supports the case only) */}
                {has('tenure') && (
                  <>
                    <Text size="sm" fw={600} mb="xs">Tenure &amp; experience</Text>
                    <SimpleGrid cols={{ base: 2, sm: 2 }} mb="lg">
                      <Stat label="Tenure" value={tenureYears != null ? `${tenureYears.toFixed(1)} yrs` : '—'} />
                      <Stat label="Longest no-raise streak" value={growth ? `${growth.longest} period${growth.longest === 1 ? '' : 's'}` : '—'} />
                    </SimpleGrid>
                  </>
                )}

                {/* Deep stats tucked away (screen-only drill-down) */}
                {(peer || growth) && (
                  <Accordion variant="contained" mb="lg" className="no-print">
                    <Accordion.Item value="deep">
                      <Accordion.Control>View deep statistical breakdown</Accordion.Control>
                      <Accordion.Panel>
                        <SimpleGrid cols={{ base: 2, sm: 4 }}>
                          {peer?.p25 != null && <Stat label="25th pctile" value={usd(peer.p25)} />}
                          {peer?.med != null && <Stat label="Median" value={usd(peer.med)} />}
                          {peer?.p75 != null && <Stat label="75th pctile" value={usd(peer.p75)} />}
                          {peer?.p90 != null && <Stat label="90th pctile" value={usd(peer.p90)} />}
                          {peer?.lo != null && peer?.hi != null && <Stat label="Range" value={`${usd(peer.lo)} – ${usd(peer.hi)}`} />}
                          {growth?.totalPct != null && <Stat label="Total growth" value={pct(growth.totalPct)} />}
                          {growth && <Stat label="Raises" value={`${growth.raises} / ${growth.periods}`} />}
                          {growth?.avgPct != null && <Stat label="Avg raise" value={pct(growth.avgPct)} />}
                        </SimpleGrid>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                )}

                {/* Supervision callout */}
                {supervises && (
                  <Paper withBorder radius="md" p="md" mb="lg">
                    <Text size="sm" fw={600}>Added responsibilities</Text>
                    <Text size="sm">
                      {subjectName} supervises {supN} {supN === 1 ? 'person' : 'people'}
                      {superviseNote ? ` (${superviseNote})` : ''} — managerial scope beyond the base title.
                    </Text>
                  </Paper>
                )}

                {/* Schools (secondary context) */}
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

                <Text size="xs" c="dimmed" mt="md">
                  Methodology: "parity" = the median pay of everyone sharing the subject's job code at this snapshot;
                  the experience-adjusted figure is the median for same-title peers with at least the subject's tenure.
                  Supervisory scope is self-reported (not in the salary dataset). Pay-band ranges are best-effort and
                  only partially seeded.
                </Text>
                <Footer />
              </Card>
            </>
          )}
        </>
      )}
    </Stack>
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
