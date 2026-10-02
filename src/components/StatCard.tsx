import { createContext, useContext, type ReactNode, type CSSProperties, type KeyboardEvent } from 'react';
import { Card, Text, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { Eyebrow } from './Eyebrow';

export type StatSize = 'hero' | 'md' | 'sm';

/** A figure on the app's type scale (theme.ts): the lead figure at the page title's 40px, every other at the
 *  24px figure size. `sm` was 18px, the card-title size, so a figure and a card's heading read as the same
 *  kind of thing. */
const VALUE: Record<StatSize, CSSProperties> = {
  hero: { fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05 },
  md: { fontSize: 24, fontWeight: 700, lineHeight: 1.15 },
  sm: { fontSize: 24, fontWeight: 700, lineHeight: 1.15 },
};

type Cols = number | string;
const track = (c: Cols) => (typeof c === 'number' ? `repeat(${c}, minmax(0, 1fr))` : c);

/**
 * A page's figures, in one card: each figure a cell, the cells parted by hairlines. It replaced a row of
 * separate cards per figure — three to eight bordered boxes side by side on the person, title, division and
 * Divisions pages — with one shape, the way the person-page redesign drew its headline figures.
 *
 * `cols` is how many cells a row holds, or a track list for cells of different weights (the person's
 * '1.2fr 1fr 1fr .8fr'), from a phone (`base`) up through `sm` (768px) and `md` (992px). The dividers are a
 * pixel of the cells' own shadow above and to their left, which the card clips at its edge: a divider only
 * ever stands between two cells, on any row a narrower screen wraps into.
 */
const InRow = createContext(false);
export function StatRow({ cols, children, className, flush = false, label }: {
  cols: { base: Cols; sm?: Cols; md?: Cols };
  children: ReactNode;
  className?: string;
  /** Inside a card already: no card of its own, only the dividers. */
  flush?: boolean;
  /** What the figures are, for a screen reader: "Headline figures". */
  label?: string;
}) {
  const style = {
    '--stat-cols-base': track(cols.base),
    '--stat-cols-sm': track(cols.sm ?? cols.base),
    '--stat-cols-md': track(cols.md ?? cols.sm ?? cols.base),
  } as CSSProperties;
  const grid = (
    <div className="stat-row" style={style} role={label ? 'group' : undefined} aria-label={label}>
      <InRow.Provider value>{children}</InRow.Provider>
    </div>
  );
  if (flush) return <div className={`stat-row-flush${className ? ` ${className}` : ''}`}>{grid}</div>;
  return <Card padding={0} className={`stat-row-card${className ? ` ${className}` : ''}`}>{grid}</Card>;
}

/**
 * One cell of a StatRow: a small-caps label (with anything that belongs beside it, `aside`, such as a date
 * chip), then whatever the figure is. `onOpen` makes the whole cell a way to where the figure is shown in
 * full (a tab), as a button; `to`, as a link.
 */
export function StatCell({ label, aside, children, onOpen, to, className }: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  onOpen?: () => void;
  to?: string;
  className?: string;
}) {
  const head = (
    <div className="stat-cell-head">
      <Eyebrow>{label}{to && <Text span c="accent.7" className="accent7-text"> →</Text>}</Eyebrow>
      {aside}
    </div>
  );
  const cls = `stat-cell${onOpen || to ? ' stat-cell-open' : ''}${className ? ` ${className}` : ''}`;
  if (to) {
    return (
      <Anchor component={Link} to={to} underline="never" c="inherit" className={cls}>
        {head}
        {children}
      </Anchor>
    );
  }
  const key = (e: KeyboardEvent) => {
    if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); }
  };
  return (
    <div className={cls} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={onOpen ? key : undefined}>
      {head}
      {children}
    </div>
  );
}

/**
 * The single metric primitive: an uppercase eyebrow label + a tabular value + optional sub-caption. Inside a
 * StatRow it is one of the row's cells; on its own, a bordered card. `to` makes the whole of it a link (with
 * a → affordance). One look for every figure across the app.
 */
export function StatCard({
  label,
  value,
  sub,
  size = 'md',
  to,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: StatSize;
  to?: string;
  className?: string;
}) {
  const inRow = useContext(InRow);
  const body = (
    <>
      <Text mt={6} style={VALUE[size]}>{value}</Text>
      {sub != null && <Text size="sm" c="dimmed" mt={4}>{sub}</Text>}
    </>
  );
  if (inRow) return <StatCell label={label} to={to} className={className}>{body}</StatCell>;
  const card = (
    <Card padding={size === 'hero' ? 'xl' : 'lg'} className={className} data-stat-card style={{ height: '100%', ...(to ? { cursor: 'pointer' } : {}) }}>
      <Eyebrow>{label}{to && <Text span c="accent.7" className="accent7-text"> →</Text>}</Eyebrow>
      {body}
    </Card>
  );
  return to ? (
    <Anchor component={Link} to={to} underline="never" c="inherit" style={{ display: 'block', height: '100%' }}>
      {card}
    </Anchor>
  ) : (
    card
  );
}
