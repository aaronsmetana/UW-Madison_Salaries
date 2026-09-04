import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTION, stagger } from './motion';

/**
 * CSS cannot import a TypeScript constant, so the ramp lives in two places. A comment asking the
 * next person to keep them in step is not a contract; this is. If the `--dur-*` block in app.css
 * ever disagrees with MOTION, that is a real bug — half the app would animate on one ramp and half
 * on another — and it would otherwise be invisible until someone noticed two cards moving at
 * different speeds.
 */
describe('the motion ramp is defined once', () => {
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  const declared = Object.fromEntries(
    [...css.matchAll(/--dur-([a-z]+):\s*(\d+)ms/g)].map((m) => [m[1], Number(m[2])]),
  );

  it('mirrors every duration token into CSS', () => {
    expect(declared).toEqual({
      instant: MOTION.instant,
      quick: MOTION.quick,
      reveal: MOTION.reveal,
      figure: MOTION.figure,
      route: MOTION.route,
    });
  });

  it('mirrors the easing curve', () => {
    const m = css.match(/--ease-out:\s*([^;]+);/);
    expect(m?.[1].replace(/\s+/g, '')).toBe(MOTION.ease.replace(/\s+/g, ''));
  });
});

describe('stagger', () => {
  it('steps per item', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(3)).toBe(3 * MOTION.stagger);
  });

  // The ceiling is the point: past it a reveal stops reading as one gesture and starts reading as a
  // slow page load. Both hand-rolled staggers this replaced had independently landed on 120ms.
  it('never lets a large set drag the reveal out', () => {
    expect(stagger(1000)).toBe(MOTION.staggerCap);
    expect(stagger(20)).toBe(MOTION.staggerCap);
  });
});
