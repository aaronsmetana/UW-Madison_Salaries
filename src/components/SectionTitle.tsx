import type { ReactNode } from 'react';
import { Group, Title, Tooltip, ActionIcon, CopyButton } from '@mantine/core';
import { IconLink, IconCheck } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * A section header with a copy-anchor affordance: a chain icon that fades in on hover and copies a deep
 * link (e.g. …/data#methodology) to the clipboard.
 *
 * h3, because these sit under a zone's h2, which sits under the page's h1. `fz` restores the visual size
 * of an h4 — the same "correct outline, smaller type" idiom `EmptyState` uses.
 */
export function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#${id}` : `#${id}`;
  return (
    <Group gap={6} wrap="nowrap" className="section-head">
      <Title order={3} fz="h4">{children}</Title>
      <CopyButton value={url} timeout={1400}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Link copied' : 'Copy link to this section'} withArrow>
            <ActionIcon className="copy-anchor" variant="subtle" color="gray" size="sm" aria-label="Copy link to this section" onClick={copy}>
              {copied ? <IconCheck size={ICON.compact} /> : <IconLink size={ICON.compact} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}
