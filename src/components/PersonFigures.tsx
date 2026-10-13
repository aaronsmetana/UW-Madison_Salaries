import type { ReactNode } from 'react';
import { Badge, Group, Text } from '@mantine/core';
import { StatCell } from './StatCard';
import { usd, fmtChange, fmtYears, num } from '../lib/format';
import type { ReportingChange } from '../lib/queries';

/**
 * A person's headline figures, one set of cells for the person page's Overview and for their Report (P37). The
 * Report said "Current salary" and an unsigned "Growth since Nov 2021 61.3%" while the Overview said "Actual pay"
 * and "+61.3%"; drawn by one component each, the two cannot drift apart again. What a cell adds beyond its figure
 * on one page alone (the Overview's growth bars, its title line) is its `children`.
 */

/** The figure the pay is, with the snapshot it is from beside the label and the FTE beside the figure. */
export function PayCell({ label, value, asOf, fte, onOpen, children }: {
  label: string;
  value: number | null;
  asOf?: string | null;
  fte?: number | null;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  return (
    <StatCell
      label={label}
      onOpen={onOpen}
      aside={asOf && (
        <Badge variant="light" color="accent" radius="xs" style={{ fontWeight: 600, flexShrink: 0 }}>
          {asOf}
        </Badge>
      )}
    >
      <Group gap={8} align="center" wrap="nowrap" mt={6}>
        <Text fw={700} style={{ fontSize: 40, letterSpacing: '-0.03em', lineHeight: 1.05 }} data-figure="pay">{usd(value)}</Text>
        {fte != null && Math.abs(fte - 1) > 0.005 && (
          <Badge variant="light" color="gray" radius="xs" style={{ fontWeight: 600 }}>
            {+fte.toFixed(2)} FTE
          </Badge>
        )}
      </Group>
      {children}
    </StatCell>
  );
}

/** The growth over the record, signed and in its direction's colour, with the span it covers. */
export function GrowthCell({ label, value, years, onOpen, children }: {
  label: string;
  value: number | null;
  years?: number | null;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  // Below the precision the cell prints, a change is flat: no direction, and no colour for one.
  const trend: 'up' | 'down' | 'flat' | 'none' =
    value == null ? 'none' : Math.abs(value) < 0.0005 ? 'flat' : value < 0 ? 'down' : 'up';
  return (
    <StatCell label={label} onOpen={onOpen}>
      <Group gap={8} align="baseline" wrap="nowrap" mt={6}>
        <Text
          fw={700}
          c={trend === 'up' || trend === 'down' ? trend : undefined}
          style={{ fontSize: 24, lineHeight: 1.15 }}
          data-trend={trend}
          data-figure="growth"
        >
          {value == null ? '—' : fmtChange(value)}
        </Text>
        {years != null && years >= 0.1 && <Text size="xs" c="dimmed">over {fmtYears(years)}</Text>}
      </Group>
      {children}
    </StatCell>
  );
}

/**
 * The lines under the growth figure on both pages: how many snapshots it spans, the FTE where it moved (the
 * figure is then the full-time rate's growth), and the figure as reported across a reporting change.
 */
export function GrowthNotes({ snapshots, since, rateAside, fte, actualPay, reported, change }: {
  snapshots: number;
  since: string | null;
  /** The rate's growth, where it differs from the figure's and no FTE moved. */
  rateAside?: number | null;
  /** First and last FTE, where it moved. */
  fte?: [number, number] | null;
  /** Actual pay's growth like for like, said beside a moved FTE. */
  actualPay?: number | null;
  /** The growth as reported, across `change`. */
  reported?: number | null;
  change?: ReportingChange | null;
}) {
  const sgn = (x: number | null | undefined) => (x == null ? '—' : fmtChange(x));
  return (
    <>
      {since && (
        <Text size="xs" c="dimmed" mt={8} className="growth-span">
          {num(snapshots)} snapshot{snapshots === 1 ? '' : 's'} since {since}{rateAside != null && !fte ? ` · rate ${sgn(rateAside)}` : ''}
        </Text>
      )}
      {fte && (
        <Text size="xs" c="dimmed" mt={2} className="growth-fte">
          Full-time rate · FTE {Math.round(fte[0] * 100)}% → {Math.round(fte[1] * 100)}% · actual pay {sgn(actualPay)}
        </Text>
      )}
      {change && reported != null && (
        <Text size="xs" c="dimmed" mt={2} data-reporting-note>
          Like for like: {sgn(reported)} as reported, with the {change.sinceLabel} change
          in {change.what} (×{change.ratio}), which is not pay.
        </Text>
      )}
    </>
  );
}

/** Years at UW as of the record's latest snapshot, and the year they began. */
export function TenureCell({ years, hireYear, asOf, onOpen }: {
  years: number | null;
  hireYear?: string | null;
  asOf?: string | null;
  onOpen?: () => void;
}) {
  return (
    <StatCell label="Tenure" onOpen={onOpen}>
      <Text fw={700} mt={6} style={{ fontSize: 24, lineHeight: 1.15 }} data-figure="tenure">
        {years == null ? '—' : (
          <>{years.toFixed(1)}<Text span fw={500} c="dimmed" size="sm"> yrs</Text></>
        )}
      </Text>
      {hireYear && (
        <Text size="xs" c="dimmed" mt={4}>
          Since {hireYear}{asOf ? ` · as of ${asOf}` : ''}
        </Text>
      )}
    </StatCell>
  );
}
