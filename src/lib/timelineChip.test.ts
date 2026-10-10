import { describe, expect, it } from 'vitest';
import { chipState, type ChipInput } from './timelineChip';

const base: ChipInput = {
  now: 10_000, playing: false, paused: false, fast: false, fastMs: 250, phase: null, step: null, fade: null, switching: false, rest: null,
  sortBy: 'salary', plan: { mv: 1500, cd: 1000, so: 900, re: 700 }, stepsLeft: 0, last: 'Sep 2026', progress: { from: 0.8, to: 0.9 },
};
const at = (o: Partial<ChipInput>) => chipState({ ...base, ...o });
const step = { from: 'Mar 2026', to: 'Sep 2026', quick: false };

describe('chipState (3a §11)', () => {
  it('names each phase of a staged step: moving, the countdown with its seconds, the re-sort', () => {
    expect(at({ phase: { phase: 'move', start: 9_000, end: 10_500 }, step }).label).toBe('Moving people · Mar 2026 → Sep 2026');
    const hold = at({ phase: { phase: 'hold', start: 9_800, end: 12_400 }, step });
    expect([hold.label, hold.count]).toEqual(['Sorting by salary in', '3']);
    // Whole seconds left, rounded up, never 0 while it holds.
    expect(at({ phase: { phase: 'hold', start: 9_000, end: 10_100 }, step }).count).toBe('1');
    expect(at({ phase: { phase: 'sort', start: 9_900, end: 10_800 }, step, sortBy: 'type, then salary' }).label).toBe('Sorting by type, then salary…');
  });
  it('says a catch-up step skips ahead, a step back rewinds, and a change of view switches', () => {
    expect(at({ phase: { phase: 'move', start: 9_900, end: 10_500 }, step: { ...step, quick: true } }).label).toBe('Skipping ahead · Mar 2026 → Sep 2026');
    expect(at({ fade: { to: 'Apr 2024', start: 9_700, end: 10_500 } }).label).toBe('Rewinding to Apr 2024');
    expect(at({ switching: true }).label).toBe('Switching view');
  });
  it('playing Fast, says how many snapshots a second, its ring the way through the timeline', () => {
    const s = at({ playing: true, fast: true, phase: { phase: 'move', start: 9_900, end: 10_150 }, step });
    expect(s.label).toBe('Playing · 4 snapshots a second');
    expect(s.ring).toEqual({ from: 0.8, to: 0.9, start: 9_900, end: 10_150, linear: true });
  });
  it('counts Play’s rest down to the next snapshot, the ring unwinding', () => {
    const s = at({ playing: true, rest: { start: 9_800, end: 10_500, next: 'Apr 2025' }, stepsLeft: 3 });
    expect([s.label, s.count]).toEqual(['Next: Apr 2025 in', '1']);
    expect(s.ring).toMatchObject({ from: 1, to: 0, start: 9_800, end: 10_500 });
  });
  it('at rest says how the columns are sorted, and that it is paused once Pause is pressed', () => {
    expect(at({}).label).toBe('Sorted by salary');
    expect(at({ paused: true, sortBy: 'type, then salary' }).label).toBe('Paused · sorted by type, then salary');
    expect(at({}).ring).toEqual({ from: 0, to: 0, start: 0, end: 0, linear: true });
  });
  it('while it plays, gives when the timeline ends: the rest of this phase, of this step, and every step after', () => {
    // 0.5 s of the move left, then the countdown, re-sort and rest (2.6 s), then two whole steps (4.1 s each).
    const s = at({ playing: true, phase: { phase: 'move', start: 9_000, end: 10_500 }, step, stepsLeft: 2 });
    expect(s.eta).toBe('Timeline ends (Sep 2026) in 0:11');
    expect(at({ playing: true, phase: { phase: 'hold', start: 9_000, end: 10_500 }, step, stepsLeft: 20 }).eta).toBe('Timeline ends (Sep 2026) in 1:24');
    expect(at({ phase: { phase: 'move', start: 9_000, end: 10_500 }, step, stepsLeft: 2 }).eta, 'not playing').toBe('');
  });
});
