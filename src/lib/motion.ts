import { useEffect, useState } from 'react';

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
 * are skipped (`chartAnim`, `useMounted`).
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
export function chartAnim(reduce: boolean, duration: number = MOTION.base) {
  return {
    isAnimationActive: !reduce,
    animationBegin: 0,
    // Never longer than the base step (G8): a 450ms rise held the Retention bars empty while the reader waited.
    animationDuration: Math.min(duration, MOTION.base),
    animationEasing: MOTION.easeRecharts,
  } as const;
}

/**
 * Whether what mounts now may arrive with a motion (G8): only as a page first draws, never after the reader
 * switched a tab (what a tab reveals is simply there), never for a panel already seen this visit (`key`),
 * and never under Reduce Motion. Read once, as the component mounts, so a re-render mid-animation cannot
 * cut it short. A page navigation (`markNavigation`, AppShell) opens the gate again; a tab switch
 * (`markTabSwitch`) closes it until then.
 */
let tabSwitched = false;
const seen = new Set<string>();
export function markTabSwitch() {
  tabSwitched = true;
  if (typeof document !== 'undefined') document.documentElement.dataset.tabSwitched = '';
}
export function markNavigation() {
  tabSwitched = false;
  if (typeof document !== 'undefined') delete document.documentElement.dataset.tabSwitched;
}
export function useEntrance(key?: string): boolean {
  const [on] = useState(() => {
    if (prefersReducedMotion() || tabSwitched) return false;
    if (key) {
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
  return on;
}

export function stagger(i: number): number {
  return Math.min(i * MOTION.stagger, MOTION.staggerCap);
}

/** Synchronous read of the OS "reduce motion" preference (safe in SSR / before hydration). */
// One query, kept: its `matches` follows the setting live, and an animation frame asking each time made a new one.
let reduceQuery: MediaQueryList | null | undefined;
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (reduceQuery === undefined) reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  return !!reduceQuery?.matches;
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

