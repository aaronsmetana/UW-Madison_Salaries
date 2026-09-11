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

/** A target / goal salary. Shares its green with same-school peers, which is safe only because the two
 *  never take the same shape: a target is always a rule across the track, a peer is always a dot. Keep
 *  it that way — if a target ever becomes a dot, it needs its own hue. */
export const MARK_TARGET = 'var(--mantine-color-pos-6)';

/** Circle radii, in px. The strip and the scatter draw the same person the same size. */
export const DOT_R = { peer: 4.5, self: 7.5 } as const;

/** A strong reference rule — a regression line, a target, anything the eye should follow. >=3:1, and a
 *  tighter dash than the soft guide's so the two are told apart by pattern, not only by weight. */
export const GUIDE_STRONG = { stroke: 'var(--guide-strong)', dasharray: '4 3', width: 2 } as const;

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
  return {
    r: DOT_R.peer + (crowd && sameSchool ? 1 : 0),
    fillOpacity: crowd && !sameSchool ? 0.55 : 0.9,
  };
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
}

export interface LegendItem {
  color: string;
  label: string;
  /** A dot (a person, a value) rather than a rule (a target, a trend, a threshold). */
  round?: boolean;
  /** Draw the rule dashed, matching GUIDE_STRONG — for a trend or target line. */
  dashed?: boolean;
}

/**
 * Compact legend: a dot / rule swatch + label, under any chart that marks more than one thing.
 *
 * The only legend in the app. The scatter used to carry its own, which is how its swatches drifted to
 * colours no other chart used — a legend that disagrees with the chart beside it is worse than none.
 */
export function MarkerLegend({ items }: { items: LegendItem[] }) {
  return (
    <Group justify="center" gap="lg" mt="xs" wrap="wrap">
      {items.map((it, i) => (
        <Group key={i} gap={6} wrap="nowrap">
          {it.dashed ? (
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
                width: 12,
                height: it.round ? 12 : 4,
                borderRadius: it.round ? '50%' : 1,
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
