import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutDots } from '../../lib/dotLayout';
import { prefersReducedMotion } from '../../lib/motion';
import { Z } from '../../lib/layers';

/** Played once per session: after that the dots are simply there. */
const SEEN_KEY = 'dotfield-entrance';
/** Each dot's fall, and how far across the plot the last one waits to start. */
const FALL_MS = 650;
const SPREAD_MS = 550;
/** The lens: its diameter in CSS px, how much it magnifies, and how far beside the pointer it sits —
 *  clear of the readout's ±$5k band, which marks where the pointer is. */
export const LENS_D = 140;
export const LENS_ZOOM = 4;
const LENS_GAP = 36;
/** A dot drawn alone, and overlapping ones: each is laid down at this alpha, so where dots pile up
 *  the ink builds — the canvas is the accumulation buffer. */
const DOT_ALPHA = 0.85;

/** A springy ease that overshoots a little and settles — the "bounce". */
const easeOutBack = (p: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};

const readSession = () => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const writeSession = () => { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } };

/**
 * A distribution drawn as one dot per person: each at their own value along x, somewhere under the
 * curve along y (lib/dotLayout). Canvas rather than SVG — 21,000 elements would be a slow page — at the
 * device's resolution, so on a 2× screen each person is a separate mark; on a 1× screen or a phone they
 * read as texture, and the lens (mouse only) shows the individuals under the pointer.
 *
 * Colours come from CSS (`.dot-field` sets `color`, `.dot-field-accent` the second kind), so a theme
 * change redraws in the new ink. No chart library: the landing page loads none.
 */
