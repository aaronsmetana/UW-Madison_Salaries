import { useMemo, useState, type ReactNode } from 'react';
import { Stack, Card, Text, Group, SimpleGrid, Table, Alert, Anchor, Button, Badge, Collapse, Chip, Tooltip as MTooltip } from '@mantine/core';
import { SegmentedToggle } from './SegmentedToggle';
import { legacyTitle, fmtChange } from '../lib/format';
import { IconInfoCircle } from '@tabler/icons-react';
import { ICON } from '../lib/ui';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, LabelList, Customized } from 'recharts';
import { AXIS_TICK, GRID, BAR_RADIUS, chartKeys, CHART_FONT } from '../lib/chartStyle';
import { Eyebrow } from './Eyebrow';
import { CardTitle } from './CardTitle';
import { CsvButton } from './CsvButton';
import { Link } from 'react-router-dom';
import { useControls } from '../state/controls';
import { usePeriod } from '../lib/period';
import { useSummary, useSql } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay, whereAll, filterKey, continuingRaisesSql, reportingFactorSql, mainOf } from '../lib/queries';
import { usd, usdCompact, num, pct, fullName } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { ChartData } from './ChartData';
import { MethodNote } from './MethodNote';
import { StatCard, StatRow } from './StatCard';
import { TipSurface } from './chart/ChartTooltip';
import { raiseBucketSql } from '../lib/raiseBuckets';
import { RaiseDistribution } from './RaiseDistribution';

interface Mover { person_key: string; fn: string; ln: string; title: string | null; school: string | null; a_pay: number; b_pay: number; delta: number; pct: number; apt_moved: boolean }
interface Promo { person_key: string; fn: string; ln: string; a_job: string | null; b_job: string | null; a_title: string | null; b_title: string | null; a_pay: number; b_pay: number; delta: number | null; pct: number | null }

/** Athletics' coaches lead any list of UW pay and of its raises: one click sets them aside (D24), as on Top earners. */
const ATHLETICS = 'Intercollegiate Athletics';
/** Staff, for the movers' split: everyone not Faculty, Limited or a trainee (any spelling), the codes included. */
const STAFF_SQL = `b.cat IS DISTINCT FROM 'Faculty' AND coalesce(b.cat, '') NOT IN ('Limited', 'Limited Appointee') AND coalesce(b.cat, '') NOT ILIKE 'employee%' AND coalesce(b.cat, '') NOT LIKE 'ET%'`;
/** A cut a reader should check before taking it as one (D25): the appointment's type changed, or 15% or more went
 *  with nothing on the record to say why (same title, FTE and basis). */
const FLAG_SQL = `((a.apt IS NOT NULL AND b.apt IS NOT NULL AND a.apt <> b.apt) OR c.r <= -0.15)`;
/** A title as a reader would write it: the source cut older titles at 30 characters, so the code's title in its
 *  latest snapshot (`codes`) stands in for it, all-capitals ones rewritten. */
const fullTitle = (t: string | null) => (t ? legacyTitle(t) : '—');
interface SummaryRow { stayers: number; joiners: number; leavers: number; title_changes: number; median_raise: number | null; n_continuing: number }

function Stat({ label, value, exact, sub }: { label: string; value: string; exact?: string; sub?: string }) {
  return <StatCard size="sm" label={label} sub={sub} value={exact ? <span title={exact} aria-label={exact}>{value}</span> : value} />;
}

type BandScale = ((v: string) => number | undefined) & { bandwidth?: () => number };

/**
 * A dashed rule from each waterfall bar's end to where the next one starts: the running total the eye
 * would otherwise carry across the gap. Bars fill the middle 80% of their band (Recharts' default
 * 10% category gap on each side), so the rule spans the gap between them.
 */
function WaterfallConnectors({ steps, xAxisMap, yAxisMap }: {
  steps: { name: string; end: number }[];
  xAxisMap?: Record<string, { scale: BandScale }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
}) {
  const xa = xAxisMap ? Object.values(xAxisMap)[0] : undefined;
  const ya = yAxisMap ? Object.values(yAxisMap)[0] : undefined;
  if (!xa || !ya) return null;
  const bw = xa.scale.bandwidth?.() ?? 0;
  return (
    <g className="wf-connectors">
      {steps.slice(0, -1).map((st, i) => {
        const a = xa.scale(st.name);
        const b = xa.scale(steps[i + 1].name);
        if (a == null || b == null) return null;
        const y = ya.scale(st.end);
        return <line key={st.name} x1={a + bw * 0.9} x2={b + bw * 0.1} y1={y} y2={y} stroke="var(--mantine-color-dimmed)" strokeWidth={1} strokeDasharray="3 3" />;
      })}
    </g>
  );
}

/** The tab's sections, for its map (D29). */
const CHANGES_SECTIONS = [
  ['changes-summary', 'Summary'], ['changes-payroll', 'Payroll'], ['changes-raises', 'Raises'], ['changes-movers', 'Biggest raises'],
  ['changes-flow', 'Net flow'], ['changes-titles', 'Title changes'], ['changes-transitions', 'Transitions'], ['changes-moves', 'Internal moves'],
] as const;

