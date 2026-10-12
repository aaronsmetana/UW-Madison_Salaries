import type { ReactNode } from 'react';
import { Group } from '@mantine/core';
import { num } from '../lib/format';

/**
 * The one provenance string for the whole app. `ReportBrief`'s printed notes apparatus
 * (components/report/sources.tsx) already stated this fact for the PDF; the wording here is
 * deliberately identical so the screen and the print-out can't drift into two different claims
 * about where these numbers come from.
 */
export const DATA_SOURCE = 'UW–Madison salary data (Wisconsin public record)';

/**
 * A chart's provenance — source, how many records, what period — as one line, for its About note.
 *
 * Every chart says where its figures come from: a public record about named people, and a figure someone
 * can't trace is a figure they can't check. It said so under every plot until the line repeated six times
 * on a person page and again in the page footer (G18); the page states its source once, and each chart's
 * own count and period are behind its About button.
 *
 * `n` and `period` are omitted rather than guessed. A call site that can't state its population or its
 * date range truthfully passes neither, and the line degrades to the source alone — a missing fact being
 * much cheaper than a confidently wrong one.
 */
export function sourceLine(n?: number | null, unit = 'rows', period?: string | null): string {
  return [DATA_SOURCE, n != null ? `${num(n)} ${unit}` : null, period || null].filter(Boolean).join(' · ');
}

/** A chart's footer: its tools (About · CSV · Table), right-aligned and compact under the plot. */
export function SourceNote({ actions }: { actions?: ReactNode }) {
  return (
    <Group justify="flex-end" gap={4} wrap="nowrap" mt="xs" className="chart-tools">
      {actions}
    </Group>
  );
}
