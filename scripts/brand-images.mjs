#!/usr/bin/env node
/**
 * brand-images.mjs — draws the site's mark into every file that carries it outside the app:
 *
 *   public/icon.svg              the favicon and the installed app's icon (the PWA manifest's one icon)
 *   public/apple-touch-icon.png  180×180, full bleed: iOS rounds the corners itself
 *   public/og-image.png          1200×630, the card a pasted link shows
 *
 * The mark's shape is src/components/brandMark.json, which the header's glyph (BrandMark) reads too, so
 * the two cannot drift. The share card sets the name in the app's own Hanken Grotesk (public/fonts) and
 * draws campus's real pay distribution in dots, from public/data/home-stats.json.
 *
 * Run it after changing the mark, and commit what it writes (the build does not run it):
 *   npm run data               # once, for public/data/home-stats.json
 *   node scripts/brand-images.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(ROOT, p);
const mark = JSON.parse(readFileSync(at('src/components/brandMark.json'), 'utf8'));

/** The mark's dots inside a square `size` wide, filling `share` of it, centred on their own extent. */
function glyph(size, share, ink) {
  const xs = mark.dots.map(([x]) => x), ys = mark.dots.map(([, y]) => y).concat(mark.lit.y);
  const x0 = Math.min(...xs) - mark.r, x1 = Math.max(...xs) + mark.r;
  const y0 = Math.min(...ys) - mark.r, y1 = Math.max(...ys) + mark.r;
  const k = (size * share) / Math.max(x1 - x0, y1 - y0);
  const dx = size / 2 - (k * (x0 + x1)) / 2, dy = size / 2 - (k * (y0 + y1)) / 2;
  const f = (n) => +n.toFixed(2);
  return `<g transform="translate(${f(dx)} ${f(dy)}) scale(${f(k)})"><g fill="${ink}">${mark.dots
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${mark.r}"/>`).join('')}</g><circle cx="${mark.lit.x}" cy="${mark.lit.y}" r="${mark.lit.r}" fill="${mark.litInk}"/></g>`;
}

/** The mark on its tile: flat accent, white dots, the lit one warm. `radius` 0 for a full-bleed icon. */
const tile = (size, radius) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${mark.tile}"/>${glyph(size, 0.7, '#fff')}</svg>`;

// Campus's pay in dots for the share card: $5k columns up to the cap, each dot the same number of people,
// the tallest column 12 dots. The column holding the median is where the one warm dot sits.
const stats = JSON.parse(readFileSync(at('public/data/home-stats.json'), 'utf8'));
const { lo100, counts } = stats.pay_counts;
const COLS = 50, STEP = 5000;
const cols = new Array(COLS).fill(0);
counts.forEach((n, i) => {
  const pay = (lo100 + i) * 100;
  const c = Math.floor(pay / STEP);
  if (c >= 0 && c < COLS) cols[c] += n;
});
const perDot = Math.max(...cols) / 12;
const medCol = Math.floor(stats.p50 / STEP);
const DOT = { gap: 10.4, r: 3.5, x0: 640, floor: 568 };
let field = '';
cols.forEach((n, c) => {
  const k = Math.round(n / perDot);
  for (let j = 0; j < k; j++) {
    const lit = c === medCol && j === Math.floor(k / 2);
    field += `<circle cx="${(DOT.x0 + c * DOT.gap).toFixed(1)}" cy="${DOT.floor - j * 9}" r="${lit ? DOT.r + 1 : DOT.r}" fill="${lit ? mark.litInk : '#5FB3C4'}" fill-opacity="${lit ? 1 : 0.55}"/>`;
  }
});

const font = readFileSync(at('public/fonts/hanken-grotesk-latin.woff2')).toString('base64');
const card = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Hanken Grotesk'; font-weight: 400 900; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; background: #0B1519; color: #F4F7F8; font-family: 'Hanken Grotesk', sans-serif; position: relative; overflow: hidden; }
.mark { position: absolute; left: 96px; top: 92px; }
.name { position: absolute; left: 96px; top: 206px; font-size: 84px; font-weight: 800; letter-spacing: -0.025em; line-height: 1.02; }
.name span { color: #5FB3C4; }
.lead { position: absolute; left: 96px; top: 408px; width: 470px; font-size: 30px; line-height: 1.3; color: #C3CED3; }
.url { position: absolute; left: 96px; top: 514px; font-size: 22px; font-weight: 600; color: #E6ECEE; padding: 10px 20px; border: 1.5px solid #2A3C43; border-radius: 999px; }
.field { position: absolute; left: 0; top: 0; }
</style></head><body>
<svg class="field" width="1200" height="630" viewBox="0 0 1200 630">${field}</svg>
<div class="mark">${tile(88, 22)}</div>
<div class="name">UW–Madison<br><span>Salaries</span></div>
<div class="lead">What people at UW–Madison are paid. Search anyone by name.</div>
<div class="url">aaronsmetana.github.io/UW-Madison_Salaries</div>
</body></html>`;

writeFileSync(at('public/icon.svg'), `${tile(32, 7)}\n`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await page.setContent(`<html><body style="margin:0">${tile(180, 0)}</body></html>`);
  writeFileSync(at('public/apple-touch-icon.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 180, height: 180 } }));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(card);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(at('public/og-image.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } }));
} finally {
  await browser.close();
}
console.log('wrote public/icon.svg, public/apple-touch-icon.png, public/og-image.png');
