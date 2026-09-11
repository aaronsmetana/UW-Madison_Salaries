import { describe, expect, it } from 'vitest';
import { layoutDots, paysFromCounts, seeded } from './dotLayout';

const curve = (x: number) => 60 * Math.exp(-(((x - 300) / 120) ** 2)) + 4;

describe('layoutDots', () => {
  const xs = Array.from({ length: 5000 }, (_, i) => 50 + ((i * 7919) % 50000) / 100);
  const pts = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });

  it('keeps every dot under the curve and above the baseline, a radius inside both', () => {
    for (let i = 0; i < xs.length; i++) {
      const y = pts[2 * i + 1];
      const top = 100 - curve(Math.floor(xs[i]) + 0.5);
      expect(y).toBeLessThanOrEqual(100 - 0.6 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(top + 0.6 - 1e-4);
    }
  });

  it('keeps every dot within half a pixel of its value', () => {
    for (let i = 0; i < xs.length; i++) expect(Math.abs(pts[2 * i] - xs[i])).toBeLessThanOrEqual(0.5);
  });

  it('draws the same picture every time', () => {
    const again = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 7 });
    expect(Array.from(again)).toEqual(Array.from(pts));
    const other = layoutDots({ xs, heightAt: curve, baseY: 100, r: 0.6, seed: 8 });
    expect(Array.from(other)).not.toEqual(Array.from(pts));
  });

  it('spreads a column from the baseline to the curve', () => {
    const col = Array.from({ length: 40 }, () => 300.2);
    const p = layoutDots({ xs: col, heightAt: curve, baseY: 100, r: 0.6 });
    const ys = Array.from({ length: 40 }, (_, i) => p[2 * i + 1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.9 * (curve(300.5) - 1.2));
  });
});

describe('seeded', () => {
  it('repeats for a seed', () => {
    const a = seeded(3), b = seeded(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('paysFromCounts', () => {
  it('puts each person inside their own $100', () => {
    const pays = paysFromCounts(500, [2, 0, 1]);
    expect(Array.from(pays)).toEqual([50025, 50075, 50250]);
  });
});
