import { Badge } from '@mantine/core';
import { useRelease } from '../lib/hooks';

/**
 * "New", on the newest release wherever it is shown: at the top of every page (ReleaseTag), on the newest
 * snapshot in the picker, a person's history and the Data page's ingestion table, and on what came with
 * it in What's new.
 *
 * For 30 days from the day the release went up (`useRelease().isNew`, lib/release), and then nowhere:
 * the rule lives here, not at each call site, so the header and the picker can never disagree about
 * whether the data is new. It used to stay until the next release landed — six months of "New" on data
 * a returning reader had long since seen.
 */
export function NewBadge({ ml }: { ml?: number | string }) {
  const release = useRelease();
  if (!release?.isNew) return null;
  return (
    <Badge size="xs" variant="light" color="accent" radius="xl" ml={ml} className="new-badge accent-adaptive-text">
      New
    </Badge>
  );
}
