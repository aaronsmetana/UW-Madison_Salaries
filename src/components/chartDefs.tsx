import { Fragment } from 'react';

/**
 * Reusable SVG `<defs>` for the "primary line" hero treatment: a vertical accent gradient (for the area
 * fill under the line) and a soft Gaussian-blur glow (applied to a duplicated underlay line). Place inside
 * an inline `<defs>` in a Recharts chart — `<defs>{lineGlowDefs('trend')}</defs>` — then reference
 * `url(#${id}-area-grad)` for the fill and `url(#${id}-line-glow)` for the glow. Kept generic and id-scoped
 * so the exact same look can be dropped into any other single-accent-line chart later.
 */
export function lineGlowDefs(id: string) {
  return (
    <Fragment>
      <linearGradient id={`${id}-area-grad`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0.28} />
        <stop offset="100%" stopColor="var(--mantine-color-accent-6)" stopOpacity={0} />
      </linearGradient>
      <filter id={`${id}-line-glow`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
    </Fragment>
  );
}
