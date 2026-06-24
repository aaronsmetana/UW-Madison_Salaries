import { Text } from '@mantine/core';
import { usd } from '../lib/format';
import { useMounted } from '../lib/motion';
import { MARK_CURRENT, MARK_TARGET, MarkerLegend } from './markers';

/** Compact $Xk for the interior tick labels (the exact min/max sit at the ends in full dollars). */
const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

/**
 * Responsive horizontal range bar for a peer group: spans min→max, shades the interquartile (p25→p75)
 * range, ticks p25 / median / p75 with value labels, and marks `value` (current salary) as a teal dot —
 * with an optional bright-green `target` line so the distance to close reads at a glance. The IQR fill
 * grows and the current dot sweeps into place once on mount. Div/percentage based and dark-mode safe.
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
  const mounted = useMounted();

  // Current-value pin: the caret sits at the dot's exact x; the label is clamped so it never overruns
  // the track at the extremes (the lowest / highest-paid person).
  const pos = at(value);
  const labelLeft = Math.max(14, Math.min(86, pos));

  // Interior tick guides drawn on the bar (p25/median/p75), median a touch stronger.
  const ticks: { x: number; label: string; strong?: boolean }[] = [
    { x: p25, label: 'p25' },
    { x: median, label: 'median', strong: true },
    { x: p75, label: 'p75' },
  ];

  return (
    <div>
      {/* current-value pin above the dot — caret points down to it so the value reads as the dot's, not
          the median's. Both label + caret sweep in with the dot on mount. */}
      <div style={{ position: 'relative', height: 28 }}>
        <Text
          fw={700}
          style={{
            position: 'absolute',
            left: mounted ? `${labelLeft}%` : 0,
            bottom: 7,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: 12.5,
            color: MARK_CURRENT,
            transition: 'left 600ms ease-out',
          }}
        >
          <Text span c="dimmed" fw={500} style={{ fontSize: 10.5 }}>Current </Text>
          {usd(value)}
        </Text>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: mounted ? `${pos}%` : 0,
            bottom: 0,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: `7px solid ${MARK_CURRENT}`,
            transition: 'left 600ms ease-out',
          }}
        />
      </div>

      <div
        style={{
          position: 'relative',
          height: H,
          borderRadius: H / 2,
          background: 'linear-gradient(90deg, var(--mantine-color-gray-2), var(--mantine-color-gray-4))',
        }}
      >
        {/* interquartile range — grows from 0 width on mount */}
        <div
          style={{
            position: 'absolute',
            left: `${at(p25)}%`,
            width: mounted ? `${Math.max(0, at(p75) - at(p25))}%` : 0,
            top: 0,
            bottom: 0,
            background: 'var(--mantine-color-accent-3)',
            opacity: 0.5,
            transition: 'width 600ms ease-out',
          }}
        />
        {/* p25 / median / p75 ticks */}
        {ticks.map((t) => (
          <div
            key={t.label}
            style={{
              position: 'absolute',
              left: `${at(t.x)}%`,
              top: t.strong ? 3 : 5,
              bottom: t.strong ? 3 : 5,
              width: t.strong ? 2 : 1.5,
              background: t.strong ? 'var(--mantine-color-gray-7)' : 'var(--mantine-color-gray-6)',
              transform: 'translateX(-50%)',
            }}
          />
        ))}
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
        {/* current marker — teal dot, sweeps in from the left edge on mount */}
        <div
          style={{
            position: 'absolute',
            left: mounted ? `${at(value)}%` : 0,
            top: '50%',
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: MARK_CURRENT,
            border: '2px solid var(--mantine-color-body)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transform: 'translate(-50%, -50%)',
            transition: 'left 600ms ease-out',
          }}
        />
      </div>

      {/* min / max own the extremes */}
      <div style={{ position: 'relative', height: 16, marginTop: 6 }}>
        <Text size="xs" c="dimmed" style={{ position: 'absolute', left: 0 }}>{usd(min)}</Text>
        <Text size="xs" c="dimmed" style={{ position: 'absolute', right: 0 }}>{usd(max)}</Text>
      </div>
      {/* interior labels sit under their ticks (compact $Xk so they don't crowd) */}
      <div style={{ position: 'relative', height: 14 }}>
        {ticks.map((t) => (
          <Text
            key={t.label}
            size="xs"
            c="dimmed"
            fw={t.strong ? 600 : 400}
            style={{
              position: 'absolute',
              left: `${at(t.x)}%`,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              fontSize: 10.5,
            }}
          >
            {t.label} {fmtK(t.x)}
          </Text>
        ))}
      </div>

      {/* Current is now pinned above the dot; only the target (when present) needs a legend. */}
      {target != null && (
        <MarkerLegend items={[{ color: MARK_TARGET, label: `Target ${usd(target)}` }]} />
      )}
    </div>
  );
}