export function DotField({
  values, kinds, toX, heightAt, height, r: rIn, entrance = false, lensAt = null, className,
}: {
  /** One per person, in the units `toX` takes. */
  values: ArrayLike<number>;
  /** Optional: 1 marks a dot drawn in the second ink (a same-school peer). */
  kinds?: ArrayLike<number>;
  /** Value → x in CSS px, for a plot `width` wide. */
  toX: (v: number, width: number) => number;
  /** The curve's height above the baseline at x, in CSS px, for a plot `width` wide. */
  heightAt: (x: number, width: number) => number;
  height: number;
  /** Dot radius in CSS px; by default sized so the dots fill the area under the curve. */
  r?: number;
  /** The once-per-session fall into place. */
  entrance?: boolean;
  /** Where the lens is, in CSS px within the field, or null for none. The caller decides when it
   *  shows — on the landing page, only for a mouse. */
  lensAt?: { x: number; y: number } | null;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [settled, setSettled] = useState(false);
  const [scheme, setScheme] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth((w) => { const n = el.getBoundingClientRect().width; return Math.abs(n - w) < 0.5 ? w : n; });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A theme change repaints in the new ink.
  useEffect(() => {
    const bump = () => setScheme((s) => s + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mantine-color-scheme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', bump);
    return () => { mo.disconnect(); mq?.removeEventListener?.('change', bump); };
  }, []);

  const layout = useMemo(() => {
    if (!(width > 0) || !values.length) return null;
    const xs = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) xs[i] = toX(values[i], width);
    let r = rIn;
    if (r == null) {
      // Size the dots to the room: the area under the curve shared out, a dot taking a bit under
      // its share so neighbours stay apart where the screen can show it.
      let area = 0;
      for (let c = 0; c < width; c++) area += Math.max(0, heightAt(c + 0.5, width));
      r = Math.min(2, Math.max(0.5, 0.42 * Math.sqrt(area / values.length)));
    }
    const pts = layoutDots({ xs, heightAt: (x) => heightAt(x, width), baseY: height, r });
    return { pts, r };
  }, [width, values, toX, heightAt, height, rIn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ink = getComputedStyle(canvas).color;
    const accentEl = canvas.nextElementSibling as HTMLElement | null;
    const accent = accentEl ? getComputedStyle(accentEl).color : ink;
    const { pts, r } = layout;
    const n = pts.length / 2;
    const s = 2 * r * dpr;
    // Round dots where there are few enough to see them as such; at the landing page's 21,000 a square
    // a pixel or two wide is indistinguishable and many times cheaper to lay down each frame.
    const round = n <= 5000;

    const draw = (elapsed: number | null) => {
      const t0 = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = DOT_ALPHA;
      for (const pass of kinds ? [0, 1] : [0]) {
        ctx.fillStyle = pass ? accent : ink;
        for (let i = 0; i < n; i++) {
          if (kinds && (kinds[i] ? 1 : 0) !== pass) continue;
          const x = pts[2 * i];
          let y = pts[2 * i + 1];
          if (elapsed != null) {
            const p = Math.min(1, Math.max(0, (elapsed - (x / width) * SPREAD_MS) / FALL_MS));
            y = -r + (y + r) * easeOutBack(p);
          }
          if (round) {
            ctx.beginPath();
            ctx.arc(x * dpr, y * dpr, r * dpr, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect((x - r) * dpr, (y - r) * dpr, s, s);
          }
        }
      }
      if (elapsed != null) {
        try { performance.measure('dot-frame', { start: t0, end: performance.now() }); } catch { /* diagnostic only */ }
      }
    };

    const skip = !entrance || readSession() || prefersReducedMotion() || document.hidden;
    if (skip) {
      draw(null);
      setSettled(true);
      return;
    }
    writeSession();
    setSettled(false);
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= SPREAD_MS + FALL_MS) {
        draw(null);
        setSettled(true);
        return;
      }
      draw(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `scheme` is read through getComputedStyle, which is why a theme change must re-run this.
  }, [layout, width, height, entrance, kinds, scheme]);

  // The lens: the dots under the pointer, four times as far apart, each a 3px circle.
  useEffect(() => {
    const canvas = lensRef.current;
    if (!canvas || !lensAt || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = LENS_D * dpr;
    canvas.height = LENS_D * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ink = getComputedStyle(canvasRef.current!).color;
    const R = LENS_D / 2;
    const reach = R / LENS_ZOOM;
    // Look at the dots in the pointer's column: a pointer above a thin tail would otherwise magnify
    // the empty space over it. The window is kept between the curve's top and the baseline.
    const top = height - heightAt(lensAt.x, width);
    const fy = Math.min(Math.max(lensAt.y, top + reach / 2), height - reach / 2);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ink;
    const { pts } = layout;
    for (let i = 0; i < pts.length / 2; i++) {
      const dx = pts[2 * i] - lensAt.x;
      const dy = pts[2 * i + 1] - fy;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      ctx.beginPath();
      ctx.arc(R + dx * LENS_ZOOM, R + dy * LENS_ZOOM, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, [lensAt, layout, heightAt, height, width]);

  // Beside the pointer, not over it: over it, the lens hid the band, the dot and the curve the reader
  // is pointing at. To the right where it fits, otherwise to the left; kept inside the plot's height.
  const R = LENS_D / 2;
  const lensBox = lensAt && width > 0 ? {
    left: (lensAt.x + LENS_GAP + LENS_D <= width ? lensAt.x + LENS_GAP : lensAt.x - LENS_GAP - LENS_D),
    top: Math.min(Math.max(lensAt.y - R, 0), Math.max(0, height - LENS_D)),
  } : null;

  return (
    <div
      ref={boxRef}
      className={`dot-field${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', width: '100%', height, pointerEvents: 'none' }}
      data-dots={values.length}
      data-alpha={DOT_ALPHA}
      data-settled={settled ? 'true' : 'false'}
      data-lens={lensAt ? 'on' : 'off'}
      aria-hidden
    >
      <canvas ref={canvasRef} className="dot-field-ink" style={{ position: 'absolute', inset: 0, width: '100%', height }} />
      <span className="dot-field-accent" hidden />
      {lensAt && lensBox && (
        <canvas
          ref={lensRef}
          className="dot-field-lens"
          style={{
            // Over the chart's own marks (the line, the markers, the readout's band), under its pill.
            position: 'absolute', zIndex: Z.content, width: LENS_D, height: LENS_D, pointerEvents: 'none',
            left: lensBox.left, top: lensBox.top,
          }}
        />
      )}
    </div>
  );
}
