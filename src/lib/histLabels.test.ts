import { describe, it, expect } from 'vitest';
import { pinClearance, medianPlace } from './histLabels';

describe('pinClearance', () => {
  const cols = [
    { left: 0, right: 30, reach: 40 },
    { left: 40, right: 70, reach: 100 },
    { left: 80, right: 110, reach: 20 },
    { left: 120, right: 150, reach: 160 },
  ];
  it('stands over its own column where nothing taller is under its label', () => {
    expect(pinClearance(cols, 20, 95, 20)).toBe(20);
  });
  it('stands over a taller neighbour its label spans', () => {
    expect(pinClearance(cols, 20, 90, 40)).toBe(100);
  });
  it('ignores a taller column beyond its label', () => {
    expect(pinClearance(cols, 20, 95, 40)).toBe(20);
  });
});

describe('medianPlace', () => {
  const label = { width: 40, top: 20, height: 12 };
  it('sits over its line with no pin, or with the pin elsewhere', () => {
    expect(medianPlace({ x: 100, ...label }, null, 400)).toBe('over');
    expect(medianPlace({ x: 100, ...label }, { left: 300, right: 360, top: 20, bottom: 33 }, 400)).toBe('over');
  });
  it('moves beside its line, away from a pin over it', () => {
    expect(medianPlace({ x: 100, ...label }, { left: 99, right: 160, top: 22, bottom: 35 }, 400)).toBe('left');
    expect(medianPlace({ x: 100, ...label }, { left: 40, right: 101, top: 22, bottom: 35 }, 400)).toBe('right');
  });
  it('goes a row up where beside would leave the plot or meet the pin', () => {
    expect(medianPlace({ x: 30, ...label }, { left: 25, right: 90, top: 22, bottom: 35 }, 400)).toBe('up');
    expect(medianPlace({ x: 100, ...label }, { left: 40, right: 160, top: 22, bottom: 35 }, 400)).toBe('up');
  });
});
