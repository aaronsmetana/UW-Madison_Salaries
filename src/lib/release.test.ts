import { describe, expect, it } from 'vitest';
import { isNewRelease, NEW_DAYS } from './release';

const at = (date: string, time = '12:00:00') => Date.parse(`${date}T${time}`);

describe('isNewRelease', () => {
  it('is new for NEW_DAYS from the day the release went up, and not a day after', () => {
    expect(NEW_DAYS).toBe(30);
    expect(isNewRelease('2026-09-27', '2026-09-01', at('2026-09-27', '00:00:01'))).toBe(true);
    expect(isNewRelease('2026-09-27', '2026-09-01', at('2026-10-26'))).toBe(true); // day 29
    expect(isNewRelease('2026-09-27', '2026-09-01', at('2026-10-26', '23:59:59'))).toBe(true);
    expect(isNewRelease('2026-09-27', '2026-09-01', at('2026-10-27', '00:00:00'))).toBe(false); // day 30 begins
    expect(isNewRelease('2026-09-27', '2026-09-01', at('2026-10-28'))).toBe(false); // day 31
  });

  it('counts from the snapshot date when no day was recorded, so a forgotten entry ends NEW early, not never', () => {
    expect(isNewRelease(null, '2026-09-01', at('2026-09-30'))).toBe(true);
    expect(isNewRelease(undefined, '2026-09-01', at('2026-10-01'))).toBe(false);
    expect(isNewRelease('', '2026-09-01', at('2026-10-01'))).toBe(false);
  });

  it('is never new on a date it cannot read', () => {
    expect(isNewRelease(null, 'not a date', at('2026-09-02'))).toBe(false);
  });
});
