import { useEffect, useState, type ReactNode } from 'react';
import { Stack, Title, Text, Table, Badge, Skeleton, Alert, Group, Code, Anchor, Card, Accordion, Tooltip, SimpleGrid, Paper, Button, Box, ActionIcon, Switch, ThemeIcon, Select, ScrollArea, VisuallyHidden } from '@mantine/core';
import { IconAlertTriangle, IconBrandGithub, IconDownload, IconBraces, IconBook2, IconCash, IconClock, IconStack2, IconArrowUp, IconReload } from '@tabler/icons-react';
import { useManifest, useActiveSnapshotId } from '../lib/hooks';
import { num, usd } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Eyebrow } from '../components/Eyebrow';
import { dropdownProps } from '../lib/selectProps';
import { MiniBar } from '../components/MiniBar';
import { DuplicateIdentities } from '../components/DuplicateIdentities';
import { DeltaChip, type DeltaTone } from '../components/Delta';
import { SortableTh, type SortState } from '../components/SortableTh';
import { CardTitle } from '../components/CardTitle';
import { useDocTitle } from '../lib/useDocTitle';
import { REAL_BASE_YEAR } from '../lib/cpi';
import { REPO_URL } from '../lib/links';
import type { SnapshotInfo } from '../lib/manifest';
import { ICON } from '../lib/ui';

// 'pos' (not stock Mantine 'green') — the app's own vetted positive palette; plain 'green's light-variant
// text (green-7, ~2.4:1 on this badge's pale fill) fails WCAG AA, 'pos' clears it comfortably (~5:1).
const STATUS_COLOR: Record<string, string> = { ok: 'pos', warning: 'orange', error: 'red', info: 'gray' };

/** The columns one appointment row carries. Kept here rather than inline so the count in the disclosure
 *  label can't drift from the list, and `data-about.spec.ts` can check it against the manifest. */
const PROSE = 'var(--content-prose)'; // The app-wide reading column (app.css). Without it prose ran to 1440px here.

const RECORD_FIELDS = [
  'name', 'title', 'job code', 'school', 'department', 'grade', 'basis', 'salary',
  'FTE-adjusted salary', 'base pay', 'FTE', 'pay-rate type', 'FLSA status',
  'employee category', 'employee type', 'hire date',
] as const;

/** Snapshot-over-snapshot delta chip for the ingestion table. `tone="neutral"` for headcount (a
 *  population size, not a status); the median-salary delta keeps `signed` (money). */
function Delta({ frac, tone = 'signed' }: { frac: number | null; tone?: DeltaTone }) {
  return <DeltaChip frac={frac} tone={tone} flatLabel="0.0%" />;
}

/** One disclaimer caveat: a small amber marker + a bold lead phrase + the rest — laid out in a 2-col grid. */
function DItem({ lead, children, id }: { lead: string; children: ReactNode; id?: string }) {
  return (
    <Group id={id} wrap="nowrap" gap={8} align="flex-start">
      <Box mt={8} style={{ width: 5, height: 5, borderRadius: 999, flexShrink: 0, background: 'var(--mantine-color-orange-5)' }} />
      <Text size="sm"><b>{lead}</b> — {children}</Text>
    </Group>
  );
}

/** Table header with an optional explanatory tooltip (dotted "help" underline). */
function Th({ children, tip, ta }: { children: ReactNode; tip?: string; ta?: 'right' }) {
  if (!tip) return <Table.Th ta={ta}>{children}</Table.Th>;
  return (
    <Table.Th ta={ta}>
      <Tooltip label={tip} multiline w={250} withArrow>
        <span style={{ borderBottom: '1px dotted var(--mantine-color-dimmed)', cursor: 'help' }}>{children}</span>
      </Tooltip>
    </Table.Th>
  );
}

/** One of the page's two subjects. The sections beneath are h3s, so the outline reads
 *  h1 (page) → h2 (subject) → h3 (section) with nothing skipped. */
