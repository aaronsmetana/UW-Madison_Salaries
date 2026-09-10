import { Tooltip } from '@mantine/core';
import { laneLetter, laneReason, laneSlot, type GutterCell } from '../lib/payHistory';

/**
 * One row's cell in the history table's appointment gutter.
 *
 * A person's concurrent appointments run down the table as parallel vertical lines, one slot each, and
 * each row's own appointment is a lettered station ON its line — so every A sits in one column and
 * every B in the next, joined by the line between them. This draws that row's slice: every lane alive
 * in the snapshot as a segment, and the row's own lane as its station.
 *
 * The letter used to sit in a column of its own after the lines, at the same x on every row, with a
 * 7px dot on the line doing the work of saying which line the row was on. On a 100px row the dot was
 * invisible and the letters all stacked in one column, so the lines read as decoration.
 *
 * The station's fill is where the honesty lives. Filled means the matcher followed this appointment
 * from the previous snapshot; dashed, with nothing drawn above it, means it did not — a new
 * appointment, or two rows the source cannot tell apart. A line that ran straight through such a
 * boundary would be claiming a continuity the data does not support, which is the one thing
 * `payHistory` exists not to do.
 */
export function LaneGutter({ cell, count, withTooltip = true }: {
  cell: GutterCell;
  /** Appointments in this snapshot, for the tooltip's wording. */
  count: number;
  /** Off for the printed report, where the note under the table carries the legend instead. */
  withTooltip?: boolean;
}) {
  const label = laneReason(cell.lane, count, !cell.start);
  // Lettered on every row of a split history, including a snapshot that holds only this one. The
  // letter is the line's name: a bare mark at the foot of the table would leave the reader tracing
  // the line back up to learn which appointment it is.
  const station = (
    <span
      className="appt-station"
      data-start={cell.start ? 'yes' : 'no'}
      style={{
        ['--slot' as string]: cell.lane - 1,
        ['--lane-c' as string]: `var(--lane-${laneSlot(cell.lane)})`,
      }}
      // Not focusable on purpose: one sentence is not worth a tab stop on all twenty rows, and a
      // label reaches a screen reader without one. The tooltip is the sighted half of the same text.
      aria-label={label}
    >
      {laneLetter(cell.lane)}
    </span>
  );

  return (
    <div className="appt-gutter">
      <span className="appt-gutter-tracks" aria-hidden="true">
        {cell.segments.map((seg) => (
          <span
            key={seg.lane}
            className="appt-gutter-track"
            data-draw={seg.draw}
            data-continues={seg.continues ? 'yes' : 'no'}
            data-ends={seg.ends ? 'yes' : 'no'}
            style={{
              ['--slot' as string]: seg.lane - 1,
              ['--lane-c' as string]: `var(--lane-${laneSlot(seg.lane)})`,
            }}
          />
        ))}
      </span>
      {withTooltip ? (
        <Tooltip label={label} withArrow multiline w={280}>
          {station}
        </Tooltip>
      ) : (
        station
      )}
    </div>
  );
}

/**
 * A station drawn inline, for the key under the table. The same class and the same two states as the
 * gutter, so the key cannot drift from what it explains.
 */
export function LaneStationSample({ lane = 1, start = false }: { lane?: number; start?: boolean }) {
  return (
    <span
      className="appt-station appt-station--sample"
      data-start={start ? 'yes' : 'no'}
      style={{ ['--lane-c' as string]: `var(--lane-${laneSlot(lane)})` }}
      aria-hidden="true"
    >
      {laneLetter(lane)}
    </span>
  );
}
