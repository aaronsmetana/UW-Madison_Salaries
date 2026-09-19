import { describe, expect, it } from 'vitest';
import { contrastRatio, dotTones, mixOklab, oklab, parseRgb, strongerInk, type DotLook, KEEP_CHROMA } from './inkMix';

describe('parseRgb', () => {
  it('reads the forms getComputedStyle returns', () => {
    expect(parseRgb('rgb(43, 126, 146)')).toEqual([43, 126, 146]);
    expect(parseRgb('rgba(43, 126, 146, 0.5)')).toEqual([43, 126, 146]);
    expect(parseRgb('color(srgb 0.2 0.4 1)')).toEqual([51, 102, 255]);
    expect(parseRgb('#2b7e92')).toEqual([43, 126, 146]);
    expect(parseRgb('oklab(0.5 0 0)')).toBeNull();
  });
});

describe('mixOklab', () => {
  it('returns the ends at 0 and 1', () => {
    expect(mixOklab('rgb(43, 126, 146)', 'rgb(20, 20, 20)', 0)).toBe('rgb(43, 126, 146)');
    expect(mixOklab('rgb(43, 126, 146)', 'rgb(20, 20, 20)', 1)).toBe('rgb(20, 20, 20)');
  });
  it('deepens toward dark text and lightens toward light text, keeping the hue', () => {
    const deeper = parseRgb(mixOklab('rgb(43, 126, 146)', 'rgb(26, 27, 30)', 0.35))!;
    expect(deeper[1]).toBeLessThan(126);
    expect(deeper[2]).toBeGreaterThan(deeper[0]); // still a blue-green, not a grey
    const lighter = parseRgb(mixOklab('rgb(79, 147, 164)', 'rgb(222, 226, 230)', 0.35))!;
    expect(lighter[1]).toBeGreaterThan(147);
  });
  it('leaves an unparseable colour alone', () => {
    expect(mixOklab('oklab(0.5 0 0)', 'rgb(0, 0, 0)', 0.5)).toBe('oklab(0.5 0 0)');
  });
});

describe('strongerInk', () => {
  // Light-mode inks against dark text, dark-mode inks against light text.
  const light = ['rgb(43, 126, 146)', 'rgb(179, 92, 0)', 'rgb(194, 37, 92)', 'rgb(112, 72, 232)', 'rgb(73, 80, 87)'];
  const dark = ['rgb(79, 147, 164)', 'rgb(255, 169, 77)', 'rgb(247, 131, 172)', 'rgb(151, 117, 250)', 'rgb(173, 181, 189)'];
  it('stands every ink at least 1.5:1 apart from itself', () => {
    for (const c of light) expect(contrastRatio(strongerInk(c, 'rgb(26, 27, 30)'), c)).toBeGreaterThanOrEqual(1.5);
    for (const c of dark) expect(contrastRatio(strongerInk(c, 'rgb(201, 201, 201)'), c)).toBeGreaterThanOrEqual(1.5);
  });
  it('goes darker on a light page and lighter on a dark one', () => {
    expect(parseRgb(strongerInk('rgb(43, 126, 146)', 'rgb(26, 27, 30)'))![1]).toBeLessThan(126);
    expect(parseRgb(strongerInk('rgb(79, 147, 164)', 'rgb(201, 201, 201)'))![1]).toBeGreaterThan(147);
  });
});

