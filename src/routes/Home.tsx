import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Stack, Title, Text, SimpleGrid, Tooltip, Anchor } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconBuildingBank, IconBriefcase, IconReportAnalytics, IconListSearch } from '@tabler/icons-react';
import { useSummary, useSql, useActiveSnapshotId, useHomeStats, useSearchIndex, useTimeline } from '../lib/hooks';
import { sqlStr } from '../lib/duckdb';
import { personPay, personEarnings, mainOf } from '../lib/queries';
import { usd, usdShort, num, fullName } from '../lib/format';
import { SearchBox, type FilterToken, type SearchPick, type ShownPerson } from '../components/SearchBox';
import { dotSpots, emphasis, filterPeopleSql, homeNamesSql, homePeopleSql, spotPeople, topSchoolsForSql, topTitlesInSql, type HomeName, type HomePerson } from '../lib/homePeople';
import type { DivisionHit, TitleHit } from '../lib/search';
import { Eyebrow } from '../components/Eyebrow';
import { useDocTitle } from '../lib/useDocTitle';
import { Z } from '../lib/layers';
import { StrataGraph, type FoundPerson, type GraphGroup, type GraphTimeline, type WhoIs } from '../components/strata/StrataGraph';
import type { SearchIndex } from '../lib/manifest';
import { standingIn } from '../lib/strata';
import { ICON } from '../lib/ui';

interface StatData { label: string; value: number | null; format: (n: number) => string; hint?: string }

/**
 * One system-wide figure on the line under the search: the number, then what it counts, read as a phrase.
 *
 * These were four headline tiles — an icon, an eyebrow and a number that counted up, at 51px on a wide
 * screen: a size away from the page's title, four times the graph's own labels, and growing with the
 * screen. They are the graph's supporting detail, so they are set as text, smaller than the search's own,
 * and hold still: a count-up is motion, and motion on the page's quietest line drew the eye to it first.
 */
function StatItem({ label, value, format, hint }: StatData) {
  const figure = <span className="home-stat-value">{value == null ? '—' : format(value)}</span>;
  return (
    <span className="home-stat">
      {hint ? <Tooltip label={hint} withArrow>{figure}</Tooltip> : figure}
      <span className="home-stat-label">{label}</span>
    </span>
  );
}

/** How many people the search lists, on the page and full page alike: its list scrolls, and its heading says
 *  how many matched. Every match in the graph's snapshot is lit on the graph (the name group) whatever the
 *  list holds; the first `NAMED` rows are marked and named there. */
const SEARCH_PEOPLE = 50;
/** How many of the listed people are marked and named on the graph, and the one the reader is on. */
const NAMED = 6;

/** A filter the full page's bar holds: a title or a school, as the search's index gives them. */
type GraphFilterItem = { kind: 'title'; hit: TitleHit } | { kind: 'division'; hit: DivisionHit };
const filterKey = (f: GraphFilterItem) => (f.kind === 'title' ? `t:${f.hit.code}` : `d:${f.hit.school}`);

/**
 * One of the other places in the site, in the row at the page's foot: an icon, a name and a line on what
 * it does. They were cards — a tile each, 264px tall on a wide screen with 23px titles — and took the
 * bottom third of the first screen from the graph they sit under. A way on, not a feature of this page,
 * so a plain link: no card, set no larger than the search. The live counts they carried are on the stat
 * line above.
 */
function ShowcaseLink({ icon, title, blurb, to }: {
  icon: ReactNode;
  title: string;
  blurb: string;
  to: string;
}) {
  return (
    <Anchor component={Link} to={to} underline="never" c="inherit" className="showcase-link">
      <span className="showcase-icon" aria-hidden>{icon}</span>
      <span className="showcase-text">
        <span className="showcase-title">{title} <span className="showcase-arrow" aria-hidden>→</span></span>
        <span className="showcase-blurb">{blurb}</span>
      </span>
    </Anchor>
  );
}

/**
 * A few figures worked out from the data, at the page's foot, all at once. They used to take turns on one line,
 * a new one every six seconds, so the one being read could go mid-sentence. The list's line is held from the
 * first paint, so the links above it never move as it fills in.
 */
function HomeFacts({ facts }: { facts: string[] }) {
  return (
    <ul className="home-facts">
      {facts.length ? facts.map((f) => <li key={f}>{f}</li>) : <li>{'\u00a0'}</li>}
    </ul>
  );
}

