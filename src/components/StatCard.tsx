import type { ReactNode, CSSProperties } from 'react';
import { Card, Text, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';

export type StatSize = 'hero' | 'md' | 'sm';

const VALUE: Record<StatSize, CSSProperties> = {
  hero: { fontSize: 'clamp(2.2rem, 4vw, 3rem)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05 },
  md: { fontSize: 24, fontWeight: 700, lineHeight: 1.15 },
  sm: { fontSize: 18, fontWeight: 700, lineHeight: 1.2 },
};

/**
 * The single metric-tile primitive: an uppercase eyebrow label + a tabular value + optional sub-caption,
 * in a bordered card. `lead` adds the accent-gradient rail (signature headline stat); `to` makes the whole
 * card a link (with a → affordance). One look for every KPI/stat tile across the app.
 */
export function StatCard({
  label,
  value,
  sub,
  size = 'md',
  lead = false,
  to,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: StatSize;
  lead?: boolean;
  to?: string;
  className?: string;
}) {
  const card = (
    <Card
      padding={size === 'hero' ? 'xl' : 'lg'}
      className={className}
      style={{ height: '100%', position: 'relative', overflow: 'hidden', ...(to ? { cursor: 'pointer' } : {}) }}
    >
      {lead && (
        <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--accent-grad)' }} />
      )}
      <Text tt="uppercase" c="dimmed" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
        {label}{to && <Text span c="accent.7"> →</Text>}
      </Text>
      <Text mt={6} style={VALUE[size]}>{value}</Text>
      {sub != null && <Text size="sm" c="dimmed" mt={4}>{sub}</Text>}
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
