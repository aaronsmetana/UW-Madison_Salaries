import { Group, Text, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconBrandGithub } from '@tabler/icons-react';
import { useSummary } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { REPO_URL } from '../lib/links';

/** App-wide footer: data provenance + generation date, and a link to the source repo. Rendered once
 *  from the shell, below every route, so this context doesn't rely on a visitor finding Data · About. */
export function Footer() {
  const { data: summary } = useSummary();
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
        <Anchor component={Link} to="/data" c="dimmed" underline="always" inherit>Data &middot; About</Anchor>
        {summary?.generated_at ? ` · data generated ${fmtDate(summary.generated_at)}` : ''}
      </Text>
      <Anchor href={REPO_URL} target="_blank" rel="noopener noreferrer" c="dimmed" underline="hover" size="xs">
        <Group gap={4} wrap="nowrap">
          <IconBrandGithub size={14} />
          Source on GitHub
        </Group>
      </Anchor>
    </Group>
  );
}
