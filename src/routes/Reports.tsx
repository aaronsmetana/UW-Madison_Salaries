import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Group, Button, SegmentedControl, Card, Box, Paper, Skeleton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconPrinter, IconFileReport } from '@tabler/icons-react';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId, useGrades } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay } from '../lib/queries';
import { useTray } from '../state/tray';
import { usd, pct, fullName, fmtDate, plural } from '../lib/format';
import { useDocTitle } from '../lib/useDocTitle';
import { downloadCSV } from '../lib/csv';
import { toReal } from '../lib/cpi';
import { leastSquares } from '../lib/stats';
import { readPref, writePref, clearPref } from '../lib/prefs';
import { PersonDashboard } from '../components/PersonDashboard';
import { EmptyState } from '../components/EmptyState';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { type ScatterPoint } from '../components/TenurePayScatter';
import { ReportSetup, type SetupComparator, type SuggestPerson } from '../components/report/ReportSetup';
import { ReportBrief } from '../components/report/ReportBrief';
import {
  COHORT_DEFS, FACTOR_DEFS, defaultConfig, migrateConfig, cohortStats, deficitBadge, caseStrength, buildTalkingPoints,
  cohortDocLabel, ordinal, buildSupervisoryCase, buildGuidelineCompression, median, type ReportConfig, type CohortMode, type CohortRow, type ComparatorRow,
  type ProofModel, type ReceiptLine, type BriefModel, type BadgeTone, type StrengthKey,
} from '../components/report/model';

interface Subject {
  pay: number | null; title: string | null; job_code: string | null;
  grade_number: number | null; grade_basis: string | null; school: string | null; date_of_hire: string | null;
  flsa_status: string | null;
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
  const generated = fmtDate(new Date());
  const isDesktop = useMediaQuery('(min-width: 75em)') ?? true;

  // The tray's "Report →" shortcut deep-links here with ?mode=compare to open the comparison studio
  // (kept working as a legacy trigger); ?type= is the current, shareable form this page now writes.
  const [params, setSearchParams] = useSearchParams();
  const [type, setType] = useState(() => {
    if (params.get('type') === 'comparison' || params.get('mode') === 'compare') return 'comparison';
    return 'person';
  });
  const [hovered, setHovered] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'setup' | 'preview'>('setup');
  const [config, setConfig] = useState<ReportConfig>(defaultConfig);

  // ── Comparison studio (tray) — subject resolution lives here (ahead of the person-mode URL-sync
  // effect below) so that effect can also read/write ?subject= for the comparison studio. ──
  const persons = items.filter((i) => i.type === 'person');
  const personIds = persons.map((p) => sqlStr(p.id)).join(',');

  const [subjectKey, setSubjectKey] = useState<string | null>(() => params.get('subject'));
  useEffect(() => {
    // Seed the subject from the tray's chosen "Subject" (primaryId) when none/invalid; the in-report
    // Select still overrides afterward. A subject seeded from ?subject= (above) is left alone as long
    // as it's still a valid tray member.
    if (persons.length && (!subjectKey || !persons.some((p) => p.id === subjectKey))) {
      const seed = primaryId && persons.some((p) => p.id === primaryId) ? primaryId : persons[0].id;
      setSubjectKey(seed);
    }
    if (!persons.length && subjectKey) setSubjectKey(null);
  }, [persons, subjectKey, primaryId]);
  const subjectName = persons.find((p) => p.id === subjectKey)?.label ?? '';
  const subjectFirst = subjectName.split(' ')[0] || 'They';

