import { useState, useMemo, useId, useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { TextInput, Popover, Loader, Stack, UnstyledButton, Text, Group, Tooltip, Badge, Box } from '@mantine/core';
import { IconSearch, IconAlertTriangle } from '@tabler/icons-react';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { useSql, useSummary, useSearchIndex } from '../lib/hooks';
import { sqlStr, sqlLikeContains } from '../lib/duckdb';
import { personPay } from '../lib/queries';
import { fullName, usd, num } from '../lib/format';
import { snapX, reportingBreaks } from '../lib/snapTime';
import { ALL_KINDS, GROUP_LIMIT, matchTitles, matchDivisions, enterPick, type SearchKind, type TitleHit, type DivisionHit } from '../lib/search';
import { DROPDOWN_TIERS, type DropdownSize } from '../lib/selectProps';
import { ICON } from '../lib/ui';
import { Sparkline } from './chart/Sparkline';

/** One matched person in one snapshot — the people query returns a row per person per snapshot. */
interface HitRow {
  person_key: string;
  fn: string;
  ln: string;
  school: string | null;
  title: string | null;
  hire_year: number | null;
  latest_appts: number;
  last_date: string | null;
  snapshot_id: string;
  d: string;
  pay: number | null;
  basis: string | null;
}

interface PersonHit {
  person_key: string;
  fn: string;
  ln: string;
  school: string | null;
  title: string | null;
  hire_year: number | null;
  latest_appts: number;
  last_date: string | null;
  /** Actual pay by snapshot, dated (snapX), for the sparkline. */
  series: { x: number; y: number }[];
  breaks: number[];
  /** Actual pay in their latest snapshot. */
  pay: number | null;
}

type Item =
  | { kind: 'person'; key: string; hit: PersonHit }
  | { kind: 'title'; key: string; hit: TitleHit }
  | { kind: 'division'; key: string; hit: DivisionHit };

/**
 * The matched people with their pay in every snapshot. `hits` must return one row per person with an
 * `ord` column giving their order in the list.
 */
function withSeries(hits: string): string {
  return `WITH hits AS (${hits}),
     series AS (
       SELECT s.person_key, s.snapshot_id, any_value(s.snapshot_date) d, ${personPay('fte')} pay,
              first(s.comp_basis ORDER BY coalesce(s.fte, 0) DESC, s.salary DESC) basis
       FROM salaries s JOIN hits USING (person_key) GROUP BY s.person_key, s.snapshot_id)
     SELECT hits.*, series.snapshot_id, series.d, series.pay, series.basis
     FROM hits JOIN series USING (person_key)
     ORDER BY hits.ord, series.d, series.snapshot_id`;
}

function toPeople(rows: HitRow[] | undefined): PersonHit[] {
  if (!rows) return [];
  const by = new Map<string, { hit: HitRow; snaps: HitRow[] }>();
  for (const r of rows) {
    const cur = by.get(r.person_key);
    if (cur) cur.snaps.push(r);
    else by.set(r.person_key, { hit: r, snaps: [r] });
  }
  return [...by.values()].map(({ hit, snaps }) => {
    const pts = snaps
      .filter((s) => s.pay != null && s.pay > 0)
      .map((s) => ({ x: snapX(s.d, s.snapshot_id), y: s.pay as number, basis: s.basis }))
      .sort((a, b) => a.x - b.x);
    return {
      person_key: hit.person_key, fn: hit.fn, ln: hit.ln, school: hit.school, title: hit.title,
      hire_year: hit.hire_year, latest_appts: hit.latest_appts, last_date: hit.last_date,
      series: pts.map(({ x, y }) => ({ x, y })),
      breaks: reportingBreaks(pts),
      pay: pts.length ? pts[pts.length - 1].y : null,
    };
  });
}

const CARD_BORDER = 'var(--mantine-color-default-border)';
// md holds the palette's four people and a title without a scroll; the room on screen caps them all.
const GROUPED_MAX_HEIGHT: Record<DropdownSize, number> = { sm: 300, md: 460, lg: 560 };
// Defined once in app.css (`--shadow-merged-card`) so the light and dark inks stay together;
// this was the same literal in three files, and dark ink on the dark canvas showed nothing.
const CARD_SHADOW = 'var(--shadow-merged-card)';

/** A group's heading inside the listbox. Presentational: the group takes its name from it. */
function GroupLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Text id={id} role="presentation" className="search-group-label" fz={11} fw={600} tt="uppercase" c="dimmed" px={10} pt={8} pb={2}>
      {children}
    </Text>
  );
}

