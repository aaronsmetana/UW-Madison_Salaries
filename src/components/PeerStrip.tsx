import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import { usd, num } from '../lib/format';
import { assignLabelRows, fmtK } from '../lib/chartStyle';
import { useMounted } from '../lib/motion';
import {
  MARK_SELF, MARK_SELF_TEXT, MARK_PEER, MARK_PEER_SAME_SCHOOL, DOT_R, GUIDE_SOFT,
  MarkerLegend, type PeerPoint,
} from './markers';
import { binSalaries } from '../lib/histogram';
import { dotRows, rowHeight, MAX_ROWS } from '../lib/swarm';
import { ChartData } from './ChartData';
import { Z } from '../lib/layers';

const RIBBON_H = 76;
/** Headroom above the population for the subject's own mark, which sits on its own lane. */
const SELF_LANE_H = DOT_R.self * 2 + 5;
const MARKER_LANE_H = 26;
const AXIS_LABEL_ROW_H = 15;
/** How close the cursor must come to a dot before the readout names that person instead of the
 *  axis position. Roughly a dot's diameter plus a little slack — enough to be reachable, small
 *  enough that the space between dots still reads the axis. */
const HOVER_SNAP_PX = 14;
/** One source for the dot radius: the packer reserves exactly what the renderer draws. */
const ROW_H = rowHeight(DOT_R.peer);

interface AxisLabel {
  x: number;
  text: string;
  strong?: boolean;
}

/** How a label at `frac` along the axis is anchored, so the two at the extremes stay inside the card
 *  instead of hanging half their width past the edge. */
function anchorFor(frac: number): { tx: string; centreShift: number } {
  if (frac < 0.06) return { tx: '0%', centreShift: 0.5 };
  if (frac > 0.94) return { tx: '-100%', centreShift: -0.5 };
  return { tx: '-50%', centreShift: 0 };
}

/**
 * "Where does this person sit among their peers" as ONE chart on ONE salary axis.
 *
 * It replaces a range strip stacked on top of a histogram. Those drew the same cohort twice, on two
 * different x-domains, and the histogram marked the subject by recolouring one tile inside a stack —
 * where a tile's height means *count* for everyone else but was set to the subject's *rank within the
 * bin* for them. One axis carrying two meanings, and the undocumented one was the reader's own.
 *
 * Here the population is dots (or, when they will not fit, a density ribbon) and the subject is a
 * different mark on its own lane, tied to the axis by a leader line. Vertical position carries no
 * meaning in either mode — it is collision avoidance and nothing else — so there is no second meaning
 * to misread. The axis draws three labels, which is what keeps it legible at phone width; the twelve
 * bin edges it replaces overlapped in every adjacent pair at 375px.
 *
 * Marks, radii and guide styling all come from `markers.tsx`, so a peer, a same-school peer and the
 * subject are drawn identically here and in the tenure scatter on the same page. The population is
 * SVG for the same reason: it is what the scatter draws, so both get the same hover behaviour from one
 * rule rather than two implementations of it.
 *
 * The one deliberate difference from the scatter is where the subject sits. In the scatter both axes
 * carry meaning, so the subject has to be drawn in place among the cloud. Here the vertical axis means
 * nothing, so putting the subject inside the swarm would put them back among the population — the
 * exact confusion this chart exists to remove. They get their own lane, and the leader line carries
 * their position down to the axis.
 */
