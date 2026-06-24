import { useEffect, useRef, useState } from 'react';

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
