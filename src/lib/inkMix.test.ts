import { describe, expect, it } from 'vitest';
import { contrastRatio, mixOklab, parseRgb, strongerInk, toneInks } from './inkMix';

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

describe('toneInks', () => {
  const cardLight = 'rgb(252, 252, 252)';
  const cardDark = 'rgb(30, 32, 36)';
  for (const [name, card, text] of [['light', cardLight, 'rgb(20, 22, 26)'], ['dark', cardDark, 'rgb(236, 238, 241)']] as const) {
    it(`never has less contrast against the ${name} card than the ink itself, each tone more than the last`, () => {
      for (const ink of ['rgb(18, 130, 150)', 'rgb(179, 92, 0)', 'rgb(214, 51, 108)', 'rgb(134, 142, 150)']) {
        const tones = toneInks(ink, text);
        expect(tones).toHaveLength(8);
        expect(tones[0]).toBe(mixOklab(ink, ink, 0));
        let last = contrastRatio(tones[0], card);
        for (const t of tones.slice(1)) {
          const c = contrastRatio(t, card);
          expect(c).toBeGreaterThanOrEqual(last - 1e-9);
          last = c;
        }
      }
    });
  }
});
