import type { ReactNode } from 'react';
import { Text } from '@mantine/core';
import type { MantineSize, MantineSpacing } from '@mantine/core';
import { num } from '../lib/format';

/**
 * "Where does this sit against its peers" — in one sentence, phrased the same way everywhere.
 *
 * The app stated this fact in four places and four voices: the person page and the person dashboard
 * said "Paid more than 83% of people with this title", while the title page said "$92,410 is at the
 * 84th percentile — paid more than 83% of 1,251 people with this title", which says the same number
 * twice (this app defines a percentile *as* the share paid less, so the two halves cannot disagree).
 *
 * Plain language wins on screen: "more than 83% of the 1,251 people" needs no glossary, and the
 * printed brief keeps the percentile register on purpose — it has a glossary and footnotes to carry
 * it. The subject is handled by mood rather than by a second verb, so a pinned what-if salary and a
 * real person share one sentence shape.
 */
export function PercentileNote({
  pct,
  n,
  pool,
  subject,
  size = 'sm',
  mt,
  mb,
}: {
  /** Share of the pool paid less, 0–100. Renders nothing when null — the caller needn't guard. */
  pct: number | null | undefined;
  /**
   * The comparison pool's size — the people the subject is measured *against*, not including the
   * subject. Pass it only when the subject sits outside the pool (a pinned what-if salary against a
   * title's population). A person compared to their own peers is inside their pool and `percentile()`
   * divides by n − 1, so quoting the pool size there reads a person short: with two people sharing a
   * title, "more than 100% of the 2 people" claims one more comparison than exists. Those pages state
   * the count in their own "Among N people…" line anyway.
   */
  n?: number | null;
  /** What the pool is: "people with this title", "same-school peers with this title". */
  pool: ReactNode;
  /** A hypothetical salary being placed, e.g. a pinned figure. Omit when the subject is the page's person. */
  subject?: ReactNode;
  size?: MantineSize;
  mt?: MantineSpacing;
  mb?: MantineSpacing;
}) {
  if (pct == null) return null;

  // The two paths that feed this disagree on precision: `percentile()` returns an integer, while the
  // title page's SQL rounds to one decimal. A percentile carrying a tenth is false precision either
  // way, and "10.2%" beside "83%" reads as two different kinds of number, so round here.
  const tail = (
    <>
      more than <b>{Math.round(pct)}%</b> of {n != null ? `the ${num(n)} ` : ''}
      {pool}.
    </>
  );

  return (
    <Text size={size} mt={mt} mb={mb}>
      {subject ? <>{subject} would be paid {tail}</> : <>Paid {tail}</>}
    </Text>
  );
}
