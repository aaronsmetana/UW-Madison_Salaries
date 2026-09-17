import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { query } from '../lib/duckdb';
import { personRowsKey, personRowsSql } from '../lib/personQuery';
import { prefersReducedMotion } from '../lib/motion';
import { usd } from '../lib/format';

/**
 * The landing page's way into a person: their marked dot (a search found them) swells, glowing, a green
 * disc opens from it over the whole window with their name growing on it, the page underneath becomes
 * theirs, and the disc closes onto their page's heading, the name settling into its place. About three
 * and a half seconds, never more than REVEAL.cap; any key or press finishes it at once; under Reduce
 * Motion there is none — the page simply opens.
 *
 * Mounted once in the app shell (AppShellLayout), so it lives through the route change it makes.
 */

export interface RevealPerson {
  key: string;
  name: string;
  title: string | null;
  school: string | null;
  pay: number | null;
}

export interface RevealStart {
  person: RevealPerson;
  /** The dot, in viewport CSS px: its centre and radius. */
  from: { x: number; y: number; r: number };
}

/** The stages, ms: the dot swells; the disc covers the window (the page changes under it); the disc closes
 *  onto the heading. Between cover and close it waits, as a card, for the heading — no longer than `cap`
 *  from the start in all. */
export const REVEAL = { swell: 1200, cover: 800, hold: 250, close: 1100, cap: 5000 } as const;
/** How big the dot swells before the disc opens, CSS px. */
const SWELL_R = 44;

const RevealContext = createContext<((start: RevealStart) => void) | null>(null);

/** Starts the reveal into a person's page; null outside the app shell. */
export const useReveal = () => useContext(RevealContext);

const easeOutBack = (p: number) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** The heading a person's page lands focus on, once it is drawn with their name. */
const heading = () => {
  const el = document.querySelector<HTMLElement>('[data-reveal-target]');
  return el && el.textContent?.trim() ? el : null;
};

