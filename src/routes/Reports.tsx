import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Text, Group, Button, SegmentedControl, Card, Box, Paper, Skeleton, Menu } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPrinter, IconFileReport, IconFileTypeDoc, IconCopy, IconCheck, IconDownload, IconChevronDown } from '@tabler/icons-react';
import { briefToWordHtml, downloadDoc, copyBriefRichText } from '../lib/wordExport';
import { useControls, METRIC_LABEL } from '../state/controls';
import { useSummary, useSql, useActiveSnapshotId, useGrades, useReferenceStatus } from '../lib/hooks';
import { payBandNote, olderSnapshotNote } from '../components/PayBandNote';
import { bandFor, belowMinimum, isRange } from '../lib/bands';
import { raiseBucket, raiseBuckets } from '../lib/raiseBuckets';
import { sqlStr } from '../lib/duckdb';
import { salaryExpr, personPay, basisEquivWhere, continuingRaisesSql, GRADED_APPT, gradedCols } from '../lib/queries';
import { useTray } from '../state/tray';
import { decodeSel, encodeSel } from '../lib/share';
import { CopyLinkButton } from '../components/CopyLinkButton';
import { PayMeasure } from '../components/PayMeasure';
import { usd, pct, fullName, plural, fmtToday, fmtGrade } from '../lib/format';
import { useDocTitle } from '../lib/useDocTitle';
import { downloadCSV } from '../lib/csv';
import { toReal } from '../lib/cpi';
import { tenureFit, TENURE_MIN_PEERS, printedPercentile } from '../lib/stats';
import { readPref, writePref, clearPref } from '../lib/prefs';
import { PersonDashboard } from '../components/PersonDashboard';
import { EmptyState } from '../components/EmptyState';
import { SearchBox } from '../components/SearchBox';
import { PageHeader } from '../components/PageHeader';
import { Eyebrow } from '../components/Eyebrow';
import { type ScatterPoint } from '../components/TenurePayScatter';
import { ReportSetup, type SetupComparator } from '../components/report/ReportSetup';
import { ReportBrief } from '../components/report/ReportBrief';
import { ReportFlow } from '../components/report/ReportFlow';
import {
  COHORT_MODES, FACTOR_DEFS, applyCase, defaultConfig, encodeCase, migrateConfig, cohortStats, caseStrength, buildTalkingPoints, askOptions, askValueOf,
  cohortDocLabel, buildSupervisoryCase, buildGuidelineCompression, median, type ReportConfig, type CohortMode, type CohortRow, type ComparatorRow,
  casePeople, closestMatches, tenureExplains, counterPoints, fallbackLadder, reviewerQuestions, matchTenureSentence, gapHistory, type MatchModel, type ProofModel, type ReceiptLine, type BriefModel, type StrengthKey, type CasePerson,
} from '../components/report/model';
import { POLICY } from '../components/report/sources';
import { ICON } from '../lib/ui';
import { Z } from '../lib/layers';

interface Subject {
  pay: number | null; title: string | null; job_code: string | null;
  grade_number: number | null; grade_basis: string | null; school: string | null; date_of_hire: string | null;
  flsa_status: string | null; comp_basis: string | null;
  /** The full-time rate of the appointment that carries the grade — what the band is read against. */
  band_rate: number | null;
  /** That appointment's `comp_basis`: the units its snapshot reported the rate in (lib/bands `bandFor`). */
  band_comp: string | null;
}
interface PeerRow { person_key: string; pay: number; tenure: number | null; school: string | null }
interface PersonRow { person_key: string; fn: string; ln: string; title: string | null; school: string | null; pay: number; tenure: number | null }

const ALL_MODES = COHORT_MODES;

/**
 * The report export controls. `Button.Group` pins its children to a single row, which ran the last two
 * buttons off a phone screen — so below the tablet breakpoint they become a plain wrapping row instead
 * of the joined strip.
 */
function ExportBar({ joined, children }: { joined: boolean; children: ReactNode }) {
  return joined ? <Button.Group>{children}</Button.Group> : <Group gap="xs" wrap="wrap">{children}</Group>;
}

