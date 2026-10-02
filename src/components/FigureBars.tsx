import { fmtK } from '../lib/chartStyle';

/**
 * Where one pay sits in its group's spread, small enough for a headline figure: the lowest to the highest
 * pay as a hairline track, the middle 50% as every chart draws it (BAND_IQR's wash and edge), the median as a
 * short tick, and the person as their own mark — the person's teal, ringed in the card's colour, as their dot
 * is on every chart. The lowest and highest pays are named at the ends.
 *
 * Positions are shares of the span, so it is as wide as its cell at any width.
 */
export function SpreadMark({ lo, p25, med, p75, hi, value, label }: {
  lo: number; p25: number; med: number; p75: number; hi: number; value: number;
  /** What a screen reader hears: the figure beside it already says the share. */
  label: string;
}) {
  const at = (v: number) => `${(Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))) * 100).toFixed(2)}%`;
  return (
    <div className="spread-mark" role="img" aria-label={label}>
      <div className="spread-mark-plot">
        <span className="spread-mark-track" />
        <span className="spread-mark-band" style={{ left: at(p25), width: `calc(${at(p75)} - ${at(p25)})` }} />
        <span className="spread-mark-median" style={{ left: at(med) }} />
        <span className="spread-mark-self" style={{ left: at(value) }} />
      </div>
      <div className="spread-mark-ends" aria-hidden>
        <span>{fmtK(lo)}</span>
        <span>{fmtK(hi)}</span>
      </div>
    </div>
  );
}

/**
 * Two growths side by side as bars: the person's, in their teal, and what typical raises alone would have
 * given, in grey. Both are drawn against the larger of the two, so whichever is smaller is the shorter bar —
 * the mockup's "typical as a share of the person's" breaks the moment typical raises outran the person, or
 * either went down. The signed figure beside each says the direction; the bars say the size.
 */
export function GrowthBars({ rows }: { rows: { name: string; value: number; self?: boolean; text: string }[] }) {
  const most = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div className="growth-bars">
      {rows.map((r) => (
        <div className="growth-bar-row" key={r.name} data-self={r.self || undefined}>
          <span className="growth-bar-name">{r.name}</span>
          <span className="growth-bar-track" aria-hidden>
            <span className="growth-bar-fill" style={{ width: `${(Math.abs(r.value) / most) * 100}%` }} />
          </span>
          <span className="growth-bar-value" data-typical-growth={r.self ? undefined : ''}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}
