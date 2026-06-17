import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react(), cspPlugin()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
});
