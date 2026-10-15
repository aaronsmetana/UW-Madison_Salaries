import { Badge } from '@mantine/core';
import { REAL_BASE_YEAR } from '../lib/cpi';

/** On every figure or chart shown in inflation-adjusted dollars (E12): which dollars these are, where they are. */
export function RealBadge() {
  return (
    <Badge size="xs" variant="light" color="accent" radius="xs" className="real-badge" style={{ textTransform: 'none', verticalAlign: 'middle' }}>
      {REAL_BASE_YEAR} $
    </Badge>
  );
}
