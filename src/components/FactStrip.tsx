import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';

export interface Fact {
  label: ReactNode;
  value: ReactNode;
}

/**
 * The facts about the thing on the page, in one divided strip: each a small-caps label over its value, the
 * cells parted by hairlines. Facts with no value are left out, so a cell only appears for a field the data has.
 *
 * It replaced a row of separate pills (Job code, Grade, Category…), each on a grey ground of its own: seven
 * shapes where one would do, and a ground the label grey could not be read on (4.1:1). Here the strip is
 * the card's white, and a glossary label (Grade, Basis, FLSA) keeps its dotted underline and its definition.
 *
 * Wrapped, each row's first cell would draw its divider against the strip's edge; the strip clips it (the
 * cells sit 1px left, and `overflow: hidden` cuts what is outside), so a divider only ever stands between
 * two cells. A fact, not a control: no hover change, the default cursor.
 */
export function FactStrip({ facts, label }: { facts: Fact[]; label: string }) {
  const shown = facts.filter((f) => f.value != null && f.value !== '');
  if (!shown.length) return null;
  return (
    <dl className="fact-strip" aria-label={label}>
      {shown.map((f, i) => (
        <div className="fact-cell" key={i}>
          <dt><Eyebrow span>{f.label}</Eyebrow></dt>
          <dd className="fact-value">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
