import { Fragment, useMemo, useState } from 'react';
import { ShowAll, useShowAll } from './ShowAll';
import { Stack, Card, Text, Group, Table, Badge, Anchor, ScrollArea, TextInput, Alert, ActionIcon, Skeleton, VisuallyHidden } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useSql, useGrades, useSearchIndex } from '../lib/hooks';
import { closeMatches } from '../lib/search';
import { sqlStr } from '../lib/duckdb';
import { personPay, peopleSql, mainOf } from '../lib/queries';
import { usd, num, fullName, fmtYears, hourly } from '../lib/format';
import { METRIC_LABEL, type Metric } from '../state/controls';
import { useTray } from '../state/tray';
import { bandFor, isRange } from '../lib/bands';
import { PayBandNote } from './PayBandNote';
import { CardTitle } from './CardTitle';
import { TrayButton } from './TrayButton';
import { SortableTh, type SortState } from './SortableTh';
import { GLOSSARY } from '../lib/glossary';
import { ChartSkeleton } from './Loading';
import { SalaryHistogram } from './SalaryHistogram';
import { HourlyTag, HOURLY_TITLE } from './HourlyTag';
import { StatCard, StatRow } from './StatCard';
import { ICON } from '../lib/ui';
import { MiniRange } from './MiniRange';
import { rangeScale } from '../lib/rangeScale';
import { MIN_GROUP } from '../lib/stats';
import { fmtK } from '../lib/chartStyle';
import { FoldRow, useFolded } from './FoldRow';


/** The loading distribution card's chart block: the histogram (284px) and its footer of controls, so the
 *  card is the loaded one's height. */
const DIST_LOADING_H = 322;

/** The title's figures: its median leads, the two spreads beside it from `md` up; a pinned salary is a fourth (T11). */
const TITLE_COLS = { base: 1, md: '1.4fr 1fr 1fr' };
const TITLE_COLS_PINNED = { base: 1, sm: 2, md: '1.3fr 1fr 1fr 1.3fr' };

function Stat({ label, value }: { label: string; value: string }) {
  return <StatCard size="sm" label={label} value={value} />;
}

interface StatsRow { title: string | null; n: number; med: number | null; p25: number | null; p75: number | null; lo: number | null; hi: number | null; hourly_share: number | null }
interface PersonRow { person_key: string; fn: string | null; ln: string | null; school: string | null; department: string | null; tenure: number | null; fte: number | null; pay: number }
type PeopleSortKey = 'name' | 'school' | 'tenure' | 'salary';
interface SchoolRow { school: string; n: number; med: number | null; lo: number | null; p25: number | null; p75: number | null; hi: number | null }
interface PctRow { scope: string; pct: number; n: number }

/**
 * Everything-about-a-title view, rendered by the Search-Title-Salaries explorer (`/titles`, with a
 * title picker + optional school filter + optional salary pin). The legacy `/title/:code` URL now
 * redirects here. Title selection drives the whole view; `pinSalary` only adds the "where it lands"
 * markers/percentile.
 */