export default function Reports() {
  const { metric } = useControls();
  const snap = useActiveSnapshotId();
  const expr = salaryExpr(metric);
  const { data: summary } = useSummary();
  const { items } = useTray();
  const snapLabel = summary?.snapshots.find((x) => x.id === snap)?.label ?? snap ?? '—';
  const generated = fmtToday();
  const isDesktop = useMediaQuery('(min-width: 75em)') ?? true;
  // Phone-width layout for the header controls: the mode switcher's full labels measure 633px, which
  // pushed the whole page 274px wider than a 375px viewport and scrolled the app sideways.
  const isNarrow = useMediaQuery('(max-width: 48em)') ?? false;

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
  const [docCopyState, setDocCopyState] = useState<'idle' | 'rich' | 'plain'>('idle');
  // The "Copied" confirmation resets itself after a beat; hold the timer so navigating away mid-beat
  // cancels it rather than setting state on an unmounted page.
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyResetTimer.current) clearTimeout(copyResetTimer.current); }, []);

  // ── Raise case: its subject and the people it is compared with, which are the case's own (`config.peers`),
  // not the compare set's. Resolved here, ahead of the URL-sync effect below, which writes both into the link. ──
  const persons = items.filter((i) => i.type === 'person');
  // A copied raise case reopens from its link: its subject, its people (`?sel=`, as Compare's) and its settings
  // (`?case=`, model `encodeCase`). Read once, as the page opens; the reader's own compare set is left alone.
  const shared = useRef((() => {
    const sel = type === 'comparison' ? decodeSel(params.get('sel'))?.filter((i) => i.type === 'person') ?? null : null;
    return { sel, caseParam: params.get('case'), subject: params.get('subject') ?? sel?.[0]?.id ?? null, read: false };
  })());
  // With no subject named, a case starts on the compare set's first person.
  const [subjectKey, setSubjectKey] = useState<string | null>(() => shared.current.subject ?? (type === 'comparison' ? persons[0]?.id ?? null : null));
  useEffect(() => {
    if (type === 'comparison' && !subjectKey && persons.length) setSubjectKey(persons[0].id);
  }, [type, subjectKey, persons]);
  // The people a new case starts from when another subject is chosen: the case it was switched from.
  const seed = useRef<CasePerson[] | null>(null);
  const peers = (config.peers ?? []).filter((p) => p.key !== subjectKey);
  const caseIds = subjectKey ? [subjectKey, ...peers.map((p) => p.key)] : [];
  const personIds = caseIds.map(sqlStr).join(',');
  const { data: caseRows } = useSql<PersonRow>(
    ['rpt-case', personIds, snap ?? '', metric],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, arg_max(title, ${expr}) title,
        any_value(school) school, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key IN (${personIds}) GROUP BY person_key`,
    type === 'comparison' && caseIds.length > 0 && !!snap
  );
  const subjectRow = caseRows?.find((p) => p.person_key === subjectKey);
  const knownName = [...(shared.current.sel ?? []), ...persons].find((p) => p.id === subjectKey)?.label;
  // Someone not paid in the latest snapshot is named from the last one they were: never by their key.
  const { data: pastName } = useSql<{ fn: string | null; ln: string | null }>(
    ['rpt-subject-name', subjectKey ?? ''],
    `SELECT arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln FROM salaries
     WHERE person_key = ${sqlStr(subjectKey ?? '')} HAVING count(*) > 0`,
    !!caseRows && !subjectRow && !knownName,
  );
  const subjectName = (subjectRow ? fullName(subjectRow.fn, subjectRow.ln) : '')
    || knownName || (pastName?.[0] ? fullName(pastName[0].fn, pastName[0].ln) : '');
  const subjectFirst = subjectName.split(' ')[0] || 'They';
  // The compare set's people the case does not have yet, which it can take in.
  const fromSet = persons.filter((p) => !caseIds.includes(p.id)).map((p) => ({ key: p.id, name: p.label }));
  const setPeers = (next: CasePerson[]) => setConfig((c) => ({ ...c, peers: casePeople(subjectKey ?? '', next, []) }));
  const chooseSubject = (key: string | null) => {
    if (subjectKey && key !== subjectKey) seed.current = [{ key: subjectKey, name: subjectName }, ...peers];
    setSubjectKey(key);
  };

  // ── Report on person ── hydrated once from ?person=/?pname= on mount (a finished report is
  // shareable), then kept in sync (with ?type=) the same way Compare syncs its ?sel= tray link.
  const [selPerson, setSelPerson] = useState<{ key: string; name: string } | null>(() => {
    const key = params.get('person');
    return key ? { key, name: params.get('pname') ?? '' } : null;
  });
  // A link with no ?pname= names its person from the data, never by their key ("aaronsmetana|2014-10-15").
  const { data: selNameRow } = useSql<{ fn: string | null; ln: string | null }>(
    ['rpt-person-name', selPerson?.key ?? ''],
    `SELECT arg_max(first_name, snapshot_date) fn, arg_max(last_name, snapshot_date) ln FROM salaries
     WHERE person_key = ${sqlStr(selPerson?.key ?? '')} HAVING count(*) > 0`,
    type === 'person' && !!selPerson && !selPerson.name,
  );
  useEffect(() => {
    const r = selNameRow?.[0];
    if (r && selPerson && !selPerson.name) setSelPerson({ key: selPerson.key, name: fullName(r.fn, r.ln) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selNameRow]);
  useDocTitle(type === 'person' && selPerson?.name ? `Report — ${selPerson.name}` : 'Reports');
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('mode'); // superseded by ?type=
        if (type === 'comparison') n.set('type', 'comparison');
        else n.delete('type');
        if (type === 'person' && selPerson) {
          n.set('person', selPerson.key);
          if (selPerson.name) n.set('pname', selPerson.name);
        } else {
          n.delete('person');
          n.delete('pname');
        }
        // Mirrors Compare's ?sel= pattern: a finished comparison report is shareable via its subject.
        if (type === 'comparison' && subjectKey) n.set('subject', subjectKey);
        else n.delete('subject');
        // And the case itself: its people and its settings, so the link reopens it (above).
        const people = type === 'comparison' && subjectKey
          ? [{ type: 'person' as const, id: subjectKey, label: subjectName }, ...peers.map((p) => ({ type: 'person' as const, id: p.key, label: p.name }))]
          : [];
        if (people.length) n.set('sel', encodeSel(people));
        else n.delete('sel');
        const cs = type === 'comparison' ? encodeCase(config) : '';
        if (cs) n.set('case', cs);
        else n.delete('case');
        return n;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, selPerson, subjectKey, subjectName, config]);
  const { data: personHistory } = useSql<{ snapshot: string; title: string | null; job_code: string | null; school: string | null; pay: number | null; fte: number | null }>(
    ['rpt-person-hist', selPerson?.key ?? '', metric],
    `SELECT snapshot_label AS snapshot, title, job_code, school, ${expr} AS pay, fte
     FROM salaries WHERE person_key = ${sqlStr(selPerson?.key ?? '')} ORDER BY snapshot_date`,
    type === 'person' && !!selPerson
  );

  // Persist the whole setup (cohort, factors, override, sections…) per subject, so switching between
  // several in-progress raise cases (or a page refresh) doesn't lose the work already done on each.
  useEffect(() => {
    let cfg = subjectKey ? migrateConfig(readPref<unknown>(`report.cfg.${subjectKey}`, null)) : defaultConfig();
    const link = shared.current;
    if (subjectKey && subjectKey === link.subject && !link.read) {
      link.read = true;
      if (link.sel) cfg = { ...cfg, peers: casePeople(subjectKey, null, link.sel.map((i) => ({ key: i.id, name: i.label }))) };
      cfg = applyCase(cfg, link.caseParam);
    }
    // A new case (or one saved before cases kept their people) starts from the case it was switched from, or
    // from the compare set when the set holds its subject; a set without them is about someone else.
    if (subjectKey && cfg.peers == null) {
      const from = seed.current ?? (persons.some((p) => p.id === subjectKey) ? persons.map((p) => ({ key: p.id, name: p.label })) : []);
      cfg = { ...cfg, peers: casePeople(subjectKey, null, from) };
    }
    seed.current = null;
    setConfig(cfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);
  useEffect(() => {
    if (subjectKey) writePref(`report.cfg.${subjectKey}`, config);
  }, [subjectKey, config]);

  const cmpReady = type === 'comparison' && !!snap && !!subjectKey;

  const { data: subjRows } = useSql<Subject>(
    ['rpt-subj', subjectKey, snap ?? '', metric],
    // The grade, its schedule and the rate the band is read against all come from the graded appointment
    // (GRADED_APPT); the metric decides the pay every other figure uses.
    `SELECT * EXCLUDE (graded), ${gradedCols()} FROM (
       SELECT ${personPay(metric)} pay, arg_max(title, ${expr}) title, arg_max(job_code, ${expr}) job_code,
          ${GRADED_APPT} graded,
          arg_max(flsa_status, ${expr}) flsa_status, arg_max(comp_basis, ${expr}) comp_basis,
          any_value(school) school, min(date_of_hire) date_of_hire
       FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND person_key = ${sqlStr(subjectKey ?? '')})`,
    cmpReady
  );
  const subj = subjRows?.[0];
  // A $0 / unreported salary is not a real subject pay — normalize to null so every downstream gate
  // (`subjectPay == null` → the pick-a-subject empty state) handles it, rather than rendering a
  // nonsense "$0 → $X (+$X, 0.0%)" recommendation.
  const subjectPay = subj?.pay != null && subj.pay > 0 ? subj.pay : null;
  const jobCode = subj?.job_code ?? null;
  const grade = subj?.grade_number ?? null;
  const school = subj?.school ?? null;
  // Same-title/grade cohorts below are scoped to the subject's own pay basis (9-month vs 12-month
  // appointments are never compared raw — a mixed cohort would otherwise mislabel a lower academic-year
  // salary as "below market" against 12-month peers). `basisEquivWhere` is label-drift + NULL-era
  // tolerant (see its doc); '' (no filter) when the subject's basis is unknown.
  const compBasisWhere = basisEquivWhere(subj?.comp_basis);
  // FLSA status drives the guideline's compression floor (exempt → 8%, non-exempt → 5%). Three spellings
  // exist in the record ('Exempt' / 'Non-exempt' / 'Non-Exempt'), so match case-insensitively; a null
  // status falls back to the conservative 5% floor (under-claims rather than over-claims).
  const exempt = subj?.flsa_status == null ? null : !/^non/i.test(subj.flsa_status);
  const { data: grades } = useGrades();
  // The grade's range, or its minimum where HR publishes only that (lib/bands).
  const band = useMemo(() => (subj ? bandFor(grades, subj.grade_number, subj.grade_basis, subj.band_comp) : null), [subj, grades]);

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
    ['rpt-peerlist', jobCode ?? '', snap ?? '', metric, compBasisWhere],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} ${compBasisWhere} GROUP BY person_key)
     SELECT person_key, pay, tenure, school FROM pp WHERE pay > 0`,
    cmpReady && !!jobCode
  );

  const { data: gradeListRows } = useSql<{ person_key: string; pay: number; tenure: number | null }>(
    ['rpt-gradelist', grade ?? -1, snap ?? '', metric, compBasisWhere],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND grade_number = ${grade ?? -1} ${compBasisWhere} GROUP BY person_key)
     SELECT person_key, pay, tenure FROM pp WHERE pay > 0`,
    cmpReady && grade != null
  );

  const { data: medHist } = useSql<{ date: string; med: number | null; pay: number | null }>(
    ['rpt-med-hist', jobCode ?? '', subjectKey ?? '', metric, compBasisWhere],
    `WITH per_snap AS (
        SELECT snapshot_id, any_value(snapshot_date) date, person_key, ${personPay(metric)} pay
        FROM salaries WHERE job_code = ${sqlStr(jobCode ?? '')} GROUP BY snapshot_id, person_key),
      -- The median is scoped to the subject's own pay basis (see compBasisWhere); the subject's OWN
      -- pay history (s, below) stays unfiltered — their historical basis may differ from today's.
      per_snap_basis AS (
        SELECT snapshot_id, person_key, ${personPay(metric)} pay
        FROM salaries WHERE job_code = ${sqlStr(jobCode ?? '')} ${compBasisWhere} GROUP BY snapshot_id, person_key),
      m AS (SELECT snapshot_id, median(pay) FILTER (WHERE pay > 0) med FROM per_snap_basis GROUP BY snapshot_id),
      -- per_snap is already one row per (snapshot_id, person_key), so the subject has at most one row
      -- per snapshot — group by snapshot_id alone (any_value picks that single date/pay).
      s AS (SELECT snapshot_id, any_value(date) date, any_value(pay) pay FROM per_snap WHERE person_key = ${sqlStr(subjectKey ?? '')} GROUP BY snapshot_id)
     SELECT s.date date, m.med med, s.pay pay FROM m JOIN s USING (snapshot_id) ORDER BY date`,
    cmpReady && !!jobCode
  );

  const { data: peerHist } = useSql<{ person_key: string; date: string; snapshot_label: string; pay: number }>(
    ['rpt-peer-hist', personIds, metric],
    `SELECT person_key, any_value(snapshot_date) date, any_value(snapshot_label) snapshot_label, ${personPay(metric)} pay
     FROM salaries WHERE person_key IN (${personIds}) GROUP BY person_key, snapshot_id ORDER BY date`,
    type === 'comparison' && caseIds.length > 0
  );

  // Also carries tenure (not just top-10-by-pay) so the same rows can surface tenure-inversion
  // suggestions — peers who out-earn the subject despite less UW tenure — not just top earners.
  const { data: suggestRows } = useSql<{ person_key: string; fn: string; ln: string; school: string | null; pay: number; tenure: number | null }>(
    ['rpt-suggest', jobCode ?? '', snap ?? '', metric, compBasisWhere],
    `SELECT person_key, any_value(first_name) fn, any_value(last_name) ln, any_value(school) school, ${personPay(metric)} pay,
        any_value(date_diff('day', CAST(date_of_hire AS DATE), CAST(snapshot_date AS DATE)) / 365.25) tenure
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND job_code = ${sqlStr(jobCode ?? '')} ${compBasisWhere}
     GROUP BY person_key`,
    cmpReady && !!jobCode
  );

  // Direct reports named under the Supervisory-scope factor — resolved at the same snapshot, kept
  // separate from `caseRows` (they are not comparators; naming one here never affects cohort stats).
  const superviseeIds = config.supervisees.map((k) => sqlStr(k)).join(',');
  const { data: superviseeRows } = useSql<PersonRow>(
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

  // Raise-cycle comparison — same-title peers' continuing raises between the previous snapshot and this
  // one (continuingRaisesSql: one appointment each side, same job code, same FTE, same pay basis — the
  // app's one definition of a raise, so the brief and the Changes panel cannot disagree about it).
  const prevSnapId = prevSnapInfo?.id ?? '';
  const { data: raiseCycleRows } = useSql<{ person_key: string; pay_from: number; pay_to: number }>(
    ['rpt-raise-cycle', jobCode ?? '', snap ?? '', prevSnapId, metric, compBasisWhere],
    `SELECT person_key, pay_from, pay_to FROM (${continuingRaisesSql({
      metric,
      where: `job_code = ${sqlStr(jobCode ?? '')} ${compBasisWhere}`,
      pair: { from: prevSnapId, to: snap ?? '' },
    })})`,
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
    // The site's raise bins (lib/raiseBuckets, as Divisions → Changes draws them): 1%, no change on its
    // own, open tails. Every bin from the lowest to the highest in use takes its place, empty or not.
    const bucketOf = raiseBucket;
    const distMap = new Map<number, number>();
    for (const r of raises) distMap.set(bucketOf(r), (distMap.get(bucketOf(r)) ?? 0) + 1);
    const used = [...distMap.keys()];
    const dist = raiseBuckets()
      .filter((k) => used.length > 0 && k >= Math.min(...used) && k <= Math.max(...used))
      .map((bucket) => ({ bucket, n: distMap.get(bucket) ?? 0 }));
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
    const curated = (caseRows ?? []).filter((r) => r.person_key !== subjectKey).map((r) => ({ pay: r.pay, tenure: r.tenure }));
    return (mode: CohortMode): CohortRow[] => {
      switch (mode) {
        case 'all': return peers.map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'school': return peers.filter((r) => school != null && r.school === school).map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'tenure': return tenureYears == null ? [] : peers.filter((r) => r.tenure != null && Math.abs(r.tenure - tenureYears) <= config.tenureBand).map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'grade': return grades.map((r) => ({ pay: r.pay, tenure: r.tenure }));
        case 'curated': return curated;
      }
    };
  }, [peerListRows, caseRows, gradeListRows, school, tenureYears, config.tenureBand, subjectKey]);

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
  // The active cohort in words, as the setup and the document both give it.
  const docCohortLabel = cohortDocLabel(selectedMode, { school, grade, gradeBasis: subj?.grade_basis, tenureBand: config.tenureBand });

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
        return { label: cohortDocLabel(m, { school, grade, gradeBasis: subj?.grade_basis, tenureBand: config.tenureBand }), n: s.n, med: s.med, percentile: s.percentile, gapToMed: s.gapToMed };
      });
    return { min: stats.min, p25: stats.p25, med: stats.med, p75: stats.p75, max: stats.max, values, cohortLabel: docCohortLabel, pools };
  }, [subjectPay, stats, cohortRowsFor, selectedMode, school, grade, config.tenureBand, docCohortLabel, statsByMode, cohortAvailable, subj?.grade_basis]);

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
    // tenureFit — the same fit, peers and rule the scatter in this document draws, so its callout and
    // this highlight cannot disagree. `gap` here is how far BELOW the line the subject sits (the brief
    // argues shortfalls), the opposite sign of tenureFit's own.
    const fit = tenureFit(pts, { x: tenureYears, y: subjectPay });
    if (!fit) return null;
    return { n: fit.n, expected: fit.expected, gap: -fit.gap, verdict: fit.verdict, perYear: fit.slope };
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
    () => (caseRows ?? []).filter((p) => p.person_key !== subjectKey).sort((a, b) => b.pay - a.pay),
    [caseRows, subjectKey]
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

  // Market-competitive position — the SAG's compa-ratio / PIR framework against the subject's official
  // pay-grade band (only computable for grades with a published range). Below the 85%-compa / 25%-PIR
  // floor triggers the guideline's "market competitive pay request".
  //
  // Read on the full-time rate of the graded appointment: a band is a range of full-time rates, and the
  // metric's pay is scaled by the appointment percentage and summed across appointments — a half-time
  // subject on a mid-range rate read as compa 0.50. The floor is a rate too; as an ask it is the same
  // raise carried to the pay the report works in (`floorAsk`), so a half-time subject is asked half.
  const bandRate = subj?.band_rate != null && subj.band_rate > 0 ? subj.band_rate : null;
  const marketPosition = useMemo(() => {
    if (subjectPay == null || bandRate == null || !isRange(band) || grade == null) return null;
    const mid = (band.min + band.max) / 2;
    const compa = bandRate / mid;
    const pir = (bandRate - band.min) / (band.max - band.min);
    const floorPay = Math.round(POLICY.marketCompetitive.compaLow * mid);
    return {
      grade, mid, compa, pir, rate: bandRate,
      position: POLICY.gradePosition(compa),
      belowCompetitive: compa < POLICY.marketCompetitive.compaLow || pir < POLICY.marketCompetitive.pirLow,
      floorPay,
      floorAsk: Math.round(subjectPay * (floorPay / bandRate)),
    };
  }, [subjectPay, bandRate, band, grade]);

  // Performance-adjustment coaching (setup-pane only): the SAG's 5–10% general range, plus the annual-
  // review matrix cell for the subject's position in grade (Emerging/Established/Advanced) when a band
  // exists, and midrange dollar suggestions to fill the Performance factor amount with.
  const performanceGuide = useMemo(() => {
    if (subjectPay == null) return null;
    const posKey = marketPosition == null ? null
      : marketPosition.position === 'Emerging in Grade' ? 'emerging' as const
        : marketPosition.position === 'Advanced in Grade' ? 'advanced' as const : 'established' as const;
    const m = POLICY.performanceAdjustment;
    const cell = (lvl: 'exemplary' | 'meets'): readonly [number, number] => posKey ? m.matrix[lvl][posKey] : m.general;
    const mid = (r: readonly [number, number]) => Math.round(subjectPay * (r[0] + r[1]) / 2);
    return {
      position: marketPosition?.position ?? null,
      general: m.general,
      exemplary: cell('exemplary'), meets: cell('meets'),
      exemplaryAmt: mid(cell('exemplary')), meetsAmt: mid(cell('meets')),
    };
  }, [subjectPay, marketPosition]);

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
  const targetPerson = (caseRows ?? []).find((p) => p.person_key === config.targetKey) ?? null;
  const targetPay = targetPerson?.pay ?? null;
  const baseParityCore = targetPay ?? stats.expMed ?? med ?? null;
  const medianKind = stats.expMed != null ? 'tenure-adjusted median' : 'median';
  // Opt-in guideline anchors (supervisory 15%, market-competitive floor) — each is a base-parity
  // CANDIDATE, applied only when the user checked its box in ReportSetup AND it exceeds the existing
  // target/median. The single highest opted-in anchor wins the base-parity slot; neither ever LOWERS
  // the ask. Both come straight from a published UW guideline, so an over-p75 ask stays anchored.
  const anchorCandidates = useMemo(() => {
    const out: { key: 'supervisor' | 'marketFloor'; pay: number; base: string; basis: string }[] = [];
    if (config.supervisorTarget && supervisoryCase.target15 != null) {
      // The document must not name a supervised subordinate when Anonymize is on — use a generic phrase.
      const topRef = config.anonymize ? 'the highest-paid direct report' : (supervisoryCase.top?.name ?? 'the named direct report');
      out.push({
        key: 'supervisor', pay: supervisoryCase.target15,
        base: `15% supervisory differential above ${topRef} (UW Salary Administration Guidelines)`,
        basis: `to reach a 15% supervisory differential above ${topRef}`,
      });
    }
    if (config.marketFloorTarget && marketPosition?.belowCompetitive) {
      // A part-time or split subject's ask is the floor's raise carried to their pay; say which rate that is.
      const fullTime = marketPosition.floorAsk !== marketPosition.floorPay ? `, a full-time rate of ${usd(marketPosition.floorPay)}` : '';
      out.push({
        key: 'marketFloor', pay: marketPosition.floorAsk,
        base: `the market-competitive floor for grade ${marketPosition.grade} — 85% of the band midpoint${fullTime} (UW Salary Administration Guidelines)`,
        basis: `to reach the market-competitive floor for grade ${marketPosition.grade} (85% of the band midpoint${fullTime})`,
      });
    }
    return out;
  }, [config.supervisorTarget, config.marketFloorTarget, config.anonymize, supervisoryCase, marketPosition]);
  const winningAnchor = anchorCandidates.reduce<(typeof anchorCandidates)[number] | null>((best, a) => {
    if (baseParityCore != null && a.pay <= baseParityCore) return best; // never lowers the core ask
    return !best || a.pay > best.pay ? a : best;
  }, null);
  const baseParity = winningAnchor ? winningAnchor.pay : baseParityCore;
  const baseLabel = winningAnchor
    ? winningAnchor.base
    : targetPerson
      ? `${fullName(targetPerson.fn, targetPerson.ln)}'s salary`
      : `${medianKind} of ${docCohortLabel}`;

  // Matching someone: a factor they have too is already in their pay, so its amount is not added to the ask.
  const matching = !(typeof config.override === 'number' && config.override > 0) && !winningAnchor && !!targetPerson;
  const activeFactors = useMemo(() => {
    const shared = new Set(matching ? config.sharedFactors : []);
    const amount = (key: string, a: number | '') => (!shared.has(key) && typeof a === 'number' && a > 0 ? a : null);
    return [
      ...FACTOR_DEFS.filter((f) => config.factors[f.key].on).map((f) => (
        { key: f.key, label: f.label, note: config.factors[f.key].note.trim(), amount: amount(f.key, config.factors[f.key].amount), shared: shared.has(f.key) }
      )),
      // Custom (user-typed) factors: active once given a label, regardless of whether a $ amount is set.
      ...config.customFactors
        .filter((c) => c.label.trim())
        .map((c) => ({ key: c.id, label: c.label.trim(), note: c.note.trim(), amount: amount(c.id, c.amount), shared: shared.has(c.id) })),
    ];
  }, [config.factors, config.customFactors, config.sharedFactors, matching]);
  const addOnSum = activeFactors.reduce((s, f) => s + (f.amount ?? 0), 0);
  const computed = baseParity != null ? baseParity + addOnSum : null;
  const override = typeof config.override === 'number' && config.override > 0 ? config.override : null;
  const recommended = override ?? computed;
  // The setup's one "What to ask for": read from what the ask actually rests on, so a case saved with two
  // guideline targets on (they used to be two boxes) shows the one that won.
  const askValue = askValueOf({ override, anchor: winningAnchor?.key ?? null, target: targetPerson?.person_key ?? null, cohort: selectedMode });
  // The person the case asks to match, beside its subject: what tenure accounts for between them, and the gap
  // at each snapshot both were paid in.
  const match: MatchModel | null = useMemo(() => {
    if (!targetPerson || askValue !== `peer:${targetPerson.person_key}` || subjectPay == null || targetPerson.pay <= subjectPay) return null;
    const gap = targetPerson.pay - subjectPay;
    return {
      key: targetPerson.person_key, name: fullName(targetPerson.fn, targetPerson.ln),
      sides: [
        { title: subj?.title ?? null, school, tenure: tenureYears, pay: subjectPay },
        { title: targetPerson.title, school: targetPerson.school, tenure: targetPerson.tenure, pay: targetPerson.pay },
      ],
      gap,
      tenure: tenureRegression && tenureYears != null && targetPerson.tenure != null
        ? { n: tenureRegression.n, perYear: tenureRegression.perYear, ...tenureExplains(tenureRegression.perYear, tenureYears, targetPerson.tenure, gap) }
        : null,
      history: gapHistory(peerHist ?? [], subjectKey ?? '', targetPerson.person_key),
      duties: config.sharedDuties.trim(),
      shared: activeFactors.filter((f) => f.shared).map((f) => f.label),
      beyond: activeFactors.filter((f) => !f.shared).map((f) => ({ label: f.label, amount: f.amount })),
    };
  }, [targetPerson, askValue, subjectPay, subj?.title, school, tenureYears, tenureRegression, peerHist, subjectKey, config.sharedDuties, activeFactors]);
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
    if (stats.percentile != null && stats.n >= 4) out.push({ kind: 'market', value: printedPercentile(stats.percentile), label: stats.gapToMed != null && stats.gapToMed > 0 ? `Current pay sits below the median of ${docCohortLabel}.` : `Current pay is at or above the median of ${docCohortLabel}.`, detail: `${plural(stats.n, 'other')} in the comparison` });
    if (stats.invCount > 0) out.push({ kind: 'inversion', value: plural(stats.invCount, 'peer'), label: stats.invCount === 1 ? 'tenure inversion — less UW tenure, higher pay' : 'tenure inversions — less UW tenure, higher pay', detail: `paid up to +${usd(stats.invMaxGap)} more with fewer years at UW` });
    if (guidelineCompression && guidelineCompression.count > 0) {
      const gc = guidelineCompression;
      out.push({
        kind: 'guidelineCompression',
        value: plural(gc.count, 'peer'),
        label: `within ${pct(gc.threshold, 0)} of ${subjectFirst}'s pay despite ≥${gc.gapYears} fewer years at UW`,
        detail: `UW guideline suggests a differential of at least ${pct(gc.threshold, 0)} where experience differs distinctly${gc.invertedCount > 0 ? ` (includes ${plural(gc.invertedCount, 'who out-earns', 'who out-earn')} ${subjectFirst})` : ''}`,
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
    if (longevity.streak > 0) out.push({ kind: 'sustained', value: plural(longevity.streakYears, 'year'), label: 'in a row below the title median', detail: longevity.streak >= longevity.total ? 'below the title median in every year on record' : 'most recent unbroken run below the median' });
    // A grade with a minimum only has no range to be placed in; the one thing it can say is "below it".
    if (band && !isRange(band) && bandRate != null && belowMinimum(bandRate, band, subj?.grade_basis)) {
      out.push({ kind: 'gradeband', value: `${usd(band.min - bandRate)} below`, label: `the grade ${grade} minimum`, detail: `grade ${grade} minimum ${usd(band.min)} · full-time rate ${usd(bandRate)}` });
    }
    if (marketPosition && isRange(band)) {
      const mp = marketPosition;
      const posPct = Math.round(mp.pir * 100);
      if (posPct < 50) {
        out.push({ kind: 'gradeband', value: `${Math.max(0, posPct)}% through the band`, label: `position in range (PIR) — ${mp.position}`, detail: `grade ${mp.grade} band ${usd(band.min)}–${usd(band.max)} · full-time rate ${usd(mp.rate)} · compa-ratio ${mp.compa.toFixed(2)}` });
      }
      if (mp.belowCompetitive) {
        out.push({ kind: 'marketFloor', value: `${mp.compa.toFixed(2)} compa-ratio`, label: `below the university's market-competitive range (85–115% of grade ${mp.grade} midpoint)`, detail: `the UW guideline provides that a market competitive pay request can be made for OHR to review and approve — the 85% floor for grade ${mp.grade} is ${usd(mp.floorPay)}` });
      }
    }
    if (compression.count > 0) out.push({ kind: 'compression', value: plural(compression.count, 'recent hire'), label: `hired within the last 2 years, paid at or above ${subjectFirst}`, detail: compression.maxGapPay != null ? `up to ${usd(compression.maxGapPay)}` : '' });
    // Gate: only a gap tenureFit calls "below" (2% of pay or more) is claimed — under that is within
    // noise and reads as reaching (the private checklist still flags it; the scatter stays as data).
    if (tenureRegression?.verdict === 'below') {
      out.push({
        kind: 'tenureTrend',
        value: usd(tenureRegression.gap),
        label: 'below what tenure alone predicts',
        detail: `based on the pay-vs-tenure trend across ${plural(tenureRegression.n, 'same-title peer')}`,
      });
    }
    return out;
  }, [subjectPay, stats, longevity, docCohortLabel, band, bandRate, grade, subj?.grade_basis, compression, subjectFirst, supervisoryCase, tenureRegression, guidelineCompression, marketPosition]);

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
  const headerMeta = [subj?.title, grade != null ? `grade ${fmtGrade(grade, subj?.grade_basis)}` : null, school, snapLabel, METRIC_LABEL[metric]].filter(Boolean).join(' · ');

  // ── "Basis under UW salary guidelines" — the SAG provisions this document's evidence actually
  //    supports, in the guideline's own vocabulary. One row per supported provision; objective
  //    (salary/tenure-derived) provisions first, self-reported ones flagged as such. ──
  const guidelineProvisions = useMemo(() => {
    const out: { key: string; name: string; quote: string; supportedBy: string; selfReported?: boolean }[] = [];
    const belowCohortMedian = stats.gapToMed != null && stats.gapToMed > 0;
    const poolsBelow = (standing?.pools ?? []).filter((p) => p.gapToMed != null && p.gapToMed > 0);
    if (belowCohortMedian || poolsBelow.length > 0) {
      out.push({
        key: 'parity',
        name: 'Parity adjustment',
        quote: POLICY.parityQuote,
        supportedBy: poolsBelow.length > 1
          ? `paid below the median in ${plural(poolsBelow.length, 'comparison pool')} (see Market standing)`
          : `paid below the median of ${docCohortLabel} (${stats.percentile != null ? printedPercentile(stats.percentile) : 'see Market standing'})`,
      });
    }
    const supBelowFloor = supervisoryCase.reports.filter((r) => r.belowFloor);
    const compressionBits: string[] = [];
    if (guidelineCompression && guidelineCompression.count > 0) compressionBits.push(`${plural(guidelineCompression.count, 'same-title peer')} within ${pct(guidelineCompression.threshold, 0)} despite ≥${guidelineCompression.gapYears} fewer years`);
    if (stats.invCount > 0) compressionBits.push(`${plural(stats.invCount, 'tenure inversion')}`);
    if (compression.count > 0) compressionBits.push(`${plural(compression.count, 'recent hire')} at or above ${subjectFirst}`);
    if (supBelowFloor.length > 0) compressionBits.push(`${plural(supBelowFloor.length, 'direct report')} under the ≥15% supervisory differential`);
    if (compressionBits.length > 0) {
      out.push({
        key: 'compression',
        name: 'Compression adjustment',
        quote: POLICY.compressionQuote,
        supportedBy: compressionBits.join('; '),
      });
    }
    if (marketPosition?.belowCompetitive) {
      out.push({
        key: 'marketFloor',
        name: 'Market competitive pay request',
        quote: POLICY.marketRequestQuote,
        supportedBy: `compa-ratio ${marketPosition.compa.toFixed(2)} on a full-time rate of ${usd(marketPosition.rate)} — below the guideline's 85% market-competitive floor for grade ${marketPosition.grade}`,
      });
    }
    if (config.factors.performance.on) {
      out.push({
        key: 'performance',
        name: 'Performance adjustment',
        quote: `Performance adjustments refer to a salary increase due to notable and sustained performance; generally, a performance adjustment of ${pct(POLICY.performanceAdjustment.general[0])}–${pct(POLICY.performanceAdjustment.general[1])} may be appropriate.`,
        supportedBy: config.factors.performance.note.trim() || 'documented under Performance & impact',
        selfReported: true,
      });
    }
    if (config.factors.scope.on) {
      out.push({
        key: 'scope',
        name: 'Change-in-duties pay adjustment',
        quote: 'Where there are significant, permanent changes to the responsibilities of a job, an increase to the salary without a title change may be appropriate (a change in duties pay adjustment).',
        supportedBy: config.factors.scope.note.trim() || 'documented under Expanded scope / out-of-class',
        selfReported: true,
      });
    }
    return out;
  }, [stats, standing, docCohortLabel, supervisoryCase, guidelineCompression, compression, subjectFirst, marketPosition, config.factors.performance, config.factors.scope]);

  // Document-facing raise cycle: this is an advocacy brief, so when the subject OUT-raised peers this
  // cycle (a clause that cuts against the ask) drop the subject's own line and bucket marker — the
  // neutral peers-median sentence + JCOER pay-plan context stay. The private checklist still reports it.
  const raiseCycleDoc = useMemo(() => {
    if (!raiseCycle) return null;
    if (raiseCycle.subjectPct != null && raiseCycle.subjectPct > raiseCycle.medianPct) {
      return { ...raiseCycle, subjectPct: null, subjectBucket: null };
    }
    return raiseCycle;
  }, [raiseCycle]);

  const valueAddTail = addOnSum > 0 ? ', plus documented value-adds' : '';
  const basisLabel = belowTarget
    ? (winningAnchor
        ? `${winningAnchor.basis}${valueAddTail}`
        : targetPerson
          ? `to match ${fullName(targetPerson.fn, targetPerson.ln)}'s salary${valueAddTail}`
          : `to reach the ${medianKind} of ${docCohortLabel}${valueAddTail}`)
    : '';

  const { data: refStatus } = useReferenceStatus();
  // Where the ranges come from, and — read in a snapshot older than the ranges — that they are today's.
  const releasedSnap = summary?.snapshots.find((x) => x.id === refStatus?.released_with);
  const bandNote = [payBandNote(refStatus), olderSnapshotNote(refStatus, summary?.snapshots.find((x) => x.id === snap), releasedSnap?.label, releasedSnap?.date)]
    .filter(Boolean).join(' ') || null;
  const model: BriefModel = {
    subjectName, subjectFirst, subjectPay, headerMeta, generated, snapLabel,
    payBandNote: bandNote,
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
    marketPosition,
    guidelineProvisions,
    cohortBasisScoped: !!subj?.comp_basis,
    standing, tenureRegression, tenureScatterPoints, raiseCycle: raiseCycleDoc, match,
    counterPoints: subjectPay == null ? [] : counterPoints({
      subjectFirst, subjectPay,
      pools: standing?.pools ?? [],
      seniorPaidLess: tenureYears == null ? 0 : (peerListRows ?? []).filter((r) => r.person_key !== subjectKey && r.tenure != null && r.tenure > tenureYears && r.pay > 0 && r.pay < subjectPay).length,
      raise: raiseCycle,
      market: marketPosition && isRange(band) ? marketPosition : null,
      tenure: tenureRegression,
      overP75: recommended != null && stats.p75 != null && recommended > stats.p75 ? stats.p75 : null,
      tenureExplainsMatch: match?.tenure && match.tenure.perYear > 0 && match.tenure.explained >= match.gap ? (config.anonymize ? 'the person the case asks to match' : match.name) : null,
      selfReported: activeFactors.length,
    }),
  };

  // Evidence-completeness checklist (private, setup-pane only): which document sections will actually
  // render, and — when one won't — the concrete reason, so the user can see how to strengthen the case.
  const evidenceChecklist = useMemo(() => {
    const has = (s: string) => config.sections.includes(s);
    const marketProof = proofs.find((p) => p.kind === 'market');
    // subjectPct/medianPct comparison mirrors the document's raise-cycle gating (Phase C): the subject
    // line is dropped when the subject out-raised peers, so the checklist explains that omission too.
    const raiseSubjectOutpaced = raiseCycle?.subjectPct != null && raiseCycle.subjectPct > raiseCycle.medianPct;
    const tenureTrendMeaningful = tenureRegression?.verdict === 'below';
    return [
      { label: 'Market standing', ok: has('standing') && standing != null && standing.min != null, note: standing == null || standing.min == null ? 'need ≥1 same-title peer' : `${standing?.pools.length ?? 0} pools`, sectionId: 'standing' },
      { label: 'Standing and gap to median', ok: !!marketProof, note: marketProof ? undefined : 'need ≥4 same-title peers', sectionId: 'highlights' },
      { label: 'Tenure inversions', ok: stats.invCount > 0, note: stats.invCount > 0 ? plural(stats.invCount, 'peer') : 'no lower-tenure, higher-paid peers', sectionId: 'highlights' },
      { label: `Guideline compression (${exempt === false ? '5%' : exempt === true ? '8%' : '5–8%'})`, ok: (guidelineCompression?.count ?? 0) > 0, note: guidelineCompression == null ? 'need same-title peers with ≥5 fewer years' : guidelineCompression.count > 0 ? plural(guidelineCompression.count, 'peer') : 'differential met vs. junior peers', sectionId: 'highlights' },
      { label: 'Supervisory differential', ok: supervisoryCase.reports.some((r) => r.belowFloor), note: config.supervisees.length === 0 ? 'name a direct report under Supervisory scope' : supervisoryCase.reports.some((r) => r.belowFloor) ? undefined : 'reports are already ≥15% below', sectionId: 'highlights' },
      { label: 'Tenure-trend regression', ok: tenureTrendMeaningful, note: tenureRegression == null ? `need ≥${TENURE_MIN_PEERS} same-title peers with tenure` : tenureRegression.verdict === 'above' ? 'paid above the tenure trend' : tenureRegression.verdict === 'on' ? 'gap under 2% of pay — omitted as too small to claim' : undefined, sectionId: 'highlights' },
      { label: 'Grade-band position', ok: proofs.some((p) => p.kind === 'gradeband'), note: band == null ? `no published range for grade ${grade ?? '—'}` : proofs.some((p) => p.kind === 'gradeband') ? undefined : isRange(band) ? 'above the band midpoint' : `at or above the grade ${grade} minimum, the only figure published`, sectionId: 'highlights' },
      { label: 'Market-competitive range', ok: marketPosition?.belowCompetitive ?? false, note: marketPosition == null ? (band == null ? `no published range for grade ${grade ?? '—'}` : `grade ${grade} is published with a minimum only`) : marketPosition.belowCompetitive ? `compa-ratio ${marketPosition.compa.toFixed(2)}` : 'within the 85–115% range', sectionId: 'highlights' },
      { label: 'Raise-cycle comparison', ok: raiseCycle != null, note: raiseCycle == null ? 'need a prior snapshot for this title' : raiseSubjectOutpaced ? 'subject out-raised peers — subject line omitted from document' : undefined, sectionId: 'history' },
      { label: 'Sustained-deficit history', ok: longevity.streak > 0, note: longevity.streak > 0 ? `${plural(longevity.streakYears, 'yr')} below median` : 'not below median on record', sectionId: 'history' },
      { label: 'Retention & replacement cost', ok: has('risk'), note: has('risk') ? undefined : 'off by default (can enable in Report sections)', sectionId: 'risk' },
    ];
  }, [config.sections, config.supervisees.length, proofs, standing, stats.invCount, supervisoryCase, tenureRegression, band, grade, raiseCycle, longevity, guidelineCompression, exempt, marketPosition]);

  // ── Setup-pane data ──
  const comparators: SetupComparator[] = (caseRows ?? []).map((p) => ({
    key: p.person_key, name: fullName(p.fn, p.ln), title: p.title ?? null, school: p.school ?? null,
    tenure: p.tenure ?? null, pay: p.pay, isSubject: p.person_key === subjectKey,
  })).sort((a, b) => (a.isSubject ? -1 : b.isSubject ? 1 : b.pay - a.pay));
  // Fall back to the case's own names before its rows resolve, so the subject is always selectable.
  const comparatorOptions = comparators.length ? comparators
    : [{ key: subjectKey ?? '', name: subjectName }, ...peers].filter((p) => p.key).map((p) => ({ key: p.key, name: p.name, title: null, school: null, tenure: null, pay: null, isSubject: p.key === subjectKey }));
  // One list of whom to add: the people with this title most like the subject, closest first.
  const matches = caseIds.length >= 5 ? [] : closestMatches(
    (suggestRows ?? []).map((r) => ({ key: r.person_key, name: fullName(r.fn, r.ln), school: r.school, tenure: r.tenure, pay: r.pay })),
    { school, tenure: tenureYears, pay: subjectPay }, new Set(caseIds),
  );
  // The ask's choices, each with its figure: every group's median (the curated one once it is more than one
  // person, where it would only repeat "Match …"), each named person, and the guideline figures that apply.
  const all = statsByMode.all;
  const asks = askOptions({
    cohorts: ALL_MODES
      .filter((m) => cohortAvailable[m] && (m !== 'curated' || statsByMode.curated.n > 1 || selectedMode === 'curated'))
      .map((m) => ({
        mode: m, pay: statsByMode[m].expMed ?? statsByMode[m].med ?? null, adjusted: statsByMode[m].expMed != null,
        label: cohortDocLabel(m, { school, grade, gradeBasis: subj?.grade_basis, tenureBand: config.tenureBand }),
      })),
    // Matching someone paid no more would not raise the ask; a case that already names them keeps them.
    peers: comparators
      .filter((c) => !c.isSubject && (subjectPay == null || (c.pay ?? 0) > subjectPay || c.key === config.targetKey))
      .map((c) => ({ key: c.key, name: c.name, pay: c.pay })),
    marketFloor: marketPosition?.belowCompetitive ? { floorPay: marketPosition.floorPay, floorAsk: marketPosition.floorAsk, compa: marketPosition.compa, grade: marketPosition.grade } : null,
    supervisor: supervisoryCase.top && supervisoryCase.target15 != null && supervisoryCase.reports.some((r) => r.belowFloor)
      && (subjectPay == null || supervisoryCase.target15 > subjectPay)
      ? { name: supervisoryCase.top.name, pay: supervisoryCase.target15 } : null,
    median: all.expMed ?? all.med ?? null,
  });
  // Private: what to ask for next if the ask is refused, and the questions a reviewer is likely to put.
  const ladder = fallbackLadder(asks, askValue, recommended, subjectPay);
  const questions = subjectPay == null ? [] : reviewerQuestions({
    subjectFirst, pay: subjectPay,
    group: stats.n > 0 ? { label: docCohortLabel, n: stats.n, paidMoreThan: stats.percentile } : null,
    tenure: tenureRegression,
    matchTenure: match ? matchTenureSentence(match, subjectFirst, match.name) : null,
    raise: raiseCycle,
    market: marketPosition && isRange(band) ? marketPosition : null,
    inversions: stats.invCount,
  });
  // The talking points carry both, for the conversation the case is for.
  const talkingPointsAll = [
    talkingPoints,
    ladder.length ? `If the ask is refused:\n${ladder.map((o, i) => `${i + 1}. ${o.label}: ${usd(o.pay)}`).join('\n')}` : '',
    questions.length ? `Questions a reviewer may ask:\n${questions.map((x) => `- ${x.q} ${x.a}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  // Per-signal coaching: for any case-strength bar that isn't maxed, the concrete lever to lift it. Not which
  // group would make the gap look largest: shopping for the most favourable pool is what a reader discounts.
  const strengthHints: Partial<Record<StrengthKey, { text: string; tone: 'action' | 'fixed' }>> = {};
  for (const p of strength.parts) {
    if (p.value >= p.max) continue;
    const head = p.max - p.value;
    if (p.key === 'market') {
      if (stats.gapToMed != null && stats.gapToMed > 0 && med) {
        strengthHints.market = { text: `${pct(stats.gapToMed / med)} below this group’s median`, tone: 'fixed' };
      } else {
        strengthHints.market = { text: 'at or above this group’s median', tone: 'fixed' };
      }
    } else if (p.key === 'inversion') {
      strengthHints.inversion = { text: `up to +${head} pts · add comparators with less UW tenure who out-earn ${subjectFirst}`, tone: 'action' };
    } else if (p.key === 'added') {
      const need = Math.max(1, 3 - activeFactors.length);
      strengthHints.added = { text: `up to +${head} pts · document ${need} more justification factor${need === 1 ? '' : 's'}`, tone: 'action' };
    } else if (p.key === 'sustained') {
      strengthHints.sustained = { text: `fixed · ${longevity.streakYears} year${longevity.streakYears === 1 ? '' : 's'} below median on record`, tone: 'fixed' };
    }
  }

  const loading = cmpReady && (!subjRows || !caseRows || (!!jobCode && !peerListRows));

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
        onSubject={chooseSubject}
        matchName={matching && targetPerson ? fullName(targetPerson.fn, targetPerson.ln) : null}
        fromSet={fromSet}
        basePay={subjectPay}
        matches={matches}
        onAddPeople={(ps) => setPeers([...peers, ...ps])}
        onRemovePerson={(key) => setPeers(peers.filter((p) => p.key !== key))}
        asks={asks}
        askValue={askValue}
        caseStrength={strength}
        strengthHints={strengthHints}
        talkingPoints={talkingPointsAll}
        ladder={ladder}
        questions={questions}
        overAsk={overAsk}
        overAskAnchor={winningAnchor?.key ?? null}
        cohortP75={stats.p75}
        recommended={recommended}
        // On a phone the ledger pinned above the tabs already shows it; the setup's own readout said it twice.
        readout={isDesktop}
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
        performanceGuide={performanceGuide}
      />
    </Box>
  );

  const briefPane = loading
    ? <Card withBorder padding="xl" className="report-brief"><Skeleton h={40} mb="lg" /><Skeleton h={120} mb="lg" /><Skeleton h={80} mb="lg" /><Skeleton h={160} /></Card>
    : (
      <ReportBrief model={model} hovered={hovered} onHover={setHovered}
        onPoolCsv={peerListRows?.length ? () => downloadCSV(`${subjectName || 'subject'}-title-peers-${snap}.csv`, peerListRows as unknown as Record<string, unknown>[]) : undefined} />
    );

  return (
    <Stack gap="lg">
      <div className="no-print">
        <PageHeader
          title="Reports"
          // Both kinds of report (G9): it described only the raise case, over the one-person report too.
          description="A report on one person's pay, or a raise case for one person built on the UW Salary Administration Guidelines."
          right={
            <Group gap="md" w={isNarrow ? '100%' : undefined}>
              <SegmentedControl
                fullWidth={isNarrow}
                w={isNarrow ? '100%' : undefined}
                value={type}
                onChange={setType}
                // Sentence case, as every other control in the app; the wide labels were Title Case.
                data={[
                  { value: 'person', label: 'One person' },
                  { value: 'comparison', label: 'Raise case' },
                ]}
              />
              <PayMeasure />
              <ExportBar joined={!isNarrow}>
                <CopyLinkButton />
                {/* One Export control: printing, the .doc and the email copy were three buttons side by side, and
                    the last two did nothing on a one-person report but sit there disabled. */}
                <Menu position="bottom-end" shadow="md" withinPortal>
                  <Menu.Target>
                    <Button
                      variant="default"
                      leftSection={<IconDownload size={ICON.control} />}
                      rightSection={<IconChevronDown size={ICON.compact} />}
                      disabled={type === 'person' ? !personHistory?.length : !peerListRows?.length}
                    >
                      Export
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPrinter size={ICON.control} />} onClick={() => window.print()}>
                      Print / Save as PDF
                    </Menu.Item>
                    {type === 'comparison' && (
                      <>
                        <Menu.Item
                          leftSection={<IconFileTypeDoc size={ICON.control} />}
                          disabled={subjectPay == null}
                          onClick={() => downloadDoc(briefToWordHtml(model), `Salary brief - ${subjectName || 'employee'}.doc`)}
                        >
                          Download .doc
                        </Menu.Item>
                        <Menu.Item
                          // Stays open so the confirmation shows where it was pressed.
                          closeMenuOnClick={false}
                          color={docCopyState !== 'idle' ? 'pos' : undefined}
                          leftSection={docCopyState !== 'idle' ? <IconCheck size={ICON.control} /> : <IconCopy size={ICON.control} />}
                          disabled={subjectPay == null}
                          onClick={async () => {
                            const rich = await copyBriefRichText(briefToWordHtml(model));
                            setDocCopyState(rich ? 'rich' : 'plain');
                            if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
                            copyResetTimer.current = setTimeout(() => setDocCopyState('idle'), 1500);
                          }}
                        >
                          {docCopyState === 'rich' ? 'Copied' : docCopyState === 'plain' ? 'Copied (plain text)' : 'Copy for email'}
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </ExportBar>
            </Group>
          }
        />
        <ReportFlow type={type === 'comparison' ? 'comparison' : 'person'} hasSubject={type === 'comparison' ? !!subjectKey : !!selPerson} />
      </div>

      {type === 'person' && (
        <>
          <Card withBorder padding="lg" className="no-print">
            <Eyebrow mb={6}>Report on</Eyebrow>
            <SearchBox kinds={['people']} placeholder="Search an employee by name…" onPick={(h) => setSelPerson({ key: h.person_key, name: h.name })} />
          </Card>
          {selPerson ? (
            <div className="print-area"><PersonDashboard personKey={selPerson.key} metric={metric} /></div>
          ) : (
            <EmptyState
              icon={<IconFileReport size={ICON.feature} />}
              title="No employee selected"
              hint="Pick an employee above for a report on their pay, title history, and how they compare to others in their title."
            />
          )}
        </>
      )}

      {type === 'comparison' && (
        !subjectKey ? (
          <Card withBorder padding="xl" className="no-print">
            <Text fw={600} mb={4}>Start your raise case</Text>
            <Text c="dimmed" size="sm" mb="md">Add the subject, then the peers to compare them with.</Text>
            <SearchBox kinds={['people']} placeholder="Search yourself by name to begin…" onPick={(h) => chooseSubject(h.person_key)} />
          </Card>
        ) : isDesktop ? (
          <div style={{ display: 'flex', gap: 'var(--mantine-spacing-lg)', alignItems: 'flex-start' }}>
            {/* The one list with a scroll of its own (G11): the setup stays beside the brief as it scrolls, so a
                setup taller than the window scrolls inside itself. */}
            <div data-own-scroll="setup beside the brief" style={{ width: '40%', maxWidth: 460, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
              {setupPane}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>{briefPane}</div>
          </div>
        ) : (
          <>
            {/* Sticky ledger so the math is always visible while editing on mobile */}
            <Paper className="no-print glass" withBorder p="xs" style={{ position: 'sticky', top: 8, zIndex: Z.sticky }}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">Current {subjectPay != null ? usd(subjectPay) : '—'}</Text>
                <Text size="sm" fw={700} c={belowTarget ? 'pos' : undefined}>
                  → {recommended == null ? '—' : belowTarget ? `${usd(recommended)} (+${pct(targetPct)})` : 'maintain current pay'}
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