/** A caveat as one line, its detail one click away (D22): two full-width callouts came before the first tile. */
function CompactNotice({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`compact-notice${className ? ` ${className}` : ''}`}>
      <Group gap={6} wrap="nowrap" align="center">
        <IconInfoCircle size={ICON.compact} style={{ flexShrink: 0, color: 'var(--text-accent)' }} aria-hidden />
        <Text size="sm" fw={600} className="compact-notice-title">{title}</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Less' : 'More'}</Button>
      </Group>
      <Collapse in={open}>
        <Text size="sm" c="dimmed" mt={4} maw="var(--measure)">{children}</Text>
      </Collapse>
    </div>
  );
}

/** One division's net change in people, as a bar from zero (D28): gains right in the rise colour, losses left in
 *  the fall's, on one scale for the list. They were two lists of numbers. */
function NetBar({ net, max }: { net: number; max: number }) {
  const w = max > 0 ? (Math.abs(net) / max) * 50 : 0;
  return (
    <div className="net-bar" aria-hidden style={{ position: 'relative', width: 'min(160px, 28vw)', height: 12, marginLeft: 'auto' }}>
      <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--guide-strong)' }} />
      <div
        className={net >= 0 ? 'net-bar-up' : 'net-bar-down'}
        style={{ position: 'absolute', top: 1, bottom: 1, borderRadius: 2, width: `${w}%`, ...(net >= 0 ? { left: '50%' } : { right: '50%' }), background: net >= 0 ? 'var(--mark-up)' : 'var(--mark-down)' }}
      />
    </div>
  );
}

