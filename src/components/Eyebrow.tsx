import type { ReactNode } from 'react';
import { Text } from '@mantine/core';

/**
 * The one small uppercase "eyebrow" label used above cards, stat tiles, and section groups — replacing
 * the dozen-plus hand-rolled `<Text tt="uppercase" size="xs" fw={700} style={{ letterSpacing }}>`
 * variants that had drifted to four different letter-spacings. One look everywhere.
 */
export function Eyebrow({ children, c = 'dimmed', mb, span }: {
  children: ReactNode;
  /** Override the default dimmed color (e.g. an accent eyebrow). */
  c?: string;
  mb?: number | string;
  /** Render inline (as a span) rather than a block. */
  span?: boolean;
}) {
  return (
    <Text span={span} size="xs" fw={700} tt="uppercase" c={c} mb={mb} style={{ letterSpacing: '0.05em' }}>
      {children}
    </Text>
  );
}
