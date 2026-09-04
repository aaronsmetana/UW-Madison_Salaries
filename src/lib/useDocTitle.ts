import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_NAME = 'UW–Madison Salaries';

/**
 * Query parameters that change *what a page is about* rather than how you are looking at it.
 *
 * `?tab=history` and `?type=comparison` are views of the same content, so they must not become
 * separate canonical URLs; `?code=IT040` is the difference between one title page and 1,329 others,
 * so it must.
 */
const CANONICAL_PARAMS = ['code', 'sch'];

function setMeta(selector: string, value: string): string | null {
  const el = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
  if (!el) return null;
  const attr = el instanceof HTMLLinkElement ? 'href' : 'content';
  const prev = el.getAttribute(attr);
  el.setAttribute(attr, value);
  return prev;
}

/**
 * Sets document.title to "{title} · SITE_NAME" for as long as the calling route is mounted, restoring
 * the previous title on unmount — so browser history/tabs/bookmarks read as more than one generic name.
 *
 * It also points the canonical link and the social-card title at this page. index.html hard-codes both
 * to the landing page, and index.html is what every route loads, so all ~22,000 person pages were
 * telling search engines they were duplicates of the front door.
 *
 * Worth being plain about the limit: this is a client-rendered app on GitHub Pages, so only crawlers
 * that execute JavaScript ever see these values. Link unfurlers — Slack, Teams, Twitter — read the
 * served HTML and will keep showing the site-level card until routes are prerendered, which is a
 * different piece of work than this.
 */
export function useDocTitle(title: string | null | undefined): void {
  // Several routes pass a constant title ("Titles") while the address genuinely changes underneath
  // them (`?code=IT040` -> `?code=FA020`). Keying only on the title would leave the canonical URL
  // pointing at whichever title page happened to mount first.
  const loc = useLocation();
  useEffect(() => {
    const full = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    const prevTitle = document.title;
    document.title = full;

    const url = new URL(window.location.href);
    const keep = new URLSearchParams();
    for (const k of CANONICAL_PARAMS) {
      const v = url.searchParams.get(k);
      if (v) keep.set(k, v);
    }
    const canonical = `${url.origin}${url.pathname}${keep.toString() ? `?${keep}` : ''}`;

    const restore: Array<[string, string | null]> = [
      ['link[rel="canonical"]', setMeta('link[rel="canonical"]', canonical)],
      ['meta[property="og:url"]', setMeta('meta[property="og:url"]', canonical)],
      ['meta[property="og:title"]', setMeta('meta[property="og:title"]', full)],
      ['meta[name="twitter:title"]', setMeta('meta[name="twitter:title"]', full)],
    ];

    return () => {
      document.title = prevTitle;
      for (const [selector, prev] of restore) if (prev != null) setMeta(selector, prev);
    };
  }, [title, loc.pathname, loc.search]);
}
