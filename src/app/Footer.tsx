import { Stack, Text, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconBrandGithub } from '@tabler/icons-react';
import { useSummary } from '../lib/hooks';
import { num } from '../lib/format';
import { REPO_URL } from '../lib/links';
import { ICON } from '../lib/ui';

/** "Nov 2021 (Pre-TTC)" → "Nov 2021": the pair of Nov 2021 snapshots is one month to a reader. */
const month = (label?: string) => label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '');

/**
 * App-wide footer: where the data is from, the snapshots it spans, who obtained the records and who built the
 * site, and the source. The last thing on every page (AppShell), so this context doesn't rely on a visitor
 * finding About the data.
 *
 * The span ("11 snapshots, Nov 2021 – Sep 2026"), not the build date: "data generated Sep 29, 2026"
 * read as the date of the data, and it changes on every deploy. Which release is newest is at the top
 * of every page (ReleaseTag), and when the site was last built is on the Data page.
 *
 * Two lines: what the records are, then whose work they are. It was one line in a fixed 40px band, which at
 * each narrower width had to drop a piece (the span, then who built it, then the source link's words) to
 * stay one line. At the end of the page it wraps freely, and keeps every word at every width.
 */
export function Footer() {
  const { data: summary } = useSummary();
  const snaps = summary?.snapshots ?? [];
  const span = snaps.length ? `${num(summary!.snapshot_count)} snapshots, ${month(snaps[0].label)} – ${month(snaps[snaps.length - 1].label)}` : null;
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Public salary records, released under Wisconsin&rsquo;s open-records law.{' '}
        <Anchor component={Link} to="/data" c="dimmed" underline="always" inherit>About the data</Anchor>
        {span ? <> · {span}</> : null}
      </Text>
      <Text size="xs" c="dimmed">
        Records obtained via open-records requests by{' '}
        <Anchor href="https://ufas223.org/" target="_blank" rel="noopener noreferrer" c="dimmed" underline="always" inherit>UFAS Local 223</Anchor>
        {' · '}Built by Aaron Smetana{' · '}
        <Anchor href={REPO_URL} target="_blank" rel="noopener noreferrer" c="dimmed" underline="always" inherit className="footer-source">
          <IconBrandGithub size={ICON.compact} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Source on GitHub
        </Anchor>
      </Text>
    </Stack>
  );
}
