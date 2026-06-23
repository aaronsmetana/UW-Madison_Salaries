import { Group, Text } from '@mantine/core';

/** Shared marker colors so "current" and "target" read the same across every chart. */
export const MARK_CURRENT = 'var(--mantine-color-accent-7)'; // current salary — teal dot
export const MARK_TARGET = 'var(--mantine-color-pos-6)'; // target salary — bright green line

/** Compact legend: a teal dot / green swatch + label, used under the bullet charts. */
export function MarkerLegend({ items }: { items: { color: string; label: string; round?: boolean }[] }) {
  return (
    <Group justify="center" gap="lg" mt="xs">
      {items.map((it, i) => (
        <Group key={i} gap={6} wrap="nowrap">
          <span
            style={{
              display: 'inline-block',
              width: 12,
              height: it.round ? 12 : 4,
              borderRadius: it.round ? '50%' : 1,
              background: it.color,
              flexShrink: 0,
            }}
          />
          <Text size="xs" fw={500}>{it.label}</Text>
        </Group>
      ))}
    </Group>
  );
}
