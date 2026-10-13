import { describe, it, expect } from 'vitest';
import { headlineGrowth } from './growth';

describe('headlineGrowth', () => {
  it('is the change in pay from the first snapshot to the last', () => {
    const g = headlineGrowth([{ salary: 100 }, { salary: 110 }, { salary: 121 }], 1);
    expect(g.total).toBeCloseTo(0.21);
    expect(g.growth).toBeCloseTo(0.21);
    expect(g.fteMoved).toBe(false);
  });
  it('leaves a reporting change out of the figure, and keeps it in the total as reported', () => {
    const g = headlineGrowth([{ salary: 90_000 }, { salary: 110_000 * 1.03 }], 11 / 9);
    expect(g.total).toBeCloseTo((110_000 * 1.03) / 90_000 - 1);
    expect(g.growth).toBeCloseTo(((110_000 * 1.03) / 90_000) / (11 / 9) - 1);
  });
  it('is the full-time rate’s growth where the FTE moved', () => {
    const g = headlineGrowth([{ salary: 65_000, rate: 100_000, fte: 0.65 }, { salary: 46_250, rate: 92_500, fte: 0.5 }], 1);
    expect(g.fteMoved).toBe(true);
    expect(g.growth).toBeCloseTo(-0.075);
    expect(g.payLfl).toBeCloseTo(46_250 / 65_000 - 1);
  });
  it('does not call an hourly record, with no FTE, a move', () => {
    const g = headlineGrowth([{ salary: 40_000, rate: 40_000, fte: null }, { salary: 41_200, rate: 41_200, fte: 1 }], 1);
    expect(g.fteMoved).toBe(false);
    expect(g.growth).toBeCloseTo(0.03);
  });
  it('has no figure without two pays', () => {
    expect(headlineGrowth([], 1).growth).toBeNull();
    expect(headlineGrowth([{ salary: 0 }, { salary: 10 }], 1).growth).toBeNull();
  });
});
