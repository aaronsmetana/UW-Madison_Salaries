import type React from 'react';
import { Group, Text } from '@mantine/core';

/**
 * One marking vocabulary for every chart in the app.
 *
 * This module already claimed to be that and was imported by three of six chart files; the scatter and
 * the histogram each kept their own answer. The result was three different teals for "this person" —
 * accent-6 in the scatter, accent-7 in the bullet charts, --bar-active in the histogram — and none of
 * them was right in both colour schemes, because each pinned a shade while the theme's own rule is
 * `primaryShade: { light: 7, dark: 6 }`. Pinning 7 is what made the peer strip's label fail the
 * contrast gate in dark mode; pinning 6 makes the scatter's dot washy in light mode.
 */

/** "This person", as a MARK: the loudest thing on any chart, >=4.5:1 in both schemes (`--mark-self`,
 *  accent-7 on white, accent-5 on the dark card). Its own token rather than the theme's primary
 *  shade, which is the BUTTON colour — it put the subject at 3.9:1 on the dark card, below the grey
 *  of everyone else — and moving the buttons to fix a chart would have moved every button. */
export const MARK_SELF = 'var(--mark-self)';

/** "This person", as LABEL TEXT. Text needs 4.5:1, which the mark colour does not clear on the dark
 *  card — so a label is not just the mark colour applied to type. Pair this with
 *  `className="accent7-text"`, which swaps to --text-accent in dark mode. */
export const MARK_SELF_TEXT = 'var(--mantine-color-accent-7)';

/** Everyone else in the cohort, as DOTS. Deliberately neutral and quiet (1.5-2.5:1): the population is
 *  context, not the subject. Its bar equivalent is `--bar` in app.css, a lighter tone for the same
 *  role — a bar is a large filled area where a dot is a few pixels, and matching their tones makes one
 *  of them wrong. */
export const MARK_PEER = 'var(--mark-peer)';

/** A population with no subject in it — the school page's tenure cloud. There the dots ARE the data,
 *  not context around someone, so they keep the stronger grey a peer used to be drawn in. */
export const MARK_POPULATION = 'var(--mantine-color-gray-5)';

/** A peer who shares this person's school — the comparison most readers actually want (>=3:1). */
export const MARK_PEER_SAME_SCHOOL = 'var(--mark-peer-same-school)';

/** A dot's own edge: 1px inside it, a step darker than its fill (a step lighter on the dark card). The
 *  population's grey is quiet on purpose (2.2:1), so its edge is what makes each person a mark a reader
 *  can see (3.8:1); a same-school peer's sharpens a green that already reads. */
export const MARK_PEER_EDGE = 'var(--mark-peer-edge)';
export const MARK_PEER_SAME_SCHOOL_EDGE = 'var(--mark-peer-same-school-edge)';

/** A target / goal salary. Shares its green with same-school peers, which is safe only because the two
 *  never take the same shape: a target is always a rule across the track, a peer is always a dot. Keep
 *  it that way — if a target ever becomes a dot, it needs its own hue. */
export const MARK_TARGET = 'var(--mantine-color-pos-6)';

/** Circle radius, in px: one size for everyone, the person included. They were drawn half again as large as
 *  their peers (a `self` radius of its own); now a pip in their dot, their label and their guides say who
 *  they are, not their size. */
export const DOT_R = { peer: 5 } as const;

/**
 * A dot's rim: 1px of the card colour just outside its fill, so dots that touch or overlap read as
 * separate people rather than one blob — flat discs in a cluster merged into a single grey shape. The
 * subject's mark always had one.
 *
 * Painted under the fill (`paintOrder`), so the 2px stroke shows only its outer half and the dot keeps
 * the radius the strip's packer reserves for it (`rowHeight(DOT_R.peer)`); growing the radius instead
 * would put every row-neighbour a pixel into the next. Not for a dot under 3px across a crowd, where
 * the rim would be most of the dot.
 */
