import { BAND_IQR } from './markers';
import { scaleX, type RangeScale } from '../lib/rangeScale';

/**
 * A pay spread on its column's one scale (`rangeScale`): the min–max whisker, the middle 50% as every
 * chart draws it (BAND_IQR), the median tick, and faint lines at the scale's round values. What runs
 * past the scale is cut at the edge and marked there with a small arrow.
 */
export function MiniRange({ scale, lo, p25, med, p75, hi, width = 200, height = 16 }: {
  scale: RangeScale;
  lo: number; p25: number; med: number; p75: number; hi: number;
  width?: number; height?: number;
}) {
  const x = (v: number) => scaleX(scale, v, width);
  const mid = height / 2;
  return (
    <svg
      className="mini-range"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      data-p25={p25}
      data-p75={p75}
      data-scale-hi={scale.hi}
      style={{ display: 'block', marginTop: 3, marginLeft: 'auto' }}
    >
      {scale.ticks.map((t) => (
        <line key={t} x1={x(t)} y1={0} x2={x(t)} y2={height} stroke="var(--hairline)" strokeWidth={1} />
      ))}
      <line x1={x(lo)} y1={mid} x2={x(hi)} y2={mid} stroke="var(--mantine-color-default-border)" strokeWidth={2} />
      {/* The middle 50% as it is drawn on every chart; the median in the text colour — teal is "this
          person", and there is no one person on a title's or a division's row. */}
      <rect className="band-iqr" x={x(p25)} y={mid - 5} width={Math.max(1, x(p75) - x(p25))} height={10} rx={2}
        fill={BAND_IQR.fill} stroke={BAND_IQR.edge} strokeWidth={BAND_IQR.edgeWidth} />
      <line x1={x(med)} y1={mid - 6} x2={x(med)} y2={mid + 6} stroke="var(--mantine-color-dimmed)" strokeWidth={2} />
      {hi > scale.hi && (
        <path className="mini-range-over" d={`M${width - 6},${mid - 3.5} L${width - 1.5},${mid} L${width - 6},${mid + 3.5}`}
          fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={1.5} />
      )}
    </svg>
  );
}
