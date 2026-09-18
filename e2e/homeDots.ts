import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { oracle, PAY } from './oracle';

/**
 * Who the landing graph's dots are, restated from the page's own drawing rather than from its code, and the
 * page facts the full-page bar must leave alone. Shared by the specs that check what the graph marks and
 * lights (search-reveal, graph-filter).
 */

export const HOME_STATS = JSON.parse(readFileSync(fileURLToPath(new URL('../public/data/home-stats.json', import.meta.url)), 'utf8')) as {
  snapshot_id: string;
  bin_cap: number;
  pay_counts: { lo100: number; counts: number[]; categories: { name: string; over: number; counts: number[] }[] };
  /** The campus median the graph marks (`quantile_cont(pay, 0.5)` over everyone paid). */
  p50: number;
};

/** Everyone paid in the graph's snapshot as the landing page counts them: total actual pay over paid
 *  appointments, in the category of their highest-paid appointment. */
export const people = () => oracle<{ person_key: string; pay: number; cat: string; fn: string; ln: string }>(
  `WITH r AS (SELECT person_key, first_name, last_name, coalesce(employee_category, 'Other') ct, ${PAY} rp FROM $SAL
              WHERE snapshot_id = '${HOME_STATS.snapshot_id}' AND salary > 0)
   SELECT person_key, sum(rp) pay, first(ct ORDER BY rp DESC, ct) cat, any_value(first_name) fn, any_value(last_name) ln
   FROM r GROUP BY person_key HAVING sum(rp) > 0`,
);

/**
 * Each person's dot, by the rule stated from the page's own drawing: under the cap, the dots run $100 by
 * $100, each $100's categories in the artifact's order, and a $100's category's people take its dots by
 * pay, then by key; over the cap, each category's people take a block of the pile in the same order.
 */
export async function spots(): Promise<Map<string, { field: 'main' | 'pile'; index: number }>> {
  const { lo100, counts, categories } = HOME_STATS.pay_counts;
  const cats = categories.map((c) => c.name);
  const rows = await people();
  const byPay = (a: { person_key: string; pay: number }, b: { person_key: string; pay: number }) =>
    a.pay - b.pay || (a.person_key < b.person_key ? -1 : a.person_key > b.person_key ? 1 : 0);
  const out = new Map<string, { field: 'main' | 'pile'; index: number }>();
  let before = 0;
  const groups = new Map<string, typeof rows>();
  for (const p of rows) {
    const key = p.pay >= HOME_STATS.bin_cap ? `over:${p.cat}` : `${Math.floor(p.pay / 100)}:${p.cat}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (let b = 0; b < counts.length; b++) {
    let at = before;
    for (let c = 0; c < cats.length; c++) {
      const list = (groups.get(`${lo100 + b}:${cats[c]}`) ?? []).sort(byPay);
      list.forEach((p, k) => out.set(p.person_key, { field: 'main', index: at + k }));
      at += categories[c].counts[b];
    }
    before += counts[b];
  }
  let at = 0;
  for (let c = 0; c < cats.length; c++) {
    (groups.get(`over:${cats[c]}`) ?? []).sort(byPay).forEach((p, k) => out.set(p.person_key, { field: 'pile', index: at + k }));
    at += categories[c].over;
  }
  return out;
}

/** The plot full page, and how its dots are laid out: what the bar must never change. */
export async function plotShape(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.hero-dist-full .hero-dist-main')!.getBoundingClientRect();
    const dots = document.querySelector('.hero-dist-full .hero-dots') as HTMLElement;
    return { x: main.x, y: main.y, w: main.width, h: main.height, laidW: dots.dataset.width, laidH: dots.getBoundingClientRect().height };
  });
}
/** The bar's pieces that lie on the plot or the pile, if any. */
export async function barOverPlot(page: Page) {
  return page.evaluate(() => {
    const R = (e: Element) => e.getBoundingClientRect();
    const main = R(document.querySelector('.hero-dist-full .hero-dist-main')!);
    const pileEl = document.querySelector('.hero-dist-full .hero-dist-pile');
    const pile = pileEl ? R(pileEl) : null;
    const hit = (a: DOMRect, b: DOMRect | null) => !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return [...document.querySelectorAll('.hero-dist-full .hero-dist-search, .hero-dist-full .hero-dist-search *')]
      .filter((el) => { const r = R(el); return r.width > 0 && r.height > 0 && (hit(r, main) || hit(r, pile)); })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60));
  });
}
