import { useRef, useState } from 'react';
import { Group, Text, Badge } from '@mantine/core';
import { usd } from '../lib/format';
import { fmtK } from '../lib/chartStyle';
import { MARK_SELF, MARK_TARGET, MarkerLegend } from './markers';
import { Z } from '../lib/layers';

/** Horizontal pay-band bar: teal dot at `value` (current, optional), optional green `target` line,
 *  optional gray `benchmarks` ticks (e.g. title median / p75), and optional `quartiles` (¼/½/¾ of the
 *  official min→max, drawn as subtle ticks + a caption) drawn inside the band. Hovering the band shows
 *  a cursor-following readout of the salary and % through the band at that point — the same interaction
 *  PeerRangeBar offers, so the two strips (rendered side-by-side on Person's "Pay & standing" tab) read
 *  as one consistent family. */
export function PayBandBar({
  min, max, value = null, target = null, benchmarks = [], quartiles = false,
}: {
  min: number;
  max: number;
  value?: number | null;
  target?: number | null;
  benchmarks?: { value: number; label: string }[];
  quartiles?: boolean;
}) {
  const span = max - min;
  const raw = value != null && span > 0 ? (value - min) / span : 0;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const status = value == null ? null : value < min ? 'below min' : value > max ? 'over max' : `${Math.round(raw * 100)}% through band`;
  const color = value == null ? 'gray' : value < min ? 'orange' : value > max ? 'red' : 'pos';
  const H = 22;
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const hoverValue = hoverPct != null ? min + (hoverPct / 100) * span : null;

  const updateHover = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverPct(frac * 100);
  };

  return (
    // `chart-plot` marks this as a plotted figure for the chart-card rule in app.css — the same job
    // `.recharts-responsive-container` does for the Recharts charts, which this one is not.
    <div className="chart-plot">
      <div
        ref={trackRef}
        onMouseMove={(e) => updateHover(e.clientX)}
        onMouseLeave={() => setHoverPct(null)}
        style={{
          position: 'relative',
          height: H,
          borderRadius: H / 2,
          background: 'linear-gradient(90deg, var(--mantine-color-gray-2), var(--mantine-color-gray-4))',
          cursor: 'crosshair',
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
        {quartiles && [0.25, 0.5, 0.75].map((f) => (
          <div
            key={f}
            style={{
              position: 'absolute',
              left: `${f * 100}%`,
              top: -2,
              bottom: -2,
              width: 1,
              background: 'var(--mantine-color-default-border)',
              transform: 'translateX(-50%)',
            }}
          />
        ))}
        {benchmarks.map((b) => (
          <div
            key={b.label}
            title={`${b.label} ${usd(b.value)}`}
            style={{
              position: 'absolute',
              left: `${at(b.value)}%`,
              top: -3,
              bottom: -3,
              width: 2,
              background: 'var(--mantine-color-gray-6)',
              transform: 'translateX(-50%)',
            }}
          />
        ))}
        {value != null && (
          <div
            style={{
              position: 'absolute',
              left: `${at(value)}%`,
              top: '50%',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: MARK_SELF,
              border: '2px solid var(--mantine-color-body)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
        {/* Cursor-following hover readout: salary + % through the band at this point. */}
        {hoverPct != null && hoverValue != null && (
          <div
            style={{
              position: 'absolute',
              left: `${hoverPct}%`,
              bottom: H + 8,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: Z.local,
            }}
          >
            <span className="chart-value-pill">~{usd(hoverValue)} · {Math.round(hoverPct)}% through the band</span>
          </div>
        )}
      </div>
      <Group justify="space-between" mt={6}>
        <Text size="xs" c="dimmed">{usd(min)} · min</Text>
        {status && <Badge size="sm" variant="light" color={color}>{status}</Badge>}
        <Text size="xs" c="dimmed">{usd(max)} · max</Text>
      </Group>
      {quartiles && (
        <Text size="xs" c="dimmed" mt={4}>
          Band quartiles  ¼ {fmtK(min + span * 0.25)} · ½ {fmtK(min + span * 0.5)} · ¾ {fmtK(min + span * 0.75)}
        </Text>
      )}
      {benchmarks.length > 0 && (
        <Text size="xs" c="dimmed" mt={4}>
          {benchmarks.map((b) => `${b.label} ${usd(b.value)}`).join('  ·  ')} (gray ticks)
        </Text>
      )}
      {target != null && (
        <MarkerLegend
          items={[
            { color: MARK_SELF, round: true, label: `Current ${usd(value)}` },
            { color: MARK_TARGET, label: `Target ${usd(target)}` },
          ]}
        />
      )}
    </div>
  );
}
