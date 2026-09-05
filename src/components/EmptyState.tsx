import type { ReactNode, RefObject } from 'react';
import { Card, Stack, ThemeIcon, Text, Title } from '@mantine/core';
import { prefersReducedMotion } from '../lib/motion';

/**
 * The action every page-level empty state wants: put the cursor in the control the state is telling
 * you to use. One helper rather than three, so "above" always means the same gesture — and so the
 * hint text and the button can never point at different controls.
 */
export function focusControl(ref: RefObject<HTMLElement | null>): void {
  const el = ref.current?.querySelector<HTMLElement>('input, [role="combobox"], button');
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  el.focus();
}

/**
 * One "nothing here" design for blank cards that would otherwise read as breakage — a dimmed icon, a
 * one-line title, an optional hint, and an optional action. Used for empty search/filter results and
 * not-yet-configured states alike; a genuinely well-designed empty state (like Compare's own build-a-
 * comparison prompt) can stay bespoke instead of being forced through this.
 *
 * `action` is the part that matters and was going unused at all seven call sites: every one of them
 * read "search and pick an employee above" / "pick a title above" — an instruction pointing somewhere
 * else. A state that names the thing you need should hand you the thing you need.
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
