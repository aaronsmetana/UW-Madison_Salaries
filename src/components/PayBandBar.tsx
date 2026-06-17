import { Group, Text, Badge } from '@mantine/core';
import { usd } from '../lib/format';
import { MARK_CURRENT, MARK_TARGET, MarkerLegend } from './markers';

/** Horizontal pay-band bar: blue dot at `value` (current), optional green `target` line. */
export function PayBandBar({ min, max, value, target = null }: { min: number; max: number; value: number; target?: number | null }) {
  const span = max - min;
  const raw = span > 0 ? (value - min) / span : 0;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const status = value < min ? 'below min' : value > max ? 'over max' : `${Math.round(raw * 100)}% through band`;
  const color = value < min ? 'yellow' : value > max ? 'red' : 'teal';
  const H = 22;

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
        <Badge size="sm" variant="light" color={color}>{status}</Badge>
        <Text size="xs" c="dimmed">{usd(max)}</Text>
      </Group>
      {target != null && (
        <MarkerLegend
          items={[
            { color: MARK_CURRENT, round: true, label: `Current ${usd(value)}` },
            { color: MARK_TARGET, label: `Target ${usd(target)}` },
          ]}
        />
      )}
    </div>
  );
}