export function TitleStats({ jobCode, snap, metric, school = null, pinSalary = null }: {
  jobCode: string;
  snap: string;
  metric: Metric;
  school?: string | null;
  pinSalary?: number | null;
}) {
  const nav = useNavigate();
  const { add, has, remove } = useTray();
  const { data: grades } = useGrades();
  const enabled = !!snap && !!jobCode;
  const pinned = pinSalary != null && Number.isFinite(pinSalary) && pinSalary > 0;
  /** What each figure here is: the measure in force (G2), never a bare "Salary". */
  const measure = METRIC_LABEL[metric];

  const titleBase = `snapshot_id = ${sqlStr(snap)} AND job_code = ${sqlStr(jobCode)}`; // all schools
  const base = school ? `${titleBase} AND school = ${sqlStr(school)}` : titleBase;       // scoped to filter

  const { data: statRows, isLoading } = useSql<StatsRow>(
    ['ts-stats', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, ${mainOf('title')} title, ${personPay(metric)} pay,
        bool_and(coalesce(fte, 0) = 0) FILTER (WHERE salary > 0) hr FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT any_value(title) title, count(*) FILTER (WHERE pay > 0) n,
        avg(CASE WHEN hr THEN 1.0 ELSE 0.0 END) FILTER (WHERE pay > 0) hourly_share,
        median(pay) FILTER (WHERE pay > 0) med, quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
        quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75, min(pay) FILTER (WHERE pay > 0) lo,
        max(pay) FILTER (WHERE pay > 0) hi FROM pp`,
    enabled
  );
  const s = statRows?.[0];

  const { data: payRows } = useSql<{ pay: number }>(
    ['ts-pays', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT pay FROM pp WHERE pay > 0`,
    enabled
  );
  const pays = useMemo(() => (payRows ?? []).map((r) => r.pay), [payRows]);

  const { data: peopleRows } = useSql<PersonRow>(
    ['ts-people', jobCode, snap, school ?? '', metric],
    `WITH pp AS (SELECT person_key, any_value(first_name) fn, any_value(last_name) ln,
        any_value(school) school, any_value(department) department,
        date_diff('day', CAST(any_value(date_of_hire) AS DATE), CAST(any_value(snapshot_date) AS DATE)) / 365.25 AS tenure,
        ${personPay(metric)} pay, nullif(sum(fte) FILTER (WHERE salary > 0), 0) fte
        FROM salaries WHERE ${base} GROUP BY person_key)
     SELECT person_key, fn, ln, school, department, tenure, fte, pay FROM pp WHERE pay > 0 ORDER BY pay DESC`,
    enabled
  );
  const people = useMemo(() => peopleRows ?? [], [peopleRows]);

  const { data: everTitle } = useSql<{ n: number }>(['ts-ever', jobCode], `SELECT count(*) n FROM salaries WHERE job_code = ${sqlStr(jobCode)}`, !!jobCode);
  const { data: index } = useSearchIndex(!!jobCode);
  const { data: bySchool } = useSql<SchoolRow>(
    ['ts-school', jobCode, snap, metric],
    `WITH pe AS (${peopleSql({ metric, where: `${titleBase} AND school IS NOT NULL`, by: ['school'] })})
     SELECT school, count(*) FILTER (WHERE pay > 0) n, median(pay) FILTER (WHERE pay > 0) med,
            min(pay) FILTER (WHERE pay > 0) lo, quantile_cont(pay, 0.25) FILTER (WHERE pay > 0) p25,
            quantile_cont(pay, 0.75) FILTER (WHERE pay > 0) p75, max(pay) FILTER (WHERE pay > 0) hi
     FROM pe GROUP BY school ORDER BY n DESC`,
    enabled
  );
  // One scale for every school's spread, as the Schools table draws its own.
  const schoolScale = useMemo(() => rangeScale((bySchool ?? []).filter((r) => r.n >= MIN_GROUP).map((r) => r.p75)), [bySchool]);

  const { data: pct } = useSql<PctRow>(
    ['ts-pct', jobCode, snap, school ?? '', pinSalary ?? 0, metric],
    // "Paid more than" these people: the share paid strictly less, as a person's own standing is counted.
    `WITH pp AS (SELECT person_key, ${personPay(metric)} pay, any_value(school) school FROM salaries WHERE ${titleBase} GROUP BY person_key)
     SELECT 'title' AS "scope", round(100.0 * avg(CASE WHEN pay < ${pinSalary ?? 0} THEN 1 ELSE 0 END), 1) pct, count(*) n FROM pp WHERE pay > 0
     ${school ? `UNION ALL SELECT 'title_school' AS "scope", round(100.0 * avg(CASE WHEN pay < ${pinSalary ?? 0} THEN 1 ELSE 0 END), 1) pct, count(*) n FROM pp WHERE pay > 0 AND school = ${sqlStr(school)}` : ''}`,
    enabled && pinned
  );
  const titleRow = pct?.find((r) => r.scope === 'title');
  const schoolRow = pct?.find((r) => r.scope === 'title_school');

  // The title's grade (its most common, where appointments differ). Its band is drawn under the distribution, on
  // the distribution's own scale (T8); the title's median is the figures' and the histogram's, said once (T10).
  const { data: gradeRow } = useSql<{ grade_number: number; grade_basis: string; comp_basis: string | null }>(
    ['ts-grade', jobCode, snap],
    `SELECT grade_number, grade_basis, any_value(comp_basis) comp_basis
     FROM salaries WHERE ${titleBase} AND grade_number IS NOT NULL AND salary > 0
     GROUP BY grade_number, grade_basis ORDER BY count(*) DESC, grade_number LIMIT 1`,
    enabled
  );
  const g = gradeRow?.[0];
  const band = g ? bandFor(grades, g.grade_number, g.grade_basis, g.comp_basis) : null;

  // Where an entered salary would rank within the (scoped) title population.
  const rank = useMemo(() => {
    if (!pinned || !pays.length) return null;
    return pays.filter((p) => p > pinSalary!).length + 1;
  }, [pinned, pays, pinSalary]);

  const [q, setQ] = useState('');
  // Clicking a histogram bar filters the list below to that salary range (persists across a title/school
  // change the same way the name search above already does, since this component isn't remounted then).
  const [binFilter, setBinFilter] = useState<{ lo: number; hi: number } | null>(null);
  const [peopleSort, setPeopleSort] = useState<SortState<PeopleSortKey>>({ key: 'salary', dir: 'desc' });
  const folded = useFolded();
  // Pay rank is anchored to the underlying pay-desc query order, independent of the table's current
  // display sort — "#12" always means "12th highest pay for this title," not "12th row shown."
  const payRank = useMemo(() => new Map(people.map((p, i) => [p.person_key, i + 1])), [people]);
  const filteredPeople = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = people
      .filter((p) => !t || fullName(p.fn, p.ln).toLowerCase().includes(t))
      .filter((p) => !binFilter || (p.pay >= binFilter.lo && p.pay <= binFilter.hi));
    const sorted = [...filtered].sort((a, b) => {
      let cmp: number;
      switch (peopleSort.key) {
        case 'name': cmp = fullName(a.fn, a.ln).localeCompare(fullName(b.fn, b.ln)); break;
        case 'school': cmp = (a.school ?? '').localeCompare(b.school ?? ''); break;
        case 'tenure': cmp = (a.tenure ?? 0) - (b.tenure ?? 0); break;
        default: cmp = a.pay - b.pay;
      }
      return peopleSort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [people, q, binFilter, peopleSort]);
  // The first rows, the rest on "Show all" (G11): the page's one scroll, not a 460px box inside it.
  const peoplePage = useShowAll(filteredPeople, `${q}|${binFilter ? `${binFilter.lo}-${binFilter.hi}` : ''}|${peopleSort.key}|${peopleSort.dir}`);

  const scopeLabel = school ? ` in ${school}` : '';

  // Loading, the page is the loaded one's shape: the same tiles with placeholders for their figures, and
  // the distribution's own card, its title and note real, the chart a block at the chart's height. Keyed as
  // the loaded cards are, so each placeholder becomes its card. Shaped otherwise (shorter tiles, a chart
  // card and a table card), the table's placeholder was taken for the distribution and rose 263px into place
  // as it loaded (layout shift 0.06 here, 0.10 on CI).
  if (isLoading) {
    return (
      <Stack gap="lg">
        <StatRow key="stats" cols={TITLE_COLS}>
          <StatCard size="hero" label={`Median ${measure.toLowerCase()} · this title${scopeLabel}`}
            value={<Skeleton height={42} width={180} radius="sm" />} sub={<Skeleton height={23} width={170} radius="sm" />} />
          <StatCard size="sm" label="Range (p25–p75)" value={<Skeleton height={28} width={150} radius="sm" />} />
          <StatCard size="sm" label="Spread (min–max)" value={<Skeleton height={28} width={150} radius="sm" />} />
        </StatRow>
        <Card key="dist" withBorder padding="lg">
          <CardTitle>{measure} distribution{scopeLabel}</CardTitle>
          <ChartSkeleton height={DIST_LOADING_H} />
          <Text size="xs" c="dimmed" mt={4}>Select a bar, by pointer or by Tab and Enter, to list just those people below.</Text>
        </Card>
      </Stack>
    );
  }
  if (!s || s.n === 0) {
    // A code that was never anyone's is not found, and the titles it is like are offered (NF2); one that is
    // only empty in this snapshot, or this school, says that.
    if (everTitle && Number(everTitle[0]?.n ?? 0) === 0) {
      const like = closeMatches(index?.titles ?? [], (t) => `${t[0]} ${t[1] ?? ''}`, jobCode, 5);
      return (
        <Card withBorder padding="lg" className="not-found">
          <CardTitle sub="No job code by that name is in the records, in any snapshot. The link may be out of date, or have a typo in it.">Title code not found</CardTitle>
          {like.length > 0 && (
            <Stack gap={6} className="not-found-suggestions">
              <Text size="sm" fw={600}>Did you mean</Text>
              {like.map(([code, title, n]) => (
                <Text key={code} size="sm">
                  <Anchor component={Link} to={`/titles?code=${encodeURIComponent(code)}`}>{title ?? code}</Anchor>
                  <Text span c="dimmed"> · {code} · {num(n)} people</Text>
                </Text>
              ))}
            </Stack>
          )}
        </Card>
      );
    }
    return <Alert color="gray">No one with this title{scopeLabel} in this snapshot.</Alert>;
  }

  return (
    <Stack gap="lg">
      <StatRow key="stats" cols={pinned ? TITLE_COLS_PINNED : TITLE_COLS}>
        <StatCard
          size="hero"
          label={`Median ${measure.toLowerCase()} · this title${scopeLabel}`}
          value={usd(s.med)}
          // The code and the headcount are the header's line now (T1); here, the people the median is of.
          sub={<>{num(s.n)} {s.n === 1 ? 'person' : 'people'}{school ? ` in ${school}` : ''}{(s.hourly_share ?? 0) >= HOURLY_TITLE && <HourlyTag annual={s.med} share={s.hourly_share} />}</>}
        />
        <Stat label="Range (p25–p75)" value={`${usd(s.p25)} – ${usd(s.p75)}`} />
        <Stat label="Spread (min–max)" value={`${usd(s.lo)} – ${usd(s.hi)}`} />
        {/* A pinned salary is placed in the figures' own row and marked on the charts (T11): it added a card of its
            own between these and the histogram, and the whole page moved down under the reader. */}
        {pinned && (
          <StatCard
            size="sm"
            label="Your salary"
            className="pin-result"
            value={usd(pinSalary)}
            sub={titleRow ? (
              <>
                {/* One line, so the row keeps its height when a salary is pinned. */}
                paid more than <b>{Math.round(titleRow.pct)}%</b> of {num(titleRow.n)}
                {school && schoolRow ? <> · {Math.round(schoolRow.pct)}% of {num(schoolRow.n)} in the school</> : rank != null ? ` · rank #${rank}` : ''}
              </>
            ) : undefined}
          />
        )}
      </StatRow>

      <Card key="dist" withBorder padding="lg">
        <CardTitle>{measure} distribution{scopeLabel}</CardTitle>
        <SalaryHistogram
          values={pays}
          markerValue={pinned ? pinSalary : null}
          markerLabel="Your salary"
          measure={measure}
          tooFewText={`Only ${num(s.n)} ${s.n === 1 ? 'person has' : 'people have'} this title${scopeLabel} — too few to chart a meaningful distribution.`}
          onBinClick={setBinFilter}
          // The grade's band under the people, on their scale (T8): its own card below, on a scale of its own, left
          // the reader to line the two up. A band is a range of full-time rates, so it is drawn under that measure.
          band={band && metric === 'full' ? {
            min: band.min,
            max: isRange(band) ? band.max : null,
            label: isRange(band)
              ? `Grade ${g?.grade_number} pay band: HR's official range of full-time rates, ${usd(band.min)} – ${usd(band.max)}, ticked at its quarters.`
              : `Grade ${g?.grade_number} minimum: ${usd(band.min)}. HR publishes no maximum for this grade.`,
          } : null}
        />
        {band && metric !== 'full' && (
          <Text size="xs" c="dimmed" mt={4} className="band-measure-note">
            Grade {g?.grade_number}&apos;s pay band is a range of full-time rates, so it is drawn under the full-time rate.
          </Text>
        )}
        <Text size="xs" c="dimmed" mt={4}>Select a bar, by pointer or by Tab and Enter, to list just those people below.</Text>
        {band && <PayBandNote snapshotId={snap} />}
      </Card>

      <Card withBorder padding="lg">
        <CardTitle mb="sm">
          People with this title{scopeLabel}
        </CardTitle>
        {binFilter && (
          <Badge
            variant="light"
            color="accent"
            mb="sm"
            rightSection={
              <ActionIcon size={14} radius="xl" variant="transparent" color="accent" aria-label="Clear salary range filter" onClick={() => setBinFilter(null)}>
                <IconX size={ICON.compact} />
              </ActionIcon>
            }
          >
            {usd(binFilter.lo)} – {usd(binFilter.hi)}
          </Badge>
        )}
        <TextInput
          size="md"
          mb="sm"
          placeholder="Search within this title…"
          leftSection={<IconSearch size={ICON.control} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <div className="sticky-head">
        <ScrollArea.Autosize type="auto" offsetScrollbars="present">
          <Table stickyHeader stickyHeaderOffset="var(--app-shell-header-offset, 0px)" miw={760} className="fold-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={48} ta="right" data-fold>#</Table.Th>
                <SortableTh sortKey="name" label="Name" sort={peopleSort} onSort={setPeopleSort} />
                <SortableTh sortKey="school" label="School · department" srLabel="school" fold sort={peopleSort} onSort={setPeopleSort} />
                <SortableTh sortKey="tenure" label="Tenure" fold tip={GLOSSARY.tenure} sort={peopleSort} onSort={setPeopleSort} align="right" />
                {/* Part-time appointments sat among full-time ones with nothing to tell them apart (T13). */}
                <Table.Th ta="right" data-fold w={64}>FTE</Table.Th>
                <SortableTh sortKey="salary" label={measure} sort={peopleSort} onSort={setPeopleSort} align="right" />
                <Table.Th w={44} className="tray-col"><VisuallyHidden>Compare</VisuallyHidden></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {peoplePage.shown.map((p) => {
                const realRank = payRank.get(p.person_key) ?? 0;
                const inTray = has(p.person_key);
                const open = () => nav(`/person/${encodeURIComponent(p.person_key)}`);
                return (
                  <Fragment key={p.person_key}>
                  <Table.Tr
                    className="peer-row"
                    // A click anywhere on the row opens the person; the keyboard's way in is the name's link.
                    // As a role="button" with that link and the tray button inside it, every row was a
                    // nested interactive control (axe), 458 of them for Associate Professor.
                    onClick={open}
                    style={{ cursor: 'pointer' }}
                  >
                    <Table.Td ta="right" c="dimmed" data-fold>{realRank}</Table.Td>
                    <Table.Td>
                      <div><Anchor component={Link} to={`/person/${encodeURIComponent(p.person_key)}`} onClick={(e) => e.stopPropagation()}>{fullName(p.fn, p.ln) || '—'}</Anchor></div>
                    </Table.Td>
                    {/* School over department, as a person's table has them: one column for where someone works. */}
                    <Table.Td data-fold>
                      <Text size="sm" lineClamp={1}>{p.school ?? '—'}</Text>
                      {p.department && <Text size="xs" c="var(--text-faint)" lineClamp={1}>{p.department}</Text>}
                    </Table.Td>
                    <Table.Td data-fold ta="right">{p.tenure != null ? fmtYears(Math.max(0, p.tenure)) : '—'}</Table.Td>
                    <Table.Td data-fold ta="right" className="fte-cell" c={p.fte != null && Math.abs(p.fte - 1) > 0.005 ? 'orange' : 'dimmed'}>
                      {p.fte == null ? 'hourly' : p.fte.toFixed(2)}
                    </Table.Td>
                    <Table.Td ta="right" fw={600}>
                      {usd(p.pay)}
                      {/* Paid by the hour: the rate the annualized figure stands for (G23). */}
                      {p.fte == null && <Text size="xs" c="dimmed" fw={400} className="hourly-rate">{hourly(p.pay)}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">
                      <TrayButton
                        inTray={inTray}
                        name={fullName(p.fn, p.ln)}
                        stopPropagation
                        onAdd={() => add({ type: 'person', id: p.person_key, label: fullName(p.fn, p.ln) })}
                        onRemove={() => remove(p.person_key)}
                      />
                    </Table.Td>
                  </Table.Tr>
                  {/* On a phone: rank, school and department across the row's width (M3). */}
                  {folded && (
                    <FoldRow span={7} onClick={open}>
                      #{realRank} · {[p.school, p.department].filter(Boolean).join(' · ') || '—'}
                      {p.fte != null && Math.abs(p.fte - 1) > 0.005 ? ` · FTE ${p.fte.toFixed(2)}` : ''}
                    </FoldRow>
                  )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        </div>
        <ShowAll shown={peoplePage.shown.length} total={peoplePage.total} onShowAll={peoplePage.showAll} pager={peoplePage.pager} />
      </Card>

      <Card withBorder padding="lg">
        <CardTitle sub={`What this title pays in each school: the market inside UW. A school with fewer than ${MIN_GROUP} people in it is greyed, with no spread.`}>Pay by school</CardTitle>
        <Table className="pay-by-school">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>School</Table.Th>
              <Table.Th ta="right">People</Table.Th>
              <Table.Th ta="right">Median</Table.Th>
              <Table.Th ta="right" data-fold w={300}>Middle 50% · {schoolScale.lo === 0 ? '$0' : fmtK(schoolScale.lo)}–{fmtK(schoolScale.hi)}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(bySchool ?? []).map((r) => (
              <Table.Tr key={r.school} data-few={r.n < MIN_GROUP || undefined} c={r.n < MIN_GROUP ? 'dimmed' : undefined}
                style={{ background: school === r.school ? 'var(--mantine-color-accent-light)' : undefined }}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Anchor component={Link} to={`/school/${encodeURIComponent(r.school)}`}>{r.school}</Anchor>
                    {school === r.school && <Badge size="xs" variant="light">filtered</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{num(r.n)}</Table.Td>
                <Table.Td ta="right">{usd(r.med)}</Table.Td>
                <Table.Td ta="right" data-fold>
                  {r.n >= MIN_GROUP && r.lo != null && r.p25 != null && r.med != null && r.p75 != null && r.hi != null
                    ? <MiniRange scale={schoolScale} lo={r.lo} p25={r.p25} med={r.med} p75={r.p75} hi={r.hi} />
                    : <Text span size="xs" c="dimmed">too few to say</Text>}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
