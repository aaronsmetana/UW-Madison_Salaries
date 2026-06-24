import type { ReactNode } from 'react';
import { Box, Group, Title, Text } from '@mantine/core';

/**
 * The shared top-level page header: a teal accent rail + big title, with an optional dimmed description
 * and an optional `right` slot for header actions/controls. One look across every page.
 */
export function PageHeader({
  title,
  description,
  right,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  const head = (
    <Box pl="md" style={{ borderLeft: '3px solid var(--mantine-color-accent-5)' }}>
      <Title order={1} style={{ letterSpacing: '-0.02em', fontSize: 'clamp(1.75rem, 3vw, 2.5rem)' }}>
        {title}
      </Title>
      {description != null && (
        <Text c="dimmed" maw={720} mt={6} size="lg">
          {description}
        </Text>
      )}
    </Box>
  );
  if (!right) return head;
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
      {head}
      {right}
    </Group>
  );
}
