import { useEffect, useRef, useState } from 'react';

/**
 * One ramp for every duration in the app.
 *
 * Before this there were ten distinct CSS durations across twenty-three sites plus four loose JS
 * numbers, and the differences carried no meaning — 220 ms and 240 ms sat on adjacent elements, and
 * two `useCountUp` calls disagreed by 100 ms for no reason anyone recorded. The four names below are
 * chosen by what is moving, not by how long it takes, so a new call site picks one by asking a
 * question it can actually answer.
 *
 * Mirrored as `--dur-*` / `--ease-out` in app.css because CSS cannot read this file;
 * `motion.test.ts` parses that stylesheet and fails if the two ever drift.
 */
export const MOTION = {
  /** A property changing on something already on screen: hover, press, focus, fill-opacity. */
  instant: 120,
  /** One element arriving, leaving, or gliding to a new position. */
  quick: 240,
  /** A chart's marks arriving together. */
  reveal: 600,
  /** A figure counting up to its value, or a line drawing itself. */
  figure: 800,
  /** A route change is a navigation, not an element arriving — deliberately shorter than `quick`. */
  route: 160,
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
export function useCountUp(target: number | null, duration = 600): number | null {
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

/**
 * Like `useMounted`, but waits for data rather than for the first paint: stays `false` until `ready`
 * turns true, then flips once and stays. A plain mount flag is no good for a chart whose data arrives
 * after mount — it would spend its animation on an empty box and then pop the real content in. Honors
 * reduced motion by starting settled.
 */
export function useReveal(ready: boolean): boolean {
  const [revealed, setRevealed] = useState(prefersReducedMotion);
  useEffect(() => {
    if (revealed || !ready) return;
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, [ready, revealed]);
  return revealed;
}
