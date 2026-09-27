import { Anchor, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useReferenceStatus, useSummary, type ReferenceStatus } from '../lib/hooks';
import { num, fmtDate } from '../lib/format';

/**
 * What a pay-band figure can say, given the official ranges loaded. It sits beside the figure it
 * qualifies — the person's pay band, the report's grade-band and market-floor tests, Screening's two
 * band flags — rather than in a banner at the top of a page that shows none.
 *
 * With the whole structure loaded it names where the ranges come from and when they were read (HR states
 * no effective date); short of that it says what the loaded ranges cover.
 */

/** Where the ranges come from, as a sentence: null until the reference says when they were read. */
export function payBandSource(ref: ReferenceStatus | undefined): string | null {
  return ref?.retrieved_at ? `Official ranges: UW–Madison salary structure, retrieved ${fmtDate(ref.retrieved_at)}.` : null;
}

/**
 * Read against a snapshot older than the release the ranges came out with, a band is today's figures laid
 * over that time's pay: HR publishes only its current structure, and the last change measured was a rise.
 */
export function olderSnapshotNote(ref: ReferenceStatus | undefined, snapshot: { id: string; label: string; date: string } | null | undefined, releasedLabel: string | null | undefined, releasedDate: string | null | undefined): string | null {
  if (!ref?.released_with || !snapshot || !releasedDate || snapshot.date >= releasedDate) return null;
  const rise = ref.structure_change != null && ref.structure_change > 0 ? ` — the last change measured was +${(ref.structure_change * 100).toFixed(1)}%` : '';
  return `Compared with the current ranges (${releasedLabel ?? ref.released_with}); the ranges in force in ${snapshot.label} were likely lower${rise}.`;
}

export function payBandNote(ref: ReferenceStatus | undefined): string | null {
  if (!ref) return null;
  if (ref.status === 'ok') return payBandSource(ref);
  if (ref.status === 'missing') return 'No official pay-band ranges are loaded, so there is no pay-band figure to give.';
  if (ref.status === 'sparse') {
    const pct = Math.round((ref.coverage ?? 0) * 100);
    return `Official pay-band ranges are loaded for only ${ref.grades_count} of UW's grades, covering ${num(ref.matched_rows)} of ${num(ref.graded_rows)} graded appointments (${pct}%). Pay-band figures describe that slice, not the whole population.`;
  }
  return `The pay-band ranges are from ${ref.max_effective_year} and the salary data from ${ref.latest_snapshot_year}, so the ranges may be out of date.`;
}

/** `snapshotId`: the snapshot the band is read in, when a page lets the reader choose one. */
export function PayBandNote({ mt = 6, snapshotId }: { mt?: number | string; snapshotId?: string | null }) {
  const { data } = useReferenceStatus();
  const { data: summary } = useSummary();
  const snaps = summary?.snapshots ?? [];
  const released = snaps.find((s) => s.id === data?.released_with);
  const older = olderSnapshotNote(data, snaps.find((s) => s.id === snapshotId), released?.label, released?.date);
  if (!data) return null;
  if (data.status === 'ok') {
    if (!data.retrieved_at) return null;
    return (
      <Text size="xs" c="dimmed" mt={mt} className="payband-note" data-payband-note="ok">
        Official ranges:{' '}
        <Anchor component={Link} to="/data#salary-ranges" inherit underline="always" className="payband-source">
          UW–Madison salary structure
        </Anchor>
        , retrieved {fmtDate(data.retrieved_at)}.{older && <span className="payband-older"> {older}</span>}
      </Text>
    );
  }
  const text = payBandNote(data);
  if (!text) return null;
  return (
    <Text size="xs" c="dimmed" mt={mt} className="payband-note" data-payband-note={data.status}>
      {text}{older && <span className="payband-older"> {older}</span>}
    </Text>
  );
}
