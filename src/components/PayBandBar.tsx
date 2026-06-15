import { Group, Text, Badge } from '@mantine/core';
import { usd } from '../lib/format';

/** Horizontal pay-band bar with a marker for `value` between `min` and `max`. */
export function PayBandBar({ min, max, value }: { min: number; max: number; value: number }) {
  const span = max - min;
  const raw = span > 0 ? (value - min) / span : 0;
  const pos = Math.max(0, Math.min(1, raw));
  const status = value < min ? 'below min' : value > max ? 'over max' : `${Math.round(raw * 100)}% through band`;
  const color = value < min ? 'yellow' : value > max ? 'red' : 'teal';

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: 12,
          borderRadius: 6,
          background: 'linear-gradient(90deg, var(--mantine-color-gray-2), var(--mantine-color-gray-4))',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${pos * 100}%`,
            top: -4,
            width: 4,
            height: 20,
            borderRadius: 2,
            background: 'var(--mantine-color-indigo-7)',
            transform: 'translateX(-50%)',
          }}
        />
      </div>
      <Group justify="space-between" mt={6}>
        <Text size="xs" c="dimmed">{usd(min)}</Text>
        <Badge size="sm" variant="light" color={color}>{status}</Badge>
        <Text size="xs" c="dimmed">{usd(max)}</Text>
      </Group>
    </div>
  );
}
