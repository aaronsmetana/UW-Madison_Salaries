import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Self-hosted, no third-party origins. 'wasm-unsafe-eval' is required for DuckDB-WASM;
// worker-src allows the bundled (same-origin) DuckDB worker; style 'unsafe-inline' for Mantine.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

// Inject the CSP <meta> only into the production build (keeps dev/HMR working).
function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</head>', `    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`);
    },
  };
}

export default defineConfig({
  base: '/UW-Madison_Salaries/',
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      // We call registerSW() ourselves (src/main.tsx) via the virtual module, so skip the
      // plugin's own injected bootstrap script.
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: {
        name: 'UW–Madison Salaries',
        short_name: 'UW Salaries',
        description: 'Search, compare, and explore public-record salary data across UW–Madison.',
        theme_color: '#0E6E83',
        background_color: '#0a2530',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Exclude .wasm from precache (the two DuckDB bundles are large) — cached at runtime instead.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'wasm-cache', expiration: { maxEntries: 4 } },
          },
          {
            // The parquet + manifest/summary/grades/home-stats JSON: serve instantly from cache,
            // refresh in the background so a stale visit still gets this deploy's data next time.
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'data-cache', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
});
