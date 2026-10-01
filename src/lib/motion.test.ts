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
  // Each step's first declaration, in `:root`; the Reduce Motion block after it sets them all to 0.
  const declared: Record<string, number> = {};
  for (const m of css.matchAll(/--dur-([a-z]+):\s*(\d+)ms/g)) declared[m[1]] ??= Number(m[2]);

  it('mirrors every duration token into CSS', () => {
    expect(declared).toEqual({ fast: MOTION.fast, base: MOTION.base, slow: MOTION.slow });
  });

  it('turns every step off under Reduce Motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
    for (const k of ['fast', 'base', 'slow']) expect(reduced, k).toMatch(new RegExp(`--dur-${k}:\\s*0ms`));
  });

  it('mirrors the easing curve', () => {
    const m = css.match(/--ease:\s*([^;]+);/);
    expect(m?.[1].replace(/\s+/g, '')).toBe(MOTION.ease.replace(/\s+/g, ''));
  });

  // Every transition and animation in the stylesheet on the three steps and the one easing, but for the
  // named exceptions: the loading bar's endless slide, and the landing's sheen and drain, timed from its
  // own motion. Delays are staggers, not durations.
  it('keeps every transition and animation on the scale', () => {
    const off = css.split('\n')
      .filter((l) => /\b(transition|animation)\s*:/.test(l) && !/global-loading-slide|hero-sheen|tail-drain|:\s*none|^\s*\/?\*/.test(l))
      .filter((l) => /\d+m?s\b(?!\))/.test(l.replace(/var\(--dur-(fast|base|slow)\)/g, '')) || /\b(ease-in-out|ease-out|ease-in|linear|cubic-bezier)\b/.test(l) || /\bease\b(?!\))/.test(l.replace(/var\(--ease\)/g, '')));
    expect(off).toEqual([]);
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
