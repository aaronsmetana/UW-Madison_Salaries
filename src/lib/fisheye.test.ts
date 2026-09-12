import { describe, it, expect } from 'vitest';
import { fisheye, FISHEYE_K } from './fisheye';

describe('fisheye', () => {
  const R = 70;
  it('leaves the rim where it is, so the glass meets the field around it', () => {
    for (const [dx, dy] of [[R, 0], [0, -R], [R * Math.SQRT1_2, R * Math.SQRT1_2]]) {
      const p = fisheye(dx, dy, R);
      expect(p.x).toBeCloseTo(dx, 6);
      expect(p.y).toBeCloseTo(dy, 6);
    }
    // And just inside it, almost where it was.
    expect(fisheye(R - 0.01, 0, R).x).toBeCloseTo(R, 1);
  });
  it('magnifies k+1 times at the centre and not at all at the rim', () => {
    expect(fisheye(0.001, 0, R).scale).toBeCloseTo(FISHEYE_K + 1, 3);
    expect(fisheye(R - 1e-9, 0, R).scale).toBeCloseTo(1, 6);
  });
  it('never folds over: a point further out is always drawn further out', () => {
    let last = -1;
    for (let d = 0; d <= R; d += 0.5) {
      const x = fisheye(d, 0, R).x;
      expect(x).toBeGreaterThan(last);
      last = x;
    }
  });
  it('keeps each point on its own ray from the centre', () => {
    const p = fisheye(12, -5, R);
    expect(p.x / p.y).toBeCloseTo(12 / -5, 9);
    expect(Math.sign(p.x)).toBe(1);
    expect(Math.sign(p.y)).toBe(-1);
  });
  it('leaves everything outside the glass alone', () => {
    expect(fisheye(90, 10, R)).toEqual({ x: 90, y: 10, scale: 1 });
  });
});
