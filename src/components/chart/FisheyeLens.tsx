import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { fisheye, LENS_D } from '../../lib/fisheye';
import type { LensMap } from './DotField';

export { LENS_D };

export interface FisheyeLensHandle {
  /** Draw again on the next frame: what is under the glass has moved. */
  redraw(): void;
}

/** What the glass is over, for its `draw`: its centre (the pointer) and radius in the caller's CSS
 *  px, the device pixel ratio, and where the fisheye puts a point, in the glass's own CSS px. */
export interface LensView { cx: number; cy: number; R: number; dpr: number; map: LensMap }

/**
 * A magnifying glass centred on the pointer: a fisheye (lib/fisheye) that magnifies four times at its
 * centre and not at all at its rim, so its edge meets the field around it and it covers exactly what
 * it magnifies. It shows what is under it by asking `draw` for it — the landing chart draws its dots,
 * curve, band, markers and labels, each point pushed through the fisheye. The glass itself (rim,
 * shadow, highlight) is CSS (`.fisheye-lens`). Mouse only: the caller decides when it shows.
 */
export const FisheyeLens = forwardRef<FisheyeLensHandle, {
  /** The pointer, in CSS px within the positioned box the glass is placed in: what the glass magnifies. */
  at: { x: number; y: number };
  /** How far above or below that the glass is shown, px: a finger would hide a glass centred under it. */
  offsetY?: number;
  /** Draws what is under the glass into `ctx` (unscaled: device pixels). */
  draw: (ctx: CanvasRenderingContext2D, view: LensView) => void;
}>(function FisheyeLens({ at, offsetY = 0, draw }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atRef = useRef(at);
  atRef.current = at;
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const raf = useRef(0);

  const paint = () => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(LENS_D * dpr);
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const R = LENS_D / 2;
    const { x: cx, y: cy } = atRef.current;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const map: LensMap = (x, y) => {
      const f = fisheye(x - cx, y - cy, R);
      return { x: R + f.x, y: R + f.y, scale: f.scale };
    };
    drawRef.current(ctx, { cx, cy, R, dpr, map });
    ctx.restore();
    try { performance.measure('lens-frame', { start: t0, end: performance.now() }); } catch { /* diagnostic only */ }
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useImperativeHandle(ref, () => ({
    redraw() { if (!raf.current) raf.current = requestAnimationFrame(() => paintRef.current()); },
  }), []);

  // The glass moves with the pointer at once (it is positioned by style); what it shows is drawn on
  // the next frame, off the pointer's own update, so a sweep's moves are not held up by it.
  useEffect(() => { if (!raf.current) raf.current = requestAnimationFrame(() => paintRef.current()); }, [at.x, at.y]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const R = LENS_D / 2;
  return (
    <div className="fisheye-lens" aria-hidden style={{ left: at.x - R, top: at.y - R + offsetY, width: LENS_D, height: LENS_D }}>
      <canvas ref={canvasRef} className="dot-field-lens" />
    </div>
  );
});
