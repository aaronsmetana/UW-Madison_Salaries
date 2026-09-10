import { Tooltip } from '@mantine/core';
import { laneLetter, laneReason, laneSlot, type GutterCell } from '../lib/payHistory';

/**
 * One row's cell in the history table's appointment gutter.
 *
 * A person's concurrent appointments run down the table as parallel vertical tracks, one slot each,
 * so a line can be followed by eye instead of re-read at every snapshot. This draws that row's slice
 * of them: every lane alive in the snapshot as a segment, the row's own lane carrying a node, and the
 * lane letter.
 *
 * The node is where the honesty lives. Filled means the matcher followed this appointment from the
 * previous snapshot; hollow, with nothing drawn above it, means it did not — a new appointment, or
 * two rows the source cannot tell apart. A line that ran straight through such a boundary would be
 * claiming a continuity the data does not support, which is the one thing `payHistory` exists not to
 * do.
 */
export function LaneGutter({ cell, count, withTooltip = true }: {
  cell: GutterCell;
  /** Appointments in this snapshot. The letter is hidden at 1 — "appointment A of 1" says nothing. */
  count: number;
  /** Off for the printed report, where the note under the table carries the legend instead. */
  withTooltip?: boolean;
}) {
  const letter = (
    <span
      className="appt-lane-chip"
      data-start={cell.start ? 'yes' : 'no'}
      style={{ ['--lane-c' as string]: `var(--lane-${laneSlot(cell.lane)})` }}
      // Not focusable on purpose: one sentence is not worth a tab stop on all twenty rows, and a
      // label reaches a screen reader without one. The tooltip is the sighted half of the same text.
      aria-label={laneReason(cell.lane, count, !cell.start)}
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
        <span
          className="appt-gutter-node"
          data-start={cell.start ? 'yes' : 'no'}
          style={{
            ['--slot' as string]: cell.lane - 1,
            ['--lane-c' as string]: `var(--lane-${laneSlot(cell.lane)})`,
          }}
        />
      </span>
      {count > 1 &&
        (withTooltip ? (
          <Tooltip label={laneReason(cell.lane, count, !cell.start)} withArrow multiline w={280}>
            {letter}
          </Tooltip>
        ) : (
          letter
        ))}
    </div>
  );
}
