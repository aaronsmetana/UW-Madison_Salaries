import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Stack, Card, Group, Select, NumberInput, Button, Table, Badge, Text, Anchor, Box, List, ScrollArea, SimpleGrid, UnstyledButton } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { IconCheck, IconDownload, IconTrendingUp } from '@tabler/icons-react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { SortableTh, type SortState } from '../components/SortableTh';
import { LoadingState } from '../components/Loading';
import { CardTitle } from '../components/CardTitle';
import { Eyebrow } from '../components/Eyebrow';
import { RaiseDistribution } from '../components/RaiseDistribution';
import { useControls } from '../state/controls';
import { useSql, useSummary, useReferenceStatus } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { usd, num, pct, fmtChange, fullName } from '../lib/format';
import { dropdownProps } from '../lib/selectProps';
import { downloadCSV } from '../lib/csv';
import { ICON } from '../lib/ui';
import { familyLabel, familySql } from '../lib/jobFamilies';
import { REPORTING_CHANGES } from '../lib/queries';
import {
  usualModesSql, usualRaises, usualCaseSql, reviewSql, titleChangesSql, accountSql, distributionSql, fmtBeyond,
  USUAL_SHARE, USUAL_MIN_N, PATTERN_MIN_N, NEAR_TITLE, AT_MINIMUM,
  type ModeRow, type ReviewRow, type TitleChangeRow, type Account, type RaiseFilters, type Usual, type Why,
} from '../lib/raiseReview';

const PAGE_SIZE = 100;

const WHY: Record<Why, { label: string; color: string; className?: string }> = {
  range: { label: 'Pay range minimum', color: 'orange', className: 'orange-light-text' },
  title: { label: 'Title-wide', color: 'accent' },
  unit: { label: 'Department-wide', color: 'pos', className: 'pos-light-text' },
  individual: { label: 'Individual', color: 'gray' },
};

/** What the explanation says of this one raise. Nothing for "Individual": the badge is all there is to say
 *  on each of up to a couple of thousand rows, and "How to read this" says what it can mean. */
function whyDetail(r: ReviewRow): string | null {
  if (r.why === 'range') return 'Brought up to the minimum of their grade’s pay range';
  if (r.why === 'title') return `${num(r.tb)} of the title’s ${num(r.tn)} raises across campus were above the usual; its median ${fmtChange(r.tmed)}`;
  if (r.why === 'unit') return `${num(r.ub)} of ${num(r.un)} raises in ${r.department ?? 'the department'} were above the usual, title-wide adjustments aside`;
  return null;
}

/** A school and department together, the department once when it carries its school's own name. */
const unitName = (school: string | null, dept: string | null) => [school, dept && dept !== school ? dept : null].filter(Boolean).join(' · ') || '—';

/** A change of title, with the codes when the name stayed the same: "Researcher III (RE103) → Researcher III (RE104)". */
function titleMove(r: TitleChangeRow): string {
  const same = r.title_from != null && r.title_from === r.title_to;
  const side = (t: string | null, c: string | null) => `${t ?? '—'}${same && c ? ` (${c})` : ''}`;
  return `${side(r.title_from, r.code_from)} → ${side(r.title_to, r.code_to)}`;
}

/** A title-wide adjustment or a department-wide pattern, as one line of the Patterns card. */
interface Pattern { key: string; label: string; detail: string; n: number; go: Record<string, string | null> }
const PATTERN_ROWS = 6;
const WHYS: readonly Why[] = ['title', 'unit', 'range', 'individual'];

/** How a category's usual raise was found, as the line under the controls says it. */
function howText(u: Usual): string {
  if (u.how === 'mode') return `${Math.round((u.share ?? 0) * 100)}% got exactly this`;
  if (u.how === 'median') return 'no one raise most got; their median';
  if (u.how === 'campus') return `under ${USUAL_MIN_N} raises, so campus’s`;
  return 'as you set it';
}

type ReviewSort = 'name' | 'title' | 'school' | 'pay' | 'raise' | 'beyond';
type ChangeSort = 'name' | 'title' | 'pay' | 'change';