export default function Home() {
  useDocTitle(null);
  const { data: summary } = useSummary();
  const snap = useActiveSnapshotId();

  // The precomputed artifact only covers the latest snapshot. It's usable once loaded, as long as
  // the page isn't pinned to some other (older) snapshot — in which case we fall back to live SQL.
  const { data: homeStats, isError: homeStatsFailed } = useHomeStats();
  const artifactUsable = !!homeStats && (snap == null || snap === homeStats.snapshot_id);
  // The people the search is showing, and its active row: their dots are marked on the graph, and picking
  // one opens them from their dot (components/PersonReveal).
  const navigate = useNavigate();
  const [shown, setShown] = useState<ShownPerson[]>([]);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  // Whether the reader put the search on that row (a pointer, an arrow), not the list opening on it.
  const [activeChosen, setActiveChosen] = useState(false);
  const openRef = useRef<((key: string) => boolean) | null>(null);
  // The query lives here, not in either search box, because the graph's full page is a portal: going
  // full page remounts the panel and everything in it. One box is on the page and the other inside the
  // panel, never both, and each is handed the query the other was holding.
  //
  // And in the address (`?q=`), so a search can be kept or sent, and Back from a person opened out of it
  // comes back to it: the box holding it, its marks on the graph, its list shut until the box is turned to
  // (the box's `handed` rule). Written as the reader types but without adding to the history, and kept when
  // a pick empties the box — that pick is what Back comes back from.
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  // Arrived holding a query: the box is not given the caret, which would open its list and move the page.
  const arrivedWithQuery = useRef(urlQuery.trim().length >= 2);
  const writtenRef = useRef(urlQuery);
  const keepUrlRef = useRef(false);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  useEffect(() => {
    const want = query.trim().length >= 2 ? query.trim() : '';
    if (!want && keepUrlRef.current) return;
    if (want) keepUrlRef.current = false;
    if (want === writtenRef.current) return;
    const t = window.setTimeout(() => {
      writtenRef.current = want;
      setParamsRef.current((p) => {
        const n = new URLSearchParams(p);
        if (want) n.set('q', want); else n.delete('q');
        return n;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);
  // The address changed by itself — a link to this page, Back or Forward within it — and the box follows.
  useEffect(() => {
    if (urlQuery === writtenRef.current) return;
    writtenRef.current = urlQuery;
    keepUrlRef.current = false;
    setQuery(urlQuery);
  }, [urlQuery]);
  const [graphFull, setGraphFull] = useState(false);
  // Full page in the address (I9): `?view=full`, with its title and school (`gt`, `gs`), so it can be kept or sent
  // and Back comes back to it. Read once, as the page opens.
  const startFull = useRef(params.get('view') === 'full');
  const askedFilters = useRef({ title: params.get('gt'), school: params.get('gs') });
  // What the full page's bar is filtering the graph to: at most one title and one school, in the order they
  // were put on (Escape and Backspace take the last one off first). Full page only — the landing graph has
  // no bar to show them in, and they go when full page does.
  const [filters, setFilters] = useState<GraphFilterItem[]>([]);
  useEffect(() => { if (!graphFull) setFilters([]); }, [graphFull]);
  const putFilter = useCallback((f: GraphFilterItem) => setFilters((fs) => [...fs.filter((g) => g.kind !== f.kind), f]), []);
  const takeFilter = useCallback((key: string) => setFilters((fs) => fs.filter((g) => filterKey(g) !== key)), []);
  // Only the box the page opens with takes the caret. The one that comes back when full page closes is
  // a box returning to a page the reader is already looking at, and full page hands focus to its own
  // exit button, which this would take straight back off it.
  const firstSearchRef = useRef(true);
  // A finger, not a mouse: a press on the graph while the list lies over it only puts the list away.
  const coarse = useMediaQuery('(pointer: coarse)', false, { getInitialValueInEffect: false }) ?? false;
  useEffect(() => { firstSearchRef.current = false; }, []);
  /** What both boxes share: the one query, the one list of found people, and the one way to open them. */
  const searchProps = {
    query,
    onQueryChange: setQuery,
    keepFoundOnUnmount: true,
    onPeopleShown: setShown,
    onActiveItem: (key: string | null, chosen: boolean) => { setActiveItem(key); setActiveChosen(chosen); },
    onPick: (h: { person_key: string; name: string }) => {
      keepUrlRef.current = true;
      if (!openRef.current?.(h.person_key)) navigate(`/person/${encodeURIComponent(h.person_key)}`);
    },
  };
  // Who each square is (lib/homePeople): asked once the search has found someone, a filter is on, or the
  // magnifying glass is first up full page — by when DuckDB is up.
  const peopleSnap = artifactUsable ? homeStats.snapshot_id : '';
  const [wantWho, setWantWho] = useState(false);
  // A title or division row on the page's list — the suggestions, or a result — shown on the graph above it
  // while the reader is on it: its dots lit and the rest faded, as a filter shows it full page. Only a row
  // the reader chose, and one they rest on (150ms), so opening the list lights nothing and a pointer
  // passing over the rows does not repaint the field for each; gone as soon as they leave it.
  const listRow = !graphFull && activeItem != null && /^[td]:/.test(activeItem) ? activeItem : null;
  const previewWanted = listRow && activeChosen ? listRow : null;
  const [previewSettled] = useDebouncedValue(previewWanted, 150);
  const preview = previewWanted != null && previewSettled === previewWanted ? previewWanted : null;
  // The dots are named once, before the first row is chosen: a list of titles and divisions is open.
  const { data: homePeople } = useSql<HomePerson>(['home-people', peopleSnap], homePeopleSql(peopleSnap), !!peopleSnap && (shown.length > 0 || filters.length > 0 || wantWho || listRow != null));
  // And their names, for the lens's card: only once the lens has first been up. With them, everyone's pay in
  // the snapshot before, for the card's change since then (and "new" for someone who was not in it).
  const { data: homeNames } = useSql<HomeName>(['home-names', peopleSnap], homeNamesSql(peopleSnap), !!peopleSnap && wantWho);
  const prevSnapshot = useMemo(() => {
    const list = summary?.snapshots ?? [];
    const at = list.findIndex((x) => x.id === peopleSnap);
    return at > 0 ? list[at - 1] : null;
  }, [summary, peopleSnap]);
  const prevSnap = prevSnapshot?.id ?? '';
  const { data: prevPeople } = useSql<HomePerson>(['home-people', prevSnap], homePeopleSql(prevSnap), !!prevSnap && wantWho && !!homeNames);
  const spots = useMemo(
    () => (homePeople && artifactUsable && homeStats.pay_counts && homeStats.bin_cap != null ? dotSpots(homePeople, homeStats.pay_counts, homeStats.bin_cap) : null),
    [homePeople, artifactUsable, homeStats],
  );
  // Whose a dot is, for the glass: 'loading' until both lookups are in, null where the dots cannot be
  // named at all (a snapshot whose counts carry no categories, so `dotSpots` has nothing to go on).
  const whoIs = useMemo((): WhoIs | 'loading' | null => {
    if (!wantWho) return null;
    if (!homePeople || !homeNames) return 'loading';
    if (!spots) return null;
    const at = spotPeople(spots);
    const names = new Map(homeNames.map((n) => [n.person_key, n]));
    const pays = new Map(homePeople.map((p) => [p.person_key, p.pay]));
    const prev = prevPeople ? new Map(prevPeople.map((p) => [p.person_key, p.pay])) : null;
    // Everyone's pay, highest first, to rank a person among (lib/strata `standingIn`).
    const desc = Float64Array.from(homePeople.flatMap((p) => (p.pay != null && p.pay > 0 ? [Number(p.pay)] : []))).sort().reverse();
    return (field, index) => {
      const key = at[field][index];
      const n = key ? names.get(key) : undefined;
      if (!key || !n) return null;
      const pay = pays.get(key) ?? null;
      return {
        key, name: fullName(n.fn, n.ln), title: n.title, school: n.school, department: n.department, pay,
        prev: prev ? (prev.get(key) ?? null) : undefined, prevLabel: prevSnapshot?.label,
        ...(pay != null ? standingIn(desc, Number(pay)) : {}), total: desc.length,
      };
    };
  }, [wantWho, homePeople, homeNames, prevPeople, prevSnapshot, spots]);
  // The graph's timeline (lib/timeline): every snapshot's people, asked for the first time a reader plays it
  // or picks a snapshot; and a snapshot's names, the first time the lens is up in it.
  const tlSnaps = useMemo(() => (artifactUsable ? (summary?.snapshots ?? []).map((x) => ({ id: x.id, label: x.label })) : []), [artifactUsable, summary]);
  const tlNames = useMemo(() => (artifactUsable ? (homeStats.pay_counts?.categories ?? []).map((c) => c.name) : []), [artifactUsable, homeStats]);
  const [wantTimeline, setWantTimeline] = useState(false);
  const { data: tlData, isError: tlFailed } = useTimeline(tlSnaps, tlNames, wantTimeline);
  const [namesAt, setNamesAt] = useState<number | null>(null);
  const namesSnapId = namesAt != null ? tlSnaps[namesAt]?.id ?? '' : '';
  const { data: snapNames } = useSql<HomeName>(['home-names', namesSnapId], homeNamesSql(namesSnapId), !!namesSnapId);
  const timeline = useMemo<GraphTimeline | null>(() => {
    if (tlSnaps.length < 2 || !tlNames.length) return null;
    return {
      snaps: tlSnaps,
      data: !wantTimeline ? null : tlData ?? (tlFailed ? 'error' : 'loading'),
      onWant: () => setWantTimeline(true),
      names: namesAt != null && snapNames
        ? { snap: namesAt, who: new Map(snapNames.map((n) => [n.person_key, { name: fullName(n.fn, n.ln), title: n.title, school: n.school, department: n.department }])) }
        : null,
      onWantNames: setNamesAt,
    };
  }, [tlSnaps, tlNames, wantTimeline, tlData, tlFailed, namesAt, snapNames]);
  // The filter's people, at their dots' pay, and what that lights: one query per filter (cached by its key),
  // mapped onto the dots through the same `spots` the search's marks use.
  const title = filters.find((f): f is { kind: 'title'; hit: TitleHit } => f.kind === 'title')?.hit;
  const school = filters.find((f): f is { kind: 'division'; hit: DivisionHit } => f.kind === 'division')?.hit;
  const { data: filterRows } = useSql<{ person_key: string; pay: number }>(
    ['graph-filter', peopleSnap, title?.code ?? '', school?.school ?? ''],
    filters.length && peopleSnap ? filterPeopleSql(peopleSnap, { jobCode: title?.code, school: school?.school }) : '',
    !!peopleSnap && filters.length > 0,
  );
  // The previewed row's people: the filter's own query, so showing it full page next reuses the answer.
  const pvCode = preview?.startsWith('t:') ? preview.slice(2) : null;
  const pvSchool = preview?.startsWith('d:') ? preview.slice(2) : null;
  const { data: previewRows } = useSql<{ person_key: string; pay: number }>(
    ['graph-filter', peopleSnap, pvCode ?? '', pvSchool ?? ''],
    preview && peopleSnap ? filterPeopleSql(peopleSnap, { jobCode: pvCode ?? undefined, school: pvSchool ?? undefined }) : '',
    !!peopleSnap && preview != null,
  );
  // Everyone the typed name matches in the graph's snapshot, lit on the graph as a group, as a title's people
  // are: "aaron" lights all 66 Aarons with a dot, where the list and its marks can hold only some. Full page,
  // within the filters on: the Aarons who are Research Associates. The same 200ms settle as the box's own.
  // The label and the rows from the same settled text, so "“aar”" never carries the count for "aa".
  const [nameTyped] = useDebouncedValue(query.trim(), 200);
  const nameQ = nameTyped.toLowerCase();
  const nameOn = nameQ.length >= 2;
  const { data: nameRows } = useSql<{ person_key: string; pay: number }>(
    ['graph-name', peopleSnap, nameQ, graphFull ? title?.code ?? '' : '', graphFull ? school?.school ?? '' : ''],
    nameOn && peopleSnap ? filterPeopleSql(peopleSnap, { name: nameQ, jobCode: graphFull ? title?.code : undefined, school: graphFull ? school?.school : undefined }) : '',
    !!peopleSnap && nameOn,
  );
  // A title's name alone can be two titles — "Research Associate" is PD012 and PD012N — so where the index
  // has another under the same name, the filter names its code too; picked, it must still say which it was.
  const { data: searchIndex } = useSearchIndex(graphFull || !!title || listRow != null || startFull.current);
  // The address's title and school, put on once full page is open and the index can name them.
  useEffect(() => {
    const asked = askedFilters.current;
    if (!graphFull || !searchIndex || (!asked.title && !asked.school)) return;
    const t = asked.title ? searchIndex.titles.find((r) => r[0] === asked.title) : null;
    const d = asked.school ? searchIndex.divisions.find((r) => r[0] === asked.school) : null;
    if (t) putFilter({ kind: 'title', hit: { code: t[0], title: t[1] ?? t[0], n: t[2], med: t[3], cat: t[4] } });
    if (d) putFilter({ kind: 'division', hit: { school: d[0], n: d[1], med: d[2] } });
    askedFilters.current = { title: null, school: null };
  }, [graphFull, searchIndex, putFilter]);
  // And written back as full page and its filters change; nothing of it once it closes. Held while the address's own
  // are still to be put on, or the first write would take them off it.
  useEffect(() => {
    if (graphFull) startFull.current = false;
    if (startFull.current) return;
    const pending = !!(askedFilters.current.title || askedFilters.current.school);
    const t = filters.find((f): f is { kind: 'title'; hit: TitleHit } => f.kind === 'title')?.hit.code ?? null;
    const d = filters.find((f): f is { kind: 'division'; hit: DivisionHit } => f.kind === 'division')?.hit.school ?? null;
    setParamsRef.current((p) => {
      const n = new URLSearchParams(p);
      if (graphFull) n.set('view', 'full'); else n.delete('view');
      if (!pending) {
        if (graphFull && t) n.set('gt', t); else n.delete('gt');
        if (graphFull && d) n.set('gs', d); else n.delete('gs');
      }
      return n.toString() === p.toString() ? p : n;
    }, { replace: true });
  }, [graphFull, filters]);
  const nameOfTitle = useCallback((code: string, name: string | null) => {
    const t = name ?? (searchIndex?.titles ?? []).find(([c]) => c === code)?.[1] ?? code;
    const shared = (searchIndex?.titles ?? []).filter(([, n]) => n === t).length > 1;
    return shared ? `${t} (${code})` : t;
  }, [searchIndex]);
  const titleName = title ? nameOfTitle(title.code, title.title) : null;
  // A group's lit dots, from its people: not yet known while the query is out or the dots are not yet
  // named — the field is then left as it is until the answer is in, rather than dimmed to nothing and lit
  // a moment later.
  const groupOf = useCallback((name: string, rows: { person_key: string; pay: number }[] | undefined): GraphGroup | null => {
    if (!artifactUsable || !homeStats.pay_counts) return null;
    if (!rows || !spots) return { name, pending: true };
    const pc = homeStats.pay_counts;
    const sizes = {
      main: pc.counts.reduce((t, n) => t + n, 0),
      pile: (pc.categories ?? []).reduce((t, c) => t + c.over, 0),
    };
    return { name, pending: false, ...emphasis(spots, rows.map((r) => ({ person_key: r.person_key, pay: Number(r.pay) })), sizes) };
  }, [artifactUsable, homeStats, spots]);
  const filterGroup = useMemo<GraphGroup | null>(() => {
    if (!filters.length) return null;
    return groupOf(titleName && school ? `${titleName} in ${school.school}` : (titleName ?? school?.school ?? ''), filterRows);
  }, [filters.length, titleName, school, filterRows, groupOf]);
  const previewGroup = useMemo<GraphGroup | null>(() => {
    if (!preview) return null;
    return groupOf(pvCode ? nameOfTitle(pvCode, null) : (pvSchool ?? ''), previewRows);
  }, [preview, pvCode, pvSchool, previewRows, nameOfTitle, groupOf]);
  // The typed name's people, within the filters full page: "“aaron”", or "“aaron” in Research Associate".
  // Only once someone matches: a title or a school typed for ("research assoc") names no one, and must not
  // dim the graph or flag it; the list says what matched. While the next letters are asked, the last answer
  // stays, so the flag does not flash "…" at every pause in the typing.
  const nameSettled = useRef<GraphGroup | null>(null);
  const nameGroup = useMemo<GraphGroup | null>(() => {
    if (!nameOn) return (nameSettled.current = null);
    const within = graphFull && filters.length ? (titleName && school ? `${titleName} in ${school.school}` : (titleName ?? school?.school ?? '')) : '';
    const g = groupOf(`“${nameTyped}”${within ? ` in ${within}` : ''}`, nameRows);
    if (!g) return (nameSettled.current = null);
    if (g.pending) return nameSettled.current;
    return (nameSettled.current = g.count > 0 ? g : null);
  }, [nameOn, graphFull, filters.length, titleName, school, nameTyped, nameRows, groupOf]);
  // On the page, a row the reader is on in the search's list, then the typed name; full page, the typed name
  // within its filters, then the filters.
  const group = !graphFull && previewGroup ? previewGroup : nameGroup ?? filterGroup;
  // What the full page's bar offers with nothing typed. Nothing on: the index's largest schools and titles,
  // turn about, so a narrow strip still shows both kinds. A school on: its largest titles; a title on: the
  // schools that employ most of it — each a small query of the filter's own rows, asked once the filter's
  // own answer is in (DuckDB answers one query at a time). Both on: nothing left to add.
  const { data: topTitles } = useSql<{ code: string }>(
    ['graph-top-titles', peopleSnap, school?.school ?? ''],
    school && !title && peopleSnap ? topTitlesInSql(peopleSnap, school.school) : '',
    !!peopleSnap && !!school && !title && !!filterRows,
  );
  const { data: topSchools } = useSql<{ school: string }>(
    ['graph-top-schools', peopleSnap, title?.code ?? ''],
    title && !school && peopleSnap ? topSchoolsForSql(peopleSnap, title.code) : '',
    !!peopleSnap && !!title && !school && !!filterRows,
  );
  const starters = useMemo<SearchPick[]>(() => {
    if (!searchIndex || (title && school)) return [];
    const asTitle = ([code, name, n, med, cat]: SearchIndex['titles'][number]): SearchPick =>
      ({ kind: 'title', hit: { code, title: name ?? code, n, med, cat } });
    const asSchool = ([name, n, med]: [string, number, number | null]): SearchPick => ({ kind: 'division', hit: { school: name, n, med } });
    if (!title && !school) {
      const schools = [...searchIndex.divisions].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(asSchool);
      const titles = [...searchIndex.titles].filter((r) => r[1]).sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(asTitle);
      return schools.flatMap((s, i) => (titles[i] ? [s, titles[i]] : [s]));
    }
    if (school) {
      const byCode = new Map(searchIndex.titles.map((r) => [r[0], r]));
      return (topTitles ?? []).flatMap((r) => { const row = byCode.get(r.code); return row ? [asTitle(row)] : []; });
    }
    const bySchool = new Map(searchIndex.divisions.map((r) => [r[0], r]));
    return (topSchools ?? []).flatMap((r) => { const row = bySchool.get(r.school); return row ? [asSchool(row)] : []; });
  }, [searchIndex, title, school, topTitles, topSchools]);
  const openFullRef = useRef<(() => void) | null>(null);
  // Whether the full page's search has its list open over the graph (SearchBox `onListOpen`).
  const searchOpenRef = useRef(false);
  const tokens = useMemo<FilterToken[]>(() => filters.map((f) => ({
    key: filterKey(f),
    kind: f.kind,
    label: f.kind === 'title' ? (titleName ?? f.hit.title) : f.hit.school,
  })), [filters, titleName]);
  // Ringed and named on the graph: the list's first rows and the one the reader is on. The rest of the
  // matches are lit by the name group, not marked one by one.
  const activePerson = activeItem?.startsWith('p:') ? activeItem.slice(2) : null;
  const found = useMemo<FoundPerson[]>(
    () => (spots ? shown.filter((p, i) => i < NAMED || p.person_key === activePerson).flatMap((p) => { const spot = spots.get(p.person_key); return spot ? [{ ...p, spot }] : []; }) : []),
    [spots, shown, activePerson],
  );
  const needsSql = !!snap && (homeStatsFailed || (!!homeStats && !artifactUsable));

  const { data: payrollRows } = useSql<{ total: number | null }>(
    ['home-payroll', snap ?? ''],
    // The sum of everyone's pay, as home-stats.json's is: a salaried person's hourly jobs left out (queries `personPay`).
    `SELECT sum(e) total FROM (SELECT person_key, ${personEarnings('full')} e FROM salaries
       WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0 GROUP BY person_key)`,
    needsSql
  );
  const payroll = artifactUsable ? homeStats.payroll_total : (payrollRows?.[0]?.total ?? null);

  // Per person, on actual pay (`people` below) — the same population home-stats.json is built from.
  const people = `(SELECT person_key, ${personPay('fte')} AS pay
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)`;
  const { data: dimRows } = useSql<{ schools: number; titles: number; lo: number | null; hi: number | null }>(
    ['home-dims', snap ?? ''],
    `SELECT count(DISTINCT school) schools, count(DISTINCT job_code) titles,
            (SELECT min(pay) FROM ${people} WHERE pay > 0) lo, (SELECT max(pay) FROM ${people} WHERE pay > 0) hi
     FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')}`,
    needsSql
  );
  const dims = useMemo(
    () =>
      artifactUsable
        ? { schools: homeStats.schools, titles: homeStats.titles, lo: homeStats.salary_lo, hi: homeStats.salary_hi }
        : dimRows?.[0],
    [artifactUsable, homeStats, dimRows]
  );

  // Distribution sparkline + the facts at the foot (lightweight aggregates over the latest snapshot).
  const { data: binRows } = useSql<{ bucket: number; n: number }>(
    ['home-bins', snap ?? ''],
    // $1k buckets, matching the precomputed artifact — and over actual pay, not the raw rate. The
    // build script fixed that mismatch on its side and left this one: the fallback was binning the
    // full-time rate while the median marker drawn on top of it came from FTE-adjusted pay, so a
    // visitor pinned to an older snapshot got a marker sitting off its own curve.
    // One point per PERSON, as in the artifact: the curve sits under a count of employees.
    `SELECT floor(pay / 1000) * 1000 AS bucket, count(*) AS n FROM ${people}
     WHERE pay > 0 AND pay < 250000 GROUP BY bucket ORDER BY bucket`,
    needsSql
  );
  const bins = artifactUsable ? homeStats.bins : (binRows ?? []);

  const { data: titleTopRows } = useSql<{ title: string; n: number }>(
    ['home-toptitle', snap ?? ''],
    `SELECT title, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND title IS NOT NULL GROUP BY title ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topTitle = artifactUsable ? homeStats.top_title : (titleTopRows?.[0] ?? null);
  const { data: divTopRows } = useSql<{ school: string; n: number }>(
    ['home-topdiv', snap ?? ''],
    `SELECT school, count(*) n FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} AND school IS NOT NULL GROUP BY school ORDER BY n DESC LIMIT 1`,
    needsSql
  );
  const topDivision = artifactUsable ? homeStats.top_division : (divTopRows?.[0] ?? null);
  // p90 (top-10% line) + median tenure, deduped per person.
  const { data: factStats } = useSql<{ p90: number | null; tenure: number | null }>(
    ['home-facts', snap ?? ''],
    `WITH p AS (
        SELECT person_key, ${personPay('fte')} AS pay,
               any_value(date_of_hire) AS doh, any_value(snapshot_date) AS sd
        FROM salaries WHERE snapshot_id = ${sqlStr(snap ?? '')} GROUP BY person_key)
     SELECT quantile_cont(pay, 0.9) FILTER (WHERE pay > 0) p90,
            median(date_diff('day', CAST(doh AS DATE), CAST(sd AS DATE)) / 365.25) FILTER (WHERE doh IS NOT NULL) tenure
     FROM p`,
    needsSql
  );
  const p90 = artifactUsable ? homeStats.p90 : (factStats?.[0]?.p90 ?? null);
  const tenure = artifactUsable ? homeStats.median_tenure_years : (factStats?.[0]?.tenure ?? null);
  const { data: byCat } = useSql<{ cat: string; med: number }>(
    ['home-bycat', snap ?? ''],
    // Each person once, at their total pay, in the category of their main appointment — the rule
    // home-stats.json uses (scripts/lib/home-stats.mjs), so the fact reads the same either way.
    `WITH p AS (SELECT person_key, ${personPay('fte')} pay, ${mainOf('employee_category')} cat FROM salaries
                WHERE snapshot_id = ${sqlStr(snap ?? '')} AND salary > 0 GROUP BY person_key)
     SELECT cat, median(pay) FILTER (WHERE pay > 0) med, count(*) FILTER (WHERE pay > 0) n
     FROM p WHERE cat IS NOT NULL GROUP BY cat ORDER BY n DESC, cat LIMIT 3`,
    needsSql
  );
  const categoryMedians = artifactUsable
    ? homeStats.category_medians
    : (byCat ?? []).map((c) => ({ category: c.cat, median: c.med }));

  // All facts are computed at runtime from summary.json + home-stats.json (or live SQL), so they
  // auto-update on data import — no hardcoded values to maintain when the salary data refreshes.
  const facts = useMemo(() => {
    const f: string[] = [];
    const first = summary?.snapshots?.[0];
    const med0 = first?.median ?? null;
    const medNow = summary?.latest?.median ?? null;
    if (med0 != null && medNow != null && med0 > 0) {
      // Like for like: the latest restated to the first's footing (the Sep 2025 change in how 9-month pay is
      // reported raised the median without raising anyone's pay).
      const lfl = summary?.latest?.median_prior ?? medNow;
      const up = Math.round(((lfl - med0) / med0) * 100);
      const yr = first?.date?.slice(0, 4);
      f.push(`Median pay rose from ${usd(med0)}${yr ? ` (${yr})` : ''} to ${usd(medNow)} — up ~${up}%${lfl !== medNow ? ' like for like' : ''}`);
    }
    if (topTitle?.title) f.push(`Most common title: ${topTitle.title} (${num(topTitle.n)} people)`);
    if (topDivision?.school) f.push(`Largest division: ${topDivision.school} (${num(topDivision.n)} people)`);
    if (p90 != null) f.push(`The top 10% earn more than ${usd(p90)}`);
    if (dims?.lo != null && dims?.hi != null) f.push(`Pay ranges from ${usd(dims.lo)} to ${usd(dims.hi)}`);
    if (tenure != null) f.push(`Median tenure is ${tenure.toFixed(1)} years`);
    if (categoryMedians.length) f.push(`Median pay by group: ${categoryMedians.map((c) => `${c.category} ${usd(c.median)}`).join(', ')}`);
    return f;
  }, [summary, topTitle, topDivision, p90, dims, tenure, categoryMedians]);


  // The figures on the line under the search, each a number and what it counts. The exact median is here
  // since the heading became what the page shows: the graph labels it in thousands. The exact payroll is on
  // hover.
  const stats: StatData[] = [
    { label: 'employees', value: summary?.latest?.headcount ?? null, format: num },
    { label: 'median', value: summary?.latest?.median ?? null, format: usd },
    { label: 'payroll', value: payroll, format: usdShort, hint: payroll != null ? usd(payroll) : undefined },
    { label: 'divisions', value: dims?.schools ?? null, format: num },
    { label: 'titles', value: dims?.titles ?? null, format: num },
  ];

  // The page's own search, in the hero beside the title (under it where the two do not fit side by side): in
  // sight at load, where the title's own line says to search. It used to be under the graph, below the first
  // screen at 1280×800. Its list lies over the plot, so it is open only while the box is in use, stopping
  // halfway down the plot so the marks landing as the reader types stay in sight. A click on the graph does
  // what it does and the list goes with the box's focus; a finger's first tap only puts the list away
  // (`searchOpenRef`), as it cannot point at what is under the list before pressing it.
  const midPlot = () => {
    const plot = document.querySelector('.hero-dist-main')?.getBoundingClientRect();
    return plot ? plot.top + plot.height / 2 : null;
  };
  const pageSearch = !graphFull && (
    <SearchBox
      {...searchProps}
      peopleInGroup={SEARCH_PEOPLE}
      size="lg"
      autoFocus={firstSearchRef.current && !arrivedWithQuery.current}
      whileFocused
      listLimit={midPlot}
      // Beside the title the box is narrower than the list's two columns: the list takes them anyway.
      listMinWidth={820}
      onListOpen={coarse ? (open) => { searchOpenRef.current = open; } : undefined}
      // Focused and empty, it suggests where to start: the full page's starters, with no filter on.
      starters={starters}
      // The way in to the full page's filters from the page's own search: a title or school shown
      // on the graph rather than opened. The box empties itself, so no list is left behind.
      onShowOnGraph={(pick) => { putFilter(pick); openFullRef.current?.(); }}
    />
  );

  // Two weights. The graph and the search are the page: the only things on it with a surface and a border,
  // and together in the first screen. Everything else is text on the page, no larger than the search's own
  // and the same size on any screen — the figures, the ways on, the notes. The title block used to be
  // centred at up to 56px over a two-line paragraph, ~200px repeating the masthead's name before the graph,
  // and with the figures and tiles scaled up to match it the search began below the first screen at 1440×900.
  return (
    <Box className="home" style={{ position: 'relative' }}>
      <div className="hero-dotgrid" aria-hidden />
      <Stack gap="xl" w="100%" style={{ position: 'relative', zIndex: Z.content }}>
        {/* The page's width, not a reading measure: a figure is not prose, and the plot grows taller with
            its width (PLOT_ASPECT). The header is set on the same left edge as the panel under it. */}
        <Stack gap="sm" w="100%" className="hero-rise">
          <div className="home-head">
            <div className="home-head-main">
              {/* What the page shows, not the site's name: the name is in the header a few pixels above, and
                  the heading used to repeat it. The count is everyone the graph draws, from the data. */}
              <Title order={1} fz="var(--fs-display)" lh={1.15} className="home-title">
                <Text span inherit c="bright">What </Text>
                {summary?.latest?.headcount != null && (
                  <Text span inherit c="accent.7" className="accent7-text">{num(summary.latest.headcount)} people </Text>
                )}
                <Text span inherit c="bright">{summary?.latest?.headcount != null ? 'at' : 'people at'} <span style={{ whiteSpace: 'nowrap' }}>UW–Madison</span> are paid</Text>
              </Title>
              {/* The median is the graph's own label; the lead says how to read the page and what to do. */}
              <Text size="sm" c="dimmed" className="home-lead">
                Every square below is one person. Search anyone by name to see their pay and how it compares with
                their title.
              </Text>
            </div>
            {/* Held while the graph is full page, which carries the same search itself: the hero keeps its height. */}
            <div className="home-head-search">{pageSearch}</div>
          </div>

          <div className="hero-dist-wrap" data-people-mapped={spots ? spots.size : undefined}>
            <StrataGraph
              bins={bins}
              payCounts={artifactUsable ? homeStats.pay_counts ?? null : null}
              p25={artifactUsable ? homeStats.p25 : null}
              median={artifactUsable ? homeStats.p50 : (summary?.latest?.median ?? null)}
              p75={artifactUsable ? homeStats.p75 : null}
              cap={artifactUsable ? homeStats.bin_cap : null}
              columnPeak={artifactUsable ? homeStats.column_peak ?? null : null}
              prevMedian={summary?.snapshots?.[summary.snapshots.length - 2]?.median ?? null}
              prevLabel={summary?.snapshots?.[summary.snapshots.length - 2]?.label ?? null}
              overflow={artifactUsable ? homeStats.bins_overflow : null}
              headcount={summary?.latest?.headcount ?? null}
              snapshotLabel={summary?.latest?.label ?? null}
              found={found}
              activeKey={activeItem?.startsWith('p:') ? activeItem.slice(2) : null}
              openRef={openRef}
              onFullChange={setGraphFull}
              search={(
                <SearchBox
                  {...searchProps}
                  size="md"
                  results="bar"
                  peopleInGroup={SEARCH_PEOPLE}
                  onListOpen={(open) => { searchOpenRef.current = open; }}
                  // The list stops halfway down the plot, so the rest stays in sight — every match lit as
                  // the reader types — and past it the list scrolls. On a phone, where the list is as wide as
                  // the graph, a tap on the rest puts it away.
                  listLimit={() => {
                    const plot = document.querySelector('.hero-dist-full .hero-dist-main')?.getBoundingClientRect();
                    return plot ? plot.top + plot.height / 2 : null;
                  }}
                  placeholder="Search a person, title or school…"
                  tokens={tokens}
                  onRemoveToken={takeFilter}
                  onPickTitle={(hit) => putFilter({ kind: 'title', hit })}
                  onPickDivision={(hit) => putFilter({ kind: 'division', hit })}
                  starters={starters}
                />
              )}
              openFullRef={openFullRef}
              startFull={startFull.current}
              whoIs={whoIs}
              onWantWho={() => setWantWho(true)}
              searchOpenRef={searchOpenRef}
              group={group}
              previewing={!graphFull && !!previewGroup}
              onClearGroup={!graphFull && previewGroup ? undefined : nameGroup ? () => setQuery('') : filters.length ? () => setFilters([]) : undefined}
              onPeel={() => {
                if (!filters.length) return false;
                takeFilter(filterKey(filters[filters.length - 1]));
                return true;
              }}
              timeline={timeline}
            />
          </div>
          <div className="home-stats">
            <div className="home-stat-row">
              {stats.map((s) => <StatItem key={s.label} {...s} />)}
            </div>
            <Anchor component={Link} to="/divisions" underline="never" className="home-stats-browse accent7-text" c="accent.7">
              Browse every school and title under Divisions <span className="browse-arrow" aria-hidden>→</span>
            </Anchor>
          </div>
        </Stack>

        {/* The rest of the site, below the fold: the page used to end with nothing to say that Compare,
            Reports, Screening or the division pages existed. Links, not features of this page. */}
        <nav className="home-more" aria-labelledby="home-more-title">
          {/* A heading, at eyebrow size: the page had an h1 and nothing under it, so a screen reader's list of
              headings was empty. */}
          <h2 id="home-more-title" className="home-more-title"><Eyebrow span>Also in here</Eyebrow></h2>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="lg" verticalSpacing="md">
            <ShowcaseLink
              to="/titles"
              icon={<IconBriefcase size={ICON.nav} stroke={1.8} />}
              title="Look up a title"
              blurb="See a title's full pay distribution, who holds it, and how it varies by school."
            />
            <ShowcaseLink
              to="/divisions"
              icon={<IconBuildingBank size={ICON.nav} stroke={1.8} />}
              title="Compare divisions"
              blurb="Headcount, median pay and top earners side by side across every school."
            />
            <ShowcaseLink
              to="/raise-case"
              icon={<IconReportAnalytics size={ICON.nav} stroke={1.8} />}
              title="Build a raise case"
              blurb="Run the UW salary guidelines for one person and print the brief for HR."
            />
            <ShowcaseLink
              to="/screening"
              icon={<IconListSearch size={ICON.nav} stroke={1.8} />}
              title="Screen a whole unit"
              blurb="Rank everyone in a school or department by how strong their case looks."
            />
          </SimpleGrid>
        </nav>

        {/* Footnotes: the least urgent thing on the page, at its end. */}
        <Stack gap="xs" maw="var(--content-prose)" mx="auto" w="100%">
          <HomeFacts facts={facts} />

          <Text size="xs" c="dimmed" ta="center" fs="italic" maw="var(--measure)" mx="auto">
            Figures are point-in-time snapshots; an employee's FTE (appointment %) and pay rate can change between
            snapshots, so actual pay earned may be higher or lower than the amounts shown.{' '}
            <Anchor component={Link} to="/data" c="dimmed" underline="always" fs="normal">How this data works →</Anchor>
          </Text>
        </Stack>
      </Stack>
    </Box>
  );
}
