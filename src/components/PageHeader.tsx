import type { ReactNode } from 'react';
import { Box, Group, Title, Text } from '@mantine/core';
import { Eyebrow } from './Eyebrow';

/**
 * The shared top-level page header: the page title, with an optional dimmed description
 * and an optional `right` slot for header actions/controls. One look across every page.
 *
 * Where the page is one thing of a kind (a title on Titles, T1), `eyebrow` names the kind over it and `meta` is
 * the line of facts under it: "OE009 · grade 19 · Academic Staff · 362 people".
 */
export function PageHeader({
  title,
  description,
  right,
  eyebrow,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
}) {
  const head = (
    <Box>
      {eyebrow != null && <Eyebrow mb={4}>{eyebrow}</Eyebrow>}
      {/* Size + letter-spacing come from the shared heading ramp (theme.ts + app.css). */}
      <Title order={1}>{title}</Title>
      {meta != null && (
        <Text c="dimmed" size="sm" mt={4} className="page-meta">
          {meta}
        </Text>
      )}
      {description != null && (
        <Text c="dimmed" maw="var(--measure)" mt={6} size="lg" className="page-description">
          {description}
        </Text>
      )}
    </Box>
  );
  if (!right) return head;
  // The heading takes what the actions leave, from a basis of its own: at its natural width — its description
  // unwrapped — it pushed the actions under it at any width short of a wide desktop.
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
      <Box style={{ flex: '1 1 420px', minWidth: 0 }}>{head}</Box>
      {right}
    </Group>
  );
}
