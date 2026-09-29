import { Group, Text, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconBrandGithub } from '@tabler/icons-react';
import { useSummary } from '../lib/hooks';
import { num } from '../lib/format';
import { REPO_URL } from '../lib/links';
import { ICON } from '../lib/ui';

/** "Nov 2021 (Pre-TTC)" → "Nov 2021": the pair of Nov 2021 snapshots is one month to a reader. */
const month = (label?: string) => label?.replace(/\s*\((?:Pre|Post)-TTC\)/, '');

/**
 * App-wide footer: where the data is from, the snapshots it spans, and a link to the source repo.
 * Rendered once from the shell, below every route, so this context doesn't rely on a visitor finding
 * About the data.
 *
 * The span ("11 snapshots, Nov 2021 – Sep 2026"), not the build date: "data generated Sep 29, 2026"
 * read as the date of the data, and it changes on every deploy. Which release is newest is beside the
 * app's name (ReleaseTag), and when the site was last built is on the Data page.
 */
export function Footer() {
  const { data: summary } = useSummary();
  const snaps = summary?.snapshots ?? [];
  const span = snaps.length ? `${num(summary!.snapshot_count)} snapshots, ${month(snaps[0].label)} – ${month(snaps[snaps.length - 1].label)}` : null;
  return (
    <Group
      justify="space-between"
      wrap="wrap"
      gap="xs"
      px="md"
      h="100%"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
    >
      <Text size="xs" c="dimmed">
        Public salary records, released under Wisconsin&rsquo;s open-records law.{' '}
        <Anchor component={Link} to="/data" c="dimmed" underline="always" inherit>About the data</Anchor>
        {span ? <span className="footer-span"> · {span}</span> : null}
      </Text>
      <Anchor href={REPO_URL} target="_blank" rel="noopener noreferrer" c="dimmed" underline="hover" size="xs">
        <Group gap={4} wrap="nowrap">
          <IconBrandGithub size={ICON.compact} />
          Source on GitHub
        </Group>
      </Anchor>
    </Group>
  );
}
