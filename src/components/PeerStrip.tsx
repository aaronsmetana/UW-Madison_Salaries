import { useLayoutEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import { usd, num } from '../lib/format';
import { assignLabelRows, fmtK } from '../lib/chartStyle';
import { useMounted } from '../lib/motion';
import { MARK_CURRENT } from './markers';
import { binSalaries } from '../lib/histogram';
import { dotRows, DOT_R, ROW_H, MAX_ROWS } from '../lib/swarm';
import { ChartData } from './ChartData';

const RIBBON_H = 76;
/** SVG user units for the ribbon. preserveAspectRatio="none" stretches these to the real width. */
const VB_W = 1000;
const VB_H = 100;
const MARKER_LANE_H = 30;
const AXIS_LABEL_ROW_H = 15;

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
 * to misread. The axis draws three labels — lowest, median, highest — which is what keeps it legible at
 * phone width; the twelve bin edges it replaces overlapped in every adjacent pair at 375px.
 */
export function PeerStrip({
  min,
  p25,
  median,
  p75,
  max,
  value,
  values,
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
  /** Every peer's pay, the subject included — they are one of the population, not an outsider. */
  values: number[];
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

  // The five-number summary describes the cohort; the axis may span something wider (see `domain`).
  const axisMin = domain ? Math.min(domain[0], min) : min;
  const axisMax = domain ? Math.max(domain[1], max) : max;
  const span = axisMax - axisMin;
  const at = (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - axisMin) / span)) : 0);

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

  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);

  // Greedy row packing, sorted by value so the packer fills each row left to right. This is the same
  // helper the chart label staggers use — a dot is a label of constant width, so there is no second
  // algorithm to keep in step with the first.
  const rows = dotRows(sorted, at, plotW);
  const rowsNeeded = rows.length ? Math.max(...rows) + 1 : 0;
  const useRibbon = rowsNeeded > MAX_ROWS;
  const plotH = useRibbon ? RIBBON_H : Math.max(3, rowsNeeded) * ROW_H;

  // Ribbon: a bin count per x, drawn as one area. Straight segments between 24 bin centres read as a
  // curve at this width and stay honest about being binned counts.
  const ribbonPath = (() => {
    if (!useRibbon) return null;
    const bins = binSalaries(sorted, 24, [axisMin, axisMax]);
    if (bins.length < 2) return null;
    const peak = Math.max(1, ...bins.map((b) => b.n));
    const pts = bins.map((b) => {
      const x = at((b.lo + b.hi) / 2) * VB_W;
      const y = VB_H - (b.n / peak) * (VB_H - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${VB_H} L${pts.join(' L')} L${VB_W},${VB_H} Z`;
  })();

  const pos = at(value) * 100;
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
      // `offsetLeft` is already the centre — the label is placed by `left: X%` and recentred with
      // translateX(-50%), which does not move offsetLeft.
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

  const updateHover = (clientX: number) => {
    const el = plotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHoverPct(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
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
        {/* Subject lane. The label and the dot share one x; the leader line below carries that x down
            to the axis, so nothing about which mark the label names is left to inference. */}
        <div style={{ position: 'relative', height: MARKER_LANE_H }}>
          {/* `accent7-text` is the app's existing fix for this exact pairing: accent-7 reads 3.08:1
              against the dark card, under AA, so dark mode swaps it for --text-accent. Without it the
              a11y gate fails on this label, which is how it was caught. */}
          <Text
            className="peer-strip-you accent7-text"
            fw={700}
            style={{
              position: 'absolute',
              left: `${pos}%`,
              top: 0,
              transform: `translateX(${labelTx})`,
              whiteSpace: 'nowrap',
              fontSize: 12.5,
              color: MARK_CURRENT,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 240ms ease',
            }}
          >
            {label} · {usd(value)}
          </Text>
          <div
            aria-hidden
            className="peer-strip-marker"
            style={{
              position: 'absolute',
              left: `${pos}%`,
              bottom: -DOT_R - 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: MARK_CURRENT,
              border: '2px solid var(--mantine-color-body)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              transform: 'translateX(-50%)',
              opacity: mounted ? 1 : 0,
              transition: 'opacity 240ms ease',
              zIndex: 3,
            }}
          />
        </div>

        <div
          ref={plotRef}
          onMouseMove={(e) => updateHover(e.clientX)}
          onMouseLeave={() => setHoverPct(null)}
          style={{ position: 'relative', height: plotH, cursor: sorted.length ? 'crosshair' : undefined }}
        >
          {/* Middle 50% — the band the caption names, and the only fill in the plot. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${at(p25) * 100}%`,
              width: `${(at(p75) - at(p25)) * 100}%`,
              top: 0,
              bottom: 0,
              background: 'var(--mantine-color-accent-6)',
              opacity: 0.08,
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${at(median) * 100}%`,
              top: 0,
              bottom: 0,
              width: 0,
              borderLeft: '1px dashed var(--mantine-color-gray-6)',
              opacity: 0.8,
            }}
          />

          {/* Leader line: the subject's x, drawn the full height of the plot down to the axis. */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${pos}%`,
              top: 0,
              bottom: 0,
              width: 1,
              marginLeft: -0.5,
              background: MARK_CURRENT,
              opacity: mounted ? 0.55 : 0,
              transition: 'opacity 240ms ease',
              zIndex: 2,
            }}
          />

          {useRibbon && ribbonPath ? (
            <svg
              aria-hidden
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: mounted ? 1 : 0, transition: 'opacity 240ms ease' }}
            >
              <path d={ribbonPath} fill="var(--bar)" fillOpacity={0.55} stroke="var(--bar)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            sorted.map((v, i) => (
              <div
                key={i}
                aria-hidden
                className="peer-strip-dot"
                style={{
                  position: 'absolute',
                  left: `${at(v) * 100}%`,
                  bottom: (rows[i] ?? 0) * ROW_H,
                  width: DOT_R * 2,
                  height: DOT_R * 2,
                  borderRadius: '50%',
                  background: 'var(--bar)',
                  transform: 'translateX(-50%)',
                  opacity: mounted ? 0.85 : 0,
                  transition: `opacity 240ms ease ${Math.min(i, 30) * 4}ms`,
                }}
              />
            ))
          )}

          {hoverPct != null && hoverValue != null && (
            <div
              style={{
                position: 'absolute',
                left: `${hoverPct}%`,
                bottom: 'calc(100% + 4px)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              <span className="chart-value-pill">
                ~{usd(hoverValue)}{hoverBelow != null ? ` · ${Math.round(hoverBelow * 100)}th percentile` : ''}
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

      <Text size="xs" c="dimmed" mt={4}>
        {useRibbon
          ? `Height = how many people earn about that much · `
          : `1 dot = 1 person · `}
        shaded band = middle 50% of peers ({fmtK(p25)}–{fmtK(p75)}).
      </Text>

      {summaryTable}
    </div>
  );
}
