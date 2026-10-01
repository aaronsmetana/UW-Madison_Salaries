import { Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { pct } from '../lib/format';
import { SEMANTIC } from '../theme';

export type DeltaTone = 'signed' | 'neutral';

/** Resolves a fractional change + tone to a Mantine color name. `signed` (money, an individual's
 *  standing): up=pos, down=red — a status the reader should react to. `neutral` (population size —
 *  headcount, row counts): always dimmed, since more/fewer people isn't inherently good or bad and
 *  shouldn't borrow the reserved status hues. */
export function deltaColor(frac: number | null | undefined, tone: DeltaTone = 'signed'): string {
  if (tone === 'neutral' || frac == null) return SEMANTIC.neutral;
  return frac >= 0 ? SEMANTIC.up : SEMANTIC.down;
}

/** Snapshot-over-snapshot delta chip: ▲/▼ + magnitude, or a flat/unavailable placeholder. `suffix`
 *  appends trailing context (e.g. a "· Nov 2021 → Mar 2026" range) in the same dimmed line so callers
 *  don't need a second Text node. */
export function DeltaChip({
  frac, tone = 'signed', flatLabel = '≈ flat', suffix, size = 'xs',
}: {
  frac: number | null | undefined;
  tone?: DeltaTone;
  flatLabel?: string;
  suffix?: ReactNode;
  size?: 'xs' | 'sm';
}) {
  if (frac == null) return <Text span size={size} c="dimmed">—{suffix}</Text>;
  if (Math.abs(frac) < 0.0005) return <Text span size={size} c="dimmed">{flatLabel}{suffix}</Text>;
  const up = frac >= 0;
  return (
    <Text span size={size} c={deltaColor(frac, tone)}>
      {up ? '▲' : '▼'} {pct(Math.abs(frac))}{suffix}
    </Text>
  );
}

/** ▲/▼ pay-rank movement vs the previous snapshot (or "new" for a rank that didn't exist before).
 *  Always `signed` — an individual moving up in pay rank is the kind of change worth flagging. */
export function RankDeltaChip({ prev, cur }: { prev?: number; cur: number }) {
  // --text-accent, not accent.6: at 10px on a striped row accent.6 read 4.35:1. No release before Sep 2026
  // put a new name among the top earners, so no scan had one to measure.
  if (prev == null) return <Text span size="xxs" className="accent-adaptive-text">new</Text>;
  const d = prev - cur;
  if (d === 0) return <Text span size="xxs" c="dimmed">—</Text>;
  const up = d > 0;
  return <Text span size="xxs" c={up ? SEMANTIC.up : SEMANTIC.down}>{up ? '▲' : '▼'}{Math.abs(d)}</Text>;
}
