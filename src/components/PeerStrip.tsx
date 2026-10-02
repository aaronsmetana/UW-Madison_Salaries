import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text } from '@mantine/core';
import { usd, num, fmtYears } from '../lib/format';
import { ordinal } from '../lib/stats';
import { CHART_FONT, fmtK } from '../lib/chartStyle';
import { useMounted } from '../lib/motion';
import {
  MARK_SELF, MARK_PEER, MARK_PEER_SAME_SCHOOL, DOT_R, BAND_IQR, LARGE_GROUP, peerDot,
  MarkerLegend, ChartDot, type PeerPoint,
} from './markers';
import { binSalaries } from '../lib/histogram';
import { smoothBins } from '../lib/distribution';
import { beeswarm } from '../lib/swarm';
import { moneyTicks } from '../lib/rangeScale';
import { placeLabel, sampleVertical, type Box, type Placement } from '../lib/labelPlace';
import { ChartData } from './ChartData';
import { DotField } from './chart/DotField';
import { Z } from '../lib/layers';
import { sideOf, type PayWindow } from '../lib/payWindow';

/** The swarm's height: everyone with a title of the redesign's 47 fits with room, and a denser one is
 *  drawn as its density (the ribbon) rather than squeezed. */
const SWARM_H = 176;
const R = DOT_R.peer;
/** How far from the centreline a dot may go before the cohort is too dense for dots. */
const MAX_OFFSET = SWARM_H / 2 - R - 2;
const RIBBON_H = 76;
/** Over a ribbon, the subject sits on a lane of their own above it, with room over that for their name. */
const SELF_LANE_H = R * 2 + 5;
const LABEL_LANE_H = 32;
/** How close the cursor must come to a dot before the readout names that person instead of the
 *  axis position. Roughly a dot's diameter plus a little slack — enough to be reachable, small
 *  enough that the space between dots still reads the axis. */
const HOVER_SNAP_PX = 14;
/**
 * Drawing kernel for the density ribbon, in PIXELS — not dollars, and not bin widths.
 *
 * The landing page smooths $1k buckets with a $1,200 kernel, which at its geometry is 4.9px; this is
 * the same visual kernel, and 5px is what makes the two charts read as the same drawing.
 *
 * Pixels because neither alternative survives this chart's inputs. A dollar constant cannot: a title
 * spanning $8k and one spanning $1.1m are both drawn here, and $1,200 would erase the first and do
 * nothing to the second. Bin widths cannot either, because `niceStep` rounds the bin count down hard
 * — ask it for 255 bins and it returns 148 — so "1.2 bin widths" silently lands anywhere from 0.6 to
 * 1.8 of the kernel actually wanted. Converting from pixels at the end is the only form that holds
 * the smoothing constant on screen, which is the thing a reader sees.
 */
const KERNEL_PX = 5;
/**
 * Target width of one ribbon bin, in px. Deliberately finer than the kernel above, so the curve is
 * resolved by the smoothing rather than by the binning — the landing page draws 4.1px buckets.
 *
 * 2, not 2.5, because `niceStep` only emits round widths and so jumps in steps of 2.5x: for the 1,251
 * Professors it returns $5k bins at a 876px plot and $2k bins at 1021px, which is 5.96px per segment
 * at one width and 2.75px at the other. Asking for 2px keeps the coarse side of that jump under the
 * kernel at every width this chart is drawn at — measured 2.3-2.8px per segment from 335px to 1021px,
 * against 68px before any of this.
 */
const RIBBON_BIN_PX = 2;
/**
 * The ribbon's kernel and height across a plot `w` px wide: KERNEL_PX and RIBBON_H on a phone; wider,
 * the kernel a hundredth of the plot and the ribbon a seventh of it, up to RIBBON_MAX_H.
 *
 * Held at 5px and 76px, a desktop strip zoomed to a title's middle 90% (lib/payWindow) was resolved
 * three times as finely as the same strip on a phone: Research Associate's $50k–$74k at 880px smoothed
 * over $140, so its 103 people on exactly $60,416 stood as one spike and everyone else as a flat line
 * under it. A sixtieth of the plot drew that shape and ironed the zoomed Professors into one hump
 * (roughness 0.004, under the "featureless" 0.008 the ribbon guard holds); a hundredth draws both.
 */
const RIBBON_MAX_H = 120;
const ribbonKernel = (w: number) => Math.max(KERNEL_PX, w / 100);
const ribbonHeight = (w: number) => Math.round(Math.min(RIBBON_MAX_H, Math.max(RIBBON_H, w / 7)));
/** With a pay window (lib/payWindow): the break between the plot and each pile of the people outside
 *  it, px; a pile's least width; and the most of the strip a pile may take. */