describe('dotTones', () => {
  // The app's own category inks and page colours, as the landing page resolves them.
  const SCHEMES = {
    light: {
      text: 'rgb(22, 25, 29)', card: 'rgb(252, 252, 252)',
      inks: ['rgb(43, 126, 146)', 'rgb(179, 92, 0)', 'rgb(194, 37, 92)', 'rgb(112, 72, 232)', 'rgb(73, 80, 87)'],
      look: { steps: 12, reach: 0.4, hues: 3, turn: 8, rimLift: 0, rimChroma: 1.3 } as DotLook,
    },
    dark: {
      text: 'rgb(232, 234, 237)', card: 'rgb(15, 16, 19)',
      inks: ['rgb(79, 147, 164)', 'rgb(255, 169, 77)', 'rgb(247, 131, 172)', 'rgb(151, 117, 250)', 'rgb(173, 181, 189)'],
      look: { steps: 12, reach: 0.5, hues: 3, turn: 8, rimLift: 0.3, rimChroma: 1 } as DotLook,
    },
  } as const;
  const dist = (a: string, b: string) => { const p = oklab(a)!, q = oklab(b)!; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  // How far apart two colours are in hue and colourfulness alone — OKLab's a and b, lightness left out.
  // That is what tells the five types apart; lightness is what the depth shading changes on purpose, and
  // measured with it a deep teal step sat "nearer" the grey ink only for sharing its lightness.
  const hueDist = (a: string, b: string) => { const p = oklab(a)!, q = oklab(b)!; return Math.hypot(p[1] - q[1], p[2] - q[2]); };

  for (const [name, sc] of Object.entries(SCHEMES)) {
    it(`${name}: begins with the ink itself, and has a tone for every step, the rim and every hue`, () => {
      const tones = dotTones(sc.inks[0], sc.text, sc.card, sc.look);
      expect(tones).toHaveLength((sc.look.steps + 1) * sc.look.hues);
      expect(tones[0]).toBe(mixOklab(sc.inks[0], sc.inks[0], 0));
    });

    it(`${name}: depth only ever moves away from the card, so no step has less contrast than the one before`, () => {
      for (const ink of sc.inks) {
        const tones = dotTones(ink, sc.text, sc.card, sc.look);
        let last = contrastRatio(tones[0], sc.card);
        for (let s = 1; s < sc.look.steps; s++) {
          const c = contrastRatio(tones[s * sc.look.hues], sc.card);
          expect(c).toBeGreaterThanOrEqual(last - 1e-6);
          last = c;
        }
      }
    });

    it(`${name}: every tone, rim and hue variant clears 3:1 against the card`, () => {
      for (const ink of sc.inks) {
        for (const tone of dotTones(ink, sc.text, sc.card, sc.look)) expect(contrastRatio(tone, sc.card)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${name}: every tone stays nearer its own employment type's ink than any other's, in hue and colour`, () => {
      sc.inks.forEach((ink, k) => {
        for (const tone of dotTones(ink, sc.text, sc.card, sc.look)) {
          const own = hueDist(tone, ink);
          sc.inks.forEach((other, j) => { if (j !== k) expect(own).toBeLessThan(hueDist(tone, other)); });
        }
      });
    });

    it(`${name}: no tone gives up more than a quarter of its ink's colour to reach its lightness`, () => {
      const chroma = (c: string) => { const p = oklab(c)!; return Math.hypot(p[1], p[2]); };
      for (const ink of sc.inks) {
        for (const tone of dotTones(ink, sc.text, sc.card, sc.look)) expect(chroma(tone)).toBeGreaterThanOrEqual(KEEP_CHROMA * chroma(ink) - 0.004);
      }
    });

    it(`${name}: a hue variant turns the hue, not the lightness`, () => {
      const tones = dotTones(sc.inks[0], sc.text, sc.card, sc.look);
      const [L0] = oklab(tones[0])!;
      for (let h = 1; h < sc.look.hues; h++) {
        expect(Math.abs(oklab(tones[h])![0] - L0)).toBeLessThan(0.02);
        expect(dist(tones[h], tones[0])).toBeGreaterThan(0.005);
      }
    });
  }

  it('dark: moves each ink a share of the room it has left, so a light ink like orange keeps its colour', () => {
    const sc = SCHEMES.dark;
    const lift = (ink: string) => {
      const tones = dotTones(ink, sc.text, sc.card, sc.look);
      return oklab(tones[(sc.look.steps - 1) * sc.look.hues])![0] - oklab(ink)![0];
    };
    expect(lift('rgb(255, 169, 77)')).toBeLessThan(lift('rgb(79, 147, 164)'));
    // And the crest's rim is lighter still than the brightest step.
    const tones = dotTones(sc.inks[0], sc.text, sc.card, sc.look);
    expect(oklab(tones[sc.look.steps * sc.look.hues])![0]).toBeGreaterThan(oklab(tones[(sc.look.steps - 1) * sc.look.hues])![0]);
  });

  it('light: the rim is a richer ink at its own lightness, not a paler one', () => {
    const sc = SCHEMES.light;
    const tones = dotTones(sc.inks[0], sc.text, sc.card, sc.look);
    const [L0, a0, b0] = oklab(sc.inks[0])!;
    const [L, a, b] = oklab(tones[sc.look.steps * sc.look.hues])!;
    expect(Math.abs(L - L0)).toBeLessThan(0.02);
    expect(Math.hypot(a, b)).toBeGreaterThan(Math.hypot(a0, b0));
  });
});
