import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Stack, Text, Skeleton, Alert, Group, Button, ActionIcon, Tabs } from '@mantine/core';
import { IconAlertTriangle, IconBrandGithub, IconDownload, IconArrowUp, IconReload } from '@tabler/icons-react';
import { useManifest, useActiveSnapshotId, useSummary } from '../lib/hooks';
import { num } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { FactStrip } from '../components/FactStrip';
import { OverflowTabsList } from '../components/OverflowTabsList';
import { useCrumbs } from '../app/PageTop';
import { useDocTitle } from '../lib/useDocTitle';
import { markTabSwitch } from '../lib/motion';
import { REPO_URL } from '../lib/links';
import type { SnapshotInfo } from '../lib/manifest';
import { ICON } from '../lib/ui';
import { ABOUT_TABS, RECORD_FIELDS, SECTION_TAB, useFileSize, type AboutTab } from '../components/about/shared';
import { OverviewTab, type PipelineFacts } from '../components/about/OverviewTab';
import { AccuracyTab } from '../components/about/AccuracyTab';
import { MethodTab } from '../components/about/MethodTab';
import { RangesTab } from '../components/about/RangesTab';
import { SnapshotsTab } from '../components/about/SnapshotsTab';
import { RenamesTab } from '../components/about/RenamesTab';

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

/** "Nov 2021 (Pre-TTC)" → "Nov 2021": a span names months, not which side of the relabel. */
const monthOf = (label: string | undefined) => label?.replace(/\s*\(.*\)$/, '') ?? '';

/**
 * About the data: where the records come from, how they were processed, and what they can and can't tell you.
 * The person page's shape — a header with its actions, a strip of facts, tabs of cards — where it was one 11,000px
 * scroll with two menus over it. Overview sums up everything; each other tab holds one subject in full.
 *
 * The tab is in the address (`?tab=`), and a link to a section (`#salary-ranges`, the old page's anchors among them)
 * opens the tab that holds it (`SECTION_TAB`) and lands on it. A section's hash outranks `?tab=`: it is how a
 * reader, or a link on another page, asked for that section.
 */
