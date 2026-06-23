import type { ReactNode } from 'react';
import { Card, Text } from '@mantine/core';

/**
 * The signature primary-metric card: a big number with an accent-gradient rail on the left edge.
 * Reused for any headline stat (e.g. a person's pay, a title's median).
 */
export function StatHero({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <Card withBorder radius="lg" shadow="sm" padding={28} style={{ position: 'relative', overflow: 'hidden', height: '100%' }}>
      <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--accent-grad)' }} />
      <Text fz={14} fw={700} c="dimmed">{label}</Text>
      <Text fw={800} lh={1.05} mt={6} style={{ fontSize: 'clamp(2.4rem, 4vw, 3.1rem)', letterSpacing: '-0.04em' }}>
        {value}
      </Text>
      {sub != null && <Text fz={15} fw={500} c="dimmed" mt={6}>{sub}</Text>}
    </Card>
  );
}
