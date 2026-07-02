import { describe, it, expect } from 'vitest';
import { wrapChartTitle } from './chartText';

describe('wrapChartTitle', () => {
  it('passes short titles through on one line', () => {
    expect(wrapChartTitle('Professor')).toEqual(['Professor']);
  });
  it('balances a long multi-word title onto two lines', () => {
    const lines = wrapChartTitle('Assistant Professor of Clinical Neurology');
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(26);
  });
  it('truncates a single long word that cannot be split', () => {
    const long = 'Supercalifragilisticexpialidocious-Coordinator';
    const lines = wrapChartTitle(long);
    expect(lines).toEqual([`${long.slice(0, 25)}…`]);
  });
  it('truncates each line when no balanced split fits within maxLine', () => {
    const long = 'Extraordinarily Long Interdepartmental Research Coordination Specialist';
    const lines = wrapChartTitle(long, 26);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(26);
  });
});
