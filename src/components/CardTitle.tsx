import type { ReactNode } from 'react';
import {
  Box, Group, Title, Text, Tooltip, ActionIcon, CopyButton, type MantineSpacing,
} from '@mantine/core';
import { IconLink, IconCheck } from '@tabler/icons-react';
import { ICON } from '../lib/ui';

/**
 * The heading on a card. One component, one look, and — the point — a real heading element.
 *
 * Seventy-seven cards across nine routes used to label themselves with `<Text size="sm" fw={600}>`:
 * a styled span. The whole app contained ten actual headings, so a screen-reader user could not
 * navigate it by heading at all, and axe's `heading-order` rule passed largely because there was no
 * outline left to get wrong. Four competing conventions had grown in the gap — this at sm/600, an
 * `Eyebrow` at 11px uppercase, a bare `Title order={3}`, and `Text fw={700} fz="md"`.
 *
 * `order` defaults to 2 because a card normally sits directly beneath the page's `PageHeader` h1 —
 * including inside a `Tabs.Panel`, since a tab list is not a heading and does not open a level. Pass
 * `order={3}` where a card genuinely nests under an h2 of its own (the zones on /data). `fz="h5"`
 * keeps the type at card scale regardless: the correct-outline-at-the-right-size idiom `EmptyState`
 * already uses.
 *
 * `sub` absorbs the dimmed one-liner that around forty of those call sites hand-rolled underneath
 * their title, and `right` the `<Group justify="space-between">` that wrapped a title plus its
 * toggle. Both were copied from card to card with slightly different spacing every time.
 *
 * `anchorId` is the former `SectionTitle`, folded in: a chain icon that appears on hover and copies a
 * deep link to the section. It was a separate component used by three files, which made "a card
 * heading" and "a linkable card heading" two different concepts with two different type sizes. It is
 * one concept with an option now, and any card can opt into a permalink.
 *
 * Note that `anchorId` names a section this heading *labels*; it does not put an id on the heading.
 * The `<Card>` already carries that id — it is the scroll target, and `app.css`'s
 * `.data-about [id] { scroll-margin-top }` is keyed to it. Emitting it here too would put the same id
 * on two elements in every one of those cards.
 */
export function CardTitle({
  children,
  sub,
  order = 2,
  anchorId,
  right,
  mb = 'md',
}: {
  children: ReactNode;
  /** The dimmed line under the title — what this card is showing, or how to read it. */
  sub?: ReactNode;
  order?: 2 | 3 | 4;
  /** The id of the section this heading labels. Adds a copy-permalink affordance; sets no id itself. */
  anchorId?: string;
  /** Controls that belong to this card, aligned to the right of the title. */
  right?: ReactNode;
  /** Defaults to the `md` gap the majority of cards already used; tighten only with reason. */
  mb?: MantineSpacing;
}) {
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#${anchorId}`
      : `#${anchorId}`;

  const heading = <Title order={order} fz="h5">{children}</Title>;

  const head = (
    <Box>
      {anchorId ? (
        <Group gap={6} wrap="nowrap" className="section-head">
          {heading}
          <CopyButton value={url} timeout={1400}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Link copied' : 'Copy link to this section'} withArrow>
                <ActionIcon
                  className="copy-anchor"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label="Copy link to this section"
                  onClick={copy}
                >
                  {copied ? <IconCheck size={ICON.compact} /> : <IconLink size={ICON.compact} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      ) : (
        heading
      )}
      {sub != null && <Text size="xs" c="dimmed" mt={2}>{sub}</Text>}
    </Box>
  );

  return (
    <Box mb={mb}>
      {right ? (
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          {head}
          {right}
        </Group>
      ) : (
        head
      )}
    </Box>
  );
}