export default function DataHealth() {
  useDocTitle('About the data');
  const { data: manifest, isLoading, error, refetch } = useManifest();
  const { data: summary } = useSummary();
  const snapId = useActiveSnapshotId();
  const parquetUrl = `${import.meta.env.BASE_URL}data/salaries.parquet`;
  const manifestUrl = `${import.meta.env.BASE_URL}data/manifest.json`;
  const parquetSize = useFileSize(parquetUrl);
  const manifestSize = useFileSize(manifestUrl);

  const { hash } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sectionId = decodeURIComponent(hash.slice(1));
  const asked = params.get('tab');
  const tab: AboutTab = SECTION_TAB[sectionId] ?? (ABOUT_TABS.some((t) => t.value === asked) ? (asked as AboutTab) : 'overview');
  const setTab = (v: string | null) => {
    const n = new URLSearchParams(params);
    if (!v || v === 'overview') n.delete('tab');
    else n.set('tab', v);
    const q = n.toString();
    navigate({ search: q ? `?${q}` : '', hash: '' }, { replace: true });
  };
  const tabLabel = ABOUT_TABS.find((t) => t.value === tab)?.label ?? '';
  useCrumbs(tab === 'overview'
    ? [{ label: 'Home', to: '/' }, { label: 'About the data' }]
    : [{ label: 'Home', to: '/' }, { label: 'About the data', to: '/data' }, { label: tabLabel }]);

  // Land on the section the address names, once it is drawn: some come only with their data (the release, the
  // renames, a snapshot's note), so look each frame for a few seconds rather than once.
  useEffect(() => {
    if (isLoading || !sectionId) return undefined;
    let frames = 0;
    let raf = 0;
    const seek = () => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ block: 'start' });
      else if (frames++ < 240) raf = requestAnimationFrame(seek);
    };
    raf = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(raf);
  }, [isLoading, sectionId, tab]);

  // Shimmer skeleton while the static manifest payload is fetched, so the page never flashes empty.
  if (isLoading)
    return (
      <Stack gap="lg" className="about-page">
        <Skeleton height={56} width="45%" radius="md" />
        <Skeleton height={64} radius="lg" />
        <Skeleton height={44} radius="md" />
        <Skeleton height={320} radius="lg" />
      </Stack>
    );
  if (error)
    return (
      <Alert color="red" variant="light" radius="md" icon={<IconAlertTriangle size={ICON.nav} />} title="Couldn't load the data manifest">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">
            The ingestion manifest failed to load ({(error as Error).message}). This is usually a temporary network hiccup
            fetching the static data file.
          </Text>
          <Button size="xs" variant="default" leftSection={<IconReload size={ICON.compact} />} onClick={() => refetch()}>Retry</Button>
        </Stack>
      </Alert>
    );

  const snaps = (manifest?.snapshots ?? []).filter((s) => s.row_count) as SnapshotInfo[];
  // Chronological, with Pre-TTC before Post-TTC on their shared Nov 2021 date.
  const ttcRank = (id: string) => (id.endsWith('-pre') ? 0 : 1);
  const ordered = [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || ttcRank(a.snapshot_id) - ttcRank(b.snapshot_id));
  const latestSnap = ordered.at(-1);
  // From any entry of the manifest: the documents that carry it count no rows.
  const dict = (manifest?.snapshots ?? []).find((s) => (s as { data_dictionary_url?: string }).data_dictionary_url) as
    | (SnapshotInfo & { data_dictionary_url?: string })
    | undefined;
  const pipeline: PipelineFacts = {
    snapshots: snaps.length,
    columnsMapped: latestSnap ? Object.keys(latestSnap.detected_mapping).length || null : null,
    peopleLatest: latestSnap?.distinct_people ?? null,
    totalRows: manifest?.total_rows,
    parquetUrl,
    parquetSize,
    manifestUrl,
    manifestSize,
    dictUrl: dict?.data_dictionary_url ?? null,
  };

  return (
    <>
    <Stack gap="lg" className="tab-rise about-page">
      <Stack gap={8}>
        <PageHeader
          title="About the data"
          description="Where these salary records come from, how they were processed, and what they can and can't tell you."
          right={
            <Group gap="sm" wrap="wrap" className="about-actions">
              <Button component="a" href={REPO_URL} target="_blank" rel="noopener noreferrer" variant="default"
                leftSection={<IconBrandGithub size={ICON.control} aria-hidden />}>
                Source on GitHub
              </Button>
              <Button component="a" href={parquetUrl} download color="accent" className="about-download"
                leftSection={<IconDownload size={ICON.control} aria-hidden />}>
                Download dataset{parquetSize ? <Text span inherit fw={400} ml={6}>· Parquet, {parquetSize}</Text> : null}
              </Button>
            </Group>
          }
        />
        <Group gap={8} wrap="nowrap" className="about-status">
          <span className="live-dot" aria-hidden />
          <Text size="sm" c="dimmed">
            <Text span fw={600} c="var(--mantine-color-text)" inherit>Live</Text> · data current as of {latestSnap?.snapshot_label ?? '—'}
            {manifest?.generated_at ? ` · site last built ${manifest.generated_at.slice(0, 10)}` : ''}
          </Text>
        </Group>
      </Stack>

      <FactStrip
        label="The data in brief"
        facts={[
          { label: 'Snapshots', value: num(snaps.length) },
          { label: 'Span', value: ordered.length ? `${monthOf(ordered[0].snapshot_label)} – ${monthOf(latestSnap?.snapshot_label)}` : null },
          { label: 'Records', value: manifest?.total_rows != null ? `${num(manifest.total_rows)} rows` : null },
          { label: 'People now', value: summary?.latest ? num(summary.latest.headcount) : null },
          { label: 'Fields', value: `${RECORD_FIELDS.length} per row` },
          { label: 'Source', value: 'UFAS records requests' },
          { label: 'Runs on', value: 'Your browser only' },
        ]}
      />

      {/* Only the tab in view is drawn (`keepMounted={false}`): the others ask the data for things nobody is reading. */}
      <Tabs value={tab} onChange={(v) => { markTabSwitch(); setTab(v); }} keepMounted={false}>
        <OverflowTabsList>
          {ABOUT_TABS.map((t) => <Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>)}
        </OverflowTabsList>
        <Tabs.Panel value="overview" pt="lg"><OverviewTab pipeline={pipeline} /></Tabs.Panel>
        <Tabs.Panel value="accuracy" pt="lg"><AccuracyTab snapshots={snaps.length} /></Tabs.Panel>
        <Tabs.Panel value="method" pt="lg"><MethodTab pipeline={pipeline} latestLabel={latestSnap?.snapshot_label ?? null} /></Tabs.Panel>
        <Tabs.Panel value="ranges" pt="lg"><RangesTab /></Tabs.Panel>
        <Tabs.Panel value="snapshots" pt="lg">
          {manifest && <SnapshotsTab manifest={manifest} ordered={ordered} latestId={latestSnap?.snapshot_id ?? null} />}
        </Tabs.Panel>
        <Tabs.Panel value="renames" pt="lg"><RenamesTab snap={snapId} /></Tabs.Panel>
      </Tabs>
    </Stack>
    <BackToTop />
    </>
  );
}