  // ── Report on person ── hydrated once from ?person=/?pname= on mount (a finished report is
  // shareable), then kept in sync (with ?type=) the same way Compare syncs its ?sel= tray link.
  const [selPerson, setSelPerson] = useState<{ key: string; name: string } | null>(() => {
    const key = params.get('person');
    return key ? { key, name: params.get('pname') || key } : null;
  });
  useDocTitle(type === 'person' && selPerson ? `Report — ${selPerson.name}` : 'Reports');
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('mode'); // superseded by ?type=
        if (type === 'comparison') n.set('type', 'comparison');
        else n.delete('type');
        if (type === 'person' && selPerson) {
          n.set('person', selPerson.key);
          n.set('pname', selPerson.name);
        } else {
          n.delete('person');
          n.delete('pname');
        }
        // Mirrors Compare's ?sel= pattern: a finished comparison report is shareable via its subject.
        if (type === 'comparison' && subjectKey) n.set('subject', subjectKey);
        else n.delete('subject');
        return n;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, selPerson, subjectKey]);
  const { data: personHistory } = useSql<{ snapshot: string; title: string | null; job_code: string | null; school: string | null; pay: number | null; fte: number | null }>(
    ['rpt-person-hist', selPerson?.key ?? '', metric],
    `SELECT snapshot_label AS snapshot, title, job_code, school, ${expr} AS pay, fte
     FROM salaries WHERE person_key = ${sqlStr(selPerson?.key ?? '')} ORDER BY snapshot_date`,
    type === 'person' && !!selPerson
  );

  // Persist the whole setup (cohort, factors, override, sections…) per subject, so switching between
  // several in-progress equity cases (or a page refresh) doesn't lose the work already done on each.
  useEffect(() => {
    setConfig(subjectKey ? migrateConfig(readPref<unknown>(`report.cfg.${subjectKey}`, null)) : defaultConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);
  useEffect(() => {
    if (subjectKey) writePref(`report.cfg.${subjectKey}`, config);
  }, [subjectKey, config]);

  const cmpReady = type === 'comparison' && !!snap && !!subjectKey;

  const { data: subjRows } = useSql<Subject>(
    ['rpt-subj', subjectKey, snap ?? '', metric],
    `SELECT ${personPay(metric)} pay, arg_max(title, ${expr}) title, arg_max(job_code, ${expr}) job_code,
        arg_max(grade_number, ${expr}) grade_number, arg_max(grade_basis, ${expr}) grade_basis,
        arg_max(flsa_status, ${expr}) flsa_status,
        any_value(school) school, min(date_of_hire) date_of_hire
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key = ${sqlStr(subjectKey ?? '')}`,
    cmpReady
  );
  const subj = subjRows?.[0];
  const subjectPay = subj?.pay ?? null;
  const jobCode = subj?.job_code ?? null;
  const grade = subj?.grade_number ?? null;
  const school = subj?.school ?? null;
  // FLSA status drives the guideline's compression floor (exempt → 8%, non-exempt → 5%). Three spellings
  // exist in the record ('Exempt' / 'Non-exempt' / 'Non-Exempt'), so match case-insensitively; a null
  // status falls back to the conservative 5% floor (under-claims rather than over-claims).
  const exempt = subj?.flsa_status == null ? null : !/^non/i.test(subj.flsa_status);
  const { data: grades } = useGrades();
  const band = useMemo(() => {
    if (!subj || subj.grade_number == null || !grades) return null;
    return grades.find((g) => g.grade === subj.grade_number && g.basis === subj.grade_basis) ?? null;
  }, [subj, grades]);

  // As-of the snapshot date (not today) — matches every peer-side tenure calc below (all computed via
  // date_diff(..., snapshot_date)), so the subject's own tenure agrees with the peer matrix/inversions.
  const snapDate = summary?.snapshots.find((x) => x.id === snap)?.date ?? null;
  // The snapshot ~2 years before the subject's current one (for the retention section's attrition
  // stat) — falls back to the earliest available snapshot when the record doesn't go back that far.
  // `summary.snapshots` is the canonical chronological order (handles the Nov 2021 pre/post-TTC tie
  // correctly; a plain date/string sort would not).
  const fromSnapInfo = useMemo(() => {
    const list = summary?.snapshots;
    if (!list?.length || !snapDate) return null;
    const nowTime = new Date(snapDate).getTime();
    const targetTime = nowTime - 2 * 365.25 * 864e5;
    let best = list[0];
    let bestDiff = Infinity;
    for (const s of list) {
      const t = new Date(s.date).getTime();
      if (t > nowTime) continue; // never look forward of the subject's own snapshot
      const diff = Math.abs(t - targetTime);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    return best;
  }, [summary, snapDate]);
  // The snapshot immediately before the subject's current one (for the raise-cycle comparison) —
  // "immediately before" in the canonical `summary.snapshots` order, so Nov 2021's pre/post-TTC pair
  // is never treated as a single raise cycle.
  const prevSnapInfo = useMemo(() => {
    const list = summary?.snapshots;
    if (!list?.length || !snap) return null;
    const idx = list.findIndex((s) => s.id === snap);
    return idx > 0 ? list[idx - 1] : null;
  }, [summary, snap]);

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

  // Also carries tenure (not just top-10-by-pay) so the same rows can surface tenure-inversion
  // suggestions — peers who out-earn the subject despite less UW tenure — not just top earners.
  const { data: suggestRows } = useSql<{ person_key: string; fn: string; ln: string; pay: number; tenure: number | null }>(
    ['rpt-suggest', jobCode ?? '', snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')}
     GROUP BY person_key ORDER BY pay DESC LIMIT 200`,
    cmpReady && !!jobCode
  );

  // Direct reports named under the Supervisory-scope factor — resolved at the same snapshot, kept
  // separate from `trayPeople` (they are not comparators; naming one here never affects cohort stats).
  const superviseeIds = config.supervisees.map((k) => sqlStr(k)).join(',');
  const { data: superviseeRows } = useSql<TrayPerson>(
    ['rpt-supervisees', superviseeIds, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title,
        any_value(school) school, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${superviseeIds})
     GROUP BY person_key`,
    cmpReady && config.supervisees.length > 0
  );

  // Title attrition for the retention section — how many of the subject's same-title peers (as of
  // ~2 years ago) are no longer in that title today. "No longer in it" (not "left UW") since this
  // includes promotions/transfers, not just departures.
  const fromSnapId = fromSnapInfo?.id ?? '';
  const { data: attritionRows } = useSql<{ of_n: number; left_n: number }>(
    ['rpt-attrition', jobCode ?? '', snap ?? '', fromSnapId],
    `WITH f AS (SELECT DISTINCT person_key FROM salaries
                WHERE snapshot_id = ${sqlStr(fromSnapId)} AND job_code = ${sqlStr(jobCode ?? '')}),
          t AS (SELECT DISTINCT person_key FROM salaries
                WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')})
     SELECT (SELECT count(*) FROM f) of_n,
            (SELECT count(*) FROM f WHERE person_key NOT IN (SELECT person_key FROM t)) left_n`,
    cmpReady && !!jobCode && !!fromSnapId && fromSnapId !== snap
  );
  const attrition = useMemo(() => {
    const r = attritionRows?.[0];
    if (!r || !fromSnapInfo || r.of_n <= 0) return null;
    return { leftN: r.left_n, ofN: r.of_n, fromLabel: fromSnapInfo.label, toLabel: snapLabel };
  }, [attritionRows, fromSnapInfo, snapLabel]);

  // Raise-cycle comparison — same-title peers who appear in BOTH the previous and current snapshot
  // (continuing appointments only; new hires/departures would distort a "raise" comparison).
  const prevSnapId = prevSnapInfo?.id ?? '';
  const { data: raiseCycleRows } = useSql<{ person_key: string; pay_from: number; pay_to: number }>(
    ['rpt-raise-cycle', jobCode ?? '', snap ?? '', prevSnapId, metric],
    `WITH cur AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
                  WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key),
          prv AS (SELECT person_key, ${personPay(metric)} pay FROM salaries
                  WHERE snapshot_id = ${sqlStr(prevSnapId)} AND job_code = ${sqlStr(jobCode ?? '')} GROUP BY person_key)
     SELECT cur.person_key, prv.pay pay_from, cur.pay pay_to
     FROM cur JOIN prv USING (person_key) WHERE cur.pay > 0 AND prv.pay > 0`,
    cmpReady && !!jobCode && !!prevSnapId
  );
  const raiseCycle = useMemo(() => {
    const rows = raiseCycleRows ?? [];
    if (!rows.length || !prevSnapInfo) return null;
    const raises = rows.map((r) => (r.pay_to - r.pay_from) / r.pay_from);
    const medianPct = median(raises);
    if (medianPct == null) return null;
    const subjRow = subjectKey ? rows.find((r) => r.person_key === subjectKey) : undefined;
    const subjectPct = subjRow ? (subjRow.pay_to - subjRow.pay_from) / subjRow.pay_from : null;
    // Annualize using the actual elapsed time between the two snapshots, so a >1-year gap between
    // snapshots doesn't get read as a single year's raise.
    const monthsBetween = snapDate
      ? Math.max(1, (new Date(snapDate).getTime() - new Date(prevSnapInfo.date).getTime()) / (30.44 * 864e5))
      : 12;
    const annualRate = Math.pow(1 + medianPct, 12 / monthsBetween) - 1;
    // 5-point-wide % bins, clamped to [-25%, +50%] — matches ChangesPanel's raise-distribution convention.
    const bucketOf = (p: number) => Math.floor(Math.min(Math.max(p, -0.25), 0.5) * 100 / 5) * 5;
    const distMap = new Map<number, number>();
    for (const r of raises) distMap.set(bucketOf(r), (distMap.get(bucketOf(r)) ?? 0) + 1);
    const dist = [...distMap.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, n]) => ({ bucket, n }));
    return {
      n: rows.length, medianPct, subjectPct,
      fromLabel: prevSnapInfo.label, toLabel: snapLabel,
      annualRate: annualRate > 0 ? annualRate : null,
      dist, subjectBucket: subjectPct != null ? bucketOf(subjectPct) : null,
    };
  }, [raiseCycleRows, prevSnapInfo, subjectKey, snapDate, snapLabel]);

  // ── Derivation ──
  const tenureYears = useMemo(() => {
    if (!subj?.date_of_hire || !snapDate) return null;
    return Math.max(0, (new Date(snapDate).getTime() - new Date(subj.date_of_hire).getTime()) / (365.25 * 864e5));
  }, [subj, snapDate]);

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
  // Document-facing phrasing for the active cohort — `COHORT_DEFS[].label` (used only in the setup
  // pane's radio group) is UI-only text like "Only my curated set" or "All same-title at UW" and must
  // never appear verbatim in a document handed to a supervisor or HR.
  const docCohortLabel = cohortDocLabel(selectedMode, { school, grade, tenureBand: config.tenureBand });

  // Market-standing panel: a distribution view of the ACTIVE cohort (the one selected in "Benchmark
  // cohort") plus a broader multi-pool percentile table drawn from every other AVAILABLE lens (title
  // grade/division/similar-tenure — "curated" is excluded here since that's the named peer table below).
  const standing = useMemo(() => {
    if (subjectPay == null) return null;
    const values = cohortRowsFor(selectedMode).map((r) => r.pay).filter((p) => p > 0);
    const pools = ALL_MODES
      .filter((m) => m !== 'curated' && cohortAvailable[m])
      .map((m) => {
        const s = statsByMode[m];
        return { label: cohortDocLabel(m, { school, grade, tenureBand: config.tenureBand }), n: s.n, med: s.med, percentile: s.percentile, gapToMed: s.gapToMed };
      });
    return { min: stats.min, p25: stats.p25, med: stats.med, p75: stats.p75, max: stats.max, values, cohortLabel: docCohortLabel, pools };
  }, [subjectPay, stats, cohortRowsFor, selectedMode, school, grade, config.tenureBand, docCohortLabel, statsByMode, cohortAvailable]);

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

  // Tenure-vs-pay regression over ALL same-title peers (not just the curated/cohort-filtered set) — a
  // continuous "what tenure alone predicts" line, distinct from the discrete tenure-inversion count.
  const tenureRegression = useMemo(() => {
    if (subjectPay == null || tenureYears == null) return null;
    const pts = (peerListRows ?? [])
      .filter((r) => r.person_key !== subjectKey && r.tenure != null && r.pay > 0)
      .map((r) => ({ x: r.tenure as number, y: r.pay }));
    if (pts.length < 8) return null;
    const reg = leastSquares(pts);
    if (!reg) return null;
    const expected = reg.intercept + reg.slope * tenureYears;
    return { n: pts.length, expected, gap: expected - subjectPay };
  }, [peerListRows, subjectPay, tenureYears, subjectKey]);

  // Points for the (detailed-format-only) tenure-vs-pay scatter — same-title peers + the subject. Peer
  // names are generic ("Peer") since this cohort can run into the hundreds; the curated peer table
  // elsewhere already carries real names for the comparators the user chose to name.
  const tenureScatterPoints: ScatterPoint[] = useMemo(() => {
    if (subjectPay == null) return [];
    const peerPts: ScatterPoint[] = (peerListRows ?? [])
      .filter((r) => r.person_key !== subjectKey && r.tenure != null && r.pay > 0)
      .map((r) => ({ tenure: r.tenure as number, pay: r.pay, sameSchool: school != null && r.school === school, isSelf: false, name: 'Peer', personKey: r.person_key }));
    const selfPt: ScatterPoint[] = tenureYears != null
      ? [{ tenure: tenureYears, pay: subjectPay, sameSchool: true, isSelf: true, name: subjectName, personKey: subjectKey ?? '' }]
      : [];
    return [...peerPts, ...selfPt];
  }, [peerListRows, subjectPay, subjectKey, school, tenureYears, subjectName]);

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

  // New-hire compression: same-title peers hired within the last 2 years who are already paid at or
  // above the subject — a distinct proof from tenure inversion (any tenure gap), specifically flagging
  // that new hires are entering above the incumbent.
  const compression = useMemo(() => {
    if (subjectPay == null) return { count: 0, maxGapPay: null as number | null };
    const cands = (peerListRows ?? []).filter(
      (r) => r.person_key !== subjectKey && r.tenure != null && r.tenure <= 2 && r.pay >= subjectPay
    );
    const maxGapPay = cands.reduce<number | null>((best, r) => (best == null || r.pay > best ? r.pay : best), null);
    return { count: cands.length, maxGapPay };
  }, [peerListRows, subjectPay, subjectKey]);

  // Supervisory pay inversion — anchored to the UW Salary Administration Guidelines' own
  // "Supervisors or Managers and Subordinates" differential (≥15%; see components/report/sources.tsx).
  const supervisoryCase = useMemo(
    () => buildSupervisoryCase(subjectPay, (superviseeRows ?? []).map((r) => ({ key: r.person_key, name: fullName(r.fn, r.ln), pay: r.pay }))),
    [subjectPay, superviseeRows]
  );

  // Guideline compression — same-title peers with distinctly less UW tenure (≥5 fewer years, the SAG's
  // 3-vs-8-year example) whom the subject is NOT paid the guideline's differential above (≥5% non-exempt
  // / ≥8% exempt). Distinct from the tenure-inversion count (that flags any junior peer paid strictly
  // more; this flags the guideline's specific differential floor being unmet).
  const guidelineCompression = useMemo(
    () => buildGuidelineCompression(
      subjectPay, tenureYears,
      (peerListRows ?? []).filter((r) => r.person_key !== subjectKey).map((r) => ({ pay: r.pay, tenure: r.tenure })),
      exempt,
    ),
    [subjectPay, tenureYears, peerListRows, subjectKey, exempt]
  );

  // Real-dollar (CPI-adjusted) erosion: the subject's own pay history may show nominal growth that's
  // actually a real-dollar pay cut once inflation is factored in — a distinct, often more persuasive,
  // framing than the raw percentage.
  const realErosion = useMemo(() => {
    if (!subjectKey) return null;
    const own = (peerHist ?? []).filter((r) => r.person_key === subjectKey && r.pay != null && r.pay > 0);
    if (own.length < 2) return null;
    const first = own[0];
    const last = own[own.length - 1];
    const firstYear = Number(String(first.date).slice(0, 4));
    const lastYear = Number(String(last.date).slice(0, 4));
    if (!firstYear || !lastYear || first.pay === last.pay) return null;
    const nominalPct = (last.pay - first.pay) / first.pay;
    const realFirst = toReal(first.pay, firstYear);
    const realLast = toReal(last.pay, lastYear);
    const realPct = (realLast - realFirst) / realFirst;
    if (!(nominalPct > 0 && realPct < 0)) return null;
    return { firstYear, nominalPct, realPct };
  }, [peerHist, subjectKey]);

  const rows: ComparatorRow[] = useMemo(() => {
    const list: ComparatorRow[] = otherPeers.map((p) => ({
      key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, pay: p.pay, tenure: p.tenure ?? null,
      isSubject: false, isAnomaly: p.person_key === anomalyKey,
      lessTenure: p.tenure != null && tenureYears != null && p.tenure < tenureYears && p.pay > (subjectPay ?? 0),
      gap: p.pay - (subjectPay ?? 0),
    }));
    if (subjectPay != null) list.unshift({ key: subjectKey ?? '__subject__', name: subjectName, title: subj?.title ?? null, pay: subjectPay, tenure: tenureYears, isSubject: true, isAnomaly: false, lessTenure: false, gap: 0 });
    return list;
  }, [otherPeers, anomalyKey, subjectPay, tenureYears, subjectName, subj, subjectKey]);
  const maxPay = Math.max(1, ...rows.map((r) => r.pay));
  const showTenure = rows.some((r) => r.tenure != null);

  // ── Target + receipt math ──
  const targetPerson = (trayPeople ?? []).find((p) => p.person_key === config.targetKey) ?? null;
  const targetPay = targetPerson?.pay ?? null;
  const baseParityCore = targetPay ?? stats.expMed ?? med ?? null;
  // Opt-in: raise base parity to the UW guideline's 15%-above-highest-paid-direct-report floor — only
  // when it's actually higher than the existing target/median (this never LOWERS the ask; the user
  // must also have checked the box in ReportSetup for this to apply at all).
  const supervisorWins = config.supervisorTarget && supervisoryCase.target15 != null
    && (baseParityCore == null || supervisoryCase.target15 > baseParityCore);
  const baseParity = supervisorWins ? supervisoryCase.target15 : baseParityCore;
  const medianKind = stats.expMed != null ? 'tenure-adjusted median' : 'median';
  const baseLabel = supervisorWins
    ? `15% supervisory differential above ${supervisoryCase.top?.name ?? 'the named direct report'} (UW Salary Administration Guidelines)`
    : targetPerson
      ? `${fullName(targetPerson.fn, targetPerson.ln)}'s salary`
      : `${medianKind} of ${docCohortLabel}`;

  const activeFactors = useMemo(
    () => [
      ...FACTOR_DEFS.filter((f) => config.factors[f.key].on).map((f) => {
        const a = config.factors[f.key].amount;
        return { key: f.key, label: f.label, note: config.factors[f.key].note.trim(), amount: typeof a === 'number' && a > 0 ? a : null };
      }),
      // Custom (user-typed) factors: active once given a label, regardless of whether a $ amount is set.
      ...config.customFactors
        .filter((c) => c.label.trim())
        .map((c) => ({ key: c.id, label: c.label.trim(), note: c.note.trim(), amount: typeof c.amount === 'number' && c.amount > 0 ? c.amount : null })),
    ],
    [config.factors, config.customFactors]
  );
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
    if (stats.percentile != null && stats.n >= 4) out.push({ kind: 'market', value: `${ordinal(stats.percentile)} percentile`, label: stats.gapToMed != null && stats.gapToMed > 0 ? `Current pay sits below the ${docCohortLabel} median.` : `Current pay is at or above the ${docCohortLabel} median.`, detail: `n = ${stats.n}` });
    if (stats.invCount > 0) out.push({ kind: 'inversion', value: plural(stats.invCount, 'peer'), label: stats.invCount === 1 ? 'tenure inversion — less UW tenure, higher pay' : 'tenure inversions — less UW tenure, higher pay', detail: `paid up to +${usd(stats.invMaxGap)} more with fewer years at UW` });
    if (guidelineCompression && guidelineCompression.count > 0) {
      const gc = guidelineCompression;
      out.push({
        kind: 'guidelineCompression',
        value: plural(gc.count, 'peer'),
        label: `within ${pct(gc.threshold)} of ${subjectFirst}'s pay despite ≥${gc.gapYears} fewer years at UW`,
        detail: `UW guideline suggests at least a ${pct(gc.threshold)} differential where experience differs distinctly${gc.invertedCount > 0 ? ` (includes ${plural(gc.invertedCount, 'who out-earns', 'who out-earn')} ${subjectFirst})` : ''}`,
      });
    }
    const belowFloorReports = supervisoryCase.reports.filter((r) => r.belowFloor);
    if (belowFloorReports.length > 0) {
      const invertedReports = supervisoryCase.reports.filter((r) => r.inverted);
      const maxGap = invertedReports.length ? Math.max(...invertedReports.map((r) => r.pay - (subjectPay ?? 0))) : null;
      out.push({
        kind: 'supervisory',
        value: invertedReports.length > 0 ? plural(invertedReports.length, 'direct report') : '<15% differential',
        label: invertedReports.length > 0 ? 'direct reports paid more than their supervisor' : "pay doesn't meet the UW supervisory-differential guideline",
        detail: invertedReports.length > 0
          ? `paid up to +${usd(maxGap ?? 0)} more than ${subjectFirst}; UW guideline calls for ≥15% above a non-managing subordinate`
          : `UW guideline calls for ≥15% above a non-managing subordinate — narrower for ${plural(belowFloorReports.length, 'named direct report')}`,
      });
    }
    if (longevity.streak > 0) out.push({ kind: 'sustained', value: String(longevity.streakYears), label: 'consecutive years below the title median', detail: longevity.streak >= longevity.total ? 'below the title median in every year on record' : 'most recent unbroken run below the median' });
    if (band && subjectPay != null && band.max > band.min) {
      const posPct = Math.round(((subjectPay - band.min) / (band.max - band.min)) * 100);
      if (posPct < 50) {
        const compaRatio = subjectPay / ((band.min + band.max) / 2);
        out.push({ kind: 'gradeband', value: `${Math.max(0, posPct)}% of range`, label: `position in grade ${grade}'s official salary range`, detail: `band ${usd(band.min)}–${usd(band.max)} · compa-ratio ${compaRatio.toFixed(2)}` });
      }
    }
    if (compression.count > 0) out.push({ kind: 'compression', value: plural(compression.count, 'recent hire'), label: `hired within the last 2 years, paid at or above ${subjectFirst}`, detail: compression.maxGapPay != null ? `up to ${usd(compression.maxGapPay)}` : '' });
    if (tenureRegression && tenureRegression.gap > 0) {
      out.push({
        kind: 'tenureTrend',
        value: usd(tenureRegression.gap),
        label: 'below what tenure alone predicts',
        detail: `based on the pay-vs-tenure trend across ${plural(tenureRegression.n, 'same-title peer')}`,
      });
    }
    return out;
  }, [subjectPay, stats, longevity, docCohortLabel, band, grade, compression, subjectFirst, supervisoryCase, tenureRegression, guidelineCompression]);

  // Time-to-parity: absent an adjustment, how long a raise alone would take to reach today's cohort
  // median — reinforces that "wait and see" isn't a neutral option. Uses this title's own observed
  // annualized raise rate (from the raise-cycle comparison) when available, else a standard 2%/yr
  // assumption — either way the rate is named in the sentence and footnoted.
  const yearsToParityRate = raiseCycle?.annualRate != null && raiseCycle.annualRate > 0 ? raiseCycle.annualRate : 0.02;
  const yearsToParityObserved = raiseCycle?.annualRate != null && raiseCycle.annualRate > 0;
  const yearsToParity = useMemo(
    () => (subjectPay != null && med != null && med > subjectPay ? Math.log(med / subjectPay) / Math.log(1 + yearsToParityRate) : null),
    [subjectPay, med, yearsToParityRate]
  );

  // ── Case strength + talking points (left pane only) ──
  const strength = useMemo(
    () => caseStrength({ gapToMed: stats.gapToMed, med, invCount: stats.invCount, streakYears: longevity.streakYears, activeFactors: activeFactors.length, supervisoryInvertedCount: supervisoryCase.invertedCount, guidelineCompressionCount: guidelineCompression?.count ?? 0 }),
    [stats, med, longevity, activeFactors.length, supervisoryCase, guidelineCompression]
  );
  const talkingPoints = useMemo(() => buildTalkingPoints({
    subjectName, current: subjectPay, recommended, delta: targetDelta, pct: targetPct, cohortLabel: docCohortLabel,
    percentile: stats.percentile, invCount: stats.invCount, invMaxGap: stats.invMaxGap, streakYears: longevity.streakYears,
    factors: activeFactors, supervisory: supervisoryCase, guidelineCompression,
  }), [subjectName, subjectPay, recommended, targetDelta, targetPct, docCohortLabel, stats, longevity, activeFactors, supervisoryCase, guidelineCompression]);

  // "prepared {date}" moves to the brief's dedicated provenance line (below the header) instead of
  // living here, so it doesn't compete with the identifying facts (title/grade/school/snapshot).
  const headerMeta = [subj?.title, grade != null ? `grade ${grade}` : null, school, snapLabel, METRIC_LABEL[metric]].filter(Boolean).join(' · ');

  const basisLabel = belowTarget
    ? (supervisorWins
        ? `to reach a 15% supervisory differential above ${supervisoryCase.top?.name ?? 'the named direct report'}${addOnSum > 0 ? ', plus documented value-adds' : ''}`
        : targetPerson
          ? `to match ${fullName(targetPerson.fn, targetPerson.ln)}'s salary${addOnSum > 0 ? ', plus documented value-adds' : ''}`
          : `to reach the ${medianKind} of ${docCohortLabel}${addOnSum > 0 ? ', plus documented value-adds' : ''}`)
    : '';

  const model: BriefModel = {
    subjectName, subjectFirst, subjectPay, headerMeta, generated, snapLabel,
    recommended, belowTarget, targetDelta, targetPct,
    basisLabel: config.headline.trim() || basisLabel,
    receipt, activeFactors, proofs, yearsToParity, yearsToParityRate, yearsToParityObserved, realErosion, rows, maxPay, showTenure,
    anonymize: config.anonymize,
    attrition,
    divergence: progression.avgAbs != null && progression.subjAbs != null && progression.subjAbs < progression.avgAbs ? { avgAbs: progression.avgAbs, subjAbs: progression.subjAbs } : null,
    history: medHist ?? [],
    format: config.format, sections: config.sections, jobCode,
    supervisory: supervisoryCase,
    guidelineCompression,
    standing, tenureRegression, tenureScatterPoints, raiseCycle,
  };

  // Evidence-completeness checklist (private, setup-pane only): which document sections will actually
  // render, and — when one won't — the concrete reason, so the user can see how to strengthen the case.
  const evidenceChecklist = useMemo(() => {
    const has = (s: string) => config.sections.includes(s);
    const marketProof = proofs.find((p) => p.kind === 'market');
    return [
      { label: 'Market standing', ok: has('standing') && standing != null && standing.min != null, note: standing == null || standing.min == null ? 'need ≥1 same-title peer' : `${standing?.pools.length ?? 0} pools` },
      { label: 'Percentile / market gap', ok: !!marketProof, note: marketProof ? undefined : 'need ≥4 same-title peers' },
      { label: 'Tenure inversions', ok: stats.invCount > 0, note: stats.invCount > 0 ? plural(stats.invCount, 'peer') : 'no lower-tenure, higher-paid peers' },
      { label: `Guideline compression (${exempt === false ? '5%' : exempt === true ? '8%' : '5–8%'})`, ok: (guidelineCompression?.count ?? 0) > 0, note: guidelineCompression == null ? 'need same-title peers with ≥5 fewer years' : guidelineCompression.count > 0 ? plural(guidelineCompression.count, 'peer') : 'differential met vs. junior peers' },
      { label: 'Supervisory differential', ok: supervisoryCase.reports.some((r) => r.belowFloor), note: config.supervisees.length === 0 ? 'name a direct report under Supervisory scope' : supervisoryCase.reports.some((r) => r.belowFloor) ? undefined : 'reports are already ≥15% below' },
      { label: 'Tenure-trend regression', ok: tenureRegression != null && tenureRegression.gap > 0, note: tenureRegression == null ? 'need ≥8 same-title peers with tenure' : tenureRegression.gap > 0 ? undefined : 'paid above the tenure trend' },
      { label: 'Grade-band position', ok: proofs.some((p) => p.kind === 'gradeband'), note: band == null ? `no published range for grade ${grade ?? '—'}` : proofs.some((p) => p.kind === 'gradeband') ? undefined : 'above the band midpoint' },
      { label: 'Raise-cycle comparison', ok: raiseCycle != null, note: raiseCycle == null ? 'need a prior snapshot for this title' : undefined },
      { label: 'Sustained-deficit history', ok: longevity.streak > 0, note: longevity.streak > 0 ? `${plural(longevity.streakYears, 'yr')} below median` : 'not below median on record' },
      { label: 'Retention & replacement cost', ok: has('risk'), note: has('risk') ? undefined : 'off by default (can enable in Report sections)' },
    ];
  }, [config.sections, config.supervisees.length, proofs, standing, stats.invCount, supervisoryCase, tenureRegression, band, grade, raiseCycle, longevity, guidelineCompression, exempt]);

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
  // Tenure-inversion suggestions — peers with LESS UW tenure who are already paid MORE than the
  // subject. These are the strongest possible comparators (they make the equity case directly),
  // distinct from `suggestions` above (which is just top earners in the title).
  const minTenure = tenureYears;
  const minPay = subjectPay;
  const inversionSuggestions: SuggestPerson[] = persons.length >= 5 || minPay == null || minTenure == null ? [] : (suggestRows ?? [])
    .filter((s) => !trayIds.has(s.person_key) && s.person_key !== subjectKey && s.tenure != null && s.tenure < minTenure && s.pay > minPay)
    .sort((a, b) => b.pay - a.pay)
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
        strengthHints.market = { text: `up to +${head} pts · strongest available lens: “${bestLabel}” (−${usd(bestGap)})`, tone: 'action' };
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

  // Over-ask credibility guard: warn (private, setup-pane only) when the recommended figure exceeds
  // this cohort's 75th percentile — an ask that high risks reading as unanchored to the comparators shown.
  const overAsk = recommended != null && stats.p75 != null && recommended > stats.p75;

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
        inversionSuggestions={inversionSuggestions}
        onAddPerson={(p) => add({ type: 'person', id: p.key, label: p.name })}
        onRemovePerson={(key) => remove(key)}
        cohortBadges={cohortBadges}
        cohortAvailable={cohortAvailable}
        targetOptions={targetOptions}
        caseStrength={strength}
        strengthHints={strengthHints}
        talkingPoints={talkingPoints}
        overAsk={overAsk}
        overAskGuidelineAnchored={supervisorWins}
        onReset={() => {
          if (subjectKey) clearPref(`report.cfg.${subjectKey}`);
          setConfig(defaultConfig());
        }}
        onHover={setHovered}
        supervisoryCase={supervisoryCase}
        onAddSupervisee={(p) => {
          if (p.key === subjectKey) return;
          if (!config.supervisees.includes(p.key)) setConfig({ ...config, supervisees: [...config.supervisees, p.key] });
        }}
        onRemoveSupervisee={(key) => setConfig({ ...config, supervisees: config.supervisees.filter((k) => k !== key) })}
        evidenceChecklist={evidenceChecklist}
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
            <EmptyState
              icon={<IconFileReport size={22} />}
              title="No employee selected"
              hint="Search and pick an employee above to generate a single-page report on their pay, title history, and how they compare to others in their title."
            />
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