function Zone({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <Stack gap="lg">
      <Box>
        <Title order={2}>{title}</Title>
        <Text c="dimmed" mt={4} maw={PROSE}>{blurb}</Text>
      </Box>
      {children}
    </Stack>
  );
}

/** One "Pay" definition: an accent icon anchor + bold term + description, in a small bordered card. */
function DefCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap={8} mb={4} wrap="nowrap">
        <ThemeIcon variant="light" color="accent" size="md" radius="md">{icon}</ThemeIcon>
        <Text size="sm" fw={700}>{title}</Text>
      </Group>
      <Text size="sm">{children}</Text>
    </Paper>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Resolve a static asset's size via a HEAD request (so a download button can show its payload up front). */
function useFileSize(url: string): string | null {
  const [size, setSize] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const len = r.headers.get('content-length');
        if (!cancelled && len) setSize(formatBytes(Number(len)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);
  return size;
}

/** A floating "back to top" button that slides into view once the reader scrolls past one viewport. */
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <ActionIcon
      className="back-to-top" data-show={show || undefined}
      variant="filled" color="accent" size="xl" radius="xl" aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <IconArrowUp size={ICON.nav} />
    </ActionIcon>
  );
}

type SortKey = 'date' | 'rows';

/** Height of the fixed chrome this page stacks (app header + sticky jump nav), read from the single
 *  `--data-chrome-top` token in app.css so JS and CSS cannot drift apart. */
function chromeTop(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--data-chrome-top');
  return parseInt(raw, 10) || 108;
}

/** Sticky "Jump to" nav with a scrollspy highlight — an IntersectionObserver lights up the chip whose
 *  section is currently in view. */
