import { Text } from '@mantine/core';
import { useReferenceStatus, type ReferenceStatus } from '../lib/hooks';
import { num } from '../lib/format';

/**
 * What a pay-band figure can say, given how much of UW the loaded official ranges cover. It sits beside
 * the figure it qualifies — the person's pay band, the report's grade-band and market-floor tests,
 * Screening's "below market floor" — rather than in a banner at the top of a page that shows none.
 */
export function payBandNote(ref: ReferenceStatus | undefined): string | null {
  if (!ref || ref.status === 'ok') return null;
  if (ref.status === 'missing') return 'No official pay-band ranges are loaded, so there is no pay-band figure to give.';
  if (ref.status === 'sparse') {
    const pct = Math.round((ref.coverage ?? 0) * 100);
    return `Official pay-band ranges are loaded for only ${ref.grades_count} of UW's grades, covering ${num(ref.matched_rows)} of ${num(ref.graded_rows)} graded appointments (${pct}%). Pay-band figures describe that slice, not the whole population.`;
  }
  return `The pay-band ranges are from ${ref.max_effective_year} and the salary data from ${ref.latest_snapshot_year}, so the ranges may be out of date.`;
}

export function PayBandNote({ mt = 6 }: { mt?: number | string }) {
  const { data } = useReferenceStatus();
  const text = payBandNote(data);
  if (!text) return null;
  return (
    <Text size="xs" c="dimmed" mt={mt} className="payband-note" data-payband-note={data?.status}>
      {text}
    </Text>
  );
}
