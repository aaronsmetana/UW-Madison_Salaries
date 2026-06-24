import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Group, Button, SegmentedControl, Card, Box, Paper, Skeleton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconPrinter } from '@tabler/icons-react';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, num, pct, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { PersonDashboard } from '../components/PersonDashboard';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { ReportSetup, type SetupComparator, type SuggestPerson } from '../components/report/ReportSetup';
import { ReportBrief } from '../components/report/ReportBrief';
import {
  COHORT_DEFS, FACTOR_DEFS, defaultConfig, cohortStats, deficitBadge, caseStrength, buildTalkingPoints,
  ordinal, type ReportConfig, type CohortMode, type CohortRow, type ComparatorRow, type ProofModel,
  type ReceiptLine, type BriefModel, type BadgeTone, type StrengthKey,
} from '../components/report/model';

interface Subject {
  pay: number | null; title: string | null; job_code: string | null;
  grade_number: number | null; school: string | null; date_of_hire: string | null;
}
interface PeerRow { person_key: string; pay: number; tenure: number | null; school: string | null }
interface TrayPerson { person_key: string; fn: string; ln: string; title: string | null; school: string | null; pay: number; tenure: number | null }

const ALL_MODES: CohortMode[] = ['all', 'school', 'tenure', 'grade', 'curated'];