export default function Raises() {
  const { metric } = useControls();
  const { data: summary } = useSummary();
  const { data: ref } = useReferenceStatus();
  // The Pre-TTC twin shares its date with the Post-TTC one and is never a step (queries `continuingRaisesSql`).
  const snaps = useMemo(() => (summary?.snapshots ?? []).filter((s) => !s.id.endsWith('-pre')), [summary]);
  const at = (id: string | null) => snaps.findIndex((s) => s.id === id);

  // The run lives in the URL, as every view here does: a comparison is a link to send.
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) if (v == null || v === '') n.delete(k); else n.set(k, v);
      return n;
    }, { replace: true });

  // Two snapshots, From the earlier: the two newest unless the URL says otherwise.
  const toIdx = at(params.get('to')) > 0 ? at(params.get('to')) : snaps.length - 1;
  const fromIdx = at(params.get('from')) >= 0 && at(params.get('from')) < toIdx ? at(params.get('from')) : toIdx - 1;
  const from = fromIdx >= 0 ? snaps[fromIdx].id : null;
  const to = toIdx > 0 ? snaps[toIdx].id : null;
  const fromLabel = snaps[fromIdx]?.label ?? '—';
  const toLabel = snaps[toIdx]?.label ?? '—';

  const school = params.get('sch');
  const filters: RaiseFilters = {
    school,
    department: school ? params.get('dept') : null,
    jobCode: params.get('title'),
    family: params.get('family'),
  };
  const filterKey = JSON.stringify(filters);
  const baseParam = params.get('base');
  const set = baseParam != null && baseParam !== '' && Number.isFinite(Number(baseParam)) ? Number(baseParam) / 100 : null;
  // The box edits freely and the run follows once typing pauses: "2.5" is one query, not three.
  const [baseDraft, setBaseDraft] = useState<string | number>(set == null ? '' : Math.round(set * 1000) / 10);
  useEffect(() => { setBaseDraft(set == null ? '' : Math.round(set * 1000) / 10); }, [set]);
  const pushBase = useDebouncedCallback((v: string | number) => { update({ base: v === '' ? null : String(v) }); setShowAll(false); }, 400);
  // Which explanation the list is narrowed to (the summary's badges), or all of them.
  const whyParam = params.get('why');
  const whyOnly = WHYS.includes(whyParam as Why) ? (whyParam as Why) : null;

  const ready = !!from && !!to;
  const pair = { metric, from: from ?? '', to: to ?? '' };

  // What the pickers offer: where people are at the later snapshot, which is where the filters look.
  const T = sqlStr(to ?? '');
  const { data: schoolOpts } = useSql<{ school: string }>(
    ['raises-schools', to], `SELECT DISTINCT school FROM salaries WHERE snapshot_id = ${T} AND salary > 0 AND school IS NOT NULL ORDER BY school`, ready);
  const { data: deptOpts } = useSql<{ department: string }>(
    ['raises-depts', to, school],
    `SELECT DISTINCT department FROM salaries WHERE snapshot_id = ${T} AND salary > 0 AND school = ${sqlStr(school ?? '')} AND department IS NOT NULL ORDER BY department`,
    ready && !!school);
  const { data: titleOpts } = useSql<{ code: string; title: string; n: number }>(
    ['raises-titles', to],
    `SELECT job_code code, arg_max(title, salary) title, count(DISTINCT person_key) n FROM salaries
     WHERE snapshot_id = ${T} AND salary > 0 AND job_code IS NOT NULL GROUP BY job_code ORDER BY title, code`, ready);
  const { data: familyOpts } = useSql<{ code: string; top: string; n: number }>(
    ['raises-families', to],
    `WITH t AS (SELECT ${familySql('job_code')} code, title, count(DISTINCT person_key) n FROM salaries
       WHERE snapshot_id = ${T} AND salary > 0 GROUP BY 1, 2)
     SELECT code, arg_max(title, n) top, sum(n)::BIGINT n FROM t WHERE code IS NOT NULL GROUP BY code ORDER BY code`, ready);

  const { data: modes } = useSql<ModeRow>(['raises-modes', from, to, metric], usualModesSql(pair), ready);
  const usual = useMemo(() => (modes ? usualRaises(modes, set) : null), [modes, set]);
  const usualKey = usual ? usualCaseSql(usual, 'cat') : '';
  // HR publishes only its current ranges, released with one snapshot: a range minimum says something only
  // of a pair that ends there.
  const ranges = !!ref && ref.status !== 'missing' && !!ref.released_with && ref.released_with === to;
  const rangesLabel = snaps.find((s) => s.id === ref?.released_with)?.label ?? null;

  const { data: rows, isFetching: loadingRows } = useSql<ReviewRow>(
    ['raises-review', from, to, metric, filterKey, usualKey, ranges],
    usual ? reviewSql({ ...pair, usual, filters, ranges }) : 'SELECT 1', ready && !!usual);
  const { data: changes } = useSql<TitleChangeRow>(['raises-changes', from, to, metric, filterKey], titleChangesSql({ ...pair, filters }), ready);
  const { data: accountRows } = useSql<Account>(['raises-account', from, to, metric, filterKey], accountSql({ ...pair, filters }), ready);
  const { data: bins } = useSql<{ bucket: number; n: number }>(['raises-dist', from, to, metric, filterKey], distributionSql({ ...pair, filters }), ready);
  const account = accountRows?.[0];

  const counts = useMemo(() => {
    const c: Record<Why, number> = { range: 0, title: 0, unit: 0, individual: 0 };
    for (const r of rows ?? []) c[r.why]++;
    return c;
  }, [rows]);

  const [sort, setSort] = useState<SortState<ReviewSort>>({ key: 'beyond', dir: 'desc' });
  const sorted = useMemo(() => {
    const val = (r: ReviewRow) =>
      sort.key === 'name' ? fullName(r.fn, r.ln)
      : sort.key === 'title' ? (r.title ?? '')
      : sort.key === 'school' ? `${r.school ?? ''} ${r.department ?? ''}`
      : sort.key === 'pay' ? r.pay_to
      : sort.key === 'raise' ? r.r
      : r.r - r.usual;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return (rows ?? []).filter((r) => !whyOnly || r.why === whyOnly).sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return dir * cmp || a.person_key.localeCompare(b.person_key);
    });
  }, [rows, sort, whyOnly]);

  // The patterns behind the list, one line each: every title-wide adjustment and department-wide pattern among
  // these rows, largest first. Each narrows the page to its title, or its department.
  const patterns = useMemo(() => {
    const title = new Map<string, Pattern>();
    const unit = new Map<string, Pattern>();
    for (const r of rows ?? []) {
      if (r.why === 'title') {
        const p = title.get(r.job_code) ?? { key: r.job_code, label: r.title ?? r.job_code, n: 0, go: { title: r.job_code },
          detail: `${num(r.tb)} of ${num(r.tn)} raises across campus above the usual, median ${fmtChange(r.tmed)}` };
        p.n++;
        title.set(r.job_code, p);
      } else if (r.why === 'unit') {
        const k = `${r.school ?? ''}|${r.department ?? ''}`;
        const p = unit.get(k) ?? { key: k, label: r.department ?? '—', n: 0, go: { sch: r.school, dept: r.department, title: null, family: null },
          detail: `${r.school && r.school !== r.department ? `${r.school} · ` : ''}${num(r.ub)} of ${num(r.un)} raises above the usual, title-wide adjustments aside` };
        p.n++;
        unit.set(k, p);
      }
    }
    const order = (m: Map<string, Pattern>) => [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    return { title: order(title), unit: order(unit) };
  }, [rows]);
  const [allPatterns, setAllPatterns] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const [changeSort, setChangeSort] = useState<SortState<ChangeSort>>({ key: 'change', dir: 'desc' });
  const changesSorted = useMemo(() => {
    const val = (r: TitleChangeRow) =>
      changeSort.key === 'name' ? fullName(r.fn, r.ln)
      : changeSort.key === 'title' ? (r.title_to ?? '')
      : changeSort.key === 'pay' ? r.pay_to
      : r.rate_to / r.rate_from - 1;
    const dir = changeSort.dir === 'asc' ? 1 : -1;
    return [...(changes ?? [])].sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return dir * cmp || a.person_key.localeCompare(b.person_key);
    });
  }, [changes, changeSort]);
  const [showAllChanges, setShowAllChanges] = useState(false);

  const scopeText = filters.department ? ` in ${filters.department}` : filters.school ? ` in ${filters.school}` : '';
  const narrowed = [
    filters.jobCode && (titleOpts?.find((t) => t.code === filters.jobCode)?.title ?? filters.jobCode),
    filters.family && familyLabel(filters.family),
  ].filter(Boolean).join(', ');
  const who = `${scopeText}${narrowed ? ` (${narrowed})` : ''}`;
  const fileTag = [from, to, filters.school, filters.department, filters.jobCode, filters.family].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');

  const exportRows = () => downloadCSV(`uw-raises-above-usual-${fileTag}${whyOnly ? `-${whyOnly}` : ''}.csv`, sorted.map((r) => ({
    name: fullName(r.fn, r.ln), title: r.title ?? '', job_code: r.job_code, school: r.school ?? '', department: r.department ?? '',
    category: r.cat, pay_from: Math.round(r.pay_from), pay_to: Math.round(r.pay_to), raise: fmtChange(r.r), usual_raise: fmtChange(r.usual),
    above_usual: fmtBeyond(r.r, r.usual), explanation: WHY[r.why].label, detail: whyDetail(r) ?? '',
  })));
  const exportChanges = () => downloadCSV(`uw-title-changes-${fileTag}.csv`, changesSorted.map((r) => ({
    name: fullName(r.fn, r.ln), title_from: r.title_from ?? '', title_to: r.title_to ?? '', job_code_from: r.code_from ?? '', job_code_to: r.code_to ?? '',
    school: r.school ?? '', department: r.department ?? '', pay_from: Math.round(r.pay_from), pay_to: Math.round(r.pay_to),
    rate_change: fmtChange(r.rate_to / r.rate_from - 1), fte_from: r.fte_from, fte_to: r.fte_to,
  })));

  const opts = snaps.map((s) => ({ value: s.id, label: s.label }));
  const noPlan = usual && usual.campus.how !== 'set' && usual.campus.usual === 0;
  // A reporting change the pair spans (9-month pay since Sep 2025): its people are among the changes of basis.
  const spans = REPORTING_CHANGES.filter((c) => from && to && (snaps[fromIdx]?.date ?? '') < c.since && (snaps[toIdx]?.date ?? '') >= c.since);
  const notCompared = account ? account.paid_both - account.same_job - account.changed_title : 0;
  const other = account ? notCompared - account.several - account.fte_changed - account.basis_changed : 0;

  return (
    <Stack gap="lg">
      <PageHeader title="Raises" description="Who got more than the usual raise between two snapshots, and what may explain it." />

      <Card withBorder padding="lg" className="raise-controls">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select {...dropdownProps('sm')} w={150} label="From" data={opts.slice(0, -1)} value={from} allowDeselect={false}
            onChange={(v) => { const i = at(v); update({ from: v, to: i >= toIdx ? snaps[i + 1]?.id ?? null : to }); setShowAll(false); }} />
          <Select {...dropdownProps('sm')} w={150} label="To" data={opts.slice(fromIdx + 1)} value={to} allowDeselect={false}
            onChange={(v) => { update({ to: v }); setShowAll(false); }} />
          <Select {...dropdownProps('sm')} w={230} label="School / division" placeholder="All schools" searchable clearable
            data={(schoolOpts ?? []).map((s) => s.school)} value={school}
            onChange={(v) => { update({ sch: v, dept: null }); setShowAll(false); }} />
          <Select {...dropdownProps('sm')} w={230} label="Department" placeholder={school ? 'All departments' : 'Choose a school first'}
            disabled={!school} searchable clearable data={(deptOpts ?? []).map((d) => d.department)} value={filters.department ?? null}
            onChange={(v) => { update({ dept: v }); setShowAll(false); }} />
          <Select {...dropdownProps('sm')} w={230} label="Title" placeholder="All titles" searchable clearable limit={60}
            data={(titleOpts ?? []).map((t) => ({ value: t.code, label: `${t.title} · ${t.code}` }))} value={filters.jobCode ?? null}
            onChange={(v) => { update({ title: v }); setShowAll(false); }} />
          <Select {...dropdownProps('sm')} w={230} label="Title category" placeholder="All categories" searchable clearable
            data={(familyOpts ?? []).map((f) => ({ value: f.code, label: familyLabel(f.code, f.top) }))} value={filters.family ?? null}
            onChange={(v) => { update({ family: v }); setShowAll(false); }} />
        </Group>

        <Box mt="md" className="raise-usual" data-usual-campus={usual?.campus.usual ?? ''} data-usual-how={usual?.campus.how ?? ''}>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <NumberInput
              size="xs" label="Count raises above" description="Blank: each category’s usual raise, found below" w={220}
              suffix="%" decimalScale={1} step={0.5} min={-50} max={100} placeholder="the usual raise"
              value={baseDraft}
              onChange={(v) => { setBaseDraft(v); pushBase(v); }}
            />
            {set != null && (
              <Button variant="subtle" size="xs" onClick={() => { setBaseDraft(''); update({ base: null }); }}>Use the usual raise found in the data</Button>
            )}
          </Group>
          {usual && (
            <Text size="sm" mt="sm" className="raise-usual-line">
              <b>Usual raise, {fromLabel} → {toLabel}:</b>{' '}
              {usual.cats.map((c, i) => (
                <span key={c.cat} className="raise-usual-cat" data-cat={c.cat ?? ''} data-usual={c.usual} data-how={c.how}>
                  {i > 0 ? ' · ' : ''}{c.cat} <b>{fmtChange(c.usual)}</b> <Text span size="sm" c="dimmed">({howText(c)})</Text>
                </span>
              ))}
            </Text>
          )}
        </Box>
      </Card>

      {!ready || !modes ? (
        <LoadingState label="Reading the raises…" />
      ) : !usual ? (
        <EmptyState icon={<IconTrendingUp size={ICON.feature} />} title="No one kept the same job between these snapshots"
          hint="Pick two snapshots with people in the same job in both." />
      ) : (
        <>
          <Card withBorder padding="lg" className="raise-summary"
            data-same-job={account?.same_job ?? ''} data-above={rows?.length ?? ''} data-paid-both={account?.paid_both ?? ''}>
            {account && rows && (
              <Text size="lg" fw={600}>
                Of {num(account.same_job)} people who stayed in the same job{who}, {num(rows.length)}
                {account.same_job ? ` (${pct(rows.length / account.same_job, 0)})` : ''} got more than the usual raise.
              </Text>
            )}
            {noPlan && (
              <Text size="sm" mt={4} className="raise-no-plan">
                Most people’s pay didn’t change between these snapshots, so the usual raise is 0%: every raise here is above it.
              </Text>
            )}
            {rows && rows.length > 0 && (
              <Group gap="xs" mt="sm" className="raise-why-counts">
                {WHYS.filter((w) => counts[w] > 0).map((w) => (
                  <Badge key={w} component="button" type="button" variant="light" color={WHY[w].color} data-why={w}
                    className={`raise-why-filter${WHY[w].className ? ` ${WHY[w].className}` : ''}`} style={{ cursor: 'pointer' }}
                    aria-pressed={whyOnly === w} leftSection={whyOnly === w ? <IconCheck size={12} /> : undefined}
                    onClick={() => { update({ why: whyOnly === w ? null : w }); setShowAll(false); }}>
                    {WHY[w].label} · {num(counts[w])}
                  </Badge>
                ))}
                {whyOnly && <Button variant="subtle" size="compact-xs" onClick={() => update({ why: null })}>Show every explanation</Button>}
              </Group>
            )}
          </Card>

          {(patterns.title.length > 0 || patterns.unit.length > 0) && (
            <Card withBorder padding="lg" className="raise-patterns">
              <CardTitle mb={4}>Patterns</CardTitle>
              <Text size="sm" c="dimmed" mb="sm">
                Raises above the usual that most of a title, or of a department, got. Pick one to see its people.
              </Text>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                {([['title', 'Title-wide adjustments', patterns.title], ['unit', 'Department-wide', patterns.unit]] as const).filter(([, , list]) => list.length > 0).map(([kind, head, list]) => (
                  <Box key={kind} className={`raise-patterns-${kind}`}>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>{head}</Text>
                    <Stack gap={6}>
                      {(allPatterns ? list : list.slice(0, PATTERN_ROWS)).map((p) => (
                        <UnstyledButton key={p.key} className="raise-pattern" data-key={p.key} data-n={p.n}
                          onClick={() => { update({ ...p.go, why: null }); setShowAll(false); }}>
                          <Text size="sm"><Text span fw={600} c="var(--text-accent)" td="underline">{p.label}</Text>{filters.jobCode || filters.department ? '' : ` · ${num(p.n)} listed`}</Text>
                          <Text size="xs" c="dimmed">{p.detail}</Text>
                        </UnstyledButton>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </SimpleGrid>
              {!allPatterns && (patterns.title.length > PATTERN_ROWS || patterns.unit.length > PATTERN_ROWS) && (
                <Button mt="sm" variant="subtle" size="xs" onClick={() => setAllPatterns(true)}>Show every pattern</Button>
              )}
            </Card>
          )}

          <RaiseDistribution
            counts={bins}
            marker={usual.campus ? { value: usual.campus.usual, label: 'usual', name: 'usual raise across campus' } : null}
            title={`Raises${who}, ${fromLabel} → ${toLabel}`}
            sub="People in the same job at the same FTE in both snapshots."
            period={`${fromLabel} → ${toLabel}`}
            className="raise-review-dist"
          />

          <Card withBorder padding={0} className="raise-above">
            <Group justify="space-between" p="md" pb="xs" wrap="wrap" gap="sm">
              <CardTitle mb={0}>More than the usual raise{whyOnly ? `: ${WHY[whyOnly].label}` : ''}</CardTitle>
              <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.inline} />} onClick={exportRows} disabled={!sorted.length}>CSV</Button>
            </Group>
            {loadingRows && !rows ? <LoadingState label="Finding who got more…" /> : !sorted.length ? (
              <Text size="sm" c="dimmed" px="md" pb="md">No one here got more than the usual raise.</Text>
            ) : (
              <ScrollArea.Autosize mah={720} type="auto">
                <Table stickyHeader striped miw={960} className="fold-table raise-above-table">
                  <Table.Thead>
                    <Table.Tr>
                      <SortableTh sortKey="name" label="Name" sort={sort} onSort={setSort} />
                      <SortableTh sortKey="title" label="Title" sort={sort} onSort={setSort} fold />
                      <SortableTh sortKey="school" label="School · department" sort={sort} onSort={setSort} fold />
                      <SortableTh sortKey="pay" label="Pay" sort={sort} onSort={setSort} align="right" fold />
                      <SortableTh sortKey="raise" label="Raise" sort={sort} onSort={setSort} align="right" />
                      <SortableTh sortKey="beyond" label="Above usual" sort={sort} onSort={setSort} align="right" />
                      <Table.Th data-fold>Explanation</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(showAll ? sorted : sorted.slice(0, PAGE_SIZE)).map((r) => (
                      <Table.Tr key={r.person_key} data-person={r.person_key} data-why={r.why}>
                        <Table.Td>
                          <Anchor component={Link} to={`/person/${encodeURIComponent(r.person_key)}`}>{fullName(r.fn, r.ln)}</Anchor>
                          <Text className="fold-under" size="xs" c="dimmed" lineClamp={3}>
                            {r.title} · {usd(r.pay_from)} → {usd(r.pay_to)} · {WHY[r.why].label}
                          </Text>
                        </Table.Td>
                        <Table.Td data-fold>
                          <Text size="sm" lineClamp={2}>{r.title ?? '—'}</Text>
                          <Text size="xs" c="dimmed">{r.cat}</Text>
                        </Table.Td>
                        <Table.Td data-fold><Text size="sm" lineClamp={2}>{unitName(r.school, r.department)}</Text></Table.Td>
                        <Table.Td ta="right" data-fold style={{ whiteSpace: 'nowrap' }}>{usd(r.pay_from)} → {usd(r.pay_to)}</Table.Td>
                        <Table.Td ta="right" className="raise-cell">{fmtChange(r.r)}</Table.Td>
                        <Table.Td ta="right" className="raise-above-cell" style={{ whiteSpace: 'nowrap' }}>
                          {fmtBeyond(r.r, r.usual)}
                          <Text size="xs" c="dimmed">usual {fmtChange(r.usual)}</Text>
                        </Table.Td>
                        <Table.Td data-fold>
                          <Badge size="sm" variant="light" color={WHY[r.why].color} className={WHY[r.why].className}>{WHY[r.why].label}</Badge>
                          {r.why !== 'individual' && <Text size="xs" c="dimmed" mt={2} lineClamp={2} className="raise-why-detail">{whyDetail(r)}</Text>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            {!showAll && sorted.length > PAGE_SIZE && (
              <Group justify="center" p="md"><Button variant="default" onClick={() => setShowAll(true)}>Show all {num(sorted.length)}</Button></Group>
            )}
          </Card>

          <Card withBorder padding={0} className="raise-title-changes" data-count={changes?.length ?? ''}>
            <Group justify="space-between" p="md" pb={4} wrap="wrap" gap="sm">
              <CardTitle mb={0}>Changed title</CardTitle>
              <Button size="xs" variant="default" leftSection={<IconDownload size={ICON.inline} />} onClick={exportChanges} disabled={!changesSorted.length}>CSV</Button>
            </Group>
            <Text size="sm" c="dimmed" px="md" pb="xs">
              A promotion or a reclassification: a new job code between these snapshots, with one appointment on each
              side. Not a raise in the same job, so not counted above.
            </Text>
            {!changes ? <LoadingState label="Finding title changes…" /> : !changesSorted.length ? (
              <Text size="sm" c="dimmed" px="md" pb="md">No one here changed title.</Text>
            ) : (
              <ScrollArea.Autosize mah={560} type="auto">
                <Table stickyHeader striped miw={820} className="fold-table raise-changes-table">
                  <Table.Thead>
                    <Table.Tr>
                      <SortableTh sortKey="name" label="Name" sort={changeSort} onSort={setChangeSort} />
                      <SortableTh sortKey="title" label="Title, from → to" sort={changeSort} onSort={setChangeSort} fold />
                      <SortableTh sortKey="pay" label="Pay" sort={changeSort} onSort={setChangeSort} align="right" fold />
                      <SortableTh sortKey="change" label="Rate change" tip="The change in the full-time rate, so a change of FTE with the new title doesn’t read as a raise or a cut." sort={changeSort} onSort={setChangeSort} align="right" />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(showAllChanges ? changesSorted : changesSorted.slice(0, PAGE_SIZE)).map((r) => {
                      const fte = Math.abs(r.fte_from - r.fte_to) > 0.005 ? ` · FTE ${r.fte_from.toFixed(2)} → ${r.fte_to.toFixed(2)}` : '';
                      return (
                        <Table.Tr key={r.person_key} data-person={r.person_key}>
                          <Table.Td>
                            <Anchor component={Link} to={`/person/${encodeURIComponent(r.person_key)}`}>{fullName(r.fn, r.ln)}</Anchor>
                            <Text className="fold-under" size="xs" c="dimmed" lineClamp={3}>{titleMove(r)}{fte}</Text>
                          </Table.Td>
                          <Table.Td data-fold>
                            <Text size="sm" lineClamp={2}>{titleMove(r)}</Text>
                            <Text size="xs" c="dimmed">{unitName(r.school, r.department)}{fte}</Text>
                          </Table.Td>
                          <Table.Td ta="right" data-fold style={{ whiteSpace: 'nowrap' }}>{usd(r.pay_from)} → {usd(r.pay_to)}</Table.Td>
                          <Table.Td ta="right">{fmtChange(r.rate_to / r.rate_from - 1)}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            {!showAllChanges && changesSorted.length > PAGE_SIZE && (
              <Group justify="center" p="md"><Button variant="default" onClick={() => setShowAllChanges(true)}>Show all {num(changesSorted.length)}</Button></Group>
            )}
          </Card>

          {account && (
            <Card withBorder padding="lg" className="raise-account"
              data-several={account.several} data-fte={account.fte_changed} data-basis={account.basis_changed} data-other={other} data-changed-title={account.changed_title}>
              <CardTitle mb="xs">Everyone paid in both snapshots{who}: {num(account.paid_both)}</CardTitle>
              <Text size="sm">
                {num(account.same_job)} stayed in the same job, above; {num(account.changed_title)} changed title, above; and{' '}
                {num(notCompared)} are not compared, because a change in their pay would not be a raise:
              </Text>
              <List size="sm" mt={4} spacing={2}>
                <List.Item><b>{num(account.fte_changed)}</b> changed FTE in the same job: their pay moved with the appointment.</List.Item>
                <List.Item><b>{num(account.several)}</b> held more than one paid appointment on a side: the records can’t say which one a change belongs to.</List.Item>
                <List.Item><b>{num(account.basis_changed)}</b> changed pay basis in the same job{spans.map((c) => `, among them ${c.note} from ${c.sinceLabel}`).join('')}.</List.Item>
                {other > 0 && <List.Item><b>{num(other)}</b> had no job code or no pay to compare on one side.</List.Item>}
              </List>
            </Card>
          )}
        </>
      )}

      <Card withBorder padding="lg" className="raise-how">
        <CardTitle mb="xs">How to read this</CardTitle>
        <Stack gap="xs">
          <Text size="sm">
            <b>A raise</b> is a change in pay for someone in the same job at the same FTE, on the same pay basis, with one
            paid appointment in each snapshot — what a raise means everywhere on this site. (The source began calling
            hourly pay “12 Month” in Sep 2025; that is the same basis.) A change of title is listed
            apart; the rest are counted under “Everyone paid in both snapshots”.
          </Text>
          <Text size="sm">
            <b>The usual raise</b> is the raise most people in an employee category got: the pay plan’s step, read to a
            tenth of a percent. It is read across campus whatever you filter to, because a school or department doesn’t
            set the pay plan. Where no one raise went to {Math.round(USUAL_SHARE * 100)}% of a category, its median stands
            in; a category with under {USUAL_MIN_N} raises takes campus’s. Across more than one step the usual raise
            compounds: 3% then 2% is +5.1%. You can set your own above.
          </Text>
          <Box>
            <Eyebrow mb={4}>What may explain a raise above the usual, in this order</Eyebrow>
            <List size="sm" spacing={4}>
              <List.Item><b>Pay range minimum:</b> below their grade’s minimum before, at it after (within {pct(AT_MINIMUM, 1)}, to HR’s rounding).
                {ranges ? '' : ` HR publishes only its current ranges${rangesLabel ? `, released with ${rangesLabel}` : ''}, so this is read only for a pair that ends there.`}</List.Item>
              <List.Item><b>Title-wide:</b> at least half of the title’s raises across campus ({PATTERN_MIN_N} or more) were above the usual, and this one is within {Math.round(NEAR_TITLE * 100)} point of the title’s median.</List.Item>
              <List.Item><b>Department-wide:</b> at least half of the department’s raises ({PATTERN_MIN_N} or more) were above the usual, leaving out those a range minimum or a title-wide adjustment already explains — so one title’s adjustment doesn’t make a pattern of its department.</List.Item>
              <List.Item><b>Individual:</b> none of these. Merit, equity, retention or a counter-offer — the records don’t say which.</List.Item>
            </List>
          </Box>
          <Text size="sm" c="dimmed">
            The public records carry no reasons, so every explanation here is an inference from the pattern. People are
            matched across snapshots by name, and filters look at where each person is in the later snapshot.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