export function PeerStrip({
  min,
  p25,
  median,
  p75,
  max,
  value,
  points,
  domain,
  label = 'This person',
  caption = 'Salary distribution',
}: {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  /** The subject's pay. */
  value: number;
  /** Every peer in the cohort, the subject included — they are one of the population, not an outsider.
   *  Same array the tenure scatter is handed, so the two charts cannot disagree about who is who. */
  points: PeerPoint[];
  /** Hold the axis to a wider range than the cohort (the whole title) so a narrower cohort — "same
   *  school" — visibly thins inside it instead of re-fitting to itself and looking identical. */
  domain?: [number, number];
  /** Names the subject's mark, e.g. a first name. Rendered as "Aaron · $114,207". */
  label?: string;
  caption?: string;
}) {
  const mounted = useMounted();

  const plotRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(0);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  // The five-number summary describes the cohort; the axis may span something wider (see `domain`).
  const axisMin = domain ? Math.min(domain[0], min) : min;
  const axisMax = domain ? Math.max(domain[1], max) : max;
  const span = axisMax - axisMin;
  // Memoised because the hover hit-test depends on it: an `at` rebuilt every render would make that
  // useMemo recompute on every mouse move, which is the one place in this component that matters.
  const at = useCallback(
    (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - axisMin) / span)) : 0),
    [axisMin, span],
  );

  // The dot dodge needs real pixels, and only the container width can supply them. Fonts play no part
  // here (unlike the axis labels below), so a plain ResizeObserver is enough.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setPlotW((prev) => {
      const next = el.getBoundingClientRect().width;
      return Math.abs(next - prev) < 0.5 ? prev : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const peers = points
    .filter((p) => Number.isFinite(p.pay) && p.pay > 0)
    .sort((a, b) => a.pay - b.pay);
  /** Every pay in the cohort — the subject included, because they are one of the 48. Stats, the
   *  ribbon and the hover readout all describe the whole population. */
  const sorted = peers.map((p) => p.pay);
  /** The dots actually drawn. The subject is left out because they already have their own mark on the
   *  lane above; drawing them twice puts an unexplained grey dot directly under their leader line, and
   *  makes the legend's "Others" a lie. This is what the scatter does too. */
  const plotted = peers.filter((p) => !p.isSelf);
  const hasSameSchool = plotted.some((p) => p.sameSchool);

  // Greedy row packing, sorted by value so the packer fills each row left to right. This is the same
  // helper the chart label staggers use — a dot is a label of constant width, so there is no second
  // algorithm to keep in step with the first.
  const rows = dotRows(plotted.map((p) => p.pay), at, plotW, DOT_R.peer);
  const rowsNeeded = rows.length ? Math.max(...rows) + 1 : 0;
  const useRibbon = rowsNeeded > MAX_ROWS;
  const swarmH = useRibbon ? RIBBON_H : Math.max(3, rowsNeeded) * ROW_H;
  const plotH = swarmH + SELF_LANE_H;

  // Ribbon: a bin count per x, drawn as one area in the population's own colour. Straight segments
  // between 24 bin centres read as a curve at this width and stay honest about being binned counts.
  const ribbonPath = (() => {
    if (!useRibbon || plotW <= 0) return null;
    const bins = binSalaries(sorted, 24, [axisMin, axisMax]);
    if (bins.length < 2) return null;
    const peak = Math.max(1, ...bins.map((b) => b.n));
    const base = plotH;
    const pts = bins.map((b) => {
      const x = at((b.lo + b.hi) / 2) * plotW;
      const y = base - (b.n / peak) * (swarmH - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${base} L${pts.join(' L')} L${plotW},${base} Z`;
  })();

  const pos = at(value) * 100;
  const selfX = at(value) * plotW;
  const labelTx = pos < 12 ? '0%' : pos > 88 ? '-100%' : '-50%';

  // Three labels, never twelve — and deliberately not a fourth for the subject. The marker prints the
  // exact figure at the same x and the leader line lands on the axis under it, so an axis tick would
  // only restate it; it was also the one pair that ever collided (a subject near the median).
  const axisLabels: AxisLabel[] = [
    { x: axisMin, text: usd(axisMin) },
    { x: median, text: `median ${fmtK(median)}`, strong: true },
    { x: axisMax, text: usd(axisMax) },
  ];

  const labelRowRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [labelRows, setLabelRows] = useState<number[]>(() => axisLabels.map(() => 0));

  // Measured, not guessed: a subject sitting near the median puts two labels on the same pixel, and
  // the widths depend on the webfont, which arrives after the first pass.
  useLayoutEffect(() => {
    const row = labelRowRef.current;
    if (!row) return;
    const measure = () => {
      const els = labelRefs.current.filter((el): el is HTMLDivElement => !!el);
      if (!els.length) return;
      // `offsetLeft` is the anchor point, which is the centre only for the centred labels; the two
      // edge-hugging ones sit half a width to one side of it. Correct for that before packing, or the
      // packer compares the wrong boxes and staggers labels that never touched. The fraction comes off
      // the element's own data attribute so this effect depends on nothing that changes every render.
      const next = assignLabelRows(
        els.map((el) => el.offsetLeft + anchorFor(Number(el.dataset.frac) || 0).centreShift * el.offsetWidth),
        els.map((el) => el.offsetWidth),
      );
      setLabelRows((prev) => (prev.length === next.length && prev.every((r, i) => r === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    labelRefs.current.forEach((el) => el && ro.observe(el));
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [axisMin, axisMax, median, value]);

  const labelRowCount = Math.max(1, ...labelRows.map((r) => r + 1));

  // The five-number summary rather than the plotted values: it is what the chart is *about*, it stays
  // one screenful for a 1,251-person cohort, and the peer table below the card already lists everyone.
  const summaryTable = (
    <ChartData
      caption={caption}
      columns={['Statistic', 'Salary']}
      rows={[
        ['Lowest', min],
        ['25th percentile', p25],
        ['Median', median],
        ['75th percentile', p75],
        ['Highest', max],
        [label, value],
      ]}
      n={sorted.length}
      unit="people"
    />
  );

  const hoverValue = hoverPct != null ? axisMin + (hoverPct / 100) * span : null;
  const hoverBelow = hoverValue != null && sorted.length
    ? sorted.filter((v) => v < hoverValue).length / sorted.length
    : null;

  /**
   * The peer under the cursor, if there is one close enough.
   *
   * The scatter directly below this chart names the person you point at; the strip answered with an
   * estimated axis value instead, so the same dot meant two different things on one page. Snapping
   * to the nearest dot rather than relying on `:hover` is what makes it usable — these dots are
   * r=4.5 and packed a couple of pixels apart, which is a hard target to hit with a mouse and an
   * impossible one on a touch screen. The positional readout stays for the space between dots,
   * where reading the axis is the only sensible answer.
   */
  const hoveredPeer = useMemo(() => {
    if (useRibbon || hoverPct == null || hoverY == null || plotW <= 0) return null;
    const hx = (hoverPct / 100) * plotW;
    let best: { p: PeerPoint; cx: number } | null = null;
    let bestD = HOVER_SNAP_PX;
    for (let i = 0; i < plotted.length; i++) {
      const cx = at(plotted[i].pay) * plotW;
      const cy = plotH - (rows[i] ?? 0) * ROW_H - DOT_R.peer - 1;
      const d = Math.hypot(cx - hx, cy - hoverY);
      if (d < bestD) {
        bestD = d;
        best = { p: plotted[i], cx };
      }
    }
    return best;
  }, [useRibbon, hoverPct, hoverY, plotW, plotH, plotted, rows, at]);

  const updateHover = (clientX: number, clientY: number) => {
    const el = plotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHoverPct(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
    setHoverY(clientY - rect.top);
  };

  // A cohort with no spread at all — every holder of the title on the identical figure, which the
  // 173 Crowd Control Officers all at $124,800 really are. There is no axis to draw, and the dots
  // would pile on x=0 while the ribbon's binning collapsed to a single bin and drew nothing. Say what
  // is true instead of rendering an empty plot.
  if (!(span > 0)) {
    return (
      <div>
        <Text size="sm">
          All {num(sorted.length)} people with this title are paid exactly {usd(axisMin)} — there is no
          spread to plot.
        </Text>
        {summaryTable}
      </div>
    );
  }

  return (
    <div>
      <div className="peer-strip">
        {/* The subject's label. `accent7-text` is the app's existing fix for this pairing: the mark
            colour reads under 4.5:1 as type on the dark card, so dark mode swaps it for --text-accent.
            A label is not the mark colour applied to text — see MARK_SELF_TEXT. */}
        <div style={{ position: 'relative', height: MARKER_LANE_H }}>
          <Text
            className="peer-strip-you accent7-text"
            fw={700}
            style={{
              position: 'absolute',
              left: `${pos}%`,
              bottom: 2,
              transform: `translateX(${labelTx})`,
              whiteSpace: 'nowrap',
              fontSize: 12.5,
              color: MARK_SELF_TEXT,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 240ms ease',
            }}
          >
            {label} · {usd(value)}
          </Text>
        </div>

        <div
          ref={plotRef}
          onMouseMove={(e) => updateHover(e.clientX, e.clientY)}
          onMouseLeave={() => { setHoverPct(null); setHoverY(null); }}
          style={{ position: 'relative', height: plotH, cursor: sorted.length ? 'crosshair' : undefined }}
        >
          {plotW > 0 && (
            <svg
              width={plotW}
              height={plotH}
              style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
              aria-hidden
            >
              {/* Middle 50% — the band the caption names, and the only fill in the plot. */}
              <rect
                x={at(p25) * plotW}
                width={Math.max(0, (at(p75) - at(p25)) * plotW)}
                y={0}
                height={plotH}
                fill="var(--mantine-color-accent-6)"
                opacity={0.08}
              />
              <line
                x1={at(median) * plotW}
                x2={at(median) * plotW}
                y1={0}
                y2={plotH}
                stroke={GUIDE_SOFT.stroke}
                strokeDasharray={GUIDE_SOFT.dasharray}
                strokeWidth={GUIDE_SOFT.width}
              />

              {useRibbon && ribbonPath ? (
                <path
                  d={ribbonPath}
                  fill={MARK_PEER}
                  fillOpacity={0.55}
                  stroke={MARK_PEER}
                  strokeWidth={1}
                  opacity={mounted ? 1 : 0}
                  style={{ transition: 'opacity 240ms ease' }}
                />
              ) : (
                plotted.map((p, i) => (
                  <circle
                    key={p.personKey || i}
                    className="chart-dot"
                    cx={at(p.pay) * plotW}
                    cy={plotH - (rows[i] ?? 0) * ROW_H - DOT_R.peer - 1}
                    r={hoveredPeer?.p === p ? DOT_R.peer + 2 : DOT_R.peer}
                    fill={p.sameSchool ? MARK_PEER_SAME_SCHOOL : MARK_PEER}
                    fillOpacity={hoveredPeer && hoveredPeer.p !== p ? 0.45 : 0.9}
                    opacity={mounted ? 1 : 0}
                    style={{ transition: `opacity 240ms ease ${Math.min(i, 30) * 4}ms` }}
                  />
                ))
              )}

              {/* Leader line + the subject's mark, drawn exactly as the tenure scatter draws it. */}
              <line
                x1={selfX}
                x2={selfX}
                y1={SELF_LANE_H / 2}
                y2={plotH}
                stroke={MARK_SELF}
                strokeWidth={1}
                opacity={mounted ? 0.55 : 0}
                style={{ transition: 'opacity 240ms ease' }}
              />
              <circle
                className="peer-strip-marker"
                cx={selfX}
                cy={SELF_LANE_H / 2}
                r={DOT_R.self}
                fill={MARK_SELF}
                stroke="var(--mantine-color-body)"
                strokeWidth={1.5}
                opacity={mounted ? 1 : 0}
                style={{ transition: 'opacity 240ms ease' }}
              />
            </svg>
          )}

          {hoverPct != null && hoverValue != null && (
            <div
              style={{
                position: 'absolute',
                left: hoveredPeer ? `${(hoveredPeer.cx / plotW) * 100}%` : `${hoverPct}%`,
                bottom: 'calc(100% + 4px)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: Z.local,
              }}
            >
              <span className="chart-value-pill">
                {hoveredPeer
                  ? `${hoveredPeer.p.name} · ${usd(hoveredPeer.p.pay)}`
                  : `~${usd(hoverValue)}${hoverBelow != null ? ` · ${Math.round(hoverBelow * 100)}th percentile` : ''}`}
              </span>
            </div>
          )}
        </div>

        <div aria-hidden style={{ height: 1, background: 'var(--hairline-strong)' }} />

        <div ref={labelRowRef} style={{ position: 'relative', height: labelRowCount * AXIS_LABEL_ROW_H, marginTop: 4 }}>
          {axisLabels.map((l, i) => (
            <Text
              key={l.text + i}
              ref={(el: HTMLDivElement | null) => {
                labelRefs.current[i] = el;
              }}
              size="xs"
              c="dimmed"
              fw={l.strong ? 600 : 400}
              data-frac={at(l.x)}
              style={{
                position: 'absolute',
                left: `${at(l.x) * 100}%`,
                top: (labelRows[i] ?? 0) * AXIS_LABEL_ROW_H,
                transform: `translateX(${anchorFor(at(l.x)).tx})`,
                whiteSpace: 'nowrap',
                fontSize: 10.5,
              }}
            >
              {l.text}
            </Text>
          ))}
        </div>
      </div>

      <MarkerLegend
        items={[
          // "This person" verbatim, not the name — the scatter's legend on the same page says exactly
          // this, and two legends a card apart disagreeing about what to call the same mark is the
          // small kind of inconsistency that makes a page feel assembled rather than designed.
          { color: MARK_SELF, round: true, label: 'This person' },
          // The ribbon is one shape for the whole cohort — it cannot separate same-school peers, so the
          // legend must not offer a mark the chart never draws.
          ...(hasSameSchool && !useRibbon ? [{ color: MARK_PEER_SAME_SCHOOL, round: true, label: 'Same school' }] : []),
          { color: MARK_PEER, round: true, label: useRibbon ? 'Everyone with this title' : 'Others' },
        ]}
      />

      <Text size="xs" c="dimmed" mt={4}>
        {useRibbon ? 'Height = how many people earn about that much · ' : '1 dot = 1 person · '}
        shaded band = middle 50% of peers ({fmtK(p25)}–{fmtK(p75)}).
      </Text>

      {summaryTable}
    </div>
  );
}