/**
 * The one search box: people, and — where the page can go to them — titles and divisions.
 *
 * Titles and divisions come from a small build-time index (`search-index.json`), fetched when the box
 * is first focused, so they answer while the database is still loading; people fill in once it is
 * ready. `kinds` decides which groups a box offers: a picker that can only take a person asks for
 * `['people']` and shows a plain list with no groups.
 */
export function SearchBox({
  placeholder,
  autoFocus = false,
  onSelect,
  onPick,
  onPickTitle,
  onPickDivision,
  kinds = ALL_KINDS,
  size = 'md',
  peopleInGroup = GROUP_LIMIT.people,
}: {
  placeholder?: string;
  autoFocus?: boolean;
  onSelect?: () => void;
  /** When set, picking a person calls this (and clears the input) instead of navigating to the profile. */
  onPick?: (hit: { person_key: string; name: string }) => void;
  /** When set, picking a title calls this instead of opening the title page. */
  onPickTitle?: (hit: TitleHit) => void;
  /** When set, picking a division calls this instead of opening the division page. */
  onPickDivision?: (hit: DivisionHit) => void;
  kinds?: readonly SearchKind[];
  /** One of the three standard sizes — the menu scales to match (lg = the centered landing box). */
  size?: DropdownSize;
  /** How many people a grouped list shows before "More people match" — fewer in the ⌘K palette, whose
   *  list sits lower on the screen, so its titles and divisions are not below the fold. */
  peopleInGroup?: number;
}) {
  const t = DROPDOWN_TIERS[size];
  // On a phone the full grouped placeholder was cut off at "Search people, titles or divis".
  const narrow = useMediaQuery('(max-width: 30em)', false, { getInitialValueInEffect: false }) ?? false;
  const large = size === 'lg';
  const grouped = kinds.some((k) => k !== 'people');
  const wantPeople = kinds.includes('people');
  const [term, setTerm] = useState('');
  const [debounced] = useDebouncedValue(term, 200);
  const q = debounced.trim().toLowerCase();
  const enabled = q.length >= 2;
  const peopleLimit = grouped ? peopleInGroup + 1 : 25;

  // Fetched on first focus — on the landing page that is the page load, since its box is autofocused.
  const [focused, setFocused] = useState(autoFocus);
  const { data: index } = useSearchIndex(focused && grouped);
  const titles = useMemo(() => (kinds.includes('titles') ? matchTitles(index, q) : []), [kinds, index, q]);
  const divisions = useMemo(() => (kinds.includes('divisions') ? matchDivisions(index, q) : []), [kinds, index, q]);

  const { data: primaryRows, isFetching: primaryFetching, isError: primaryFailed } = useSql<HitRow>(
    ['search', q, peopleLimit],
    withSeries(
      // People still here first, then by name ignoring case: every snapshot before Sep 2025 spells
      // names in capitals, so a plain ORDER BY put everyone who left before then ahead of everyone
      // still here — and with six rows shown, departed people filled the list.
      `SELECT *, row_number() OVER (ORDER BY last_date < (SELECT max(snapshot_date) FROM salaries), lower(ln), lower(fn), person_key) ord FROM (
         SELECT person_key,
            arg_max(first_name, snapshot_date) AS fn,
            arg_max(last_name, snapshot_date)  AS ln,
            arg_max(school, snapshot_date)     AS school,
            arg_max(title, snapshot_date)      AS title,
            arg_max(hire_year, snapshot_date)  AS hire_year,
            arg_max(per_snap, snapshot_date)   AS latest_appts,
            max(snapshot_date)                 AS last_date
         FROM (
           SELECT person_key, first_name, last_name, school, title, hire_year, snapshot_date,
                  count(*) OVER (PARTITION BY person_key, snapshot_id) per_snap
           FROM salaries
           WHERE lower(first_name || ' ' || last_name) LIKE ${sqlLikeContains(q)} ESCAPE '\\'
         )
         GROUP BY person_key
       ) ORDER BY ord LIMIT ${peopleLimit}`
    ),
    enabled && wantPeople
  );
  const primaryHits = useMemo(() => (primaryRows ? toPeople(primaryRows) : undefined), [primaryRows]);

  // Typo fallback: only runs once the exact-match query has settled with zero hits. Uses DuckDB's
  // built-in Jaro-Winkler similarity against the full display name; > 0.86 keeps it to near-misses
  // (transposed/missing letters) rather than surfacing unrelated names.
  const fuzzyEnabled = enabled && wantPeople && !primaryFetching && primaryHits?.length === 0 && q.length >= 3;
  const { data: fuzzyRows, isFetching: fuzzyFetching } = useSql<HitRow>(
    ['search-fuzzy', q, peopleLimit],
    // Collapse to one row per person BEFORE scoring. This used to compute a Jaro-Winkler similarity
    // for every row — ~250k of them, i.e. each person once per snapshot — on every debounce that
    // found no exact match, which is constantly while someone types a name the data doesn't have.
    // The score depends only on the name, so all but one evaluation per person was waste: ~22k
    // comparisons instead of ~250k, for identical results.
    //
    // Deliberately NOT prefiltered on a first letter, which is the tempting version of this: a
    // typo IN the first letter still scores well above the threshold (jaro_winkler('jenneth poss',
    // 'kenneth poss') is ~0.94), so that filter would silently drop exactly the misspellings this
    // fallback exists to catch.
    withSeries(
      `SELECT *, row_number() OVER (ORDER BY sim DESC, person_key) ord FROM (
         SELECT person_key, fn, ln, school, title, hire_year, last_date, 1 AS latest_appts,
            jaro_winkler_similarity(lower(fn || ' ' || ln), ${sqlStr(q)}) AS sim
         FROM (
           SELECT person_key,
              arg_max(first_name, snapshot_date) AS fn,
              arg_max(last_name, snapshot_date)  AS ln,
              arg_max(school, snapshot_date)     AS school,
              arg_max(title, snapshot_date)      AS title,
              arg_max(hire_year, snapshot_date)  AS hire_year,
              max(snapshot_date)                 AS last_date
           FROM salaries
           GROUP BY person_key
         )
       ) WHERE sim > 0.86 ORDER BY ord LIMIT ${Math.min(peopleLimit, 8)}`
    ),
    fuzzyEnabled
  );
  const fuzzyHits = useMemo(() => toPeople(fuzzyRows), [fuzzyRows]);

  const usingFuzzy = (primaryHits?.length ?? 0) === 0 && fuzzyHits.length > 0;
  const peopleBusy = wantPeople && enabled && (primaryFetching || (primaryHits === undefined && !primaryFailed) || (fuzzyEnabled && fuzzyFetching));

  // Latest campus snapshot date — anyone whose last record predates it is no longer in the data
  // (likely departed). Mirrors the PersonDashboard "departed" check.
  const { data: summary } = useSummary();
  const campusLatestDate = summary?.snapshots?.[summary.snapshots.length - 1]?.date ?? null;

  const nav = useNavigate();

  const people = useMemo(() => (usingFuzzy ? fuzzyHits : (primaryHits ?? [])), [usingFuzzy, fuzzyHits, primaryHits]);
  const peopleShown = grouped ? people.slice(0, peopleInGroup) : people;
  const morePeople = grouped && people.length > peopleInGroup;

  // Keyboard navigation for the autocomplete (combobox semantics): one flat list across the groups,
  // in the order they are drawn.
  const items = useMemo<Item[]>(
    () => [
      ...peopleShown.map((hit): Item => ({ kind: 'person', key: `p:${hit.person_key}`, hit })),
      ...titles.map((hit): Item => ({ kind: 'title', key: `t:${hit.code}`, hit })),
      ...divisions.map((hit): Item => ({ kind: 'division', key: `d:${hit.school}`, hit })),
    ],
    [peopleShown, titles, divisions]
  );
  const opened = enabled;

  // Detect homonyms within the current results (same display name, different person).
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of people) {
      const k = `${h.fn} ${h.ln}`.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [people]);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;
  const [active, setActive] = useState(0);
  // Whether the reader has chosen a row (see `enterPick`).
  const [moved, setMoved] = useState(false);
  // An Enter pressed while people were still being searched: the text it was pressed on (as `q` will
  // read it once the debounce catches up), opened once people have answered for it.
  const [pendingEnter, setPendingEnter] = useState<string | null>(null);
  const itemKeys = items.map((i) => i.key).join('|');
  useEffect(() => { setActive(0); }, [itemKeys]);
  useEffect(() => { setMoved(false); }, [q]);
  useEffect(() => { document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, listId]);

  const select = (it: Item) => {
    if (it.kind === 'person') {
      const h = it.hit;
      if (onPick) {
        onPick({ person_key: h.person_key, name: fullName(h.fn, h.ln) });
        setTerm('');
        return;
      }
      nav(`/person/${encodeURIComponent(h.person_key)}`);
    } else if (it.kind === 'title') {
      if (onPickTitle) {
        onPickTitle(it.hit);
        setTerm('');
        return;
      }
      nav(`/paycheck?code=${encodeURIComponent(it.hit.code)}`);
    } else {
      if (onPickDivision) {
        onPickDivision(it.hit);
        setTerm('');
        return;
      }
      nav(`/school/${encodeURIComponent(it.hit.school)}`);
    }
    onSelect?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setTerm(''); setPendingEnter(null); return; }
    if (!opened) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const i = enterPick(active, items.length, peopleBusy, moved);
      if (i === 'wait') setPendingEnter(term.trim().toLowerCase());
      else if (i != null) select(items[i]);
      return;
    }
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMoved(true); setPendingEnter(null); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMoved(true); setPendingEnter(null); setActive((a) => Math.max(0, a - 1)); }
  };
  // The kept Enter: dropped if the text changes; otherwise the first row, once the search has caught up
  // with that text and people have answered for it.
  useEffect(() => {
    if (pendingEnter == null) return;
    if (term.trim().toLowerCase() !== pendingEnter) { setPendingEnter(null); return; }
    if (q !== pendingEnter || peopleBusy) return;
    setPendingEnter(null);
    if (items.length) select(items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, term, q, peopleBusy, items.length]);

  const rowStyle = (i: number) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    borderRadius: 6,
    background: i === active ? 'var(--mantine-color-default-hover)' : undefined,
  });
  const optionProps = (i: number, it: Item) => ({
    id: optId(i),
    role: 'option',
    'aria-selected': i === active,
    'data-kind': it.kind,
    onMouseEnter: () => { setActive(i); setMoved(true); },
    onClick: () => select(it),
    px: 10,
    py: t.rowPad,
    style: rowStyle(i),
  });

  const personRow = (h: PersonHit, i: number) => {
    const sharedName = (nameCounts.get(`${h.fn} ${h.ln}`.trim().toLowerCase()) ?? 0) > 1;
    const multiAppt = (h.latest_appts ?? 0) > 1; // only flag roles held in the latest snapshot
    // Departed employees read in the muted ink with a "Former" badge. They used to be faded to 55% as
    // well, which put their names at 2.5:1 — below what any text on the site may be.
    const inactive = campusLatestDate != null && h.last_date != null && String(h.last_date) < String(campusLatestDate);
    return (
      <UnstyledButton key={items[i].key} {...optionProps(i, items[i])}>
        <Group wrap="nowrap" gap="sm" justify="space-between" align="center">
          <Box style={{ minWidth: 0, flex: 1 }}>
            {/* Top line: name (bold) + status badges. */}
            <Group wrap="nowrap" gap="xs" align="center" style={{ minWidth: 0 }}>
              <Text fz={t.nameFont} fw={600} c={inactive ? 'dimmed' : undefined} truncate="end" style={{ minWidth: 0 }}>
                {fullName(h.fn, h.ln)}
              </Text>
              {inactive && (
                <Tooltip label="Not in the latest snapshot — may no longer be employed." withArrow position="top">
                  <Badge size="xs" radius="sm" variant="light" color="gray" style={{ flexShrink: 0, cursor: 'pointer' }}>
                    Former
                  </Badge>
                </Tooltip>
              )}
              {multiAppt && (
                <Tooltip label="Holds multiple appointments in the latest snapshot (e.g., split or joint roles)." withArrow position="top">
                  <Badge size="xs" radius="sm" variant="default" fw={500} style={{ flexShrink: 0, cursor: 'pointer' }}>
                    Multiple roles
                  </Badge>
                </Tooltip>
              )}
              {sharedName && (
                <Tooltip label="Multiple people share this name — double-check this is the right person." multiline w={260} withArrow position="top">
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <IconAlertTriangle size={ICON.compact} color="var(--mantine-color-orange-6)" />
                  </span>
                </Tooltip>
              )}
            </Group>
            {/* Bottom line: title · school · hire year (smaller, muted) — the hire year is the
                main way to tell two same-named people apart in the dropdown. */}
            {(h.title || h.school || h.hire_year) && (
              <Text fz={t.subFont} c="dimmed" lineClamp={1} mt={1}>
                {[h.title, h.school, h.hire_year ? `Hired ${h.hire_year}` : null].filter(Boolean).join(' · ')}
              </Text>
            )}
          </Box>
          {/* Pay now (or when last seen), with its path — the figure is part of the option's name;
              the sparkline beside it is decoration. */}
          {h.pay != null && (
            <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Sparkline points={h.series} breaks={h.breaks} stroke={inactive ? 'var(--mantine-color-dimmed)' : undefined} />
              <Text fz={t.subFont} fw={600} c={inactive ? 'dimmed' : undefined} className="search-pay" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {inactive ? `last ${usd(h.pay)}` : usd(h.pay)}
              </Text>
            </Group>
          )}
        </Group>
      </UnstyledButton>
    );
  };

  const titleRow = (h: TitleHit, i: number) => (
    <UnstyledButton key={items[i].key} {...optionProps(i, items[i])}>
      <Group wrap="nowrap" gap="xs" align="center" style={{ minWidth: 0 }}>
        <Text fz={t.nameFont} fw={600} truncate="end" style={{ minWidth: 0 }}>{h.title}</Text>
        <span className="code-pill">{h.code}</span>
      </Group>
      <Text fz={t.subFont} c="dimmed" mt={1}>
        {num(h.n)} {h.n === 1 ? 'person' : 'people'}{h.med != null ? ` · median ${usd(h.med)}` : ''}
      </Text>
    </UnstyledButton>
  );

  const divisionRow = (h: DivisionHit, i: number) => (
    <UnstyledButton key={items[i].key} {...optionProps(i, items[i])}>
      <Text fz={t.nameFont} fw={600} truncate="end">{h.school}</Text>
      <Text fz={t.subFont} c="dimmed" mt={1}>
        {num(h.n)} {h.n === 1 ? 'person' : 'people'}{h.med != null ? ` · median ${usd(h.med)}` : ''}
      </Text>
    </UnstyledButton>
  );

  const nPeople = peopleShown.length;
  const showPeopleGroup = wantPeople && (nPeople > 0 || peopleBusy);
  const empty = items.length === 0 && !peopleBusy;

  return (
    <Popover
      opened={!!opened}
      width="target"
      position="bottom-start"
      offset={0}
      radius={t.radius}
      withinPortal
      trapFocus={false}
      returnFocus={false}
      closeOnClickOutside={false}
      closeOnEscape
      // The list is never taller than the room below (or above) the box: in the ⌘K palette on a 720px
      // screen it ran past the modal and the screen's bottom, and its titles were off-screen. The room
      // is handed to the style below as a variable, so the tier's own cap still applies where it is lower.
      middlewares={{
        flip: true,
        shift: true,
        size: {
          padding: 12,
          apply({ availableHeight, elements }) {
            elements.floating.style.setProperty('--search-room', `${Math.max(180, Math.floor(availableHeight))}px`);
          },
        },
      }}
    >
      <Popover.Target>
        <div style={{ width: '100%', maxWidth: large ? '100%' : 720, margin: large ? '0 auto' : undefined }}>
          <TextInput
            size={t.mantineSize}
            radius={t.radius}
            leftSection={<IconSearch size={t.icon} />}
            leftSectionWidth={large ? 56 : undefined}
            placeholder={placeholder ?? (grouped ? (narrow ? 'Name, title or division…' : 'Search people, titles or divisions…') : 'Search a person…')}
            value={term}
            onChange={(e) => setTerm(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            rightSection={peopleBusy ? <Loader size="sm" /> : null}
            aria-label={grouped ? 'Search a person, title or division' : 'Search a person'}
            role="combobox"
            aria-expanded={!!opened}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={opened && items.length ? optId(active) : undefined}
            data-autofocus={autoFocus || undefined}
            autoFocus={autoFocus}
            classNames={large ? { input: 'hero-search-input' } : undefined}
            styles={{
              input: {
                fontSize: t.inputFont,
                ...(large ? { fontWeight: 500 } : {}),
                // While results show, flatten the bottom and merge into one card with the dropdown.
                ...(opened
                  ? {
                      borderBottomLeftRadius: 0,
                      borderBottomRightRadius: 0,
                      borderBottomWidth: 0,
                      borderColor: CARD_BORDER,
                      boxShadow: CARD_SHADOW,
                    }
                  : {}),
              },
            }}
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown
        p={0}
        className="search-dropdown"
        style={{
          // Grouped, the list holds up to 13 rows in two columns; the tier's height would cut the
          // people column off above its sixth row on the landing box.
          maxHeight: `min(${grouped ? Math.max(t.maxDropdown, GROUPED_MAX_HEIGHT[size]) : t.maxDropdown}px, var(--search-room, 100vh))`,
          overflowY: 'auto',
          // Flat top flush against the input; bottom radius pairs with the input; one continuous card.
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderTopWidth: 0,
          borderBottomLeftRadius: t.radius,
          borderBottomRightRadius: t.radius,
          borderColor: CARD_BORDER,
          boxShadow: CARD_SHADOW,
        }}
      >
        {empty ? (
          <Text size="sm" c="dimmed" px="md" py={10}>
            No matches for “{debounced}”.
          </Text>
        ) : grouped ? (
          // Grouped: People, then Titles, then Divisions, each a labelled group of options. Where the
          // box is wide, people take the left column and titles and divisions the right, so all three
          // show without scrolling (app.css, .search-groups).
          <div className="search-groups" style={{ padding: t.island }} role="listbox" id={listId} aria-label="Search results">
            {showPeopleGroup && (
              <div role="group" aria-labelledby={`${listId}-people`} className="search-group" data-group="people">
                <GroupLabel id={`${listId}-people`}>{usingFuzzy ? 'People — no exact match, did you mean' : 'People'}</GroupLabel>
                {nPeople === 0 && peopleBusy && (
                  <Group gap={8} px={10} py={t.rowPad} className="search-status">
                    <Loader size={12} />
                    <Text fz={t.subFont} c="dimmed">Searching people…{pendingEnter != null ? ' Enter opens the first match once they arrive.' : ''}</Text>
                  </Group>
                )}
                {peopleShown.map((h, i) => personRow(h, i))}
                {morePeople && (
                  <Text fz={t.subFont} c="dimmed" px={10} py={4} className="search-status">
                    More people match — keep typing to narrow them.
                  </Text>
                )}
              </div>
            )}
            {(titles.length > 0 || divisions.length > 0) && (
            <div role="presentation" className="search-side">
            {titles.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-titles`} className="search-group" data-group="titles">
                <GroupLabel id={`${listId}-titles`}>Titles</GroupLabel>
                {titles.map((h, j) => titleRow(h, nPeople + j))}
              </div>
            )}
            {divisions.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-divisions`} className="search-group" data-group="divisions">
                <GroupLabel id={`${listId}-divisions`}>Divisions</GroupLabel>
                {divisions.map((h, j) => divisionRow(h, nPeople + titles.length + j))}
              </div>
            )}
            </div>
            )}
          </div>
        ) : items.length > 0 ? (
          // Island buffer; rows are rounded chips inset from the walls + clear of the scrollbar.
          <Stack gap={1} p={t.island} role="listbox" id={listId}>
            {usingFuzzy && (
              <Text size="xs" c="dimmed" fs="italic" px={10} pt={6} pb={2}>
                No exact match — did you mean:
              </Text>
            )}
            {peopleShown.map((h, i) => personRow(h, i))}
          </Stack>
        ) : null}
      </Popover.Dropdown>
    </Popover>
  );
}