export const DOT_RIM = { stroke: 'var(--mantine-color-body)', strokeWidth: 2, paintOrder: 'stroke' } as const;

/** A strong reference rule — a regression line, a target, anything the eye should follow. >=3:1, and a
 *  tighter dash than the soft guide's so the two are told apart by pattern, not only by weight. */
export const GUIDE_STRONG = { stroke: 'var(--guide-strong)', dasharray: '4 3', width: 2 } as const;

/**
 * Where tenure alone would put someone's pay, give or take the 2% the tenure callout calls "on the
 * curve" (`onCurveBand` in lib/stats.ts): a faint wash along the tenure line, with no edges. Its own
 * tint, not BAND_IQR's — that one means "middle 50%" on every chart, and one look must not mean two
 * things.
 */
export const FIT_BAND = { fill: 'var(--fit-band)' } as const;

/** A quiet reference rule — quartiles, a median, the grid. Present, never competing with the data. */
export const GUIDE_SOFT = { stroke: 'var(--mantine-color-gray-5)', dasharray: '3 3', width: 1 } as const;

/**
 * The middle 50% of a group (p25 to p75), drawn the same way on every chart: a neutral wash, an edge
 * at each end a reader can see, and the words themselves where there is room for them. The strip,
 * the histogram and the Titles box plot each had their own — a teal wash at 8%, one at 5%, and an
 * accent box — and none of the three was visible at 3:1.
 */
export const BAND_IQR = { fill: 'var(--band-fill)', edge: 'var(--band-edge)', edgeWidth: 1, label: 'middle 50%' } as const;

/**
 * A crowd: past this many dots, the cloud itself becomes the loudest thing on a chart. Others draw
 * fainter and same-school peers a pixel larger, so the two marks a reader is looking for still stand
 * out of it.
 */
export const LARGE_GROUP = 200;
export function peerDot(sameSchool: boolean, groupSize: number): { r: number; fillOpacity: number } {
  const crowd = groupSize > LARGE_GROUP;
  return { r: DOT_R.peer, fillOpacity: crowd && !sameSchool ? 0.55 : 1 };
}

export type DotKind = 'peer' | 'same' | 'self';
const DOT_FILL: Record<DotKind, string> = { peer: MARK_PEER, same: MARK_PEER_SAME_SCHOOL, self: MARK_SELF };
const DOT_EDGE: Record<DotKind, string | null> = { peer: MARK_PEER_EDGE, same: MARK_PEER_SAME_SCHOOL_EDGE, self: null };

/**
 * One person as a dot, the same on every chart that sets someone among their peers: 10px, a 1px edge inside
 * it, and a 1.5px ring of the card's colour outside it so dots that touch stay two people. The person whose
 * page it is wears their teal with a pip of the card's colour at its centre — a shape, not only a colour.
 * Pointed at (`hovered`), a ring of the ink beyond the card's.
 *
 * The fill circle carries the class, the data-mark and the size, so a reader of the chart (a test, the hit
 * test) finds one element per person; the edge and the pip are drawn over it and take no pointer.
 */
export function ChartDot({ cx, cy, kind, r = DOT_R.peer, fillOpacity = 1, hovered = false, dimmed = false, className = 'chart-dot', style }: {
  cx: number; cy: number; kind: DotKind; r?: number; fillOpacity?: number; hovered?: boolean; dimmed?: boolean;
  className?: string; style?: React.CSSProperties;
}) {
  const edge = DOT_EDGE[kind];
  return (
    // Dimmed (outside the chosen cohort) multiplies whatever opacity the chart gives it (its fade in), so the
    // two never overwrite each other.
    <g style={{ transition: 'opacity var(--dur-base) var(--ease)', ...style, opacity: Number(style?.opacity ?? 1) * (dimmed ? 0.18 : 1) }}>
      <circle
        className={className}
        data-mark={kind === 'self' ? 'self' : kind === 'same' ? 'same-school' : 'peer'}
        cx={cx}
        cy={cy}
        r={r}
        fill={DOT_FILL[kind]}
        fillOpacity={fillOpacity}
        stroke="var(--mantine-color-body)"
        strokeWidth={3}
        paintOrder="stroke"
      />
      {edge && <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke={edge} strokeOpacity={fillOpacity} strokeWidth={1} pointerEvents="none" />}
      {kind === 'self' && <circle className="chart-dot-pip" cx={cx} cy={cy} r={2} fill="var(--mantine-color-body)" pointerEvents="none" />}
      {hovered && <circle className="chart-dot-hover" cx={cx} cy={cy} r={r + 2.75} fill="none" stroke="var(--mantine-color-text)" strokeWidth={1.5} pointerEvents="none" />}
    </g>
  );
}

