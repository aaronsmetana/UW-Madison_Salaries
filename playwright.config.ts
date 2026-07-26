import { defineConfig, devices } from '@playwright/test';

// Vite's `base` (see vite.config.ts) serves the whole app under this subpath — every baseURL/goto
// call must include it, and specs must always use RELATIVE paths (`./explore`, never `/explore`),
// or a leading slash escapes the base path and 404s.
const BASE_PATH = '/UW-Madison_Salaries/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000, // DuckDB-WASM init (parquet fetch + wasm boot) is slow on a cold page load
  workers: 1, // each test spins up its own DuckDB-WASM instance — too heavy to parallelize
  reporter: 'list',
  use: {
    // `vite preview` binds IPv6 localhost only (no --host flag) — 127.0.0.1 would refuse the
    // connection, so this must stay `localhost`, not the loopback IP.
    baseURL: `http://localhost:4173${BASE_PATH}`,
    serviceWorkers: 'block', // the PWA would otherwise serve stale cached bundles across test runs
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: `http://localhost:4173${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
