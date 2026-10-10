import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chipState, type ChipInput } from '../../lib/timelineChip';
import { MOTION, prefersReducedMotion } from '../../lib/motion';

/**
 * The timeline's status chip (mockup 3a §11): a ring and what the graph is doing — "Moving people · Mar 2026 →
 * Sep 2026", "Sorting by salary in" with the seconds left inside the ring, "Next: Apr 2025 in" — and, while it
 * plays, when the timeline ends (not `compact`, on a phone, where it shares Play's one line). Its own clock (four times a second, only while something counts), so the graph
 * is not drawn again for it; the ring turns by a registered `--ring` angle, animated, never redrawn by React.
 */
export function TimelineChip({ input, compact = false }: { input: Omit<ChipInput, 'now'>; compact?: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  const live = input.playing || input.phase != null || input.rest != null || input.fade != null || input.switching;
  useEffect(() => {
    setNow(performance.now());
    if (!live) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [live, input.phase, input.rest, input.fade]);
  const st = chipState({ ...input, now });

  const ringRef = useRef<HTMLSpanElement>(null);
  const { from, to, start, end, linear } = st.ring;
  useLayoutEffect(() => {
    const el = ringRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.setProperty('--ring', `${to * 360}deg`);
    const t = performance.now();
    if (end <= start || t >= end || prefersReducedMotion()) return;
    const a = el.animate([{ '--ring': `${from * 360}deg` }, { '--ring': `${to * 360}deg` }] as Keyframe[], { duration: end - start, easing: linear ? 'linear' : MOTION.ease });
    a.currentTime = Math.max(0, t - start);
  }, [from, to, start, end, linear]);

  return (
    <div className="strata-status" data-compact={compact || undefined} data-count={st.count || undefined}>
      <span ref={ringRef} className="strata-status-ring" aria-hidden>
        <span className="strata-status-count">{st.count}</span>
      </span>
      <span className="strata-status-text">
        <span className="strata-status-label">{st.label}</span>
        {/* The chip's height is its own (app.css), so the label centres alone and never moves the row. */}
        {st.eta && !compact && <span className="strata-status-eta">{st.eta}</span>}
      </span>
    </div>
  );
}
