import { useEffect, useRef, useState } from 'react';

/**
 * One ramp for every duration in the app: three steps and one easing (P10).
 *
 * It had grown to five names (120, 160, 240, 600, 800) in here and twelve durations in app.css, and the
 * differences carried no meaning. Chosen by what is moving: `fast`, a property changing on something
 * already on screen (hover, press, focus, a route); `base`, one element arriving or leaving; `slow`,
 * something travelling a distance or drawing itself (a chart's marks, a figure counting up, a bar growing
 * to its value).
 *
 * Mirrored as `--dur-*` / `--ease` in app.css because CSS cannot read this file; `motion.test.ts` parses
 * that stylesheet and fails if the two drift. Under Reduce Motion the CSS steps are 0 and the JS ones
 * are skipped (`chartAnim`, `useCountUp`, `useMounted`).
 */
export const MOTION = {
  fast: 150,
  base: 250,
  slow: 450,
  /** Travel for an arriving element, in px — the app's one reveal distance. */
  risePx: 4,
  /** Per-item delay step for a staggered reveal, and the total lead-in it may never exceed. */
  stagger: 6,
  staggerCap: 120,
  ease: 'cubic-bezier(.22,.8,.3,1)',
  /** Recharts wants a keyword, not a bezier. */
  easeRecharts: 'ease-out',
} as const;

/**
 * Per-item delay for a staggered reveal, capped so a large set still finishes promptly.
 *
 * The two hand-rolled staggers this replaces used different steps (4 ms and 6 ms) but had
 * independently arrived at the same 120 ms ceiling, which is the part that matters: past that, a
 * reveal stops reading as one gesture and starts reading as a slow load.
 */
/**
 * Animation props for a Recharts mark (`<Bar>`, `<Line>`, `<Area>`, `<Scatter>`).
 *
 * Recharts tweens a mark whenever its data changes and has no notion of `prefers-reduced-motion`,
 * so a mark that omits `isAnimationActive` re-animates on every filter change and ignores the
 * preference outright. Seventeen marks across six files had done exactly that while their
 * neighbours were explicitly gated — which is why an eslint rule now refuses a mark that carries
 * neither this helper nor an explicit `isAnimationActive`.
 *
 * The default also caps Recharts' own: it uses 1500ms for lines and areas, and 400ms for bars.
 */
export function chartAnim(reduce: boolean, duration: number = MOTION.slow) {
  return {
    isAnimationActive: !reduce,
    animationBegin: 0,
    animationDuration: duration,
    animationEasing: MOTION.easeRecharts,
  } as const;
}

export function stagger(i: number): number {
  return Math.min(i * MOTION.stagger, MOTION.staggerCap);
}

/** Synchronous read of the OS "reduce motion" preference (safe in SSR / before hydration). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * `false` on the first paint, `true` immediately after mount — flip a CSS class/inline style from an
 * "initial" (e.g. width:0) to a "settled" state to fire a one-shot grow/fade transition. When the user
 * prefers reduced motion it starts `true`, so content renders in its final state with no animation.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(prefersReducedMotion);
  useEffect(() => {
    if (mounted) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [mounted]);
  return mounted;
}

/**
 * Animate a number from 0 → `target` once on mount over `duration` ms (ease-out cubic). Returns the
 * current value for rendering. Honors reduced-motion (returns `target` immediately) and re-runs if
 * `target` changes. Returns `null` when `target` is `null`.
 */
export function useCountUp(target: number | null, duration: number = MOTION.slow): number | null {
  const [value, setValue] = useState<number | null>(() =>
    target == null ? null : prefersReducedMotion() ? target : 0,
  );
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (target == null) { setValue(null); return; }
    if (prefersReducedMotion() || duration <= 0) { setValue(target); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(target * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setValue(target);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);
  return value;
}
