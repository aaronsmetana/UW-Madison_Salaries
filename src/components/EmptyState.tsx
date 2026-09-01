import type { ReactNode } from 'react';
import { Card, Stack, ThemeIcon, Text, Title } from '@mantine/core';

/**
 * One "nothing here" design for blank cards that would otherwise read as breakage — a dimmed icon, a
 * one-line title, an optional hint, and an optional action. Used for empty search/filter results and
 * not-yet-configured states alike; a genuinely well-designed empty state (like Compare's own build-a-
 * comparison prompt) can stay bespoke instead of being forced through this.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  size = 'md',
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <Card withBorder padding="xl">
      <Stack align="center" gap={6} py={size === 'sm' ? 12 : 32}>
        <ThemeIcon size={size === 'sm' ? 36 : 48} radius="xl" variant="light" color="gray">
          {icon}
        </ThemeIcon>
        {/* The `md` title is an h2, not an h4: it is the page's main content when a page has nothing
            to show yet (PayCheck, Screening, Reports), sitting directly under PageHeader's h1, and an
            h1 -> h4 jump breaks the outline screen-reader users navigate by. `fz` keeps the old visual
            size. The `sm` variant stays a Text, not a heading, because it labels a panel inside an
            already-headed section. */}
        {size === 'sm' ? (
          <Text fw={600} ta="center">{title}</Text>
        ) : (
          <Title order={2} fz="h4" ta="center">{title}</Title>
        )}
        {hint != null && <Text c="dimmed" ta="center" maw={420} size="sm">{hint}</Text>}
        {action}
      </Stack>
    </Card>
  );
}