/** Focuses the heading as soon as it is there, for up to `cap` ms. */
function focusWhenReady(cap: number = REVEAL.cap) {
  const t0 = performance.now();
  const look = () => {
    const el = heading();
    if (el) { el.focus({ preventScroll: true }); return; }
    if (performance.now() - t0 < cap) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

export function RevealProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [run, setRun] = useState<(RevealStart & { id: number }) | null>(null);
  const start = useCallback((s: RevealStart) => {
    const href = `/person/${encodeURIComponent(s.person.key)}`;
    // What the page will wait on, started now: its code, and its first query.
    void import('../routes/Person');
    void qc.prefetchQuery({ queryKey: personRowsKey(s.person.key), queryFn: () => query(personRowsSql(s.person.key)) });
    if (prefersReducedMotion()) {
      window.scrollTo(0, 0);
      navigate(href);
      focusWhenReady();
      return;
    }
    setRun({ ...s, id: performance.now() });
  }, [navigate, qc]);
  return (
    <RevealContext.Provider value={start}>
      {children}
      {run && <RevealOverlay key={run.id} run={run} onDone={() => setRun(null)} />}
    </RevealContext.Provider>
  );
}

function RevealOverlay({ run, onDone }: { run: RevealStart; onDone: () => void }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const { person, from } = run;

  useEffect(() => {
    const href = `/person/${encodeURIComponent(person.key)}`;
    const t0 = performance.now();
    const vw = window.innerWidth, vh = window.innerHeight;
    const { x, y, r } = from;
    const cover = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) + 8;
    const covered = REVEAL.swell + REVEAL.cover;
    let navigated = false;
    let closing: number | null = null;
    let target: { cx: number; cy: number; dx: number; dy: number; scale: number } | null = null;
    let raf = 0;
    let finished = false;
    const root = rootRef.current!, scrim = scrimRef.current!, glow = glowRef.current!, disc = discRef.current!;
    const tag = tagRef.current!, card = cardRef.current!, name = nameRef.current!, rest = restRef.current!;
    root.dataset.phase = 'swell';
    // Where the tag beside the dot goes: right of it, or left where the window ends.
    const tagLeft = x + 60 + 280 < vw;
    tag.style.left = tagLeft ? `${x + 58}px` : '';
    tag.style.right = tagLeft ? '' : `${vw - x + 58}px`;
    tag.style.top = `${y}px`;

    const go = () => {
      if (navigated) return;
      navigated = true;
      window.scrollTo(0, 0);
      navigate(href);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      go();
      focusWhenReady();
      onDone();
    };
    const circle = (rad: number, cx: number, cy: number) => `circle(${Math.max(0, rad)}px at ${cx}px ${cy}px)`;

    const frame = (now: number) => {
      const t = now - t0;
      if (t < REVEAL.swell) {
        const p = t / REVEAL.swell;
        const rr = lerp(r, SWELL_R, easeOutBack(p));
        disc.style.clipPath = circle(rr, x, y);
        // Three times the dot's radius out: a 40px glow scaled to six radii across.
        glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${(rr * 6) / 40})`;
        glow.style.opacity = String(clamp01(p * 3));
        scrim.style.opacity = String(0.55 * easeInOut(p));
        scrim.style.setProperty('--hole', `${rr * 1.6}px`);
        tag.style.opacity = String(clamp01((p - 0.15) * 3));
        tag.style.transform = `translateY(-50%) scale(${lerp(0.9, 1, clamp01(p * 2))})`;
      } else if (t < covered) {
        root.dataset.phase = 'cover';
        const p = (t - REVEAL.swell) / REVEAL.cover;
        const e = easeInOut(p);
        disc.style.clipPath = circle(lerp(SWELL_R, cover, e), x, y);
        glow.style.opacity = String(1 - p);
        tag.style.opacity = String(clamp01(1 - p * 3));
        scrim.style.opacity = '0.55';
        card.style.opacity = String(clamp01((p - 0.35) * 2.5));
        card.style.transform = `translate(-50%, -50%) translate(${lerp(x - vw / 2, 0, e) * 0.35}px, ${lerp(y - vh / 2, 0, e) * 0.35}px) scale(${lerp(0.7, 1, e)})`;
      } else if (closing == null) {
        root.dataset.phase = 'hold';
        disc.style.clipPath = 'none';
        glow.style.opacity = '0';
        tag.style.opacity = '0';
        scrim.style.opacity = '0';
        card.style.opacity = '1';
        card.style.transform = 'translate(-50%, -50%)';
        go();
        const el = heading();
        if ((el && t >= covered + REVEAL.hold) || t >= REVEAL.cap - REVEAL.close) {
          closing = now;
          root.dataset.phase = 'close';
          if (el) {
            // The name's own box, not the heading's (which runs the width of the page).
            const range = document.createRange();
            range.selectNodeContents(el);
            const box = range.getBoundingClientRect();
            const nb = name.getBoundingClientRect();
            const scale = (parseFloat(getComputedStyle(el).fontSize) || 32) / (parseFloat(getComputedStyle(name).fontSize) || 32);
            target = { cx: box.left + box.width / 2, cy: box.top + box.height / 2, dx: box.left - nb.left, dy: box.top - nb.top, scale };
          }
        }
      } else {
        const p = clamp01((now - closing) / REVEAL.close);
        const e = easeInOut(p);
        const cx = target ? target.cx : vw / 2, cy = target ? target.cy : vh / 2;
        disc.style.clipPath = circle(lerp(cover, 0, e), lerp(vw / 2, cx, e), lerp(vh / 2, cy, e));
        rest.style.opacity = String(clamp01(1 - p * 3));
        // The name moves onto the heading's and shrinks to its size, fading as the disc closes past it.
        if (target) name.style.transform = `translate(${target.dx * e}px, ${target.dy * e}px) scale(${lerp(1, target.scale, e)})`;
        name.style.opacity = String(clamp01((1 - p) * 2.5));
        if (p >= 1) { finish(); return; }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Any key, or a press anywhere, finishes it — after a moment, so the press that started it cannot.
    const skip = (e: Event) => {
      if (performance.now() - t0 < 150) return;
      if (e instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      finish();
    };
    window.addEventListener('keydown', skip, true);
    window.addEventListener('pointerdown', skip, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('pointerdown', skip, true);
    };
    // One run per mount (keyed by its start).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detail = [person.title, person.school].filter(Boolean).join(' · ');
  return createPortal(
    <div ref={rootRef} className="person-reveal" role="status" aria-live="polite" data-phase="swell">
      <span className="visually-hidden">Opening {person.name}</span>
      <div ref={scrimRef} className="person-reveal-scrim" style={{ ['--hole-x' as string]: `${from.x}px`, ['--hole-y' as string]: `${from.y}px` }} aria-hidden />
      <div ref={glowRef} className="person-reveal-glow" aria-hidden />
      <div ref={discRef} className="person-reveal-disc" style={{ clipPath: `circle(${from.r}px at ${from.x}px ${from.y}px)`, ['--disc-x' as string]: `${from.x}px`, ['--disc-y' as string]: `${from.y}px` }} aria-hidden>
        <div ref={cardRef} className="person-reveal-card">
          <div ref={nameRef} className="person-reveal-name">{person.name}</div>
          <div ref={restRef}>
            {detail && <div className="person-reveal-detail">{detail}</div>}
            {person.pay != null && <div className="person-reveal-pay">{usd(person.pay)}</div>}
          </div>
        </div>
      </div>
      <div ref={tagRef} className="person-reveal-tag" aria-hidden>
        <span className="person-reveal-tag-name">{person.name}</span>
        {person.title && <span className="person-reveal-tag-detail">{person.title}</span>}
      </div>
    </div>,
    document.body,
  );
}