export default function Reports() {
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { data: summary } = useSummary();
  const { items, add, remove, primaryId } = useTray();
  const snapLabel = summary?.snapshots.find((x) => x.id === snap)?.label ?? snap ?? '—';
  const generated = new Date().toISOString().slice(0, 10);
  const isDesktop = useMediaQuery('(min-width: 75em)') ?? true;

  // The tray's "Report →" shortcut deep-links here with ?mode=compare to open the comparison studio.
  const [params] = useSearchParams();
  const [type, setType] = useState(params.get('mode') === 'compare' ? 'comparison' : 'person');
  const [hovered, setHovered] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'setup' | 'preview'>('setup');
  const [config, setConfig] = useState<ReportConfig>(defaultConfig);

  // ── Report on person ──
  const [selPerson, setSelPerson] = useState<{ key: string; name: string } | null>(null);
  const { data: personHistory } = useSql<{ snapshot: string; title: string | null; job_code: string | null; school: string | null; pay: number | null; fte: number | null }>(
    ['rpt-person-hist', selPerson?.key ?? '', metric],
    `SELECT snapshot_label AS snapshot, title, job_code, school, ${expr} AS pay, fte
     FROM salaries WHERE person_key = ${sqlStr(selPerson?.key ?? '')} ORDER BY snapshot_date`,
    type === 'person' && !!selPerson
  );

  // ── Comparison studio (tray) ──
  const persons = items.filter((i) => i.type === 'person');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');

  const [subjectKey, setSubjectKey] = useState<string | null>(null);
  useEffect(() => {
    // Seed the subject from the tray's chosen "Subject" (primaryId) when none/invalid; the in-report
    // Select still overrides afterward.
    if (persons.length && (!subjectKey || !persons.some((p) => p.id === subjectKey))) {
      const seed = primaryId && persons.some((p) => p.id === primaryId) ? primaryId : persons[0].id;
      setSubjectKey(seed);
    }
    if (!persons.length && subjectKey) setSubjectKey(null);
  }, [persons, subjectKey, primaryId]);
  const subjectName = persons.find((p) => p.id === subjectKey)?.label ?? '';
  const subjectFirst = subjectName.split(' ')[0] || 'They';

  const cmpReady = type === 'comparison' && !!snap && !!subjectKey;

  const { data: subjRows } = useSql<Subject>(
    ['rpt-subj', subjectKey, snap ?? '', metric],
    `SELECT ${personPay(metric)} pay, arg_max(title, ${expr}) title, arg_max(job_code, ${expr}) job_code,
        arg_max(grade_number, ${expr}) grade_number, any_value(school) school, min(date_of_hire) date_of_hire
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key = ${sqlStr(subjectKey ?? '')}`,
    cmpReady
  );
  const subj = subjRows?.[0];
  const subjectPay = subj?.pay ?? null;
  const jobCode = subj?.job_code ?? null;
  const grade = subj?.grade_number ?? null;
  const school = subj?.school ?? null;

  const { data: peerListRows } = useSql<PeerRow>(
    ['rpt-peerlist', jobCode ?? '', snap ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT person_key, pay, tenure, school FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );

  const { data: gradeListRows } = useSql<{ person_key: string; pay: number; tenure: number | null }>(
    ['rpt-gradelist', grade ?? -1, snap ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND grade_number = ${grade ?? -1} GROUP BY person_key)
     SELECT person_key, pay, tenure FROM pp WHERE pay > 0`,
    cmpReady && grade != null
  );

  const { data: trayPeople } = useSql<TrayPerson>(
    ['rpt-tray', personIds, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title,
        any_value(school) school, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && persons.length > 0 && !!snap
  );

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

  const { data: peerHist } = useSql<{ person_key: string; date: string; pay: number }>(
    ['rpt-peer-hist', personIds, metric],
    `SELECT person_key, any_value(snapshot_date) date, ${personPay(metric)} pay
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    type === 'comparison' && persons.length > 0
  );

  const { data: suggestRows } = useSql<{ person_key: string; fn: string; ln: string; pay: number }>(
    ['rpt-suggest', jobCode ?? '', snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, ${personPay(metric)} pay
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')}
     GROUP BY person_key ORDER BY pay DESC LIMIT 10`,
    cmpReady && !!jobCode
  );

  // ── Derivation ──
  const tenureYears = useMemo(() => {
    if (!subj?.date_of_hire) return null;
    return Math.max(0, (Date.now() - new Date(subj.date_of_hire).getTime()) / (365.25 * 864e5));
  }, [subj]);

  // Each cohort is the set of PEERS the subject is measured against — the subject is never part of
  // their own benchmark (critical for the small curated set, where including them halves the gap).
  const cohortRowsFor = useMemo(() => {
    const peers = (peerListRows ?? []).filter((r) => r.person_key !== subjectKey);
    const grades = (gradeListRows ?? []).filter((r) => r.person_key !== subjectKey);
    const curated = (trayPeople ?? []).filter((r) => r.person_key !== subjectKey).map((r) => ({ pay: r.pay, tenure: r.tenure }));
    return (mode: CohortMode): CohortRow[] => {
      switch (mode) {
        case 'all': return peers.map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'school': return peers.filter((r) => school != null && r.school === school).map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'tenure': return tenureYears == null ? [] : peers.filter((r) => r.tenure != null && Math.abs(r.tenure - tenureYears) <= config.tenureBand).map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'grade': return grades.map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'curated': return curated;
      }
    };
  }, [peerListRows, trayPeople, gradeListRows, school, tenureYears, config.tenureBand, subjectKey]);

  const statsByMode = useMemo(() => {
    const out = {} as Record<CohortMode, ReturnType<typeof cohortStats>>;
    for (const m of ALL_MODES) out[m] = cohortStats(cohortRowsFor(m), subjectPay, tenureYears);
    return out;
  }, [cohortRowsFor, subjectPay, tenureYears]);

  const cohortAvailable = useMemo(() => {
    const minN = (m: CohortMode) => (m === 'curated' ? 1 : 3); // 1 named peer is a valid curated benchmark
    return Object.fromEntries(ALL_MODES.map((m) => {
      let ok = statsByMode[m].n >= minN(m);
      if (m === 'school' && school == null) ok = false;
      if (m === 'tenure' && tenureYears == null) ok = false;
      if (m === 'grade' && grade == null) ok = false;
      return [m, ok];
    })) as Record<CohortMode, boolean>;
  }, [statsByMode, school, tenureYears, grade]);

  const selectedMode: CohortMode = cohortAvailable[config.cohort] ? config.cohort : 'all';
  const stats = statsByMode[selectedMode];
  const med = stats.med;
  const cohortLabel = COHORT_DEFS.find((c) => c.value === selectedMode)?.label ?? '';

  // Longevity (consecutive years below the title median)
  const longevity = useMemo(() => {
    const rows = (medHist ?? []).filter((r) => r.pay != null && r.pay > 0 && r.med != null);
    if (!rows.length) return { belowCount: 0, total: 0, streak: 0, streakYears: 0 };
    const below = rows.filter((r) => (r.pay as number) < (r.med as number));
    const streakDates: string[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i].pay as number) < (rows[i].med as number)) streakDates.push(rows[i].date);
      else break;
    }
    return { belowCount: below.length, total: rows.length, streak: streakDates.length, streakYears: new Set(streakDates.map((d) => new Date(d).getFullYear())).size };
  }, [medHist]);

  // Absolute-dollar raise divergence
  const progression = useMemo(() => {
    const byPerson = new Map<string, number[]>();
    for (const r of peerHist ?? []) {
      if (r.pay == null || r.pay <= 0) continue;
      (byPerson.get(r.person_key) ?? byPerson.set(r.person_key, []).get(r.person_key)!).push(r.pay);
    }
    const abs = (a: number[]) => (a.length >= 2 ? a[a.length - 1] - a[0] : null);
    const peers = [...byPerson.entries()].filter(([k]) => k !== subjectKey).map(([, a]) => abs(a)).filter((v): v is number => v != null);
    const subjAbs = subjectKey ? abs(byPerson.get(subjectKey) ?? []) : null;
    return { avgAbs: peers.length ? peers.reduce((s, v) => s + v, 0) / peers.length : null, subjAbs };
  }, [peerHist, subjectKey]);

  // Comparator rows for the matrix (+ equity anomaly)
  const otherPeers = useMemo(
    () => (trayPeople ?? []).filter((p) => p.person_key !== subjectKey).sort((a, b) => b.pay - a.pay),
    [trayPeople, subjectKey]
  );
  const anomalyKey = useMemo(() => {
    if (subjectPay == null || tenureYears == null) return null;
    let best: { key: string; gap: number } | null = null;
    for (const p of otherPeers) {
      if (p.tenure != null && p.tenure < tenureYears && p.pay > subjectPay) {
        const gap = p.pay - subjectPay;
        if (!best || gap > best.gap) best = { key: p.person_key, gap };
      }
    }
    return best?.key ?? null;
  }, [otherPeers, subjectPay, tenureYears]);

  const rows: ComparatorRow[] = useMemo(() => {
    const list: ComparatorRow[] = otherPeers.map((p) => ({
      key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, pay: p.pay, tenure: p.tenure ?? null,
      isSubject: false, isAnomaly: p.person_key === anomalyKey,
      lessTenure: p.tenure != null && tenureYears != null && p.tenure < tenureYears && p.pay > (subjectPay ?? 0),
      gap: p.pay - (subjectPay ?? 0),
    }));
    if (subjectPay != null) list.unshift({ key: '__subject__', name: subjectName, title: subj?.title ?? null, pay: subjectPay, tenure: tenureYears, isSubject: true, isAnomaly: false, lessTenure: false, gap: 0 });
    return list;
  }, [otherPeers, anomalyKey, subjectPay, tenureYears, subjectName, subj]);
  const maxPay = Math.max(1, ...rows.map((r) => r.pay));
  const showTenure = rows.some((r) => r.tenure != null);

  // ── Target + receipt math ──
  const targetPerson = (trayPeople ?? []).find((p) => p.person_key === config.targetKey) ?? null;
  const targetPay = targetPerson?.pay ?? null;
  const baseParity = targetPay ?? stats.expMed ?? med ?? null;
  const medianKind = stats.expMed != null ? 'tenure-adjusted median' : 'median';
  const baseLabel = targetPerson
    ? `${fullName(targetPerson.fn, targetPerson.ln)}'s salary`
    : `${medianKind} · ${cohortLabel}`;

  const activeFactors = FACTOR_DEFS.filter((f) => config.factors[f.key].on).map((f) => {
    const a = config.factors[f.key].amount;
    return { key: f.key, label: f.label, note: config.factors[f.key].note.trim(), amount: typeof a === 'number' && a > 0 ? a : null };
  });
  const addOnSum = activeFactors.reduce((s, f) => s + (f.amount ?? 0), 0);
  const computed = baseParity != null ? baseParity + addOnSum : null;
  const override = typeof config.override === 'number' && config.override > 0 ? config.override : null;
  const recommended = override ?? computed;
  const belowTarget = subjectPay != null && recommended != null && recommended > subjectPay;
  const targetDelta = belowTarget && recommended != null && subjectPay != null ? recommended - subjectPay : 0;
  const targetPct = belowTarget && subjectPay ? targetDelta / subjectPay : 0;

  const receipt: ReceiptLine[] = useMemo(() => {
    if (baseParity == null) return [];
    const out: ReceiptLine[] = [{ id: 'base', label: `Base parity — ${baseLabel}`, amount: baseParity, kind: 'base' }];
    for (const f of activeFactors) if (f.amount != null) out.push({ id: f.key, label: `${f.label}${f.note ? ` (${f.note})` : ''}`, amount: f.amount, kind: 'addon' });
    if (override != null && computed != null && Math.round(override) !== Math.round(computed)) {
      out.push({ id: 'negotiated', label: 'Negotiated adjustment', amount: override - computed, kind: 'negotiated' });
    }
    return out;
  }, [baseParity, baseLabel, activeFactors, override, computed]);

  // ── Proofs ──
  const proofs: ProofModel[] = useMemo(() => {
    if (subjectPay == null) return [];
    const out: ProofModel[] = [];
    if (stats.percentile != null && stats.n >= 4) out.push({ kind: 'market', value: `${ordinal(stats.percentile)} percentile`, label: stats.gapToMed != null && stats.gapToMed > 0 ? `Current pay sits below the ${cohortLabel.toLowerCase()} median.` : `Current pay is at or above the ${cohortLabel.toLowerCase()} median.`, detail: '' });
    if (stats.invCount > 0) out.push({ kind: 'inversion', value: `${num(stats.invCount)} peers`, label: 'tenure inversions — less UW tenure, higher pay', detail: `paid up to +${usd(stats.invMaxGap)} more with fewer years at UW` });
    if (longevity.streak > 0) out.push({ kind: 'sustained', value: `${longevity.streakYears} ${longevity.streakYears === 1 ? 'year' : 'years'}`, label: 'consecutive years in market deficit', detail: longevity.streak >= longevity.total ? 'below the title median in every year on record' : 'most recent unbroken run below the median' });
    return out;
  }, [subjectPay, stats, longevity, cohortLabel]);

  // ── Case strength + talking points (left pane only) ──
  const strength = useMemo(() => caseStrength({ gapToMed: stats.gapToMed, med, invCount: stats.invCount, streakYears: longevity.streakYears, activeFactors: activeFactors.length }), [stats, med, longevity, activeFactors.length]);
  const talkingPoints = useMemo(() => buildTalkingPoints({
    subjectName, current: subjectPay, recommended, delta: targetDelta, pct: targetPct, cohortLabel,
    percentile: stats.percentile, invCount: stats.invCount, invMaxGap: stats.invMaxGap, streakYears: longevity.streakYears,
    factors: activeFactors,
  }), [subjectName, subjectPay, recommended, targetDelta, targetPct, cohortLabel, stats, longevity, activeFactors]);

  const headerMeta = [subj?.title, grade != null ? `grade ${grade}` : null, school, snapLabel, METRIC_LABEL[metric], `prepared ${generated}`].filter(Boolean).join(' · ');

  const basisLabel = belowTarget
    ? (targetPerson
        ? `to match ${fullName(targetPerson.fn, targetPerson.ln)}'s salary${addOnSum > 0 ? ', plus documented value-adds' : ''}`
        : `to reach the ${medianKind} of ${cohortLabel.toLowerCase()}${addOnSum > 0 ? ', plus documented value-adds' : ''}`)
    : '';

  const model: BriefModel = {
    subjectName, subjectFirst, subjectPay, headerMeta,
    recommended, belowTarget, targetDelta, targetPct,
    basisLabel: config.headline.trim() || basisLabel,
    receipt, activeFactors, proofs, rows, maxPay, showTenure, cohortLabel,
    netSavings: subjectPay != null ? subjectPay * 0.5 - targetDelta : 0,
    divergence: progression.avgAbs != null && progression.subjAbs != null && progression.subjAbs < progression.avgAbs ? { avgAbs: progression.avgAbs, subjAbs: progression.subjAbs } : null,
    format: config.format, sections: config.sections, jobCode,
  };

  // ── Setup-pane data ──
  const comparators: SetupComparator[] = (trayPeople ?? []).map((p) => ({
    key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, school: p.school ?? null,
    tenure: p.tenure ?? null, pay: p.pay, isSubject: p.person_key === subjectKey,
  })).sort((a, b) => (a.isSubject ? -1 : b.isSubject ? 1 : b.pay - a.pay));
  // Fall back to tray labels before trayPeople resolves, so the subject is always selectable.
  const comparatorOptions = comparators.length ? comparators : persons.map((p) => ({ key: p.id, name: p.label, title: null, school: null, tenure: null, pay: null, isSubject: p.id === subjectKey }));
  const targetOptions = comparators.filter((c) => !c.isSubject).map((c) => ({ value: c.key, label: c.name }));
  const trayIds = new Set(persons.map((p) => p.id));
  const suggestions: SuggestPerson[] = persons.length >= 5 ? [] : (suggestRows ?? [])
    .filter((s) => !trayIds.has(s.person_key) && s.person_key !== subjectKey)
    .slice(0, 3)
    .map((s) => ({ key: s.person_key, name: fullName(s.fn, s.ln), pay: s.pay }));
  // Semantic scenting: highlight the single biggest-deficit lens as the strongest ("best") case.
  let bestMode: CohortMode | null = null;
  let bestGap = 0;
  for (const m of ALL_MODES) {
    if (!cohortAvailable[m]) continue;
    const g = statsByMode[m].gapToMed ?? 0;
    if (g > bestGap) { bestGap = g; bestMode = m; }
  }
  const cohortBadges = Object.fromEntries(ALL_MODES.map((m) => {
    if (!cohortAvailable[m]) return [m, null];
    const b = deficitBadge(statsByMode[m].gapToMed);
    if (b && b.tone === 'deficit' && m === bestMode) return [m, { text: b.text, tone: 'best' as BadgeTone }];
    return [m, b];
  })) as Record<CohortMode, { text: string; tone: BadgeTone } | null>;

  // Per-signal coaching: for any case-strength bar that isn't maxed, the concrete lever to lift it.
  const bestLabel = COHORT_DEFS.find((c) => c.value === bestMode)?.label ?? '';
  const strengthHints: Partial<Record<StrengthKey, { text: string; tone: 'action' | 'fixed' }>> = {};
  for (const p of strength.parts) {
    if (p.value >= p.max) continue;
    const head = p.max - p.value;
    if (p.key === 'market') {
      if (bestMode && bestMode !== selectedMode && bestGap > (stats.gapToMed ?? 0)) {
        strengthHints.market = { text: `up to +${head} pts · switch to “${bestLabel}” (−${usd(bestGap)})`, tone: 'action' };
      } else if (stats.gapToMed != null && stats.gapToMed > 0 && med) {
        strengthHints.market = { text: `the largest gap available — ${pct(stats.gapToMed / med)} below this cohort’s median`, tone: 'fixed' };
      } else {
        strengthHints.market = { text: 'at or above this cohort’s median', tone: 'fixed' };
      }
    } else if (p.key === 'inversion') {
      strengthHints.inversion = { text: `up to +${head} pts · add comparators with less UW tenure who out-earn ${subjectFirst}`, tone: 'action' };
    } else if (p.key === 'added') {
      const need = Math.max(1, 3 - activeFactors.length);
      strengthHints.added = { text: `up to +${head} pts · document ${need} more justification factor${need === 1 ? '' : 's'}`, tone: 'action' };
    } else if (p.key === 'sustained') {
      strengthHints.sustained = { text: `fixed · ${longevity.streakYears} yr${longevity.streakYears === 1 ? '' : 's'} below median on record`, tone: 'fixed' };
    }
  }

  const loading = cmpReady && (!subjRows || !trayPeople || (!!jobCode && !peerListRows));

  // ── Render ──
  const setupPane = (
    <Box className="setup-panel">
      <ReportSetup
        config={config}
        onChange={setConfig}
        comparators={comparatorOptions}
        subjectKey={subjectKey}
        onSubject={setSubjectKey}
        basePay={subjectPay}
        suggestions={suggestions}
        onAddPerson={(p) => add({ type: 'person', id: p.key, label: p.name })}
        onRemovePerson={(key) => remove(key)}
        cohortBadges={cohortBadges}
        cohortAvailable={cohortAvailable}
        targetOptions={targetOptions}
        caseStrength={strength}
        strengthHints={strengthHints}
        talkingPoints={talkingPoints}
        onReset={() => setConfig(defaultConfig())}
        onHover={setHovered}
      />
    </Box>
  );

  const briefPane = loading
    ? <Card withBorder padding="xl" className="report-brief"><Skeleton h={40} mb="lg" /><Skeleton h={120} mb="lg" /><Skeleton h={80} mb="lg" /><Skeleton h={160} /></Card>
    : <ReportBrief model={model} hovered={hovered} onHover={setHovered} />;

  return (
    <Stack gap="lg">
      <div className="no-print">
        <PageHeader
          title="Reports"
          right={
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
                <Button
                  variant="default"
                  leftSection={<IconDownload size={16} />}
                  disabled={type === 'person' ? !personHistory?.length : !peerListRows?.length}
                  onClick={() =>
                    type === 'person'
                      ? downloadCSV(`${selPerson?.name ?? 'employee'}-history.csv`, (personHistory ?? []) as unknown as Record<string, unknown>[])
                      : downloadCSV(`${subjectName || 'subject'}-title-peers-${snap}.csv`, (peerListRows ?? []) as unknown as Record<string, unknown>[])
                  }
                >
                  Download CSV
                </Button>
                <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
                  Print / Save as PDF
                </Button>
              </Button.Group>
            </Group>
          }
        />
      </div>

      {type === 'person' && (
        <>
          <Card withBorder padding="lg" className="no-print">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.05em' }}>Report on</Text>
            <SearchBox placeholder="Search an employee by name…" onPick={(h) => setSelPerson({ key: h.person_key, name: h.name })} />
            {selPerson && <Text size="sm" mt="sm">Showing report for <b>{selPerson.name}</b>.</Text>}
          </Card>
          {selPerson ? (
            <div className="print-area"><PersonDashboard personKey={selPerson.key} metric={metric} /></div>
          ) : (
            <Card withBorder padding="xl"><Text c="dimmed">Search and pick an employee above to generate a single-page report on their pay, title history, and how they compare to others in their title.</Text></Card>
          )}
        </>
      )}

      {type === 'comparison' && (
        persons.length === 0 ? (
          <Card withBorder padding="xl" className="no-print">
            <Text fw={600} mb={4}>Start your equity review</Text>
            <Text c="dimmed" size="sm" mb="md">Add yourself (the subject), then add the peers you want to be compared against.</Text>
            <SearchBox placeholder="Search yourself by name to begin…" onPick={(h) => add({ type: 'person', id: h.person_key, label: h.name })} />
          </Card>
        ) : isDesktop ? (
          <div style={{ display: 'flex', gap: 'var(--mantine-spacing-lg)', alignItems: 'flex-start' }}>
            <div style={{ width: '40%', maxWidth: 460, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
              {setupPane}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{briefPane}</div>
          </div>
        ) : (
          <>
            {/* Sticky ledger so the math is always visible while editing on mobile */}
            <Paper className="no-print" withBorder radius="md" p="xs" style={{ position: 'sticky', top: 8, zIndex: 5 }}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">Current {subjectPay != null ? usd(subjectPay) : '—'}</Text>
                <Text size="sm" fw={800} c={belowTarget ? 'green.7' : undefined}>
                  → {recommended != null ? usd(recommended) : '—'}{belowTarget ? ` (+${pct(targetPct)})` : ''}
                </Text>
              </Group>
            </Paper>
            <SegmentedControl
              className="no-print"
              fullWidth
              value={mobileTab}
              onChange={(v) => setMobileTab(v as 'setup' | 'preview')}
              data={[{ value: 'setup', label: 'Setup' }, { value: 'preview', label: 'Preview' }]}
            />
            <div style={{ display: mobileTab === 'setup' ? undefined : 'none' }}>{setupPane}</div>
            <div style={{ display: mobileTab === 'preview' ? undefined : 'none' }}>{briefPane}</div>
          </>
        )
      )}
    </Stack>
  );
}
