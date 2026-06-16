import { Group, Text, Badge } from '@mantine/core';
import { usd } from '../lib/format';

/**
 * Responsive horizontal range bar for a peer group: spans min→max, shades the
 * interquartile (p25→p75) range, ticks the median, and drops a bright marker at
 * `value` (this person's salary). Div/percentage based — fully responsive and
 * dark-mode friendly (mirrors PayBandBar).
 */
export function PeerRangeBar({
  min,
  p25,
  median,
  p75,
  max,
  value,
}: {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  value: number;
}) {
  const span = max - min;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const pos = span > 0 ? (value - min) / span : 0;
  const rank =
    value < min ? 'below the range' : value > max ? 'above the range' : `${Math.round(pos * 100)}% of the way up`;

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: 16,
          borderRadius: 8,
          background: 'linear-gradient(90deg, var(--mantine-color-gray-2), var(--mantine-color-gray-4))',
        }}
      >
        {/* interquartile range */}
        <div
          style={{
            position: 'absolute',
            left: `${at(p25)}%`,
            width: `${Math.max(0, at(p75) - at(p25))}%`,
            top: 0,
            bottom: 0,
            background: 'var(--mantine-color-indigo-4)',
            opacity: 0.55,
          }}
        />
        {/* median tick */}
        <div
          style={{
            position: 'absolute',
            left: `${at(median)}%`,
            top: -3,
            width: 2,
            height: 22,
            background: 'var(--mantine-color-indigo-7)',
            transform: 'translateX(-50%)',
          }}
        />
        {/* this person's marker */}
        <div
          style={{
            position: 'absolute',
            left: `${at(value)}%`,
            top: -6,
            width: 4,
            height: 28,
            borderRadius: 2,
            background: 'var(--mantine-color-teal-6)',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 0 2px var(--mantine-color-body)',
          }}
        />
      </div>

      <Group justify="space-between" mt={6}>
        <Text size="xs" c="dimmed">{usd(min)}</Text>
        <Text size="xs" c="dimmed">{usd(max)}</Text>
      </Group>

      <Group justify="center" gap="md" mt="xs">
        <Text size="xs" c="dimmed">p25 {usd(p25)}</Text>
        <Text size="xs" fw={600}>median {usd(median)}</Text>
        <Text size="xs" c="dimmed">p75 {usd(p75)}</Text>
        <Badge variant="light" color="teal">This person {usd(value)} · {rank}</Badge>
      </Group>
    </div>
  );
}