function JumpNav({ items }: { items: [string, string][] }) {
  const [active, setActive] = useState(items[0]?.[0] ?? '');
  useEffect(() => {
    const ids = items.map(([h]) => h.slice(1));
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const seen = new Map<string, boolean>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const current = ids.find((id) => seen.get(id));
        if (current) setActive(`#${current}`);
      },
      // Same source of truth as `.data-jumpnav`'s `top` and the sections' `scroll-margin-top`.
      { rootMargin: `-${chromeTop() + 4}px 0px -75% 0px`, threshold: 0 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);
  return (
    <Group gap="sm" wrap="wrap" className="data-jumpnav">
      <Eyebrow>Jump to</Eyebrow>
      {items.map(([href, label]) => (
        <Anchor key={href} href={href} size="xs" underline="never" className={`data-jump-chip${active === href ? ' active' : ''}`}>
          {label}
        </Anchor>
      ))}
    </Group>
  );
}

export default function DataHealth() {
  useDocTitle('Data · About');
  const { data: manifest, isLoading, error, refetch } = useManifest();
  const snapId = useActiveSnapshotId();
  const [compact, setCompact] = useState(false);
  // 'date' ascending reproduces the chronological default the table always had.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'date', dir: 'asc' });
  const [year, setYear] = useState('all');
  const parquetUrl = `${import.meta.env.BASE_URL}data/salaries.parquet`;
  const manifestUrl = `${import.meta.env.BASE_URL}data/manifest.json`;
  const parquetSize = useFileSize(parquetUrl);
  const manifestSize = useFileSize(manifestUrl);


  // Shimmer skeleton while the static manifest payload is fetched, so the page never flashes empty.
  if (isLoading)
    return (
      <Stack gap="lg" className="data-about">
        <Skeleton height={56} width="45%" radius="md" />
        <Skeleton height={120} radius="lg" />
        <Skeleton height={220} radius="lg" />
        <Skeleton height={260} radius="lg" />
      </Stack>
    );
  if (error)
    return (
      <Alert color="red" variant="light" radius="md" icon={<IconAlertTriangle size={ICON.nav} />} title="Couldn't load the data manifest">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            The ingestion manifest failed to load ({(error as Error).message}). This is usually a temporary
            network hiccup fetching the static data file.
          </Text>
          <Button size="xs" variant="default" leftSection={<IconReload size={ICON.compact} />} onClick={() => refetch()}>Retry</Button>
        </Stack>
      </Alert>
    );

  const snaps = (manifest?.snapshots ?? []).filter((s) => s.row_count) as SnapshotInfo[];
  const dict = (manifest?.snapshots ?? []).find((s) => 'data_dictionary_url' in (s as object)) as
    | (SnapshotInfo & { data_dictionary_url?: string })
    | undefined;
  const latestSnap = snaps.length
    ? [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).at(-1)
    : undefined;
  // Chronological order, with Pre-TTC before Post-TTC for the shared Nov-2021 date.
  const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : 1);
  const orderedSnaps = [...snaps].sort(
    (a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id)
  );
  const maxRows = Math.max(1, ...orderedSnaps.map((s) => s.row_count || 0));
  const dpct = (cur?: number | null, prev?: number | null) =>
    cur != null && prev != null && prev !== 0 ? (cur - prev) / prev : null;

  // Snapshot-over-snapshot deltas are always measured against the *chronological* predecessor, so they stay
  // correct no matter how the reader sorts or filters the rows below.
  const prevMap = new Map<string, SnapshotInfo>();
  orderedSnaps.forEach((s, i) => { if (i > 0) prevMap.set(s.snapshot_id, orderedSnaps[i - 1]); });

  const years = [...new Set(snaps.map((s) => s.snapshot_year))].sort((a, b) => b - a);
  const yearOptions = [{ value: 'all', label: 'All years' }, ...years.map((y) => ({ value: String(y), label: String(y) }))];

  let displaySnaps = orderedSnaps;
  if (year !== 'all') displaySnaps = displaySnaps.filter((s) => String(s.snapshot_year) === year);
  {
    const mul = sort.dir === 'asc' ? 1 : -1;
    const cmp =
      sort.key === 'rows'
        ? (a: SnapshotInfo, b: SnapshotInfo) => ((a.row_count || 0) - (b.row_count || 0)) * mul
        : (a: SnapshotInfo, b: SnapshotInfo) =>
            (a.snapshot_date.localeCompare(b.snapshot_date) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id)) * mul;
    displaySnaps = [...displaySnaps].sort(cmp);
  }

  const toc: [string, string][] = [
    ['#source', 'Source'],
    ['#disclaimer', 'Accuracy'],
    ['#privacy', 'Privacy'],
    ['#how-it-works', 'Figures'],
    ['#methodology', 'Method'],
    ['#snapshots', 'Snapshots'],
    ['#duplicates', 'Duplicates'],
  ];

  return (
    <>
    <Stack gap="lg" className="tab-rise data-about">
      <Group gap={8} wrap="nowrap">
        <span className="live-dot" aria-hidden />
        <Text size="xs" c="dimmed">
          <b>Live</b> · data current as of {latestSnap?.snapshot_label ?? '—'}
          {manifest?.generated_at ? ` · site last built ${manifest.generated_at.slice(0, 10)}` : ''}
        </Text>
      </Group>
      <PageHeader
        title="Data · About"
        description="Where these salary records come from, how they were processed, and what they can and can't tell you."
      />

      <JumpNav items={toc} />

      <Zone
        title="What this data is"
        blurb="Who released these records, how far you can trust a number, and what the three pay views actually measure."
      >
      <Card id="source" maw={PROSE}>
        <CardTitle order={3} anchorId="source">Data source &amp; acknowledgment</CardTitle>
        <Stack gap="sm">
          <Text size="sm">
            The UW–Madison salary report files presented here are <b>public records</b>, obtained through
            Wisconsin open-records requests (Wisconsin Public Records Law, Wis. Stat. §§ 19.31–19.39) filed by{' '}
            <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" fw={600}>United Faculty &amp; Academic Staff (UFAS)</Anchor>
            {' '}— AFT Local 223, AFL-CIO, the union representing UW–Madison faculty and academic staff.
            Their open-records work is what makes this transparency possible, and the credit for these
            records belongs to them.
          </Text>
          <Text size="sm">
            This site is an independent project built by Aaron Smetana to make those public records easier to
            explore. It is <b>not affiliated with, operated by, or endorsed by UFAS or UW–Madison</b> — any
            errors or interpretations here are the project's alone, not theirs.</Text>
          <Group gap="lg">
            <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" size="sm" fw={600}>
              Visit UFAS Local 223 →
            </Anchor>
            <Anchor href="https://docs.legis.wisconsin.gov/statutes/statutes/19/ii" target="_blank" rel="noopener noreferrer" size="sm">
              Wisconsin Public Records Law →
            </Anchor>
            <Anchor href="https://www.doj.state.wi.us/office-open-government/office-open-government" target="_blank" rel="noopener noreferrer" size="sm">
              File your own records request →
            </Anchor>
          </Group>
        </Stack>
      </Card>

      <Alert
        color="gray"
        variant="light"
        radius="lg"
        maw={PROSE}
        className="alert-warn"
        icon={<IconAlertTriangle size={ICON.feature} />}
        title="Accuracy & disclaimer — these numbers may not reflect reality"
        id="disclaimer"
        styles={{ title: { fontSize: 'var(--mantine-h4-font-size)', fontWeight: 700 } }}
      >
        <details className="disc-details" open>
          <summary>
            <Text span size="sm" fw={600}>
              Every figure here is a point-in-time, gross, best-effort transcription of a public spreadsheet —
              treat all of it as approximate, not as a person's verified pay.
            </Text>
          </summary>
          <Stack gap="sm" mt="sm">
          <Text size="sm">A number can be wrong or misleading for many reasons. For example:</Text>
          <Box className="disc-grid">
            <DItem lead="Part-time staff">the "Full-time rate" view is the annual rate, which is <i>more</i> than a half-time person actually earned.</DItem>
            <DItem lead="Multiple appointments">a person's pay is blended across roles, so a split or joint appointment may not read as you'd expect.</DItem>
            <DItem lead="Bonuses & deferred pay">coaches, executives, and others may receive supplemental, overload, deferred, or one-time compensation that isn't in these reports.</DItem>
            <DItem lead="Changes between snapshots">raises, promotions, leaves, or appointment changes that happen between two reports aren't captured, so true earnings can be higher or lower than any single number shown.</DItem>
            <DItem lead="Gross, not take-home">amounts are gross annualized figures and exclude benefits, taxes, and retirement.</DItem>
            <DItem lead="Nominal dollars">figures are as-reported (not inflation-adjusted) by default. A few charts (Person's Salary Trend, General Comparisons, Compare) offer a "{REAL_BASE_YEAR} $" toggle that approximates real purchasing power using published CPI-U annual averages — treat it as a rough guide, not an official inflation calculation, since the most recent year or two are estimated from partial-year data.</DItem>
            <DItem lead="Nov 2021 (TTC)">nearly every title, job code, and grade changed at once in a structural reclassification; those are relabels, not promotions or raises.</DItem>
            <DItem lead="Oct 2023 scope change">some reports excluded students/trainees, so headcount and joiner/leaver counts across that point partly reflect coverage, not real hiring or attrition.</DItem>
            <DItem lead="Column mapping">columns are auto-detected from each spreadsheet; a mis-mapped column can attach the wrong value to a field.</DItem>
            <DItem id="identity" lead="Identity matching">people are matched by name + hire date, with no employee ID in the source. Two different people can be merged into one, or one person split into two — meaning a salary can be attributed to the <b>wrong named person</b>.</DItem>
            <DItem lead="Name formatting & transcription">ALL-CAPS source names are auto-cased and can be mangled; values are read from published spreadsheets and may carry source or ingestion errors.</DItem>
          </Box>
          <Text size="sm" mt={4}>
            The information is provided "as is," may be inaccurate or incomplete, and carries{' '}
            <b>no warranty and no liability</b> — verify against official UW–Madison or State of Wisconsin
            sources before relying on it for any decision.
          </Text>
          </Stack>
        </details>
      </Alert>

      <Card id="privacy" maw={PROSE}>
        <CardTitle order={3} anchorId="privacy">Privacy &amp; responsible use</CardTitle>
        <Stack gap="sm">
          <Text size="sm">
            These records name <b>real people</b>. The salaries of public-university employees are a Wisconsin
            public record, but "public" is not a license to harass, dox, shame, or target anyone. Please use this
            site to understand pay structures, ranges, and equity — not to make judgments about individuals.
          </Text>
          <Text size="sm">
            Only the fields released in the public salary reports are shown — name, title, department, school,
            pay, FTE, and hire date. <b>No</b> home addresses, contact details, ID numbers, demographic data, or
            anything beyond the released report is collected or displayed.
          </Text>
          <Text size="sm">
            A salary here is pay for a role at a point in time — <b>not</b> a person's total compensation or
            their worth. And the most consequential error this data can make is naming the{' '}
            <Anchor href="#identity" underline="always">wrong person</Anchor>.
          </Text>
        </Stack>
      </Card>

      <Card id="how-it-works" maw={PROSE}>
        <CardTitle order={3} anchorId="how-it-works">How these figures are calculated</CardTitle>
        <Stack gap="sm">
          <Text size="sm">
            Each source row is one <b>appointment</b>, carrying a full-time annual rate and an FTE — the
            appointment percentage, where 0.5 is half-time. Hourly appointments report no FTE at all; they are
            counted at their full listed rate rather than as zero. The "Pay" control switches between three views:
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            <DefCard icon={<IconCash size={ICON.control} />} title="Actual pay">Rate × FTE (or the full rate, for hourly staff with no FTE on file) — closest to what the person was actually paid.</DefCard>
            <DefCard icon={<IconClock size={ICON.control} />} title="Full-time rate">The listed annual rate. For part-time staff this is <i>more</i> than they actually earned.</DefCard>
            <DefCard icon={<IconStack2 size={ICON.control} />} title="Base pay">Base salary as reported; may exclude supplemental or overload pay.</DefCard>
          </SimpleGrid>
          <Text size="sm">
            A person holding <b>more than one paid appointment</b> is combined by summing each appointment's
            actual (rate × FTE) earnings, so split roles aren't double-counted. Unpaid $0 affiliate
            appointments are excluded from headcount, medians, and totals.
          </Text>
        </Stack>
      </Card>

      </Zone>

      <Zone
        title="How it was built"
        blurb="The pipeline from a published spreadsheet to the numbers on this site — auditable, and downloadable in full."
      >
      <Card id="methodology" maw={PROSE}>
        <CardTitle order={3} anchorId="methodology">Methodology, reproducibility &amp; downloads</CardTitle>
        <Stack gap="sm">
          <Text size="sm">
            This project is open source. The ingestion code, column-detection logic, and applied corrections are
            all public, so you can audit exactly how each published spreadsheet becomes the data shown here — or
            reproduce it from the raw records yourself.
          </Text>
          <Group gap="sm" wrap="wrap">
            <Button component="a" className="data-dl-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer" variant="default" size="xs" leftSection={<IconBrandGithub size={ICON.compact} />}>Source code &amp; ingestion</Button>
            <Button component="a" className="data-dl-btn" href={parquetUrl} download variant="default" size="xs" leftSection={<IconDownload size={ICON.compact} />}>Dataset (Parquet){parquetSize ? ` · ${parquetSize}` : ''}</Button>
            <Button component="a" className="data-dl-btn" href={manifestUrl} target="_blank" rel="noopener noreferrer" variant="default" size="xs" leftSection={<IconBraces size={ICON.compact} />}>Manifest (JSON){manifestSize ? ` · ${manifestSize}` : ''}</Button>
            {dict?.data_dictionary_url && (
              <Button component="a" className="data-dl-btn" href={dict.data_dictionary_url} target="_blank" rel="noopener noreferrer" variant="default" size="xs" leftSection={<IconBook2 size={ICON.compact} />}>Data dictionary</Button>
            )}
          </Group>

          {/* `order` wraps each Accordion.Control's <button> in an <h3>, which is the ARIA pattern for
              an accordion. These two labels read as card headings but cannot BE `CardTitle`: a heading
              nested inside a button is invalid, and Accordion.Control renders a button. */}
          <Accordion variant="contained" mt="xs" multiple order={3}>
            <Accordion.Item value="record">
              <Accordion.Control>
                <Text size="sm" fw={600}>What's in a record — {RECORD_FIELDS.length} fields</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Text size="xs" c="dimmed" mb="sm">
                  Each appointment row carries these, tagged with the snapshot it came from. The three "Pay"
                  views are derived from them; nothing else about a person is stored.
                </Text>
                <Group gap={6} wrap="wrap">
                  {RECORD_FIELDS.map((f) => (
                    <Code key={f} className="kbd-chip">{f}</Code>
                  ))}
                </Group>
              </Accordion.Panel>
            </Accordion.Item>

            {latestSnap && Object.keys(latestSnap.detected_mapping).length > 0 && (
              <Accordion.Item value="mapping">
                <Accordion.Control>
                  <Text size="sm" fw={600}>Detected column mappings — {latestSnap.snapshot_label}</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text size="xs" c="dimmed" mb="sm">
                    How each column in the source spreadsheet was auto-mapped to a field in this app (detection
                    runs per snapshot; this is the latest). A mis-detection here is one way a value can be mislabeled.
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6} verticalSpacing={6}>
                    {Object.entries(latestSnap.detected_mapping).map(([field, col]) => (
                      <Group key={field} gap={6} wrap="nowrap">
                        <Code className="kbd-chip">{field}</Code>
                        <Text span size="xs" c="dimmed">→</Text>
                        <Text span size="sm" lineClamp={1} title={col}>{col}</Text>
                      </Group>
                    ))}
                  </SimpleGrid>
                  {latestSnap.unmapped_headers.length > 0 && (
                    <Text size="xs" c="dimmed" mt="sm">
                      Unmapped (ignored) source columns: {latestSnap.unmapped_headers.join(', ')}.
                    </Text>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            )}
          </Accordion>
        </Stack>
      </Card>

      <Card id="snapshots">
        <Group justify="space-between" align="center" mb="xs" wrap="wrap" gap="sm">
          <CardTitle order={3} anchorId="snapshots">Per-snapshot ingestion</CardTitle>
          <Group gap="sm" wrap="wrap">
            <Select
              {...dropdownProps('sm')}
              size="xs" w={120} aria-label="Filter snapshots by year" data={yearOptions}
              value={year} onChange={(v) => setYear(v ?? 'all')} allowDeselect={false}
            />
            <Switch size="xs" label="Hide technical details" checked={compact} onChange={(e) => setCompact(e.currentTarget.checked)} />
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          <b>{num(manifest?.total_rows)}</b> records · <b>{num(snaps.length)}</b> snapshots ·
          schema v{manifest?.schema_version} · last built {manifest?.generated_at?.slice(0, 16).replace('T', ' ')}
          {dict?.data_dictionary_url && (
            <> · <Anchor href={dict.data_dictionary_url} target="_blank" rel="noopener noreferrer" inherit>data dictionary →</Anchor></>
          )}
        </Text>
        <Box role="region" aria-label="Per-snapshot ingestion table" tabIndex={0} className="data-snap-region">
        {/* `stickyHeaderOffset` resolves against the nearest scrolling ancestor, which inside a
            ScrollContainer is the ScrollArea viewport — not the document. The old 108px offset therefore
            pushed the header 108px DOWN INTO the table, over the first two rows. `ScrollArea.Autosize`
            with a bounded height and no offset is what the app's seven other sticky tables use. */}
        <ScrollArea.Autosize mah={620} type="auto" offsetScrollbars="present" className="data-snap-scroll">
      <Table stickyHeader miw={compact ? 680 : 920} className="data-snap-table">
        <Table.Thead>
          <Table.Tr>
            <SortableTh sortKey="date" label="Snapshot" sort={sort} onSort={setSort} />
            {!compact && <Th>Source (file · sheet)</Th>}
            <SortableTh sortKey="rows" label="Rows" sort={sort} onSort={setSort} align="right" tip="Rows in the source spreadsheet — one per appointment (a person can hold several)." />
            <Th ta="right" tip="Distinct identities in the dump (name + hire date).">People</Th>
            <Th ta="right" tip="People with at least one paid appointment — the headcount used across the site.">Paid</Th>
            <Th ta="right" tip="Change in paid headcount vs the previous snapshot.">Δ paid</Th>
            <Th ta="right" tip="Appointments with no salary (affiliates given campus access), excluded from headcount and salary stats.">Unpaid $0</Th>
            <Th ta="right" tip="Median paid salary (full-time rate as reported in the source).">Median</Th>
            <Th ta="right" tip="Change in median vs the previous snapshot.">Δ median</Th>
            <Th>Status</Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {displaySnaps.map((s) => {
            const prev = prevMap.get(s.snapshot_id);
            return (
            <Table.Tr key={s.snapshot_id} style={{ background: s.note ? 'var(--mantine-color-default-hover)' : undefined }}>
              <Table.Td>
                <Text size="sm" fw={500}>{s.snapshot_label}</Text>
                {!compact && <Code className="kbd-chip">{s.snapshot_id}</Code>}
              </Table.Td>
              {!compact && (
                <Table.Td>
                  {/* Verbatim strings out of the source workbook, so they take the mono register
                      (app.css) rather than being retyped as prose. */}
                  <Text size="xs" className="mono">{s.source_file}</Text>
                  <Text size="xs" c="dimmed" className="mono">{s.source_sheet}</Text>
                </Table.Td>
              )}
              <Table.Td ta="right">
                {num(s.row_count)}
                <MiniBar frac={(s.row_count || 0) / maxRows} />
              </Table.Td>
              <Table.Td ta="right">{num(s.distinct_people)}</Table.Td>
              <Table.Td ta="right">{s.distinct_people_paid != null ? num(s.distinct_people_paid) : '—'}</Table.Td>
              <Table.Td ta="right">{prev ? <Delta frac={dpct(s.distinct_people_paid, prev?.distinct_people_paid)} tone="neutral" /> : '—'}</Table.Td>
              <Table.Td ta="right">{num(s.zero_or_null_salary)}</Table.Td>
              <Table.Td ta="right">{usd(s.salary_median)}</Table.Td>
              <Table.Td ta="right">{prev ? <Delta frac={dpct(s.salary_median, prev?.salary_median)} /> : '—'}</Table.Td>
              <Table.Td>
                <Badge
                  color={STATUS_COLOR[s.status] ?? 'gray'}
                  variant={s.status === 'ok' || s.status === 'info' ? 'light' : 'filled'}
                  radius="sm"
                  className={s.status === 'ok' ? 'pos-light-text' : undefined}
                >
                  <VisuallyHidden>System status: </VisuallyHidden>{s.status.toUpperCase()}
                </Badge>
                {!compact && s.messages.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>{s.messages.join('; ')}</Text>
                )}
                {!compact && s.unmapped_headers.length > 0 && (
                  <Text size="xs" c="dimmed" mt={2}>unmapped: {s.unmapped_headers.join(', ')}</Text>
                )}
                {s.note && (
                  <Text size="xs" fs="italic" c="dimmed" mt={2}>{s.note}</Text>
                )}
              </Table.Td>
            </Table.Tr>
            );
          })}
          {displaySnaps.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={compact ? 9 : 10}>
                <Text size="sm" c="dimmed" ta="center" py="md">No snapshots match this filter.</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
        </ScrollArea.Autosize>
        </Box>
        <Text size="xs" c="dimmed" mt="sm">
          Hover any column heading for its definition. A <b>shaded row</b> carries a note worth reading — the
          Nov-2021 TTC relabel, or the Oct-2023 scope change.
        </Text>
      </Card>

      <DuplicateIdentities snap={snapId} />
      </Zone>
    </Stack>
    <BackToTop />
    </>
  );
}
