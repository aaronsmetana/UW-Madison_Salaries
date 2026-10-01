import type { ReactNode, CSSProperties } from 'react';
import { Text } from '@mantine/core';

/**
 * The one small uppercase "eyebrow" label used above cards, stat tiles, and section groups — replacing
 * the dozen-plus hand-rolled `<Text tt="uppercase" size="xs" fw={700} style={{ letterSpacing }}>`
 * variants that had drifted to four different letter-spacings. One look everywhere.
 *
 * `xxs`, not `xs`. theme.ts describes 11px as the floor reserved for "eyebrows and dense labels", but
 * this component was reading `xs` — so when `xs` moved 12 -> 13px to become a caption size, every
 * eyebrow in the app silently followed it up to 13px bold uppercase. The token and its one consumer
 * now agree.
 */
export function Eyebrow({ children, c = 'var(--text-faint)', mb, span, ta, lineClamp, style }: {
  children: ReactNode;
  /** Override the default faint colour (e.g. an accent eyebrow). */
  c?: string;
  mb?: number | string;
  /** Render inline (as a span) rather than a block. */
  span?: boolean;
  ta?: 'left' | 'center' | 'right';
  lineClamp?: number;
  /** Extra layout only (e.g. flexShrink) — the type/casing/spacing stay fixed. */
  style?: CSSProperties;
}) {
  return (
    <Text span={span} size="xxs" fw="var(--label-weight)" tt="uppercase" c={c} mb={mb} ta={ta} lineClamp={lineClamp} style={{ letterSpacing: 'var(--label-tracking)', ...style }}>
      {children}
    </Text>
  );
}