const PILE_GAP = 12;
const PILE_MIN_W = 10;
const PILE_MAX_SHARE = 0.2;
/** The axis's tick labels: 12px chart text on a 16px line. */
const TICK_LINE = 16;

/** A pile's dots: everyone in it, each placed along the pile by their rank in it, lowest pay at the left;
 *  as a swarm (not `ribbon`), spread from the centreline as the plot's are. Its offsets are null where the
 *  pile is too dense for dots, and it is drawn as the ribbon's dots are. */
function pileDots(list: readonly PeerPoint[], w: number, ribbon: boolean) {
  const fracs = list.map((_, i) => (i + 0.5) / Math.max(1, list.length));
  const ys = ribbon || !(w > 0) ? null : beeswarm(fracs.map((f) => f * w), R, MAX_OFFSET, list.findIndex((p) => p.isSelf));
  // Over a ribbon a pile is drawn as the ribbon's dots are: the cohort only, the subject on their own mark.
  const others = list.filter((p) => !p.isSelf && !p.dimmed);
  return {
    list,
    ys,
    values: Float64Array.from(others.map((p) => (list.indexOf(p) + 0.5) / Math.max(1, list.length))),
    kinds: Uint8Array.from(others.map((p) => (p.sameSchool ? 1 : 0))),
  };
}

/** What the caption says about a window's piles: the axis's span, and who is piled where. A fact about
 *  this axis rather than a how-to-read, so it stays on the card when the rest goes behind the footer's
 *  note. */
function pileNote(w: PayWindow, below: number, above: number, listable: boolean): string {
  const people = (n: number) => `${num(n)} ${n === 1 ? 'person' : 'people'}`;
  const where = below && above
    ? `the ${people(below)} paid less and the ${people(above)} paid more are piled at each end`
    : below ? `the ${people(below)} paid less are piled at the left` : `the ${people(above)} paid more are piled at the right`;
  return `The axis runs ${fmtK(w.lo)}–${fmtK(w.hi)}, where 90% of people with this title are paid; ${where}${listable ? ' (select a pile to list them)' : ''}.`;
}

/** "Aaron · $116,491 · 11.9 yrs": a person, as a readout names them. */
const readout = (p: PeerPoint) => `${p.name} · ${usd(p.pay)}${p.tenure != null && Number.isFinite(p.tenure) ? ` · ${fmtYears(Math.max(0, p.tenure))}` : ''}`;