/** A legend's chip for a dot: the same dot, at the same size. */
export function DotChip({ kind }: { kind: DotKind }) {
  return (
    <svg className="dot-chip" width={13} height={13} viewBox="0 0 13 13" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <ChartDot cx={6.5} cy={6.5} kind={kind} />
    </svg>
  );
}

/**
 * One peer in a cohort, as both the strip and the scatter understand them.
 *
 * Shared so the two charts on a person's overview cannot disagree about who is who: they are handed
 * the same array, and the scatter simply drops the members whose tenure is unknown.
 */
export interface PeerPoint {
  pay: number;
  sameSchool: boolean;
  isSelf: boolean;
  name: string;
  personKey: string;
  /** Years at UW, for the readout ("Name · $pay · 11.9 yrs"). */
  tenure?: number | null;
  /** Outside the cohort the page has chosen ("Same school"): drawn where they are, at 18%. */
  dimmed?: boolean;
}

export interface LegendItem {
  color: string;
  label: string;
  /** A person's dot, drawn as the chart draws it (ChartDot). */
  dot?: DotKind;
  /** A dot (a person, a value) rather than a rule (a target, a trend, a threshold). */
  round?: boolean;
  /** A filled square, for a bar series: a 4px rule reads as a line. */
  bar?: boolean;
  /** Draw the rule dashed, matching GUIDE_STRONG — for a trend or target line. */
  dashed?: boolean;
}

/**
 * Compact legend: a dot / rule swatch + label, under any chart that marks more than one thing.
 *
 * The only legend in the app. The scatter used to carry its own, which is how its swatches drifted to
 * colours no other chart used — a legend that disagrees with the chart beside it is worse than none.
 * Recharts' default `<Legend />` was the other holdout, on four charts; a line chart names its lines
 * at their ends instead (`EndLabels`), and a bar chart uses this.
 */
export function MarkerLegend({ items, align = 'center' }: { items: LegendItem[]; align?: 'center' | 'start' }) {
  // `start`: a key over the plot it explains, read before it, as the person's strip has.
  return (
    <Group justify={align === 'start' ? 'flex-start' : 'center'} gap="lg" mt={align === 'start' ? 0 : 'xs'} mb={align === 'start' ? 'sm' : 0} wrap="wrap" className="marker-legend">
      {items.map((it, i) => (
        <Group key={i} gap={6} wrap="nowrap">
          {it.dot ? (
            <DotChip kind={it.dot} />
          ) : it.dashed ? (
            <svg width={22} height={12} aria-hidden style={{ flexShrink: 0 }}>
              <line
                x1={1}
                y1={6}
                x2={21}
                y2={6}
                stroke={it.color}
                strokeWidth={GUIDE_STRONG.width}
                strokeDasharray={GUIDE_STRONG.dasharray}
              />
            </svg>
          ) : (
            <span
              style={{
                display: 'inline-block',
                width: it.bar ? 10 : 12,
                height: it.round ? 12 : it.bar ? 10 : 4,
                borderRadius: it.round ? '50%' : it.bar ? 2 : 1,
                background: it.color,
                flexShrink: 0,
              }}
            />
          )}
          <Text size="xs" fw={500}>{it.label}</Text>
        </Group>
      ))}
    </Group>
  );
}
