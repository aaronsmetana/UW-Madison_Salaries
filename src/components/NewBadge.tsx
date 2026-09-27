import { Badge } from '@mantine/core';

/**
 * "New", on the newest snapshot wherever snapshots are listed — the snapshot picker, a person's history,
 * the Data page's ingestion table. It is the newest release's until the next one lands (`useRelease`):
 * nothing is dated by hand, so nothing has to be remembered to take it off.
 */
export function NewBadge({ ml }: { ml?: number | string }) {
  return (
    <Badge size="xs" variant="light" color="accent" radius="sm" ml={ml} className="new-badge accent-adaptive-text">
      New
    </Badge>
  );
}
