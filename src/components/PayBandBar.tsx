import { useRef, useState } from 'react';
import { Badge, Text } from '@mantine/core';
import { usd } from '../lib/format';
import { fmtK } from '../lib/chartStyle';
import { MARK_SELF, MARK_TARGET, BAND_IQR, MarkerLegend } from './markers';
import { Z } from '../lib/layers';

/**
 * A pay band read at a glance (P18): the official range as a track, filled from its minimum to the value, the
 * value a dot with its "% through the band" standing over it, the quartiles ticked and named on the track, and
 * (`peers`) the middle 50% and median of everyone with the title laid over the band. It was a marker on an
 * unfilled track with faint ticks, its status centred under the bar rather than under the marker, and the
 * quartiles printed as a sentence below.
 *
 * Optional `target` (a rule across the track), `benchmarks` (grey ticks named in a line below). Hovering the
 * band reads the salary and the share through the band at that point, as the peer range bar beside it does.
 */
export function PayBandBar({
  min, max, value = null, target = null, benchmarks = [], quartiles = false, peers = null,
}: {
  min: number;
  max: number;
  value?: number | null;
  target?: number | null;
  benchmarks?: { value: number; label: string }[];
  quartiles?: boolean;
  /** The title's own spread on the band: its middle 50% and median, and what to call them. */
  peers?: { p25: number; med: number; p75: number; label: string } | null;
}) {
  const span = max - min;
  const raw = value != null && span > 0 ? (value - min) / span : 0;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const status = value == null ? null : value < min ? 'below min' : value > max ? 'over max' : `${Math.round(raw * 100)}% through the band`;
  // Inside the band is a place, not a success or a direction: the accent. Outside it, caution below and red over.
  const color = value == null ? 'gray' : value < min ? 'orange' : value > max ? 'red' : 'accent';
  const H = 22;
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const hoverValue = hoverPct != null ? min + (hoverPct / 100) * span : null;
  const valueAt = value != null ? at(value) : null;
  // The status over the marker, held inside the bar's ends.
  const statusAlign = valueAt == null ? '-50%' : valueAt < 12 ? '0%' : valueAt > 88 ? '-100%' : '-50%';
  // The scale under the track: its ends and, with `quartiles`, its quarters, each where it falls.
  const scale = [0, ...(quartiles ? [0.25, 0.5, 0.75] : []), 1];

  const updateHover = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverPct(frac * 100);
  };

  return (
    // `chart-plot` marks a plotted figure built from divs rather than Recharts, which is how the tests
    // find one.
    <div className="chart-plot payband-bar">
      {/* The value's standing, over its own marker. */}
      {status && valueAt != null && (
        <div style={{ position: 'relative', height: 26 }}>
          <div className="payband-status" style={{ position: 'absolute', left: `${valueAt}%`, transform: `translateX(${statusAlign})`, top: 0 }}>
            {/* Light variant text in the darker shades (app.css). */}
            <Badge size="sm" variant="light" color={color}>{status}</Badge>
          </div>
        </div>
      )}
      <div
        ref={trackRef}
        className="payband-track"
        onMouseMove={(e) => updateHover(e.clientX)}
        onMouseLeave={() => setHoverPct(null)}
        style={{
          position: 'relative',
          height: H,
          borderRadius: H / 2,
          background: 'var(--mantine-color-default-hover)',
          boxShadow: 'inset 0 0 0 1px var(--hairline-strong)',
          cursor: 'crosshair',
        }}
      >
        {/* Filled from the minimum to the value: how far up the band the pay has come. */}
        {valueAt != null && (
          <div className="payband-fill" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${valueAt}%`, borderRadius: H / 2, background: 'var(--tint-accent-strong)' }} />
        )}
        {/* The title's middle 50% and median, laid over the band. */}
        {peers && (
          <>
            <div className="payband-peers" style={{ position: 'absolute', left: `${at(peers.p25)}%`, width: `${Math.max(0.5, at(peers.p75) - at(peers.p25))}%`, top: 4, bottom: 4, borderRadius: 4, background: BAND_IQR.fill, boxShadow: `inset 0 0 0 1px ${BAND_IQR.edge}` }} />
            <div className="payband-peers-median" style={{ position: 'absolute', left: `${at(peers.med)}%`, top: 2, bottom: 2, width: 2, background: 'var(--guide-strong)', transform: 'translateX(-50%)' }} />
          </>
        )}
        {quartiles && [0.25, 0.5, 0.75].map((f) => (
          <div key={f} className="payband-quartile" style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--guide-strong)', opacity: 0.6, transform: 'translateX(-50%)' }} />
        ))}
        {target != null && (
          <div style={{ position: 'absolute', left: `${at(target)}%`, top: -5, bottom: -5, width: 3, borderRadius: 2, background: MARK_TARGET, transform: 'translateX(-50%)' }} />
        )}
        {benchmarks.map((b) => (
          <div key={b.label} title={`${b.label} ${usd(b.value)}`} style={{ position: 'absolute', left: `${at(b.value)}%`, top: -3, bottom: -3, width: 2, background: 'var(--mantine-color-gray-6)', transform: 'translateX(-50%)' }} />
        ))}
        {valueAt != null && (
          <div
            className="payband-marker"
            style={{
              position: 'absolute',
              left: `${valueAt}%`,
              top: '50%',
              // The person on a range, as on their headline figure's (SpreadMark): 14px of their teal, ringed in
              // the card's colour.
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: MARK_SELF,
              boxShadow: '0 0 0 2px var(--mantine-color-body)',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
        {/* Cursor-following hover readout: salary + % through the band at this point. */}
        {hoverPct != null && hoverValue != null && (
          <div style={{ position: 'absolute', left: `${hoverPct}%`, bottom: H + 8, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: Z.local }}>
            <span className="chart-tip-pill">~{usd(hoverValue)} · {Math.round(hoverPct)}% through the band</span>
          </div>
        )}
      </div>
      {/* The scale, named on the track: min, the quarters, max. */}
      <div className="payband-scale" style={{ position: 'relative', height: 18, marginTop: 4 }}>
        {scale.map((f) => (
          <Text
            key={f}
            component="span"
            size="xs"
            c="dimmed"
            className="payband-scale-label"
            style={{ position: 'absolute', left: `${f * 100}%`, transform: `translateX(${f === 0 ? '0%' : f === 1 ? '-100%' : '-50%'})`, whiteSpace: 'nowrap' }}
          >
            {f === 0 ? `min ${fmtK(min)}` : f === 1 ? `max ${fmtK(max)}` : fmtK(min + span * f)}
          </Text>
        ))}
      </div>
      <Text size="xs" c="dimmed" mt={4} className="payband-range">
        Band {usd(min)} – {usd(max)}
        {peers ? ` · shaded: the middle 50% of ${peers.label} (${fmtK(peers.p25)}–${fmtK(peers.p75)}), the line their median (${fmtK(peers.med)})` : ''}
        {benchmarks.length > 0 ? ` · ${benchmarks.map((b) => `${b.label} ${usd(b.value)}`).join(' · ')} (grey ticks)` : ''}
      </Text>
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
