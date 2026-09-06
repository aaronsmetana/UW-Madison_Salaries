import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Z } from './layers';

/**
 * Same contract as `motion.test.ts`, and the same reason: CSS cannot import a TypeScript constant,
 * so the scale lives in two places and a comment asking the next person to keep them in step is not
 * a contract. A drift here is worse than a motion drift, because the symptom is one surface
 * silently painting over another on some routes and not others.
 *
 * These are source greps, and they say so. They cannot see a computed stacking context — only that
 * nobody wrote a bare number where a token belongs.
 */
describe('the stacking scale is defined once', () => {
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

  it('mirrors every layer token into CSS', () => {
    const declared = Object.fromEntries(
      [...css.matchAll(/--z-([a-zA-Z-]+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(declared).toEqual({
      behind: Z.behind,
      content: Z.content,
      local: Z.local,
      sticky: Z.sticky,
      floating: Z.floating,
      modal: Z.modal,
      'loading-bar': Z.loadingBar,
    });
  });

  it('leaves no raw z-index literal in the stylesheet', () => {
    // Every `z-index:` in app.css must read a token. Strip the :root block that defines them first,
    // or the definitions themselves would count as violations.
    const body = css.replace(/:root\s*\{[^}]*\}/g, '');
    const raw = [...body.matchAll(/z-index:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !v.startsWith('var(--z-'));
    expect(raw).toEqual([]);
  });
});

describe('the scale keeps page furniture under dialogs', () => {
  /**
   * This is the bug the scale exists to prevent, so it gets an assertion rather than a comment. The
   * back-to-top button shipped at 250 against Mantine's 200 and painted over the command palette on
   * /data; the tray tied at 200 and won only on DOM order.
   */
  it('puts floating chrome below the modal layer', () => {
    expect(Z.floating).toBeLessThan(Z.modal);
  });

  it('keeps the loading bar above a dialog, since loading continues while one is open', () => {
    expect(Z.loadingBar).toBeGreaterThan(Z.modal);
  });

  it('orders the in-page layers by how far they reach', () => {
    expect(Z.behind).toBeLessThan(Z.content);
    expect(Z.content).toBeLessThan(Z.local);
    expect(Z.local).toBeLessThan(Z.sticky);
    expect(Z.sticky).toBeLessThan(Z.floating);
  });
});
