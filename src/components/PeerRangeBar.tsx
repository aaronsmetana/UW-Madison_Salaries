import { Group, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { MARK_CURRENT, MARK_TARGET, MarkerLegend } from './markers';

/**
 * Responsive horizontal range bar for a peer group: spans min→max, shades the
 * interquartile (p25→p75) range, lightly ticks the median, and marks `value`
 * (current salary) as a blue dot — with an optional bright-green `target` line so
 * the distance to close reads at a glance. Div/percentage based and dark-mode safe.
 */
export function PeerRangeBar({
  min,
  p25,
  median,
  p75,
  max,
  value,
  target = null,
}: {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  value: number;
  target?: number | null;
}) {
  const span = max - min;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const H = 26;

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: H,
          borderRadius: H / 2,
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
            background: 'var(--mantine-color-accent-3)',
            opacity: 0.5,
          }}
        />
        {/* median tick (subtle, secondary) */}
        <div
          style={{
            position: 'absolute',
            left: `${at(median)}%`,
            top: 4,
            bottom: 4,
            width: 2,
            background: 'var(--mantine-color-gray-6)',
            transform: 'translateX(-50%)',
          }}
        />
        {/* target marker — bright green line */}
        {target != null && (
          <div
            style={{
              position: 'absolute',
              left: `${at(target)}%`,
              top: -5,
              bottom: -5,
              width: 3,
              borderRadius: 2,
              background: MARK_TARGET,
              transform: 'translateX(-50%)',
            }}
          />
        )}
        {/* current marker — blue dot */}
        <div
          style={{
            position: 'absolute',
            left: `${at(value)}%`,
            top: '50%',
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: MARK_CURRENT,
            border: '2px solid var(--mantine-color-body)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>

      <Group justify="space-between" mt={6}>
        <Text size="xs" c="dimmed">{usd(min)}</Text>
        <Text size="xs" c="dimmed">{usd(max)}</Text>
      </Group>

      <MarkerLegend
        items={[
          { color: MARK_CURRENT, round: true, label: `Current ${usd(value)}` },
          ...(target != null ? [{ color: MARK_TARGET, label: `Target ${usd(target)}` }] : []),
        ]}
      />
      <Text size="xs" c="dimmed" ta="center" mt={4}>
        median {usd(median)} · p25 {usd(p25)} · p75 {usd(p75)}
      </Text>
    </div>
  );
}