/**
 * "Where does this person sit among their peers" as ONE chart on ONE salary axis.
 *
 * It replaced a range strip stacked on top of a histogram. Those drew the same cohort twice, on two
 * different x-domains, and the histogram marked the subject by recolouring one tile inside a stack —
 * where a tile's height means *count* for everyone else but was set to the subject's *rank within the
 * bin* for them. One axis carrying two meanings, and the undocumented one was the reader's own.
 *
 * Here the population is a beeswarm: one 10px dot per person, every dot as near the centreline as the
 * dots before it allow, none overlapping, the same picture every time (lib/swarm `beeswarm`). Vertical
 * position means nothing but room. The subject is placed first, on the line, among their peers — as the
 * person-page redesign drew it. They were on a lane of their own above the swarm, half again as large, so
 * that position would not make them one of the population; their pip, their teal and their name (placed
 * beside them by lib/labelPlace, with a leader where it must sit away) now say who they are, and their
 * place in the swarm is where they stand. Where a cohort is too dense for dots, it is drawn as its density
 * (a ribbon), the subject over it on their own lane.
 *
 * The middle 50% is a rounded band behind the dots and the median a dashed line, each named where it is
 * ("Median $119k", "Middle 50% · $114k–$127k"); the axis is ticks at round steps. Marks come from
 * `markers.tsx`, so a person is drawn here as in the tenure scatter on the same page.
 *
 * `points` is everyone with the title; those `dimmed` (outside the chosen cohort) stay where they are, at
 * 18%, so choosing "Same school" thins the picture rather than redrawing it. The band and median are the
 * cohort's (`p25`…`median`…`p75`).
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
  fullName,
  caption = 'Salary distribution',
  zoom = null,
  onPile,
  pileShown = 0,
}: {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  /** The subject's pay. */
  value: number;
  /** Everyone with the title, the subject included — they are one of the population, not an outsider —
   *  those outside the chosen cohort `dimmed`. Same array the tenure scatter is handed, so the two charts
   *  cannot disagree about who is who. */
  points: PeerPoint[];
  /** Hold the axis to a wider range than the cohort (the whole title) so a narrower cohort — "same
   *  school" — visibly thins inside it instead of re-fitting to itself and looking identical. */
  domain?: [number, number];
  /** Names the subject's mark, e.g. a first name. Rendered as "Aaron · $114,207". */
  label?: string;
  /** The subject's whole name, for the legend's entry for their dot. */
  fullName?: string;
  caption?: string;
  /** The title's pay window (lib/payWindow): the axis spans it, and the people paid under or over it are
   *  piled past a break at each end. It overrides `domain`. */
  zoom?: PayWindow | null;
  /** A pile pressed: the side (-1 under the window, 1 over it) whose people the page lists. */
  onPile?: (side: -1 | 1) => void;
  /** The side whose people the page is listing, or 0. */
  pileShown?: -1 | 0 | 1;
}) {
  const mounted = useMounted();

  const plotRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // The strip's whole width, measured; the plot's is what the piles leave of it.
  const [stripW, setStripW] = useState(0);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverPile, setHoverPile] = useState<-1 | 0 | 1>(0);

  // The five-number summary describes the cohort; the axis may span something wider (see `domain`), or
  // narrower — the title's pay window, with the people outside it piled at each end.
  const axisMin = zoom ? zoom.lo : domain ? Math.min(domain[0], min) : min;
  const axisMax = zoom ? zoom.hi : domain ? Math.max(domain[1], max) : max;
  const span = axisMax - axisMin;
  const at = useCallback(
    (x: number) => (span > 0 ? Math.max(0, Math.min(1, (x - axisMin) / span)) : 0),
    [axisMin, span],
  );

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setStripW((prev) => {
      const next = el.getBoundingClientRect().width;
      return Math.abs(next - prev) < 0.5 ? prev : next;
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Memoised: hover writes state on every pointer move, and a title like Professor has 1,251 people.
  const peers = useMemo(
    () => points.filter((p) => Number.isFinite(p.pay) && p.pay > 0).sort((a, b) => a.pay - b.pay),
    [points],
  );
  /** The cohort's pays — the subject included, because they are one of them. The ribbon and the hover
   *  readout describe the cohort; the dimmed are only context. */
  const sorted = useMemo(() => peers.filter((p) => !p.dimmed).map((p) => p.pay), [peers]);
  const inPlot = useMemo(() => peers.filter((p) => sideOf(zoom, p.pay) === 0), [peers, zoom]);
  const hasSameSchool = useMemo(() => peers.some((p) => !p.isSelf && p.sameSchool), [peers]);
  const hasOthers = useMemo(() => peers.some((p) => !p.isSelf && !p.sameSchool), [peers]);
  const lows = useMemo(() => peers.filter((p) => sideOf(zoom, p.pay) < 0), [peers, zoom]);
  const highs = useMemo(() => peers.filter((p) => sideOf(zoom, p.pay) > 0), [peers, zoom]);
  const inside = useMemo(() => inPlot.filter((p) => !p.dimmed).map((p) => p.pay), [inPlot]);
  const lowsCounted = lows.filter((p) => !p.dimmed).length;
  const highsCounted = highs.filter((p) => !p.dimmed).length;

  // Each pile as wide as its share of the people drawn in the plot, so its dots have the room the
  // plot's have: w = plot · n / inside, with the plot what the piles and their breaks leave. A pile is
  // never narrower than PILE_MIN_W nor wider than PILE_MAX_SHARE of the strip.
  const { plotW, lowW, highW } = useMemo(() => {
    const nIn = Math.max(1, inPlot.length);
    const gaps = (lows.length ? PILE_GAP : 0) + (highs.length ? PILE_GAP : 0);
    const plot0 = Math.max(0, stripW - gaps) / (1 + (lows.length + highs.length) / nIn);
    const width = (n: number) => (n ? Math.min(stripW * PILE_MAX_SHARE, Math.max(PILE_MIN_W, (plot0 * n) / nIn)) : 0);
    const lw = width(lows.length), hw = width(highs.length);
    return { plotW: Math.max(0, stripW - gaps - lw - hw), lowW: lw, highW: hw };
  }, [stripW, inPlot.length, lows.length, highs.length]);
  const lowAside = lowW ? lowW + PILE_GAP : 0;
  const highAside = highW ? highW + PILE_GAP : 0;

  // The beeswarm, or null where the cohort is too dense for dots at this width (or too many to count).
  const swarm = useMemo(() => {
    if (!(plotW > 0) || peers.length > LARGE_GROUP) return null;
    return beeswarm(inPlot.map((p) => at(p.pay) * plotW), R, MAX_OFFSET, inPlot.findIndex((p) => p.isSelf));
  }, [plotW, peers.length, inPlot, at]);
  const useRibbon = plotW > 0 && !swarm;
  const ribbonH = ribbonHeight(plotW);
  /** Where the population starts below the plot's top: under the subject's lanes over a ribbon. */
  const popTop = useRibbon ? LABEL_LANE_H + SELF_LANE_H : 0;
  const popH = useRibbon ? ribbonH : SWARM_H;
  const plotH = popTop + popH;
  const midY = SWARM_H / 2;

  /**
   * The density ribbon: a smoothed curve over the cohort, drawn as an area plus a line the way the
   * landing page's distribution is. `binSalaries` is kept rather than binning evenly, precisely because it
   * rounds: landing bins on round dollar edges is what keeps the pay spikes at $50k, $60k, $75k on a single
   * bin instead of smeared across two — people hired onto round numbers, not noise to be cleaned up.
   */
  const ribbon = useMemo(() => {
    if (!useRibbon || plotW <= 0 || !(span > 0)) return null;
    const target = Math.max(40, Math.min(600, Math.round(plotW / RIBBON_BIN_PX)));
    // Only the people inside the axis: binned against a narrower domain, the rest would pile into its end
    // bins and draw spikes at both edges.
    const bins = binSalaries(inside, target, [axisMin, axisMax]);
    if (bins.length < 2) return null;
    const step = bins[1].lo - bins[0].lo;
    const curve = smoothBins(bins.map((b) => ({ bucket: b.lo, n: b.n })), ribbonKernel(plotW) * (span / plotW));
    // Against the SMOOTHED peak, not the raw one: the kernel moves weight out of the tallest bin.
    const peak = Math.max(...curve.map((c) => c.n));
    if (!(peak > 0)) return null;
    const xy = curve.map((c) => ({ x: at(c.bucket + step / 2) * plotW, h: (c.n / peak) * (ribbonH - 2) }));
    const pts = xy.map((p) => `${p.x.toFixed(1)},${(plotH - p.h).toFixed(1)}`);
    return { line: `M${pts.join(' L')}`, xy };
  }, [useRibbon, plotW, span, inside, axisMin, axisMax, at, plotH, ribbonH]);

  // One dot per peer under the ribbon's curve (DotField), where they are too many for a swarm.
  const ribbonPeers = useMemo(() => inPlot.filter((p) => !p.isSelf && !p.dimmed), [inPlot]);
  const dotValues = useMemo(() => Float64Array.from(ribbonPeers.map((p) => p.pay)), [ribbonPeers]);
  const dotKinds = useMemo(() => Uint8Array.from(ribbonPeers.map((p) => (p.sameSchool ? 1 : 0))), [ribbonPeers]);
  const dotX = useCallback((v: number, w: number) => at(v) * w, [at]);
  const dotHeight = useCallback((x: number) => {
    const xy = ribbon?.xy;
    if (!xy || xy.length < 2) return 0;
    let i = 0;
    while (i < xy.length - 2 && xy[i + 1].x < x) i++;
    const a = xy[i], b = xy[i + 1];
    const f = Math.min(1, Math.max(0, (x - a.x) / ((b.x - a.x) || 1)));
    return Math.max(0, a.h + (b.h - a.h) * f);
  }, [ribbon]);

  const pileH = useMemo(() => {
    const xy = ribbon?.xy;
    if (!xy?.length) return popH - 2;
    return Math.max(4, Math.round(xy.reduce((t, p) => t + p.h, 0) / xy.length));
  }, [ribbon, popH]);
  const lowDots = useMemo(() => pileDots(lows, lowW, useRibbon), [lows, lowW, useRibbon]);
  const highDots = useMemo(() => pileDots(highs, highW, useRibbon), [highs, highW, useRibbon]);
  const pileX = useCallback((v: number, w: number) => v * w, []);
  const pileHeight = useCallback(() => pileH, [pileH]);

  // The subject: where their pay is in the plot, or in their pile at their rank in it.
  const selfSide = sideOf(zoom, value);
  const selfPile = selfSide < 0 ? lowDots : selfSide > 0 ? highDots : null;
  const selfRank = selfPile ? Math.max(0, selfPile.list.findIndex((p) => p.isSelf)) : 0;
  const selfX = selfSide < 0
    ? -lowAside + ((selfRank + 0.5) / Math.max(1, lows.length)) * lowW
    : selfSide > 0
      ? plotW + PILE_GAP + ((selfRank + 0.5) / Math.max(1, highs.length)) * highW
      : at(value) * plotW;
  const selfIdx = inPlot.findIndex((p) => p.isSelf);
  const selfY = useRibbon
    ? LABEL_LANE_H + SELF_LANE_H / 2
    : midY + (selfPile ? selfPile.ys?.[selfRank] ?? 0 : selfIdx >= 0 ? swarm?.[selfIdx] ?? 0 : 0);

  const px = (v: number) => at(v) * plotW;
  const medX = px(median);
  const bandX0 = px(p25), bandX1 = px(p75);

  // The words on the plot, measured: the median's, the band's and the subject's, so each can be placed and
  // the subject's can keep off the other two.
  const medRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const bandShortRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ med: 0, band: 0, bandShort: 0, youW: 0, youH: 0, labelH: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const next = {
        med: medRef.current?.offsetWidth ?? 0,
        band: bandRef.current?.offsetWidth ?? 0,
        bandShort: bandShortRef.current?.offsetWidth ?? 0,
        youW: youRef.current?.offsetWidth ?? 0,
        youH: youRef.current?.offsetHeight ?? 0,
        labelH: medRef.current?.offsetHeight ?? 0,
      };
      setSizes((prev) => (Object.keys(next).every((k) => prev[k as keyof typeof prev] === next[k as keyof typeof next]) ? prev : next));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    const ro = new ResizeObserver(measure);
    [medRef, bandRef, bandShortRef, youRef].forEach((r) => r.current && ro.observe(r.current));
    return () => ro.disconnect();
  }, [median, p25, p75, value, label]);

  // The median's name beside the top of its line, on whichever side has the room.
  const medRight = medX + 6 + sizes.med <= plotW;
  const medBox: Box = medRight
    ? { x0: medX + 6, y0: popTop + 2, x1: medX + 6 + sizes.med, y1: popTop + 2 + sizes.labelH }
    : { x0: medX - 6 - sizes.med, y0: popTop + 2, x1: medX - 6, y1: popTop + 2 + sizes.labelH };
  // The band's name inside its foot, right-aligned: the full one where it fits, else its first words, else none.
  const bandRoom = bandX1 - bandX0 - 16;
  const bandWords = sizes.band && sizes.band <= bandRoom ? 'full' : sizes.bandShort && sizes.bandShort <= bandRoom ? 'short' : null;
  const bandW = bandWords === 'full' ? sizes.band : bandWords === 'short' ? sizes.bandShort : 0;
  const bandBox: Box = { x0: bandX1 - 8 - bandW, y0: plotH - 6 - sizes.labelH, x1: bandX1 - 8, y1: plotH - 6 };
  const bandText = `${BAND_IQR.label[0].toUpperCase()}${BAND_IQR.label.slice(1)}`;

  // The subject's name: placed by lib/labelPlace, as close to their dot as the people, the words and the
  // median's line round it allow. It moves when what is round it does (the cohort, the width, the fonts),
  // never because something is pointed at.
  const placedRef = useRef<Placement | null>(null);
  const place = useMemo(() => {
    if (!(plotW > 0) || !sizes.youW) return null;
    const dots = useRibbon || !swarm ? [] : inPlot.map((p, i) => (p.isSelf ? null : { x: at(p.pay) * plotW, y: midY + swarm[i], r: R, weight: p.dimmed ? 0.12 : 1 }))
      .filter((d): d is NonNullable<typeof d> => d != null);
    const p = placeLabel({
      anchor: { x: selfX, y: selfY },
      size: { w: sizes.youW, h: sizes.youH },
      bounds: { x0: -lowAside, y0: 0, x1: plotW + highAside, y1: plotH },
      dots,
      boxes: [medBox, ...(bandWords ? [bandBox] : [])],
      lines: [{ points: sampleVertical(medX, popTop, plotH), weight: 0.25 }],
      current: placedRef.current,
    });
    placedRef.current = p;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the boxes are functions of these
  }, [plotW, sizes, useRibbon, swarm, inPlot, at, selfX, selfY, lowAside, highAside, plotH, medX, popTop, bandWords, medRight]);

  // The axis: ticks at round steps across the plot, about one per 90px — none where a pile's count stands
  // under the break beside it ("46 under $100k" says that end's figure already).
  const ticks = useMemo(() => {
    if (!(plotW > 0) || !(span > 0)) return [];
    return moneyTicks(axisMin, axisMax, Math.max(2, Math.floor(plotW / 90)))
      .filter((t) => t >= axisMin - 1e-6 && t <= axisMax + 1e-6)
      .filter((t) => !(lows.length && px(t) < 60) && !(highs.length && px(t) > plotW - 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `px` is a function of `at` and `plotW`
  }, [plotW, span, axisMin, axisMax, lows.length, highs.length, at]);

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
      about={
        <>
          {useRibbon
            ? 'Taller = more people earn near that salary, and each dot under the curve is one of them.'
            : '1 dot = 1 person; where many are paid alike, the dots spread above and below the middle.'}{' '}
          The shaded box is the middle 50% of peers ({fmtK(p25)}–{fmtK(p75)}), and the dashed line the median.
        </>
      }
    />
  );

  const hoverValue = hoverPct != null ? axisMin + (hoverPct / 100) * span : null;
  const hoverBelow = hoverValue != null && sorted.length ? sorted.filter((v) => v < hoverValue).length / sorted.length : null;

  /** The person under the cursor, if one is close enough: snapping to the nearest dot rather than relying on
   *  `:hover`, because 10px dots a pixel or two apart are a hard target for a mouse and an impossible one for
   *  a finger. The positional readout stays for the space between dots. */
  const hoveredPeer = useMemo(() => {
    if (useRibbon || !swarm || hoverPct == null || hoverY == null || plotW <= 0) return null;
    const hx = (hoverPct / 100) * plotW;
    let best: { p: PeerPoint; cx: number; cy: number } | null = null;
    let bestD = HOVER_SNAP_PX;
    for (let i = 0; i < inPlot.length; i++) {
      const cx = at(inPlot[i].pay) * plotW, cy = midY + swarm[i];
      const d = Math.hypot(cx - hx, cy - hoverY);
      if (d < bestD) {
        bestD = d;
        best = { p: inPlot[i], cx, cy };
      }
    }
    return best;
  }, [useRibbon, swarm, hoverPct, hoverY, plotW, inPlot, at, midY]);

  const updateHover = (clientX: number, clientY: number, target: EventTarget | null) => {
    const el = plotRef.current;
    if (!el) return;
    const pile = (target as Element | null)?.closest?.('[data-pile]');
    if (pile) {
      setHoverPct(null);
      setHoverY(null);
      setHoverPile(Number(pile.getAttribute('data-pile')) < 0 ? -1 : 1);
      return;
    }
    setHoverPile(0);
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setHoverPct(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
    setHoverY(clientY - rect.top);
  };

  // A cohort with no spread at all — every holder of the title on the identical figure, which the
  // 173 Crowd Control Officers all at $124,800 really are. Say what is true instead of an empty plot.
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

  /** The draw order: the dimmed, then everyone else, then same school, so the marks a reader looks for are
   *  on top; the subject is drawn last of all, over the svg. */
  const rank = (p: PeerPoint) => (p.dimmed ? 0 : p.sameSchool ? 2 : 1);

  // A pile of the people outside the window, past a break: as a button where the page can list them.
  const pileBox = (side: -1 | 1): ReactNode => {
    const list = side < 0 ? lows : highs;
    const w = side < 0 ? lowW : highW;
    // A pile holds everyone past its end and draws them all, the dimmed included; what it counts, and what
    // the table lists from it, is the chosen cohort.
    const counted = list.filter((p) => !p.dimmed);
    if (!counted.length || !(w > 0)) return null;
    const dots = side < 0 ? lowDots : highDots;
    const bound = side < 0 ? axisMin : axisMax;
    const words = `${num(counted.length)} ${counted.length === 1 ? 'person' : 'people'} ${side < 0 ? 'under' : 'over'} ${fmtK(bound)}`;
    const left = side < 0 ? -lowAside : plotW + PILE_GAP;
    const Box = onPile ? 'button' : 'div';
    return (
      <Box
        key={side}
        {...(onPile ? { type: 'button' as const, onClick: () => onPile(side), 'aria-pressed': pileShown === side, 'aria-label': `List the ${words}` } : { 'aria-hidden': true })}
        className="peer-strip-pile"
        data-pile={side}
        data-n={counted.length}
        style={{ position: 'absolute', left, top: popTop, width: w, height: popH, cursor: onPile ? 'pointer' : undefined }}
      >
        {useRibbon || !dots.ys ? (
          <DotField className="strip-dots" values={dots.values} kinds={dots.kinds} toX={pileX} heightAt={pileHeight} height={popH} />
        ) : (
          <svg width={w} height={popH} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
            {dots.list.map((p, i) => ({ p, i })).filter(({ p }) => !p.isSelf).sort((a, b) => rank(a.p) - rank(b.p)).map(({ p, i }) => {
              const dot = peerDot(p.sameSchool, peers.length);
              return (
                <ChartDot
                  key={p.personKey || i}
                  kind={p.sameSchool ? 'same' : 'peer'}
                  cx={((i + 0.5) / Math.max(1, list.length)) * w}
                  cy={midY + dots.ys![i]}
                  fillOpacity={dot.fillOpacity}
                  dimmed={p.dimmed}
                />
              );
            })}
          </svg>
        )}
        {/* The break: a zigzag in the baseline between the pile and the plot. */}
        <svg className="peer-strip-break" width={PILE_GAP} height={12} aria-hidden
          style={{ position: 'absolute', bottom: -5, [side < 0 ? 'right' : 'left']: -PILE_GAP }}>
          <path d={`M0 5 L${PILE_GAP * 0.3} 5 L${PILE_GAP * 0.42} 0 L${PILE_GAP * 0.58} 11 L${PILE_GAP * 0.7} 5 L${PILE_GAP} 5`} fill="none" stroke="var(--mantine-color-gray-5)" strokeWidth={1} />
        </svg>
        {hoverPile === side && (
          <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', [side < 0 ? 'left' : 'right']: 0, pointerEvents: 'none', zIndex: Z.local }}>
            <span className="chart-tip-pill">
              {words} · {side < 0 ? 'lowest' : 'highest'} {usd(side < 0 ? counted[0].pay : counted[counted.length - 1].pay)}
            </span>
          </div>
        )}
      </Box>
    );
  };

  // The readout over a dot: above it, or below where it would sit on the subject's name.
  const tipAbove = (() => {
    if (!hoveredPeer || !place || !sizes.youW) return true;
    const you = { x0: place.x - sizes.youW / 2, x1: place.x + sizes.youW / 2, y0: place.y - sizes.youH / 2, y1: place.y + sizes.youH / 2 };
    return !(you.y1 > hoveredPeer.cy - 40 && you.y0 < hoveredPeer.cy && you.x0 < hoveredPeer.cx + 90 && you.x1 > hoveredPeer.cx - 90);
  })();

  return (
    <div>
      {/* The key, over the plot: the subject by name with their own dot, then the colours the plot paints. */}
      <MarkerLegend
        align="start"
        items={[
          { color: MARK_SELF, dot: 'self' as const, label: fullName ?? label },
          ...(hasSameSchool ? [{ color: MARK_PEER_SAME_SCHOOL, dot: 'same' as const, label: 'Same school' }] : []),
          ...(hasOthers ? [{ color: MARK_PEER, dot: 'peer' as const, label: 'Others' }] : []),
        ]}
      />

      <div className="peer-strip" ref={stripRef} data-window={zoom ? `${zoom.lo}-${zoom.hi}` : undefined} data-mode={useRibbon ? 'ribbon' : 'swarm'}>
       <div style={{ marginLeft: lowAside, marginRight: highAside }}>
        <div
          ref={plotRef}
          onMouseMove={(e) => updateHover(e.clientX, e.clientY, e.target)}
          onMouseLeave={() => { setHoverPct(null); setHoverY(null); setHoverPile(0); }}
          style={{ position: 'relative', height: plotH, cursor: sorted.length ? 'crosshair' : undefined }}
        >
          {plotW > 0 && useRibbon && ribbon && (
            <div style={{ position: 'absolute', inset: 0, height: plotH, opacity: mounted ? 1 : 0, transition: 'opacity var(--dur-base) var(--ease)' }}>
              <DotField className="strip-dots" values={dotValues} kinds={dotKinds} toX={dotX} heightAt={dotHeight} height={plotH} />
            </div>
          )}
          {plotW > 0 && (
            <svg width={plotW} height={plotH} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
              {/* The middle 50% (BAND_IQR): a rounded band behind the people, edged, the height of the swarm. */}
              <rect
                className="band-iqr"
                x={bandX0}
                width={Math.max(0, bandX1 - bandX0)}
                y={popTop + (useRibbon ? 0 : 2)}
                height={popH - (useRibbon ? 0 : 4)}
                rx={useRibbon ? 0 : 8}
                fill={BAND_IQR.fill}
                stroke={BAND_IQR.edge}
                strokeWidth={BAND_IQR.edgeWidth}
              />
              <line
                className="strip-median"
                x1={medX}
                x2={medX}
                y1={popTop}
                y2={plotH}
                stroke="var(--guide-strong)"
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />

              {useRibbon && ribbon ? (
                // Area + line, the landing page's treatment, in the population's own grey — on this chart the
                // accent IS the subject's mark. The people are the dots under it (DotField).
                <g opacity={mounted ? 1 : 0} style={{ transition: 'opacity var(--dur-base) var(--ease)' }}>
                  <path d={ribbon.line} fill="none" stroke={MARK_PEER} strokeWidth={1.5} strokeLinejoin="round" />
                </g>
              ) : swarm ? (
                inPlot.map((p, i) => ({ p, i })).filter(({ p }) => !p.isSelf).sort((a, b) => rank(a.p) - rank(b.p)).map(({ p, i }) => {
                  const dot = peerDot(p.sameSchool, peers.length);
                  return (
                    // The dot pointed at takes a ring of the ink; the rest stay as they are.
                    <ChartDot
                      key={p.personKey || i}
                      kind={p.sameSchool ? 'same' : 'peer'}
                      cx={at(p.pay) * plotW}
                      cy={midY + swarm[i]}
                      fillOpacity={dot.fillOpacity}
                      hovered={hoveredPeer?.p === p}
                      dimmed={p.dimmed}
                      style={{ opacity: mounted ? 1 : 0, transition: `opacity var(--dur-base) var(--ease) ${Math.min(i, 30) * 4}ms` }}
                    />
                  );
                })
              ) : null}

              {/* Over a ribbon, the subject's leader down to the axis, as the subject sits on a lane above it. */}
              {useRibbon && (
                <line x1={selfX} x2={selfX} y1={selfY} y2={plotH} stroke={MARK_SELF} strokeWidth={1} opacity={mounted ? 0.55 : 0}
                  style={{ transition: 'opacity var(--dur-base) var(--ease)' }} />
              )}
              {place?.leader && (
                <line className="peer-strip-leader" x1={place.leader.x1} y1={place.leader.y1} x2={place.leader.x2} y2={place.leader.y2}
                  stroke={MARK_SELF} strokeWidth={1.5} strokeLinecap="round" />
              )}
              <ChartDot className="peer-strip-marker" kind="self" cx={selfX} cy={selfY} hovered={hoveredPeer?.p.isSelf} style={{ opacity: mounted ? 1 : 0 }} />
            </svg>
          )}

          {/* The median and the middle 50%, named where they are. */}
          <div ref={medRef} className="strip-label strip-median-label" style={{ left: medRight ? medX + 6 : medX - 6, top: popTop + 2, transform: medRight ? undefined : 'translateX(-100%)' }}>
            Median {fmtK(median)}
          </div>
          {bandWords && (
            <div className="strip-label strip-band-label" style={{ left: bandX1 - 8, bottom: 6, transform: 'translateX(-100%)' }}>
              {bandWords === 'full' ? `${bandText} · ${fmtK(p25)}–${fmtK(p75)}` : bandText}
            </div>
          )}
          {/* The band's two names, measured where nothing is drawn, to choose the one that fits. */}
          <div aria-hidden style={{ position: 'absolute', left: -10000, top: 0, visibility: 'hidden' }}>
            <div ref={bandRef} className="strip-label" style={{ position: 'relative' }}>{bandText} · {fmtK(p25)}–{fmtK(p75)}</div>
            <div ref={bandShortRef} className="strip-label" style={{ position: 'relative' }}>{bandText}</div>
          </div>

          {/* The subject's name, where lib/labelPlace put it. Measured before it is placed, so it is drawn
              hidden until then. `accent7-text` is no use here: the pill is the mark's own colour with the
              card's words on it, which reads at 7.2:1 (light) and 5.7:1 (dark). */}
          <div
            ref={youRef}
            className="peer-strip-you"
            style={{
              left: place ? place.x : 0,
              top: place ? place.y : 0,
              visibility: place && mounted ? undefined : 'hidden',
            }}
          >
            {label} · {usd(value)}
          </div>

          {pileBox(-1)}
          {pileBox(1)}

          {hoverPct != null && hoverValue != null && (
            <div
              style={{
                position: 'absolute',
                left: hoveredPeer ? hoveredPeer.cx : `${hoverPct}%`,
                ...(hoveredPeer
                  ? tipAbove ? { bottom: plotH - hoveredPeer.cy + R + 6 } : { top: hoveredPeer.cy + R + 6 }
                  : { bottom: 'calc(100% + 4px)' }),
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: Z.local,
              }}
            >
              <span className="chart-tip-pill">
                {hoveredPeer
                  ? readout(hoveredPeer.p)
                  : `~${usd(hoverValue)}${hoverBelow != null ? ` · ${ordinal(Math.round(hoverBelow * 100))} percentile` : ''}`}
              </span>
            </div>
          )}
        </div>

        {/* The axis: its baseline, a tick at each round step, and each pile's count under its pile. */}
        <div aria-hidden style={{ height: 1, background: 'var(--hairline-strong)', marginLeft: -lowAside, marginRight: -highAside }} />
        <div className="strip-axis" style={{ position: 'relative', height: TICK_LINE + 6 }}>
          {ticks.map((t) => {
            const x = px(t);
            const tx = x < 20 ? '0%' : x > plotW - 20 ? '-100%' : '-50%';
            return (
              <div key={t} className="strip-tick" style={{ left: x }}>
                <span className="strip-tick-mark" />
                <span className="strip-tick-label" style={{ transform: `translateX(${tx})`, fontSize: CHART_FONT, lineHeight: `${TICK_LINE}px` }}>{fmtK(t)}</span>
              </div>
            );
          })}
          {lowsCounted > 0 && (
            <span className="strip-tick-label peer-strip-pile-label" style={{ left: -lowAside, fontSize: CHART_FONT, lineHeight: `${TICK_LINE}px`, top: 6 }}>
              {num(lowsCounted)} under {fmtK(axisMin)}
            </span>
          )}
          {highsCounted > 0 && (
            <span className="strip-tick-label peer-strip-pile-label" style={{ left: plotW + highAside, transform: 'translateX(-100%)', fontSize: CHART_FONT, lineHeight: `${TICK_LINE}px`, top: 6 }}>
              {num(highsCounted)} over {fmtK(axisMax)}
            </span>
          )}
        </div>
       </div>
      </div>

      {zoom && (lowsCounted || highsCounted) ? (
        <Text size="xs" c="dimmed" mt={4} className="peer-strip-note">
          {pileNote(zoom, lowsCounted, highsCounted, !!onPile)}
        </Text>
      ) : null}

      {summaryTable}
    </div>
  );
}
