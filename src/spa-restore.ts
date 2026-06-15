// Restores the deep-link path stashed by 404.html (GitHub Pages SPA fallback).
// Imported first in main.tsx so it runs before the router reads window.location.
const l = window.location;
if (l.search[1] === '/') {
  const decoded = l.search
    .slice(1)
    .split('&')
    .map((s) => s.replace(/~and~/g, '&'))
    .join('?');
  window.history.replaceState(null, '', l.pathname.slice(0, -1) + decoded + l.hash);
}
