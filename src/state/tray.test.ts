import { describe, it, expect } from 'vitest';
import { nextColorIdx } from './tray';
import { CHART_SERIES } from '../lib/chartStyle';

describe('nextColorIdx', () => {
  it('assigns 0 to the first item', () => {
    expect(nextColorIdx([])).toBe(0);
  });
  it('assigns the next dense index as items are added', () => {
    expect(nextColorIdx([{ colorIdx: 0 }])).toBe(1);
    expect(nextColorIdx([{ colorIdx: 0 }, { colorIdx: 1 }])).toBe(2);
  });
  it('reclaims a freed slot instead of always incrementing', () => {
    // Item that held slot 1 was removed — slot 1 should be reused rather than skipped.
    expect(nextColorIdx([{ colorIdx: 0 }, { colorIdx: 2 }])).toBe(1);
  });
  it('reuses the last slot once every CHART_SERIES color is taken', () => {
    const full = Array.from({ length: CHART_SERIES.length }, (_, i) => ({ colorIdx: i }));
    expect(nextColorIdx(full)).toBe(CHART_SERIES.length - 1);
  });
});
