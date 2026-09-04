import type { ReactNode } from 'react';
import { Group, Text } from '@mantine/core';
import { num } from '../lib/format';

/**
 * The one provenance string for the whole app. `ReportBrief`'s printed notes apparatus
 * (components/report/sources.tsx) already stated this fact for the PDF; the wording here is
 * deliberately identical so the screen and the print-out can't drift into two different claims
 * about where these numbers come from.
 */
export const DATA_SOURCE = 'UW–Madison salary data (Wisconsin public record)';

/**
 * A chart's provenance footer — source, how many records, what period, and the controls for taking
 * the numbers away.
 *
 * Before this, exactly one chart in the app (the person dashboard's) said where its figures came
 * from, and it said so in a hand-rolled paragraph. Every other chart asked the reader to trust an
 * unlabelled plot. Sourcing every chart is the one convention Our World in Data and Datawrapper
 * both treat as non-negotiable, and it matters more here than on a product site: this is a public
 * record about named people, and a figure someone can't trace is a figure they can't check.
 *
 * `n` and `period` are omitted rather than guessed. A call site that can't state its population or
 * its date range truthfully passes neither, and the line degrades to the source alone — a missing
 * fact being much cheaper than a confidently wrong one.
 */
export function SourceNote({
  n,
  unit = 'rows',
  period,
  actions,
}: {
  /** How many records the chart describes. Defaults to the row count of its data table. */
  n?: number | null;
  /** What `n` counts — 'people', 'snapshots', 'rows'. Pass it whenever you pass `n`. */
  unit?: string;
  /**
   * Rendered verbatim, so one prop covers both shapes a chart needs: a point in time
   * ('as of Mar 2026') and a span ('Nov 2021 – Mar 2026'). See `span()` for the latter.
   */
  period?: string | null;
  actions?: ReactNode;
}) {
  const parts = [DATA_SOURCE, n != null ? `${num(n)} ${unit}` : null, period || null].filter(Boolean);

  return (
    <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap" mt="xs">
      {/* minWidth:0 lets the source text wrap inside the flex row instead of shoving the
          actions off the right edge on a phone. */}
      <Text size="xxs" c="dimmed" style={{ minWidth: 0 }}>
        {parts.join(' · ')}
      </Text>
      {actions && (
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {actions}
        </Group>
      )}
    </Group>
  );
}
