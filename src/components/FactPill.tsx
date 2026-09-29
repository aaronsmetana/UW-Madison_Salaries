import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';

/**
 * One fact about the thing on the page, as a pill: a small-caps label and its value, on a tint of its
 * own. Renders nothing when there is no value, so a pill only appears for a field the data has.
 *
 * The person header's source columns (Job code, Grade, Category…) were hairline boxes with an 11px
 * label and an 11px value — the smallest text on the page, on boxes that all but vanished on a dark
 * page. Filled now, and the value at the caption size: the fill is `--pill-bg`, a translucent tint
 * measured against both grounds a pill sits on (the page, and a card or dropdown), and deliberately not
 * the hover token, whose 1.03:1 is why these were outlined in the first place.
 *
 * A fact, not a control: no hover change and the default cursor, though a glossary label (Grade, FLSA,
 * Basis) keeps its own dotted-underline explanation. `.code-pill` (a job code in a list) wears the same
 * fill and shape, so every pill in the app is one thing.
 */
export function FactPill({ label, value }: { label: ReactNode; value: ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <span className="fact-pill">
      <Eyebrow span>{label}</Eyebrow>
      <span className="fact-pill-value">{value}</span>
    </span>
  );
}
