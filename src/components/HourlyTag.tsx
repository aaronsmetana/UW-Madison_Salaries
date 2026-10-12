import { Tooltip, VisuallyHidden } from '@mantine/core';
import { hourly, num, HOURS_PER_YEAR } from '../lib/format';

/**
 * A title paid by the hour (G23). The source gives an hourly job's pay annualized over 2,080 hours, so on a
 * list of titles a Crowd Control Officer's $145,600 read as a salary. The tag says so where the figure is,
 * and its rate is a pointer away (and read out with the tag).
 */
export function HourlyTag({ annual, share }: {
  /** The annualized figure shown beside it: the title's median. */
  annual: number | null | undefined;
  /** The share of the title's people paid by the hour, when not all of them are. */
  share?: number | null;
}) {
  const some = share != null && share < 0.995 ? `, for the ${Math.round(share * 100)}% of its people paid hourly` : '';
  const rate = `Median ${hourly(annual)}${some}, shown as a year of ${num(HOURS_PER_YEAR)} hours`;
  return (
    <Tooltip label={rate} withArrow multiline w={260}>
      <span className="cat-tag hourly-tag">
        Hourly · annualized<VisuallyHidden>: {rate}</VisuallyHidden>
      </span>
    </Tooltip>
  );
}

/** A title counts as hourly when most of the people in it are paid by the hour. */
export const HOURLY_TITLE = 0.5;