export function ChangesPanel() {
  const [hoveredWf, setHoveredWf] = useState<number | null>(null);
  const { scope, metric, filters } = useControls();
  const where = whereAll(scope, filters);
  const { data: summary } = useSummary();
  const snaps = useMemo(() => summary?.snapshots ?? [], [summary]);

  // The page's period (D1): the control bar's From and snapshot. The tab had its own From and To, a second period.
  const { from: periodFrom, to: periodTo, setPeriod } = usePeriod();
  const fromId = periodFrom?.id ?? null;
  const toId = periodTo?.id ?? null;
  const enabled = !!fromId && !!toId && fromId !== toId;
  const A = sqlStr(fromId ?? '');
  const B = sqlStr(toId ?? '');
  // The page's scope, the one control for it (D3): the tab had a School and a Department picker of its own under
  // the page's "Showing".
  const localWhere = where;
  const scopeKey = `${scope.kind === 'school' ? scope.value : scope.kind === 'department' ? `${scope.school ?? ''}/${scope.value}` : ''}|${filterKey(filters)}`;

  // Only offer divisions/departments present in BOTH snapshots. UW renamed and split divisions in the
  // 2025 reorg (e.g. "Sch of Med & Public Health" → "School of Medicine and Public Health"), so a unit
  // labelled differently across the pair can't be matched by name and would read as all-new-hires.
  const { data: schoolOpts } = useSql<{ school: string }>(
    ['chg-schools', fromId, toId],
    `SELECT school FROM (
        SELECT school FROM salaries WHERE snapshot_id = ${A} AND school IS NOT NULL GROUP BY school
        INTERSECT
        SELECT school FROM salaries WHERE snapshot_id = ${B} AND school IS NOT NULL GROUP BY school
     ) ORDER BY school`,
    enabled
  );
  // The school and department the Raises link carries: the page's scope.
  const deptSchool = scope.kind === 'school' ? scope.value : scope.kind === 'department' ? scope.school : null;
  const linkDept = scope.kind === 'department' ? scope.value : null;
  // A division the period's start does not have under this name (the 2025 reorganization renamed several):
  // everyone in it would read as a new hire, so the tab says so instead of counting it.
  const scopeMissing = scope.kind === 'school' && !!schoolOpts && !schoolOpts.some((x) => x.school === scope.value);
  const live = enabled && !scopeMissing;

  // Restrict both sides to people with a paid appointment so unpaid $0 affiliates don't read as
  // joiners/leavers (a $0-only person has NULL personPay and is dropped by the HAVING).
  const cte = `WITH a AS (SELECT person_key, ${personPay(metric)} pay, ${mainOf('job_code')} job, ${mainOf('title')} title, ${mainOf('school')} school,
                                 ${mainOf('comp_basis')} basis, ${mainOf('employee_category')} cat, ${mainOf('appointment_type')} apt
                          FROM salaries WHERE snapshot_id = ${A} AND ${localWhere} GROUP BY person_key HAVING ${personPay(metric)} > 0),
                    b AS (SELECT person_key, ${personPay(metric)} pay, ${mainOf('job_code')} job, ${mainOf('title')} title, ${mainOf('school')} school,
                                 ${mainOf('comp_basis')} basis, ${mainOf('employee_category')} cat, ${mainOf('appointment_type')} apt,
                                 any_value(first_name) fn, any_value(last_name) ln
                          FROM salaries WHERE snapshot_id = ${B} AND ${localWhere} GROUP BY person_key HAVING ${personPay(metric)} > 0),
                    codes AS (SELECT job_code, arg_max(title, snapshot_date) t FROM salaries WHERE job_code IS NOT NULL GROUP BY job_code)`;

  // Every raise figure on this panel — the median, the distribution, the biggest raises and cuts, the
  // share of raise dollars — reads continuing raises (continuingRaisesSql): one appointment on each
  // side, same title, same FTE, same pay basis. Over all stayers, a promotion, an FTE change and the
  // Sep 2025 change in how 9-month pay is reported all passed for raises (the 9-month change alone put
  // 1,474 faculty at +25.9%); across that change a raise is like for like, the earlier pay restated ×11/9.
  // Headcounts and the payroll decomposition still cover every stayer: the decomposition has to, or its
  // parts stop summing to the total.
  const crs = `(${continuingRaisesSql({ metric, where: localWhere, pair: { from: fromId ?? '', to: toId ?? '' } })})`;

  const { data: sumData } = useSql<SummaryRow>(
    ['chg-sum', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL) stayers,
            count(*) FILTER (WHERE a.person_key IS NULL) joiners,
            count(*) FILTER (WHERE b.person_key IS NULL) leavers,
            count(*) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL AND a.job IS DISTINCT FROM b.job) title_changes,
            (SELECT median(r) FROM ${crs}) median_raise,
            (SELECT count(*) FROM ${crs}) n_continuing
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key`,
    live
  );
  const s = sumData?.[0];

  // One raise shared by most continuing staff is a pay-plan step, not a spread of raises: said in a line,
  // since the distribution's 1% bins round "exactly 2.0%" into "+2%". Read at 0.1%, raise-steps' resolution.
  const { data: modeRows } = useSql<{ k: number; c: number; n: number }>(
    ['chg-mode', fromId, toId, scopeKey, metric],
    `WITH c AS (SELECT round(r, 3) k FROM ${crs})
     SELECT k, count(*) c, (SELECT count(*) FROM c) n FROM c GROUP BY k ORDER BY c DESC, k LIMIT 1`,
    live
  );
  const commonRaise = modeRows?.[0] && modeRows[0].n > 0 && modeRows[0].k > 0 && modeRows[0].c / modeRows[0].n >= 0.5 ? modeRows[0] : null;

  // Divisions formed from whole departments of others within this pair (summary `reorganizations`): their
  // people moved division without changing anything else, and are said to have.
  const reorgs = useMemo(() => {
    const date = (id: string | null) => snaps.find((x) => x.id === id)?.date ?? null;
    const [a, b] = [date(fromId), date(toId)];
    if (!a || !b) return [];
    return (summary?.reorganizations ?? []).filter((r) => { const d = date(r.to_id); return !!d && d > a && d <= b; });
  }, [summary, snaps, fromId, toId]);
  const reorgMove = (from: string | null, to: string | null) =>
    reorgs.some((r) => r.school === to && r.from.some((f) => f.school === from));

  // The biggest raises and cuts: everyone, Faculty or staff, Athletics in or out (D24). Four of the top five raises
  // were coaches'.
  const [who, setWho] = useState<'all' | 'faculty' | 'staff'>('all');
  const [noAthletics, setNoAthletics] = useState(false);
  const [showFlagged, setShowFlagged] = useState(false);
  const moverWhere = `${noAthletics ? ` AND b.school IS DISTINCT FROM ${sqlStr(ATHLETICS)}` : ''}${who === 'faculty' ? " AND b.cat = 'Faculty'" : who === 'staff' ? ` AND ${STAFF_SQL}` : ''}`;
  const moverKey = `${who}|${noAthletics}`;
  const moverSelect = `${cte}
     SELECT c.person_key, b.fn, b.ln, b.title, b.school, c.pay_from a_pay, c.pay_to b_pay, (c.pay_to - c.pay_from) delta, c.r pct,
            ${FLAG_SQL} AND c.pay_to < c.pay_from flagged, (a.apt IS NOT NULL AND b.apt IS NOT NULL AND a.apt <> b.apt) apt_moved
     FROM ${crs} c JOIN b ON b.person_key = c.person_key JOIN a ON a.person_key = c.person_key WHERE TRUE${moverWhere}`;
  // Raises that are raises and cuts that are cuts: with few cuts, the list ran on into people whose pay stood still.
  const { data: raises } = useSql<Mover>(['chg-raise', fromId, toId, scopeKey, metric, moverKey], `${moverSelect} AND c.pay_to > c.pay_from ORDER BY delta DESC LIMIT 12`, live);
  // A cut the record cannot explain is set aside unless asked for (D25), and counted, so the list says so.
  const { data: cuts } = useSql<Mover>(['chg-cut', fromId, toId, scopeKey, metric, moverKey, showFlagged],
    `${moverSelect} AND c.pay_to < c.pay_from${showFlagged ? '' : ` AND NOT (${FLAG_SQL})`} ORDER BY delta ASC LIMIT 12`, live);
  const { data: flaggedRows } = useSql<{ n: number }>(['chg-flagged', fromId, toId, scopeKey, metric, moverKey],
    `SELECT count(*) n FROM (${moverSelect} AND c.pay_to < c.pay_from AND (${FLAG_SQL})) m`, live);
  const flaggedN = Number(flaggedRows?.[0]?.n ?? 0);
  const { data: promos } = useSql<Promo>(
    ['chg-promo', fromId, toId, scopeKey, metric],
    // Like for like across the 9-month reporting change, as a continuing raise is.
    // Each title as its code's latest snapshot spells it (D26): older snapshots cut titles at 30 characters.
    `${cte} SELECT b.person_key, b.fn, b.ln, a.job a_job, b.job b_job, coalesce(ca.t, a.title) a_title, coalesce(cb.t, b.title) b_title,
        a.pay * ${reportingFactorSql('a.basis', 'b.basis')} a_pay, b.pay b_pay,
        (b.pay - a.pay * ${reportingFactorSql('a.basis', 'b.basis')}) delta, b.pay / nullif(a.pay * ${reportingFactorSql('a.basis', 'b.basis')}, 0) - 1 pct
     FROM a JOIN b ON a.person_key = b.person_key LEFT JOIN codes ca ON ca.job_code = a.job LEFT JOIN codes cb ON cb.job_code = b.job
     WHERE a.job IS DISTINCT FROM b.job ORDER BY delta DESC LIMIT 12`,
    live
  );

  const { data: decompData } = useSql<{ total_change: number; raises: number; hires: number; departures: number }>(
    ['chg-decomp', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT
       coalesce(sum(b.pay) FILTER (WHERE b.person_key IS NOT NULL), 0) - coalesce(sum(a.pay) FILTER (WHERE a.person_key IS NOT NULL), 0) total_change,
       coalesce(sum(b.pay - a.pay) FILTER (WHERE a.person_key IS NOT NULL AND b.person_key IS NOT NULL), 0) raises,
       coalesce(sum(b.pay) FILTER (WHERE a.person_key IS NULL), 0) hires,
       -coalesce(sum(a.pay) FILTER (WHERE b.person_key IS NULL), 0) departures
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key`,
    live
  );
  const d = decompData?.[0];

  // 1% bins with open tails and a bin of its own for no change (lib/raiseBuckets, shared with the
  // Reports raise cycle). Every bin takes its place on the axis, empty or not.
  const { data: raiseCounts } = useSql<{ bucket: number; n: number }>(
    ['chg-dist', fromId, toId, scopeKey, metric],
    `SELECT ${raiseBucketSql('r')} AS bucket, count(*) n FROM ${crs} GROUP BY 1 ORDER BY 1`,
    live
  );

  const { data: mobility } = useSql<{ person_key: string; fn: string; ln: string; a_school: string | null; b_school: string | null; delta: number }>(
    ['chg-mobility', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT b.person_key, b.fn, b.ln, a.school a_school, b.school b_school, (b.pay - a.pay) delta
     FROM a JOIN b ON a.person_key = b.person_key
     WHERE a.school IS DISTINCT FROM b.school ORDER BY abs(b.pay - a.pay) DESC LIMIT 200`,
    live
  );

  const { data: equityRows } = useSql<{ top10_share: number | null; n_raised: number }>(
    ['chg-equity', fromId, toId, scopeKey, metric],
    `WITH r AS (SELECT (pay_to - pay_from) raise FROM ${crs} WHERE pay_to > pay_from)
     SELECT count(*) n_raised,
       CASE WHEN sum(raise) > 0 THEN round(100.0 * sum(raise) FILTER (WHERE raise >= (SELECT quantile_cont(raise, 0.9) FROM r)) / sum(raise), 1) ELSE NULL END top10_share
     FROM r`,
    live
  );
  const equity = equityRows?.[0];

  const { data: flows } = useSql<{ a_title: string | null; b_title: string | null; n: number; med_delta: number | null }>(
    ['chg-flows', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT any_value(coalesce(ca.t, a.title)) a_title, any_value(coalesce(cb.t, b.title)) b_title, count(*) n, round(median(b.pay - a.pay)) med_delta
     FROM a JOIN b ON a.person_key = b.person_key LEFT JOIN codes ca ON ca.job_code = a.job LEFT JOIN codes cb ON cb.job_code = b.job
     WHERE a.job IS DISTINCT FROM b.job
     GROUP BY a.job, b.job ORDER BY n DESC LIMIT 15`,
    live
  );

  // Net headcount flow per division: who hired more than they lost (and vice versa) over the window.
  const { data: netFlows } = useSql<{ school: string; joined: number; departed: number }>(
    ['chg-netflows', fromId, toId, scopeKey, metric],
    `${cte}
     SELECT coalesce(a.school, b.school) school,
        count(*) FILTER (WHERE a.person_key IS NULL) joined,
        count(*) FILTER (WHERE b.person_key IS NULL) departed
     FROM a FULL OUTER JOIN b ON a.person_key = b.person_key
     WHERE coalesce(a.school, b.school) IS NOT NULL
     GROUP BY coalesce(a.school, b.school)
     HAVING count(*) FILTER (WHERE a.person_key IS NULL) + count(*) FILTER (WHERE b.person_key IS NULL) > 0`,
    live
  );
  const netTop = useMemo(() => {
    const rows = (netFlows ?? []).map((r) => ({ ...r, net: r.joined - r.departed }));
    const gainers = [...rows].sort((a, b) => b.net - a.net).slice(0, 6).filter((r) => r.net > 0);
    const losers = [...rows].sort((a, b) => a.net - b.net).slice(0, 6).filter((r) => r.net < 0).reverse();
    const max = Math.max(1, ...[...gainers, ...losers].map((r) => Math.abs(r.net)));
    return { gainers, losers, max };
  }, [netFlows]);

  const isTTC = !!fromId && !!toId && fromId.includes('pre') && toId.includes('post');
  const fromLabel = snaps.find((x) => x.id === fromId)?.label ?? '—';
  const toLabel = snaps.find((x) => x.id === toId)?.label ?? '—';
  const scopeText = scope.kind === 'department' ? ` in ${scope.value}` : scope.kind === 'school' ? ` in ${scope.value}` : '';

  // Quick snapshot-pair presets.
  // Quick ranges set the page's period, its start and end at once.
  const setPair = (a: string, b: string) => setPeriod(a, b);
  const presetLatest = () => { if (snaps.length >= 2) setPair(snaps[snaps.length - 2].id, snaps[snaps.length - 1].id); };
  const presetYoY = () => {
    const last = snaps[snaps.length - 1];
    if (!last) return;
    const target = new Date(last.date); target.setFullYear(target.getFullYear() - 1);
    const prior = [...snaps].filter((x) => new Date(x.date) <= target).at(-1) ?? snaps[0];
    setPair(prior.id, last.id);
  };
  const presetTTC = () => {
    const post = snaps.find((x) => x.id.endsWith('-post')) ?? snaps[0];
    const last = snaps[snaps.length - 1];
    if (post && last) setPair(post.id, last.id);
  };

  // Waterfall steps: net payroll change = raises + new hires − departures.
  const waterfall = useMemo(() => {
    if (!d) return [];
    const r = d.raises, h = d.hires, dep = d.departures, tot = d.total_change;
    const s2 = r + h;
    // `end` is the running total after the step, where the connector to the next bar is drawn.
    const step = (name: string, base: number, amount: number, kind: 'up' | 'down' | 'net', end: number) => ({ name, base, bar: Math.abs(amount), amount, kind, end });
    return [
      step('Raises', Math.min(0, r), r, r >= 0 ? 'up' : 'down', r),
      step('New hires', Math.min(r, s2), h, h >= 0 ? 'up' : 'down', s2),
      step('Departures', Math.min(s2, tot), dep, 'down', tot),
      step('Net change', Math.min(0, tot), tot, 'net', tot),
    ];
  }, [d]);
  // A waterfall step's colour: what added to payroll up, what took from it down (the app's one direction
  // pair, green and deep red), and the net a total, in the guide grey — its sign is in its label.
  const wfColor = (kind: string) =>
    kind === 'net' ? 'var(--guide-strong)' : kind === 'up' ? 'var(--mark-up)' : 'var(--mark-down)';

  // Share of continuing staff who got any raise.
  const raisedPct = equity?.n_raised != null && s?.n_continuing ? equity.n_raised / s.n_continuing : null;

  const exportMovers = () =>
    downloadCSV(`uw-pay-changes-${fromId}-to-${toId}.csv`, [...(raises ?? []), ...(cuts ?? [])].map((m) => ({
      name: fullName(m.fn, m.ln), title: m.title ?? '', school: m.school ?? '',
      from_pay: Math.round(m.a_pay), to_pay: Math.round(m.b_pay), change: Math.round(m.delta), pct: `${(m.pct * 100).toFixed(1)}%`,
    })));
  const exportFlows = () =>
    downloadCSV(`uw-title-flows-${fromId}-to-${toId}.csv`, (flows ?? []).map((f) => ({
      from_title: f.a_title ?? '', to_title: f.b_title ?? '', people: f.n, median_pay_change: f.med_delta ?? '',
    })));

  const moverRows = (rows?: Mover[]) =>
    (rows ?? []).map((m) => (
      <Table.Tr key={m.person_key}>
        <Table.Td>
          <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{fullName(m.fn, m.ln)}</Anchor>
          <Text size="xs" c="dimmed" lineClamp={1}>{[m.title, m.school].filter(Boolean).join(' · ')}</Text>
          {/* On a phone the pay each side sits under the name; its column folds away. */}
          <Text className="fold-under" size="xs" c="dimmed">{usd(m.a_pay)} → {usd(m.b_pay)}</Text>
          {m.delta < 0 && (m.apt_moved || m.pct <= -0.15) && (
            <MTooltip withArrow multiline w={280} label={m.apt_moved
              ? 'The appointment’s type changed between the two snapshots: the fall may be the new appointment’s pay, not a cut.'
              : 'A cut of 15% or more with no change of title, FTE or basis on the record: it may be a new appointment under the same title. Check the person.'}>
              <Badge size="xs" variant="light" color="gray" className="flag-tag" tabIndex={0}>{m.apt_moved ? 'appointment changed' : 'check'}</Badge>
            </MTooltip>
          )}
        </Table.Td>
        <Table.Td ta="right" data-fold>{usd(m.a_pay)} → {usd(m.b_pay)}</Table.Td>
        <Table.Td ta="right" c={m.delta >= 0 ? 'up' : 'down'} style={{ whiteSpace: 'nowrap' }}>{m.delta >= 0 ? '+' : '−'}{usd(Math.abs(m.delta))}</Table.Td>
        <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>{fmtChange(m.pct)}</Table.Td>
      </Table.Tr>
    ));

  // Internal moves (D27): the reorganization's set aside unless asked for, then the biggest each way.
  const [hideReorg, setHideReorg] = useState(true);
  const movesReorg = (mobility ?? []).filter((m) => reorgMove(m.a_school, m.b_school)).length;
  const movesShown = (mobility ?? []).filter((m) => !(hideReorg && reorgMove(m.a_school, m.b_school)));
  const movesUp = movesShown.filter((m) => (m.delta ?? 0) >= 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 8);
  const movesDown = movesShown.filter((m) => (m.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 8);

  // The sections the tab has for this period, in order: the map lists only those drawn.
  const present = new Set([
    'changes-summary', 'changes-payroll', 'changes-raises', 'changes-movers',
    ...(netTop.gainers.length || netTop.losers.length ? ['changes-flow'] : []),
    'changes-titles',
    ...((flows ?? []).length ? ['changes-transitions'] : []),
    ...(movesShown.length ? ['changes-moves'] : []),
  ]);

  return (
    <Stack gap="lg">
      {scopeMissing && (
        <Alert color="gray" variant="light" className="changes-scope-missing">
          {scope.kind === 'school' ? scope.value : ''} is not in {fromLabel} under this name (the 2025 reorganization renamed
          several divisions), so its changes cannot be measured from there. Choose a later From, or All UW.
        </Alert>
      )}
      <Group gap="xs" wrap="wrap">
        <Eyebrow>Quick range</Eyebrow>
        <Button size="compact-xs" variant="default" onClick={presetLatest}>Latest pair</Button>
        <Button size="compact-xs" variant="default" onClick={presetYoY}>Year over year</Button>
        <Button size="compact-xs" variant="default" onClick={presetTTC}>Since TTC</Button>
      </Group>

      {/* A map of the tab (D29): ten sections ran 6,500px with no way between them. Held under the page header. */}
      <nav className="changes-index" aria-label="Sections of Changes">
        {CHANGES_SECTIONS.filter(([id]) => present.has(id)).map(([id, label]) => (
          <Anchor key={id} component="button" type="button" size="sm" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {label}
          </Anchor>
        ))}
      </nav>

      {/* One sentence, then the figures (G22): the page opened with about 120 words and two callouts before
          its first number. How each figure was counted closes the section, folded. */}
      {s && live && (
        <Text size="sm" className="changes-lead changes-section" id="changes-summary">
          Between <b>{fromLabel}</b> and <b>{toLabel}</b>{scopeText}:
        </Text>
      )}

      <StatRow cols={{ base: 2, sm: 5 }}>
        <Stat label="Continuing" value={num(s?.stayers)} />
        <Stat label="New hires" value={num(s?.joiners)} />
        <Stat label="Departures" value={num(s?.leavers)} />
        <Stat label="Title changes" value={num(s?.title_changes)} />
        <Stat label="Median raise" value={s?.median_raise == null ? '—' : pct(s.median_raise)}
          sub={s?.n_continuing ? `${num(s.n_continuing)} counted${raisedPct != null ? ` · ${pct(raisedPct)} got one` : ''}` : undefined} />
      </StatRow>

      {s && live && commonRaise && (
        <Text size="sm" className="changes-step-note" data-common-raise={commonRaise.k} data-common-share={(commonRaise.c / commonRaise.n).toFixed(4)}>
          <b>An across-the-board step:</b> {pct(commonRaise.c / commonRaise.n, 0)} of the {num(commonRaise.n)} who kept the same title and
          appointment{scopeText} were raised exactly {(commonRaise.k * 100).toFixed(1)}%.
        </Text>
      )}

      {/* The same pair and unit on the Raises page, where the Pre-TTC twin is never an end. */}
      {s && live && !fromId?.endsWith('-pre') && !toId?.endsWith('-pre') && (
        <Anchor component={Link} size="sm" className="changes-raises-link"
          to={`/raises?${new URLSearchParams({
            from: fromId ?? '', to: toId ?? '',
            ...(deptSchool ? { sch: deptSchool } : {}),
            ...(deptSchool && linkDept ? { dept: linkDept } : {}),
          })}`}>
          See who got more than the usual raise, and what may explain it →
        </Anchor>
      )}

      {/* Only where the period spans one (`reorgs` is the period's). */}
      {reorgs.map((r) => (
        <CompactNotice key={`${r.to_id}|${r.school}`} className="changes-reorg" title={`A reorganization: ${r.school}`}>
          Formed in {snaps.find((x) => x.id === r.to_id)?.label ?? r.to_id} from whole departments of{' '}
          {r.from.map((f, i) => (
            <span key={f.school}>{i > 0 ? '; ' : ''}{f.school} ({f.departments.join(', ')}: {num(f.people)} people)</span>
          ))}
          . Their moves between divisions below are that, not people changing jobs — and in a view of one of these
          divisions they count as joining or leaving it.
        </CompactNotice>
      ))}

      {isTTC && (
        <CompactNotice className="changes-ttc" title="The TTC reclassification, Nov 2021">
          This pair spans the Nov-2021 Title &amp; Total Compensation restructure — nearly everyone's title/job
          code changed at once. Treat "title changes" here as a structural reclassification, not promotions.
        </CompactNotice>
      )}

      <MethodNote className="changes-method">
        <Text inherit>
          Raises count the {num(s?.n_continuing)} people who held one appointment in both snapshots, in the same title
          at the same FTE: a promotion, an FTE change or a change in how pay is reported is not a raise. A departure
          is someone not present in {toLabel}.
        </Text>
        <Text inherit>
          People are matched by name only: no employee ID exists in the public records, so the counts of who
          continued, joined and left are approximate, and a name change or a shared name can be miscounted.{' '}
          <Anchor component={Link} to="/data#identity" inherit>How matching works →</Anchor>
        </Text>
        <Text inherit>
          A division the period&apos;s start has no row for under its name cannot be measured from there: some were
          renamed or split in the 2025 reorganization, and the tab says so rather than count everyone in it as new.
        </Text>
      </MethodNote>

      {/* The waterfall alone, its steps labelled (D21): four tiles above it said the same four figures again. */}
      <Card withBorder padding="lg" id="changes-payroll" className="changes-section">
        <CardTitle mb="sm" sub="Raises, new hires and departures, adding up to the net change.">Payroll change decomposition</CardTitle>
        {equity && equity.top10_share != null && (
          <Text size="sm" mt="sm">
            Raise concentration: the top 10% of raised staff captured <b>{equity.top10_share}%</b> of all raise
            dollars ({num(equity.n_raised)} people got a raise).
          </Text>
        )}
        {waterfall.length > 0 && (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart {...chartKeys('Payroll change decomposition')} data={waterfall} margin={{ left: 12, right: 12, top: 24 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis width={56} tickFormatter={(v) => usdCompact(v)} tick={AXIS_TICK} />
              <Tooltip
                cursor={{ fill: 'var(--mantine-color-default-hover)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const w = payload[0].payload as { name: string; amount: number };
                  return (
                    <TipSurface>
                      <Text size="sm" fw={600}>{w.name}</Text>
                      <Text size="sm" c={w.amount >= 0 ? 'up' : 'down'}>{w.amount >= 0 ? '+' : ''}{usd(w.amount)}</Text>
                    </TipSurface>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="var(--mantine-color-default-border)" />
              <Customized component={<WaterfallConnectors steps={waterfall} />} />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar
                dataKey="bar"
                stackId="w"
                radius={BAR_RADIUS}
                isAnimationActive={false}
                onMouseEnter={(_, i) => setHoveredWf(i)}
                onMouseLeave={() => setHoveredWf(null)}
              >
                {waterfall.map((w, i) => (
                  <Cell
                    key={i}
                    fill={wfColor(w.kind)}
                    fillOpacity={hoveredWf != null && hoveredWf !== i ? 0.45 : 1}
                  />
                ))}
                <LabelList
                  dataKey="amount" position="top"
                  formatter={(v: number) => `${v >= 0 ? '+' : '−'}${usdCompact(Math.abs(v))}`}
                  style={{ fontSize: CHART_FONT, fontWeight: 700, fill: 'var(--mantine-color-text)' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div id="changes-raises" className="changes-section">
      <RaiseDistribution
        counts={raiseCounts}
        marker={s?.median_raise != null ? { value: s.median_raise, label: 'median', name: 'median' } : null}
        title="Raise distribution"
        sub="Percent change in pay for continuing staff."
        period={`${fromLabel} → ${toLabel}`}
      />
      </div>

      <Stack gap="sm" id="changes-movers" className="changes-section">
        <CardTitle
          mb={0}
          right={
            <CsvButton onClick={exportMovers} disabled={!(raises ?? []).length} />
          }
          sub="People in the same title at the same FTE in both snapshots."
        >
          Biggest raises and cuts
        </CardTitle>
        <Group gap="sm" wrap="wrap" className="mover-controls">
          <SegmentedToggle
            ariaLabel="Whose raises"
            value={who}
            onChange={(v) => setWho(v as 'all' | 'faculty' | 'staff')}
            options={[{ id: 'all', label: 'All' }, { id: 'faculty', label: 'Faculty' }, { id: 'staff', label: 'Staff' }]}
          />
          <Chip size="xs" checked={noAthletics} onChange={setNoAthletics} className="movers-no-athletics">Without Athletics</Chip>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder padding="lg">
            <CardTitle order={3} mb="sm">Biggest raises</CardTitle>
            <Table className="fold-table"><Table.Tbody>{moverRows(raises)}</Table.Tbody></Table>
          </Card>
          <Card withBorder padding="lg">
            <CardTitle order={3} mb="sm" right={(flaggedN > 0 || showFlagged) && (
              <Chip size="xs" checked={showFlagged} onChange={setShowFlagged} className="cuts-show-flagged">
                {showFlagged ? 'Flagged shown' : `Include ${num(flaggedN)} flagged`}
              </Chip>
            )}>Biggest decreases</CardTitle>
            <Table className="cuts-table fold-table"><Table.Tbody>{moverRows(cuts)}</Table.Tbody></Table>
            {!showFlagged && flaggedN > 0 && (
              <Text size="xs" c="dimmed" mt="xs" className="cuts-flag-note">
                {num(flaggedN)} {flaggedN === 1 ? 'cut is' : 'cuts are'} set aside: an appointment whose type changed, or a fall of 15% or
                more that nothing on the record explains.
              </Text>
            )}
          </Card>
        </SimpleGrid>
      </Stack>

      {(netTop.gainers.length > 0 || netTop.losers.length > 0) && (
        <Card withBorder padding="lg" id="changes-flow" className="changes-section">
          <CardTitle mb="sm" sub="The divisions that gained and lost the most paid staff, on one scale from zero.">Net headcount flow by division</CardTitle>
          <Table className="net-flow fold-table">
            <Table.Tbody>
              {[...netTop.gainers, ...netTop.losers].map((r) => (
                <Table.Tr key={r.school} data-net={r.net}>
                  <Table.Td><Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`}>{r.school}</Anchor></Table.Td>
                  <Table.Td ta="right" c="dimmed" data-fold>+{num(r.joined)} / −{num(r.departed)}</Table.Td>
                  <Table.Td><NetBar net={r.net} max={netTop.max} /></Table.Td>
                  <Table.Td ta="right" c={r.net >= 0 ? 'up' : 'down'} fw={600} w={72}>{r.net > 0 ? '+' : r.net < 0 ? '−' : ''}{num(Math.abs(r.net))}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="xs">Net = paid staff who joined the division minus those who left it (same name-matching caveat applies).</Text>
        </Card>
      )}

      <Card withBorder padding="lg" id="changes-titles" className="changes-section">
        <CardTitle mb="sm" sub={isTTC ? 'Reclassifications in the TTC restructure, not promotions.' : 'Promotions and lateral moves.'}>Title / job-code changes</CardTitle>
        <Table className="fold-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Person</Table.Th>
              <Table.Th>From → To title</Table.Th>
              <Table.Th ta="right" data-fold>Pay</Table.Th>
              <Table.Th ta="right">Change</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(promos ?? []).map((p) => {
              // Whole titles (D26), and their codes where the two read the same: "Researcher III → Researcher III".
              const [ta, tb] = [fullTitle(p.a_title), fullTitle(p.b_title)];
              const same = ta.toLowerCase() === tb.toLowerCase();
              return (
                <Table.Tr key={p.person_key} className="title-change-row" data-a-job={p.a_job ?? ''} data-b-job={p.b_job ?? ''}>
                  <Table.Td>
                    <Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`}>{fullName(p.fn, p.ln)}</Anchor>
                    <Text className="fold-under" size="xs" c="dimmed">{usd(p.a_pay)} → {usd(p.b_pay)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" className="title-change-titles">
                      {ta}{same && p.a_job ? ` (${p.a_job})` : ''} → {tb}{same && p.b_job ? ` (${p.b_job})` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="title-change-pay" data-fold>{usd(p.a_pay)} → {usd(p.b_pay)}</Table.Td>
                  <Table.Td ta="right" c={(p.delta ?? 0) >= 0 ? 'up' : 'down'} className="title-change-delta">
                    {p.delta == null ? '—' : `${p.delta >= 0 ? '+' : '−'}${usd(Math.abs(p.delta))}`}
                    {p.pct != null && <Text span size="xs" c="dimmed"> {fmtChange(p.pct)}</Text>}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>

      {(flows ?? []).length > 0 && (
        <Card withBorder padding="lg" id="changes-transitions" className="changes-section">
          <CardTitle
            mb="sm"
            right={
              <CsvButton onClick={exportFlows} disabled={!(flows ?? []).length} />
            }
          >
            Top title transitions
          </CardTitle>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>From → To title</Table.Th>
                <Table.Th ta="right">People</Table.Th>
                <Table.Th ta="right">Median pay Δ</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(flows ?? []).map((f, i) => (
                <Table.Tr key={i}>
                  <Table.Td><Text size="sm">{fullTitle(f.a_title)} → {fullTitle(f.b_title)}</Text></Table.Td>
                  <Table.Td ta="right">{num(f.n)}</Table.Td>
                  <Table.Td ta="right" c={(f.med_delta ?? 0) >= 0 ? 'up' : 'down'}>
                    {f.med_delta == null ? '—' : `${f.med_delta >= 0 ? '+' : ''}${usd(f.med_delta)}`}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <ChartData
            caption="Title transitions"
            columns={['From', 'To', 'People', 'Median pay change']}
            rows={(flows ?? []).map((f) => [f.a_title, f.b_title, f.n, f.med_delta])}
            n={(flows ?? []).reduce((s, f) => s + f.n, 0)}
            unit="people"
            period={`${fromLabel} → ${toLabel}`}
          />
        </Card>
      )}

      {movesShown.length > 0 && (
        <Card withBorder padding="lg" id="changes-moves" className="changes-section">
          <CardTitle
            mb="sm"
            sub="People who changed division between the two snapshots, the biggest changes in pay each way."
            right={movesReorg > 0 && (
              <Chip size="xs" checked={hideReorg} onChange={setHideReorg} className="moves-hide-reorg">
                Hide {num(movesReorg)} reorganization {movesReorg === 1 ? 'move' : 'moves'}
              </Chip>
            )}
          >
            Internal moves
          </CardTitle>
          {/* Gains apart from losses (D27), the reorganization's moves set aside by default: sorted by the size of
              the change, its split appointments, −$238,251 and −$196,738, led the list. */}
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {([['Moved for more', movesUp, 'moves-up'], ['Moved for less', movesDown, 'moves-down']] as const).map(([head, rows, cls]) => (
              <div key={cls} className={cls}>
                <CardTitle order={3} mb="xs">{head}</CardTitle>
                <Table>
                  <Table.Tbody>
                    {rows.map((m) => (
                      <Table.Tr key={m.person_key}>
                        <Table.Td>
                          <Anchor component={Link} to={`/person/${encodeURIComponent(m.person_key)}`}>{fullName(m.fn, m.ln)}</Anchor>
                          <Text size="xs" c="dimmed">{m.a_school ?? '—'} → {m.b_school ?? '—'}</Text>
                          {reorgMove(m.a_school, m.b_school) && <Badge size="xs" variant="light" color="gray" className="reorg-badge">Reorganization</Badge>}
                        </Table.Td>
                        <Table.Td ta="right" c={(m.delta ?? 0) >= 0 ? 'up' : 'down'}>
                          {m.delta == null ? '—' : `${m.delta >= 0 ? '+' : '−'}${usd(Math.abs(m.delta))}`}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt="xs" className="moves-note">
            A move with a large fall in pay is usually not a pay cut: part of an appointment moving while the rest stays
            behind, or a change of FTE. Open the person to see their appointments.
          </Text>
        </Card>
      )}
    </Stack>
  );
}
