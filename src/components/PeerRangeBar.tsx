import { useLayoutEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import { usd } from '../lib/format';
import { ordinal } from '../lib/stats';
import { assignLabelRows, fmtK } from '../lib/chartStyle';
import { useMounted } from '../lib/motion';
import { MARK_SELF, MARK_SELF_TEXT, MARK_TARGET, MarkerLegend } from './markers';
import { Z } from '../lib/layers';

/** How many individual peer ticks to draw at most — beyond this, evenly sample so a huge cohort
 *  (e.g. "Professor") doesn't render thousands of overlapping hairlines. */
const MAX_PEER_TICKS = 300;

/**
 * Responsive horizontal range bar for a peer group: spans min→max, shades the interquartile (p25→p75)
 * range, ticks p25 / median / p75 with value labels, and marks `value` (current salary) as a teal dot —
 * with an optional bright-green `target` line so the distance to close reads at a glance. The IQR fill
 * grows and the current dot sweeps into place once on mount. Div/percentage based and dark-mode safe.
 * Passing `values` (the cohort's individual pays) adds a slim "rug" lane of one faint mark per peer
 * UNDER the track (never on it — on-track ticks read as a barcode against the pill), so the strip shows
 * an actual population, plus a cursor-following readout of the salary/percentile under the pointer.
 */
export function PeerRangeBar({
  min,
  p25,
  median,
  p75,
  max,
  value,
  target = null,
  values,
}: {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  value: number;
  target?: number | null;
  values?: number[];
}) {
  const span = max - min;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - min) / span)) * 100 : 0);
  const H = 26;
  const mounted = useMounted();
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Current-value pin: the caret sits at the dot's exact x; the label shares that x but switches its
  // anchor near the edges (left-hug / right-hug, else centered) so it stays attached to the dot at the
  // extremes (lowest / highest-paid person) without overrunning the track.
  const pos = at(value);
  const labelTx = pos < 12 ? '0%' : pos > 88 ? '-100%' : '-50%';

  // Interior tick guides drawn on the bar (p25/median/p75), median a touch stronger.
  const ticks: { x: number; label: string; strong?: boolean }[] = [
    { x: p25, label: 'p25' },
    { x: median, label: 'median', strong: true },
    { x: p75, label: 'p75' },
  ];

  // Sampled peer positions for the faint per-person tick layer.
  const peerTicks = (() => {
    if (!values?.length) return [];
    const valid = values.filter((v) => Number.isFinite(v) && v > 0);
    if (valid.length <= MAX_PEER_TICKS) return valid;
    const step = valid.length / MAX_PEER_TICKS;
    const sampled: number[] = [];
    for (let i = 0; i < MAX_PEER_TICKS; i++) sampled.push(valid[Math.floor(i * step)]);
    return sampled;
  })();

  const iqrWidthPct = Math.max(0, at(p75) - at(p25));

  // p25/median/p75 labels are centered on their ticks, so a cohort with a long right tail (a handful of
  // very high earners stretching `max`) squeezes all three into a sliver of the track and their labels
  // collide — "Professor" puts p75 at $258k against a $749k max. Measure the real track and label widths
  // and stagger any collision onto a second row, the same two-row approach the Person trend chart uses
  // for title-change dividers. Measured rather than guessed from a percentage so it holds at every width.
  const labelRowRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [labelRows, setLabelRows] = useState<number[]>([0, 0, 0]);

  useLayoutEffect(() => {
    const row = labelRowRef.current;
    if (!row) return;
    const measure = () => {
      const els = labelRefs.current.filter((el): el is HTMLDivElement => !!el);
      if (!els.length) return;
      const next = assignLabelRows(
        els.map((el) => el.offsetLeft),
        els.map((el) => el.offsetWidth)
      );
      setLabelRows((prev) => (prev.length === next.length && prev.every((r, i) => r === next[i]) ? prev : next));
    };
    measure();
    // Observe the labels themselves, not just their container: a late web-font swap widens the text
    // without changing the container at all, which would otherwise leave the first (narrower)
    // measurement in place and the labels overlapping. The container covers layout-driven changes
    // (nav collapsing, a tab becoming visible); the window listener covers viewport resizes, which
    // some engines don't surface through ResizeObserver.
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    labelRefs.current.forEach((el) => el && ro.observe(el));
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [min, max, p25, median, p75]);

  const LABEL_ROW_H = 14;
  const labelRowCount = Math.max(1, ...labelRows.map((r) => r + 1));

  const hoverValue = hoverPct != null ? min + (hoverPct / 100) * span : null;
  const hoverBelowShare = hoverValue != null && values?.length
    ? values.filter((v) => Number.isFinite(v) && v > 0 && v < hoverValue).length / values.filter((v) => Number.isFinite(v) && v > 0).length
    : null;

  const updateHover = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverPct(frac * 100);
  };

  return (
    // See PayBandBar: `chart-plot` is how a hand-rolled figure tells the stylesheet it is one.
    <div className="chart-plot">
      {/* current-value pin above the dot — caret points down to it so the value reads as the dot's, not
          the median's. Both label + caret sweep in with the dot on mount. */}
      <div style={{ position: 'relative', height: 28 }}>
        <Text
          fw={700}
          className="accent7-text"
          style={{
            position: 'absolute',
            left: mounted ? `${pos}%` : 0,
            bottom: 7,
            transform: `translateX(${labelTx})`,
            whiteSpace: 'nowrap',
            fontSize: 12.5,
            color: MARK_SELF_TEXT,
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
            borderTop: `7px solid ${MARK_SELF}`,
            transition: 'left 600ms ease-out',
          }}
        />
      </div>

      {/* Track + rug share one hover wrapper so the readout works over either lane. */}
      <div
        ref={trackRef}
        onMouseMove={(e) => updateHover(e.clientX)}
        onMouseLeave={() => setHoverPct(null)}
        style={{ position: 'relative', cursor: values?.length ? 'crosshair' : undefined }}
      >
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
              width: mounted ? `${iqrWidthPct}%` : 0,
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
              background: MARK_SELF,
              border: '2px solid var(--mantine-color-body)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              transform: 'translate(-50%, -50%)',
              transition: 'left 600ms ease-out',
            }}
          />
        </div>

        {/* Rug lane: one faint round-capped mark per peer, in its own slim row UNDER the track (marks
            drawn on the pill itself read as a barcode against the gradient). */}
        {peerTicks.length > 0 && (
          <div aria-hidden style={{ position: 'relative', height: 10, marginTop: 3 }}>
            {peerTicks.map((v, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${at(v)}%`,
                  top: 1.5,
                  width: 1,
                  height: 7,
                  borderRadius: 999,
                  background: 'var(--mantine-color-gray-6)',
                  opacity: 0.35,
                  transform: 'translateX(-50%)',
                }}
              />
            ))}
          </div>
        )}

        {/* Cursor-following hover readout: salary at this point + share of the cohort earning less. */}
        {hoverPct != null && hoverValue != null && (
          <div
            style={{
              position: 'absolute',
              left: `${hoverPct}%`,
              bottom: 'calc(100% + 6px)',
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: Z.local,
            }}
          >
            <span className="chart-value-pill">
              ~{usd(hoverValue)}{hoverBelowShare != null ? ` · ${ordinal(Math.round(hoverBelowShare * 100))} percentile` : ''}
            </span>
          </div>
        )}
      </div>

      {/* min / max own the extremes */}
      <div style={{ position: 'relative', height: 16, marginTop: 6 }}>
        <Text size="xs" c="dimmed" style={{ position: 'absolute', left: 0 }}>{usd(min)} · lowest</Text>
        <Text size="xs" c="dimmed" style={{ position: 'absolute', right: 0 }}>highest · {usd(max)}</Text>
      </div>
      {/* interior labels sit under their ticks (compact $Xk so they don't crowd), dropping to a second
          row when a tight interquartile range would otherwise overlap them */}
      <div ref={labelRowRef} style={{ position: 'relative', height: labelRowCount * LABEL_ROW_H }}>
        {ticks.map((t, i) => (
          <Text
            key={t.label}
            ref={(el: HTMLDivElement | null) => {
              labelRefs.current[i] = el;
            }}
            size="xs"
            c="dimmed"
            fw={t.strong ? 600 : 400}
            style={{
              position: 'absolute',
              left: `${at(t.x)}%`,
              top: (labelRows[i] ?? 0) * LABEL_ROW_H,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
              fontSize: 10.5,
            }}
          >
            {t.label} {fmtK(t.x)}
          </Text>
        ))}
      </div>

      {/* One quiet caption explains the encodings (in-band text collided with the median tick). */}
      <Text size="xs" c="dimmed" mt={4}>
        Shaded band = middle 50% of peers{peerTicks.length > 0 ? ' · each tick below the bar = one person' : ''}.
      </Text>

      {/* Current is now pinned above the dot; only the target (when present) needs a legend. */}
      {target != null && (
        <MarkerLegend items={[{ color: MARK_TARGET, label: `Target ${usd(target)}` }]} />
      )}
    </div>
  );
}
