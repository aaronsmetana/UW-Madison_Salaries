import type { ReactNode } from 'react';
import { Card, Stack, ThemeIcon, Text, Title } from '@mantine/core';

/**
 * One "nothing here" design for blank cards that would otherwise read as breakage — a dimmed icon, a
 * one-line title, an optional hint, and an optional action. Used for empty search/filter results and
 * not-yet-configured states alike; a genuinely well-designed empty state (like Compare's own build-a-
 * comparison prompt) can stay bespoke instead of being forced through this.
 *
 * `action` is for something the state can do itself — widen a screen to everyone in scope — and never a
 * second way to the control directly above it: a "Choose a title" button under the title picker only
 * repeated the picker, so the hint says where the control is ("above") and the page has one of each.
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
    <Card withBorder padding="lg">
      {/* `lg` + py 16, not `xl` + py 32. Those stacked to 128px of vertical padding before any
          content, which is most of why the page-level empty states ran 251-348px tall and took a
          quarter to a third of the default view on /compare, /reports and /screening. An empty
          state should be calm, not cavernous. */}
      <Stack align="center" gap={6} py={size === 'sm' ? 8 : 16}>
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
        {hint != null && <Text c="dimmed" ta="center" maw="var(--measure-narrow)" size="sm">{hint}</Text>}
        {action}
      </Stack>
    </Card>
  );
}
